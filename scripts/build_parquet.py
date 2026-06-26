#!/usr/bin/env python3
"""Regenerate data/projects.parquet from data/projects.json.

projects.json is the canonical source; this columnar export mirrors the column set
and primary-source selection of scripts/build_projects_exports.py (the CSV/GeoJSON
exporter) so projects.csv and projects.parquet stay row-for-row identical. Run after
editing projects.json:  python scripts/build_parquet.py

Requires pandas + pyarrow (not stdlib):  pip install pandas pyarrow
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "projects.json")
OUT = os.path.join(ROOT, "data", "projects.parquet")

# Column order mirrors scripts/build_projects_exports.py COLS so the Parquet and CSV
# exports stay aligned. Keep the two lists in sync if either changes.
COLS = ["id", "name", "operator", "state", "lat", "lon", "coord_precision",
        "capacity_mw", "capacity_type", "status", "status_as_of",
        "power_generation", "power_model", "provenance", "transformation",
        "confidence", "primary_source_url", "primary_source_publisher"]


def primary_source(rec):
    """Same selection rule as the CSV/GeoJSON exporter: first source with a URL that
    supports the claim, else first source with any URL, else empty."""
    srcs = rec.get("sources", []) or []
    s = next((x for x in srcs if x.get("url") and x.get("supports_claim")), None) \
        or next((x for x in srcs if x.get("url")), None) or {}
    return s.get("url", ""), s.get("publisher", "")


def row(rec):
    """Flatten one ledger record into a dict keyed by COLS. Missing/null values become
    None so pandas/pyarrow can represent them as proper nulls rather than empty strings."""
    loc = rec.get("location") or {}
    pw = rec.get("power") or {}
    url, pub = primary_source(rec)
    return {
        "id": rec.get("id"),
        "name": rec.get("name"),
        "operator": rec.get("operator"),
        "state": rec.get("state"),
        "lat": loc.get("lat"),
        "lon": loc.get("lon"),
        "coord_precision": loc.get("precision"),
        "capacity_mw": rec.get("capacity_mw"),
        "capacity_type": rec.get("capacity_type"),
        "status": rec.get("status"),
        "status_as_of": rec.get("status_as_of"),
        "power_generation": pw.get("generation"),
        "power_model": pw.get("model"),
        "provenance": rec.get("provenance"),
        "transformation": rec.get("transformation"),
        "confidence": rec.get("confidence"),
        "primary_source_url": url or None,
        "primary_source_publisher": pub or None,
    }


def main():
    try:
        import pandas as pd
    except ImportError:
        sys.stderr.write(
            "build_parquet.py needs pandas + pyarrow: pip install pandas pyarrow\n")
        raise

    with open(SRC, encoding="utf-8") as f:
        d = json.load(f)
    recs = d.get("records", []) or []

    df = pd.DataFrame([row(r) for r in recs], columns=COLS)

    # Stable dtypes: nullable integer for MW, float for coords, string elsewhere.
    df["capacity_mw"] = pd.to_numeric(df["capacity_mw"], errors="coerce").astype("Int64")
    df["lat"] = pd.to_numeric(df["lat"], errors="coerce").astype("float64")
    df["lon"] = pd.to_numeric(df["lon"], errors="coerce").astype("float64")
    for c in df.columns:
        if c not in ("capacity_mw", "lat", "lon"):
            df[c] = df[c].astype("string")

    # pyarrow is the parquet engine; surface a clear message if it is missing.
    try:
        df.to_parquet(OUT, engine="pyarrow", index=False)
    except ImportError:
        sys.stderr.write(
            "build_parquet.py needs pyarrow for parquet output: pip install pyarrow\n")
        raise

    print("projects.parquet: %d rows · %d cols" % (len(df), len(COLS)))


if __name__ == "__main__":
    main()
