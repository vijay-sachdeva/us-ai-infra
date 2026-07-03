#!/usr/bin/env python3
"""Per-push data-quality gate for the US AI Infrastructure Monitor ledger.

These tests are FAST and OFFLINE (no network) so they can run on every push/PR.
They cover the audit's structural asks:

  (a) data/projects.json validates against schemas/projects.schema.json
  (b) every record's provenance / transformation / confidence is in the schema enums
  (c) data/projects.csv and data/projects.geojson are regenerable from projects.json
      and in sync with what is committed (we import the real builder logic from
      scripts/build_projects_exports.py and compare its output -- we never shell out)
  (d) data/sources.json structural integrity (linkable entries have a URL, the
      url<->linkable invariant holds, provenance is in the allowed set)
  (e) location lat/lon fall in a US-ish range whenever precision != 'unknown'
  (f) capacity_mw is positive when present

Run locally:
    pip install jsonschema pytest
    pytest tests/test_data_quality.py -v

Dependency: 'jsonschema' (only used for test (a)). Everything else is stdlib.
"""
import csv
import importlib.util
import io
import json
import os

import pytest

# --------------------------------------------------------------------------- #
# Paths -- resolved relative to the repo root (this file lives in tests/).
# --------------------------------------------------------------------------- #
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SCHEMAS = os.path.join(ROOT, "schemas")
SCRIPTS = os.path.join(ROOT, "scripts")

PROJECTS_JSON = os.path.join(DATA, "projects.json")
PROJECTS_CSV = os.path.join(DATA, "projects.csv")
PROJECTS_GEOJSON = os.path.join(DATA, "projects.geojson")
SOURCES_JSON = os.path.join(DATA, "sources.json")
SCHEMA_PATH = os.path.join(SCHEMAS, "projects.schema.json")
BUILDER_PATH = os.path.join(SCRIPTS, "build_projects_exports.py")

# Continental-US-ish bounding box, padded to comfortably include AK/HI and
# coordinate slop. Records flagged precision != 'unknown' must fall inside it.
US_LAT_MIN, US_LAT_MAX = 17.0, 72.0      # ~Hawaii up through Alaska's North Slope
US_LON_MIN, US_LON_MAX = -180.0, -64.0   # Aleutians (~ -179) through Maine (~ -66)


