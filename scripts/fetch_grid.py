#!/usr/bin/env python3
"""EIA-930 hourly demand (+ committed capacity) -> data/grid.json. Stdlib only."""
import os, csv, json, datetime, pathlib, urllib.parse, urllib.request

EIA_KEY = os.environ["EIA_API_KEY"]
ROOT = pathlib.Path(__file__).resolve().parents[1]
BAS = ["PJM", "MISO", "SWPP", "ERCO", "CISO", "ISNE", "NYIS", "SOCO", "DUK"]   # EIA respondent codes


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc)


def capacity():
    out = {}
    with open(ROOT / "scripts/data_sources/ba_capacity_mw.csv") as f:
        for row in csv.DictReader(f):
            out[row["ba"]] = float(row["capacity_mw"])
    return out


def demand(ba, start, end):
    base = "https://api.eia.gov/v2/electricity/rto/region-data/data/"
    qs = {"api_key": EIA_KEY, "frequency": "hourly", "data[0]": "value",
          "facets[respondent][]": ba, "facets[type][]": "D",            # D = demand
          "start": start, "end": end,
          "sort[0][column]": "period", "sort[0][direction]": "desc", "length": 5000}
    url = base + "?" + urllib.parse.urlencode(qs, doseq=True)
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)["response"]["data"]


def main():
    now = utc_now()
    start = (now - datetime.timedelta(days=21)).strftime("%Y-%m-%dT00")
    end = now.strftime("%Y-%m-%dT%H")
    cap = capacity()
    regions = {}
    for ba in BAS:
        try:
            vals = [float(x["value"]) for x in demand(ba, start, end) if x.get("value") is not None]
        except Exception as e:
            print(f"[grid] {ba} skipped: {e}"); continue
        if not vals:
            continue
        peak = round(max(vals)); c = cap.get(ba)
        regions[ba] = {"peak_mw": peak, "avg_mw": round(sum(vals) / len(vals)), "latest_mw": round(vals[0]),
                       "capacity_mw": (round(c) if c else None),
                       "headroom_pct": (round(100 * (c - peak) / c, 1) if c and c > peak else (0.0 if c else None))}
    out = {"lastUpdated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "tier": "primary",
           "source": "EIA-930 (demand) + EIA-860 (capacity)", "regions": regions}
    (ROOT / "data").mkdir(exist_ok=True)
    json.dump(out, open(ROOT / "data/grid.json", "w"), indent=2)
    print(f"[grid] wrote {len(regions)} regions")


if __name__ == "__main__":
    main()
