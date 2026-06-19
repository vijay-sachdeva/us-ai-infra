#!/usr/bin/env python3
"""Join grid + queues + power_econ into a per-state white-space score -> data/siting.json.
Modeled, state/ISO-resolution. Front-end maps county FIPS -> state FIPS -> score."""
import json, datetime, pathlib
from _states import ABBR_TO_FIPS, STATE_BA, STATE_ISO

ROOT = pathlib.Path(__file__).resolve().parents[1]
W = {"headroom": 0.45, "congestion": 0.33, "price": 0.22}   # renormalized (dist-to-tx is Phase 2)


def load(name):
    return json.load(open(ROOT / f"data/{name}.json"))


def norm(v, lo, hi):
    return 0.5 if hi <= lo else max(0.0, min(1.0, (v - lo) / (hi - lo)))


def main():
    grid, queues, econ = load("grid"), load("queues"), load("power_econ")
    headroom = {ba: r.get("headroom_pct") for ba, r in grid["regions"].items()}
    hv = [h for h in headroom.values() if h is not None]
    median_h = sorted(hv)[len(hv) // 2] if hv else 5.0
    congestion = {r["iso"]: r["active_gw"] for r in queues["iso"]}
    price = {st: d["ind_usd_mwh"] for st, d in econ["states"].items()}
    h_lo, h_hi = (min(hv), max(hv)) if hv else (0, 10)
    c_lo, c_hi = (min(congestion.values()), max(congestion.values())) if congestion else (0, 1)
    p_lo, p_hi = (min(price.values()), max(price.values())) if price else (0, 1)
    scores = {}
    for st, fips in ABBR_TO_FIPS.items():
        h = headroom.get(STATE_BA.get(st), median_h) or median_h
        c = congestion.get(STATE_ISO.get(st), (c_lo + c_hi) / 2)
        p = price.get(st, (p_lo + p_hi) / 2)
        score = 100 * (W["headroom"] * norm(h, h_lo, h_hi)
                       + W["congestion"] * (1 - norm(c, c_lo, c_hi))
                       + W["price"] * (1 - norm(p, p_lo, p_hi)))
        scores[fips] = round(score)
    out = {"lastUpdated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "tier": "modeled",
           "resolution": "state/ISO inputs (county-true geometry is Phase 2)",
           "formula": "0.45·headroom + 0.33·(1−queue_congestion) + 0.22·(1−industrial_price)",
           "inputs": {"headroom": "EIA-930+860", "congestion": "LBNL", "price": "EIA-861"},
           "states": scores}
    (ROOT / "data").mkdir(exist_ok=True)
    json.dump(out, open(ROOT / "data/siting.json", "w"), indent=2)
    print(f"[siting] wrote {len(scores)} states")


if __name__ == "__main__":
    main()