# --------------------------------------------------------------------------- #
# Small loaders / helpers.
# --------------------------------------------------------------------------- #
def _load_json(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _enum(schema, *path):
    """Walk schema['$defs']... and return the 'enum' list at the given key path."""
    node = schema
    for key in path:
        node = node[key]
    return node["enum"]


def _import_builder():
    """Import scripts/build_projects_exports.py as a module (no shelling out).

    The builder is stdlib-only and its top-level code is guarded by
    `if __name__ == '__main__'`, so importing it does NOT regenerate any files.
    We reuse its COLS list and primary_source() so the test asserts against the
    exact logic that produces the committed exports.
    """
    spec = importlib.util.spec_from_file_location("build_projects_exports", BUILDER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# --------------------------------------------------------------------------- #
# Module-level fixtures (loaded once).
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def schema():
    return _load_json(SCHEMA_PATH)


@pytest.fixture(scope="module")
def projects():
    return _load_json(PROJECTS_JSON)


@pytest.fixture(scope="module")
def records(projects):
    return projects["records"]


@pytest.fixture(scope="module")
def sources():
    return _load_json(SOURCES_JSON)


@pytest.fixture(scope="module")
def builder():
    return _import_builder()


# --------------------------------------------------------------------------- #
# (a) Schema validation.
# --------------------------------------------------------------------------- #
def test_projects_validates_against_schema(projects, schema):
    jsonschema = pytest.importorskip(
        "jsonschema",
        reason="pip install jsonschema to run schema validation",
    )
    # Draft 2020-12 per the schema's $schema declaration.
    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    errors = sorted(validator.iter_errors(projects), key=lambda e: list(e.path))
    assert not errors, "projects.json failed schema validation:\n" + "\n".join(
        "  at %s: %s" % ("/".join(str(p) for p in e.path) or "<root>", e.message)
        for e in errors
    )


def test_record_count_matches_records(projects, records):
    # record_count is advisory in the schema; if present it should be honest.
    if "record_count" in projects:
        assert projects["record_count"] == len(records), (
            "record_count (%s) != len(records) (%s)"
            % (projects["record_count"], len(records))
        )


def test_record_ids_unique(records):
    ids = [r["id"] for r in records]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    assert not dupes, "duplicate record ids: %s" % dupes


# --------------------------------------------------------------------------- #
# (b) Enum membership for the classification fields on every record.
# --------------------------------------------------------------------------- #
def test_record_classification_fields_in_enums(records, schema):
    prov_enum = _enum(schema, "$defs", "project", "properties", "provenance")
    trans_enum = _enum(schema, "$defs", "project", "properties", "transformation")
    conf_enum = _enum(schema, "$defs", "project", "properties", "confidence")

    bad = []
    for r in records:
        rid = r.get("id", "<no-id>")
        if r.get("provenance") not in prov_enum:
            bad.append("%s: provenance=%r not in %s" % (rid, r.get("provenance"), prov_enum))
        if r.get("transformation") not in trans_enum:
            bad.append("%s: transformation=%r not in %s" % (rid, r.get("transformation"), trans_enum))
        if r.get("confidence") not in conf_enum:
            bad.append("%s: confidence=%r not in %s" % (rid, r.get("confidence"), conf_enum))
    assert not bad, "classification fields out of enum:\n" + "\n".join(bad)


def test_record_source_provenance_in_enum(records, schema):
    src_prov_enum = _enum(schema, "$defs", "source", "properties", "provenance")
    bad = []
    for r in records:
        for s in r.get("sources", []) or []:
            if s.get("provenance") not in src_prov_enum:
                bad.append(
                    "%s / %s: source provenance=%r not in %s"
                    % (r.get("id"), s.get("source_id"), s.get("provenance"), src_prov_enum)
                )
    assert not bad, "source provenance out of enum:\n" + "\n".join(bad)


# --------------------------------------------------------------------------- #
# (c) CSV / GeoJSON exports are regenerable and in sync with projects.json.
#
# We import the real builder logic and rebuild the rows/features in memory, then
# compare to what is committed. CSV is compared row-by-row (so CRLF-vs-LF and
# trailing-newline differences don't cause false failures); GeoJSON is compared
# as parsed objects (so indentation / key-order / trailing whitespace don't
# matter -- only the data does).
# --------------------------------------------------------------------------- #
def _expected_csv_rows(records, builder):
    rows = [list(builder.COLS)]
    for r in records:
        loc = r.get("location") or {}
        pw = r.get("power") or {}
        url, pub = builder.primary_source(r)
        rows.append([
            r["id"], r["name"], r["operator"], r["state"],
            loc.get("lat", ""), loc.get("lon", ""), loc.get("precision", ""),
            r.get("capacity_mw", ""), r.get("capacity_type", ""),
            r.get("status", ""), r.get("status_as_of", ""),
            pw.get("generation", ""), pw.get("model", ""),
            r.get("provenance", ""), r.get("transformation", ""),
            r.get("confidence", ""), url, pub,
        ])
    # Round-trip through csv so numbers/empties are stringified exactly as the
    # writer would emit them, giving an apples-to-apples comparison.
    buf = io.StringIO()
    w = csv.writer(buf)
    for row in rows:
        w.writerow(row)
    return list(csv.reader(io.StringIO(buf.getvalue())))


def test_csv_in_sync_with_projects_json(records, builder):
    expected = _expected_csv_rows(records, builder)
    with io.open(PROJECTS_CSV, encoding="utf-8", newline="") as fh:
        committed = list(csv.reader(fh))
    assert committed == expected, (
        "data/projects.csv is out of sync with data/projects.json.\n"
        "Regenerate it:  python scripts/build_projects_exports.py\n"
        "First differing row index: %s"
        % next(
            (i for i, (a, b) in enumerate(zip(committed, expected)) if a != b),
            "len(%d) vs len(%d)" % (len(committed), len(expected)),
        )
    )


def _expected_geojson(projects, builder):
    records = projects["records"]
    feats = []
    for r in records:
        loc = r.get("location") or {}
        if loc.get("lat") is None or loc.get("lon") is None:
            continue
        pw = r.get("power") or {}
        url, _ = builder.primary_source(r)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [loc["lon"], loc["lat"]]},
            "properties": {
                "id": r["id"], "name": r["name"], "operator": r["operator"],
                "state": r["state"], "capacity_mw": r.get("capacity_mw"),
                "capacity_type": r.get("capacity_type"), "status": r.get("status"),
                "power_model": pw.get("model"), "confidence": r.get("confidence"),
                "source_url": url,
            },
        })
    return {
        "type": "FeatureCollection",
        "name": "US AI data-center projects",
        "license": "CC-BY-4.0",
        "attribution": projects.get("attribution", ""),
        "features": feats,
    }


