#!/usr/bin/env python3
"""EIA retail-sales industrial price by state -> data/power_econ.json. Stdlib only."""
import os, json, datetime, pathlib, urllib.parse, urllib.request

EIA_KEY = os.environ["EIA_API_KEY"]
ROOT = pathlib.Path(__file__).resolve().parents[1]


def series():
    base = "https://api.eia.gov/v2/electricity/retail-sales/data/"
    qs = {"api_key": EIA_KEY, "frequency": "monthly", "data[0]": "price",
          "facets[sectorid][]": "IND",
          "sort[0][column]": "period", "sort[0][direction]": "desc", "length": 5000}
    url = base + "?" + urllib.parse.urlencode(qs, doseq=True)
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)["response"]["data"]


def main():
    latest = {}   # stateid -> most recent IND price (cents/kWh)
    period = None
    for row in series():
        st = row.get("stateid"); p = row.get("price")
        if not st or p is None or len(st) != 2:
            continue   # skip regions/US totals
        if st not in latest:
            latest[st] = float(p); period = period or row.get("period")
    states = {st: {"ind_cents_kwh": round(c, 2), "ind_usd_mwh": round(c * 10, 1)} for st, c in latest.items()}
    out = {"lastUpdated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "tier": "primary", "source": "EIA retail-sales (sector IND)", "period": period, "states": states}
    (ROOT / "data").mkdir(exist_ok=True)
    json.dump(out, open(ROOT / "data/power_econ.json", "w"), indent=2)
    print(f"[power_econ] wrote {len(states)} states for {period}")


if __name__ == "__main__":
    main()
