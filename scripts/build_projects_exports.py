#!/usr/bin/env python3
"""Regenerate data/projects.csv and data/projects.geojson from data/projects.json.

projects.json is the canonical source; these flat/geo exports are derived. Run after
editing projects.json:  python scripts/build_projects_exports.py
Stdlib-only (no deps), so it runs anywhere / in CI.
"""
import csv, io, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "projects.json")

COLS = ["id", "name", "operator", "state", "lat", "lon", "coord_precision",
        "capacity_mw", "capacity_type", "status", "status_as_of",
        "power_generation", "power_model", "provenance", "transformation",
        "confidence", "primary_source_url", "primary_source_publisher"]


def primary_source(rec):
    srcs = rec.get("sources", []) or []
    s = next((x for x in srcs if x.get("url") and x.get("supports_claim")), None) \
        or next((x for x in srcs if x.get("url")), None) or {}
    return s.get("url", ""), s.get("publisher", "")


def main():
    d = json.load(open(SRC, encoding="utf-8"))
    recs = d["records"]

    with io.open(os.path.join(ROOT, "data", "projects.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(COLS)
        for r in recs:
            loc, pw = r.get("location") or {}, r.get("power") or {}
            url, pub = primary_source(r)
            w.writerow([r["id"], r["name"], r["operator"], r["state"],
                        loc.get("lat", ""), loc.get("lon", ""), loc.get("precision", ""),
                        r.get("capacity_mw", ""), r.get("capacity_type", ""),
                        r.get("status", ""), r.get("status_as_of", ""),
                        pw.get("generation", ""), pw.get("model", ""),
                        r.get("provenance", ""), r.get("transformation", ""),
                        r.get("confidence", ""), url, pub])

    feats = []
    for r in recs:
        loc = r.get("location") or {}
        if loc.get("lat") is None or loc.get("lon") is None:
            continue
        pw = r.get("power") or {}
        url, _ = primary_source(r)
        feats.append({"type": "Feature",
                      "geometry": {"type": "Point", "coordinates": [loc["lon"], loc["lat"]]},
                      "properties": {"id": r["id"], "name": r["name"], "operator": r["operator"],
                                     "state": r["state"], "capacity_mw": r.get("capacity_mw"),
                                     "capacity_type": r.get("capacity_type"), "status": r.get("status"),
                                     "power_model": pw.get("model"), "confidence": r.get("confidence"),
                                     "source_url": url}})
    gj = {"type": "FeatureCollection", "name": "US AI data-center projects",
          "license": "CC-BY-4.0", "attribution": d.get("attribution", ""), "features": feats}
    open(os.path.join(ROOT, "data", "projects.geojson"), "w", encoding="utf-8").write(
        json.dumps(gj, ensure_ascii=False, indent=1))

    print("projects.csv: %d rows · projects.geojson: %d features" % (len(recs), len(feats)))


if __name__ == "__main__":
    main()