def test_geojson_in_sync_with_projects_json(projects, builder):
    expected = _expected_geojson(projects, builder)
    committed = _load_json(PROJECTS_GEOJSON)
    assert committed == expected, (
        "data/projects.geojson is out of sync with data/projects.json.\n"
        "Regenerate it:  python scripts/build_projects_exports.py"
    )


def test_geojson_only_omits_records_without_coords(projects, builder):
    # The builder drops records with null lat/lon. Confirm the feature count
    # equals the number of records that DO have both coordinates.
    records = projects["records"]
    with_coords = [
        r for r in records
        if (r.get("location") or {}).get("lat") is not None
        and (r.get("location") or {}).get("lon") is not None
    ]
    gj = _load_json(PROJECTS_GEOJSON)
    assert len(gj["features"]) == len(with_coords), (
        "geojson has %d features but %d records have coordinates"
        % (len(gj["features"]), len(with_coords))
    )


# --------------------------------------------------------------------------- #
# (d) sources.json structural integrity.
#
# sources.json is the dashboard-wide source ledger. Its source provenance set
# is the schema's source enum PLUS 'modeled' (modeled/derived composites that
# legitimately carry no external URL). We allow that superset here.
# --------------------------------------------------------------------------- #
def _sources_allowed_provenance(schema):
    base = set(_enum(schema, "$defs", "source", "properties", "provenance"))
    # Dashboard ledger additionally uses 'modeled' for derived/composite refs.
    return base | {"modeled"}


def test_sources_top_level_shape(sources):
    assert isinstance(sources, dict), "sources.json must be a JSON object"
    assert isinstance(sources.get("ledger"), list), "sources.json must have a 'ledger' array"
    assert sources["ledger"], "sources.json ledger must not be empty"


def test_sources_entries_well_formed(sources, schema):
    allowed = _sources_allowed_provenance(schema)
    bad = []
    for i, e in enumerate(sources["ledger"]):
        tag = "ledger[%d] (%r)" % (i, e.get("label", "<no-label>"))
        if not isinstance(e, dict):
            bad.append("%s: not an object" % tag)
            continue
        if not e.get("label"):
            bad.append("%s: missing/empty label" % tag)
        if "linkable" not in e or not isinstance(e["linkable"], bool):
            bad.append("%s: 'linkable' must be a boolean" % tag)
        if e.get("provenance") not in allowed:
            bad.append("%s: provenance=%r not in %s" % (tag, e.get("provenance"), sorted(allowed)))
    assert not bad, "malformed sources.json entries:\n" + "\n".join(bad)


