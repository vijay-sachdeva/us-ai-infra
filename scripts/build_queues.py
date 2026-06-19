#!/usr/bin/env python3
"""LBNL queue snapshot + withdrawal haircut -> data/queues.json. Stdlib only."""
import csv, json, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
WITHDRAWAL = 0.78   # LBNL: ~78% of queued capacity historically withdraws


def main():
    rows, vintage = [], None
    with open(ROOT / "scripts/data_sources/queue_by_iso.csv") as f:
        for r in csv.DictReader(f):
            gw = float(r["active_gw"]); vintage = r.get("vintage")
            rows.append({"iso": r["iso"], "active_gw": round(gw),
                         "credible_gw": round(gw * (1 - WITHDRAWAL))})
    rows.sort(key=lambda d: -d["active_gw"])
    out = {"lastUpdated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "tier": "analyst", "source": f"LBNL Queued Up ({vintage})", "withdrawal_rate": WITHDRAWAL, "iso": rows}
    (ROOT / "data").mkdir(exist_ok=True)
    json.dump(out, open(ROOT / "data/queues.json", "w"), indent=2)
    print(f"[queues] wrote {len(rows)} ISOs")


if __name__ == "__main__":
    main()