def test_sources_linkable_url_invariant(sources):
    """linkable == True  <=>  a non-empty http(s) URL is present."""
    bad = []
    for i, e in enumerate(sources["ledger"]):
        tag = "ledger[%d] (%r)" % (i, e.get("label", "<no-label>"))
        url = e.get("url")
        has_url = bool(url) and isinstance(url, str) and url.startswith(("http://", "https://"))
        if e.get("linkable") and not has_url:
            bad.append("%s: linkable=true but url is missing/non-http (%r)" % (tag, url))
        if has_url and not e.get("linkable"):
            bad.append("%s: has a URL (%r) but linkable=false" % (tag, url))
        if not e.get("linkable") and url not in (None, ""):
            bad.append("%s: linkable=false should carry no url, got %r" % (tag, url))
    assert not bad, "sources.json linkable/url invariant violated:\n" + "\n".join(bad)


# --------------------------------------------------------------------------- #
# (e) Coordinate sanity: lat/lon present and US-ranged unless precision unknown.
# --------------------------------------------------------------------------- #
def test_coordinates_us_ranged_when_precise(records):
    bad = []
    for r in records:
        loc = r.get("location") or {}
        precision = loc.get("precision")
        lat, lon = loc.get("lat"), loc.get("lon")
        if precision == "unknown":
            # Undisclosed sites are expected to carry null coordinates.
            continue
        rid = r.get("id", "<no-id>")
        if lat is None or lon is None:
            bad.append("%s: precision=%r but lat/lon is null" % (rid, precision))
            continue
        if not (US_LAT_MIN <= lat <= US_LAT_MAX):
            bad.append("%s: lat %s out of US range [%s, %s]" % (rid, lat, US_LAT_MIN, US_LAT_MAX))
        if not (US_LON_MIN <= lon <= US_LON_MAX):
            bad.append("%s: lon %s out of US range [%s, %s]" % (rid, lon, US_LON_MIN, US_LON_MAX))
    assert not bad, "coordinate sanity failures:\n" + "\n".join(bad)


# --------------------------------------------------------------------------- #
# (f) capacity_mw must be a positive number when present (non-null).
# --------------------------------------------------------------------------- #
def test_capacity_mw_positive_when_present(records):
    bad = []
    for r in records:
        cap = r.get("capacity_mw")
        if cap is None:
            continue
        if not isinstance(cap, (int, float)) or isinstance(cap, bool):
            bad.append("%s: capacity_mw=%r is not a number" % (r.get("id"), cap))
        elif cap <= 0:
            bad.append("%s: capacity_mw=%r is not positive" % (r.get("id"), cap))
    assert not bad, "capacity_mw failures:\n" + "\n".join(bad)


# --------------------------------------------------------------------------- #
# (g) Curated-module staleness gate. Every CHART_META entry in app.js carries a
#     reviewed: "YYYY-MM" stamp — when a curator last re-verified that module's
#     numbers. The UI shows an amber "review due" pill past ~100 days; this test
#     FAILS the merge gate past 150 days, so a rotting curated panel breaks CI
#     before it misleads a journalist. Fix = re-verify the module's figures and
#     bump its reviewed stamp (never bump without re-verifying).
# --------------------------------------------------------------------------- #
def test_curated_modules_not_stale():
    import datetime
    import re
    app_js = os.path.join(ROOT, "app.js")
    if not os.path.exists(app_js):
        pytest.skip("app.js not present")
    with io.open(app_js, encoding="utf-8") as fh:
        src = fh.read()
    start = src.find("const CHART_META")
    end = src.find("};", start)
    block = src[start:end]
    entries = re.findall(r"^\s{4}(\w+): \{ reviewed: \"(\d{4})-(\d{2})\"", block, re.M)
    assert entries, "no reviewed: stamps found in CHART_META — staleness gate misconfigured"
    today = datetime.date.today()
    stale = []
    for cid, yy, mm in entries:
        reviewed = datetime.date(int(yy), int(mm), 1)
        age = (today - reviewed).days
        if age > 150:
            stale.append("%s: reviewed %s-%s (%d days ago)" % (cid, yy, mm, age))
    assert not stale, (
        "curated modules past the 150-day re-verification threshold — re-verify their "
        "figures against sources and bump the reviewed stamp:\n" + "\n".join(stale))


if __name__ == "__main__":
    raise SystemExit(pytest.main([os.path.abspath(__file__), "-v"]))
