#!/usr/bin/env python3
"""Compute "what changed" deltas from data/history/*.csv -> data/changes.json.

The dashboard's history CSVs accumulate a dated snapshot per feed per day
(scripts/archive_history.py). This derives the week-over-week movements a
reader would otherwise have to diff by hand:

  * projects:   latest ledger snapshot vs the most recent snapshot >= MIN_GAP
                days older — new records, removed records, status flips,
                capacity revisions. (Structural: the ledger only re-archives
                when the source dataset changes.)
  * gpu_prices: latest $/GPU-hr per provider x SKU vs the observation nearest
                WINDOW days earlier — price moves + newly/no-longer listed SKUs.
  * queues:     latest LBNL queue GW per ISO vs prior — annual source data, so
                "no change" is the normal, honest state (rendered as such).

Deliberately EXCLUDED: grid.csv headroom/peaks (weekly deltas are weather, not
structure) and power_econ.csv (monthly EIA period advances rarely; a delta
computed across identical periods would be noise).

Honesty rules: every item carries the source label from its history row; if a
feed lacks a >= MIN_GAP-day-older snapshot the section reports that instead of
faking a comparison; numbers are diffs of archived values, never estimates.
Tier: computed — arithmetic over the cited feeds, tagged as such in the UI.
"""

from __future__ import annotations

import csv
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HIST = ROOT / "data" / "history"
OUT = ROOT / "data" / "changes.json"

WINDOW_DAYS = 7   # target comparison window
MIN_GAP_DAYS = 3  # smallest gap that still counts as a comparison


def _rows(feed: str) -> list[dict]:
    p = HIST / f"{feed}.csv"
    if not p.exists():
        return []
    with open(p, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def _dates(rows: list[dict]) -> list[str]:
    return sorted({r["date"] for r in rows if r.get("date")})


def _baseline(dates: list[str], latest: str) -> str | None:
    """The snapshot date closest to (latest - WINDOW), at least MIN_GAP days older."""
    d_latest = datetime.strptime(latest, "%Y-%m-%d")
    cutoff = d_latest - timedelta(days=MIN_GAP_DAYS)
    target = d_latest - timedelta(days=WINDOW_DAYS)
    older = [d for d in dates if datetime.strptime(d, "%Y-%m-%d") <= cutoff]
    if not older:
        return None
    return min(older, key=lambda d: abs((datetime.strptime(d, "%Y-%m-%d") - target).days))


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _gap_note(sec: dict) -> None:
    """Honesty guard: when a comparison spans well past the target window (structural feeds
    re-archive only on change), say so explicitly rather than hiding behind '~7 days'."""
    if not sec.get("baseline") or not sec.get("latest"):
        return
    gap = (datetime.strptime(sec["latest"], "%Y-%m-%d") - datetime.strptime(sec["baseline"], "%Y-%m-%d")).days
    if gap > 2 * WINDOW_DAYS:
        sec["window_note"] = f"vs the previous revision, {gap} days earlier"


def projects_section() -> dict:
    rows = _rows("projects_status")
    dates = _dates(rows)
    if not dates:
        return {"key": "projects", "label": "Named-build ledger", "items": [],
                "note": "no archived snapshots yet"}
    latest = dates[-1]
    base = _baseline(dates, latest)
    sec = {"key": "projects", "label": "Named-build ledger",
           "latest": latest, "baseline": base,
           "src": "projects ledger (primary; see Buildout)", "items": []}
    if not base:
        sec["note"] = f"only one snapshot so far ({latest}) — deltas start accruing with the next ledger change"
        return sec
    cur = {r["id"]: r for r in rows if r["date"] == latest}
    old = {r["id"]: r for r in rows if r["date"] == base}
    disp = lambda r: f"{r.get('operator', r['id'])} · {r.get('state', '?')}"
    for pid in sorted(set(cur) - set(old)):
        r = cur[pid]
        mw = _num(r.get("capacity_mw"))
        # ALWAYS carry the status: the ledger back-records distress too — a cancelled project
        # "entering the ledger" must never read as a new 600 MW announcement.
        sec["items"].append({"kind": "new",
                             "text": f"{disp(r)} entered the ledger as {r.get('status', '?')}"
                             + (f" · {mw:,.0f} MW" if mw else "")})
    for pid in sorted(set(old) - set(cur)):
        r = old[pid]
        sec["items"].append({"kind": "removed",
                             "text": f"{disp(r)} left the ledger (was {r.get('status', '?')})"})
    for pid in sorted(set(cur) & set(old)):
        c, o = cur[pid], old[pid]
        if c.get("status") != o.get("status"):
            sec["items"].append({"kind": "status",
                                 "text": f"{disp(c)}: {o.get('status')} → {c.get('status')}"})
        mw_c, mw_o = _num(c.get("capacity_mw")), _num(o.get("capacity_mw"))
        if mw_c is not None and mw_o is not None and mw_c != mw_o:
            sec["items"].append({"kind": "capacity",
                                 "text": f"{disp(c)}: {mw_o:,.0f} → {mw_c:,.0f} MW"})
    if not sec["items"]:
        sec["note"] = "no ledger changes in this window"
    return sec


def gpu_section() -> dict:
    rows = _rows("gpu_prices")
    dates = _dates(rows)
    if not dates:
        return {"key": "gpu_prices", "label": "GPU rental list prices", "items": [],
                "note": "no archived observations yet"}
    latest = dates[-1]
    base = _baseline(dates, latest)
    sec = {"key": "gpu_prices", "label": "GPU rental list prices",
           "latest": latest, "baseline": base,
           "src": "provider pricing pages (primary; see Tokens)", "items": []}
    if not base:
        sec["note"] = f"history starts {dates[0]} — a full comparison window lands soon"
        return sec
    key = lambda r: (r["provider"], r["sku"])
    cur = {key(r): r for r in rows if r["date"] == latest}
    old = {key(r): r for r in rows if r["date"] == base}
    name = {"lambda": "Lambda", "nebius": "Nebius", "runpod": "RunPod", "coreweave": "CoreWeave"}
    lab = lambda k: f"{name.get(k[0], k[0].title())} {k[1]}"
    for k in sorted(set(cur) & set(old)):
        pc, po = _num(cur[k]["usd_per_gpu_hr"]), _num(old[k]["usd_per_gpu_hr"])
        if pc is None or po is None or pc == po:
            continue
        pct = (pc - po) / po * 100 if po else 0
        sec["items"].append({"kind": "price",
                             "text": f"{lab(k)}: ${po:.2f} → ${pc:.2f}/GPU-hr ({pct:+.1f}%)"})
    for k in sorted(set(cur) - set(old)):
        p = _num(cur[k]["usd_per_gpu_hr"])   # guard: a None price must not crash the build
        sec["items"].append({"kind": "new",
                             "text": f"{lab(k)} newly listed" + (f" at ${p:.2f}/GPU-hr" if p is not None else "")})
    for k in sorted(set(old) - set(cur)):
        sec["items"].append({"kind": "removed", "text": f"{lab(k)} no longer listed"})
    if not sec["items"]:
        sec["note"] = "list prices held flat in this window"
    return sec


def queues_section() -> dict:
    rows = _rows("queues")
    dates = _dates(rows)
    if not dates:
        return {"key": "queues", "label": "Interconnection queues (LBNL)", "items": [],
                "note": "no archived snapshots yet"}
    latest = dates[-1]
    base = _baseline(dates, latest)
    sec = {"key": "queues", "label": "Interconnection queues (LBNL)",
           "latest": latest, "baseline": base,
           "src": "LBNL Queued Up (annual; see Buildout)", "items": []}
    if not base:
        sec["note"] = "single snapshot so far"
        return sec
    cur = {r["iso"]: r for r in rows if r["date"] == latest}
    old = {r["iso"]: r for r in rows if r["date"] == base}
    for iso in sorted(set(cur) & set(old)):
        for col, unit in (("active_gw", "GW queued"), ("credible_gw", "GW credible")):
            c, o = _num(cur[iso].get(col)), _num(old[iso].get(col))
            if c is not None and o is not None and c != o:
                sec["items"].append({"kind": "queue",
                                     "text": f"{iso}: {o:,.0f} → {c:,.0f} {unit}"})
    if not sec["items"]:
        sec["note"] = "no new LBNL snapshot in this window — the queue series updates annually"
    return sec


def main() -> int:
    sections = [projects_section(), gpu_section(), queues_section()]
    for s in sections:
        _gap_note(s)
    out = {
        "computed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_days": WINDOW_DAYS,
        "tier": "computed",
        "note": ("Deltas computed from the archived daily snapshots in data/history/ — arithmetic "
                 "over the cited feeds, never estimates. Grid load and retail power prices are "
                 "excluded on purpose: their weekly deltas are weather/period noise, not structure."),
        "sections": sections,
    }
    # No timestamp churn: if nothing but computed_at would change, keep the previous file byte-
    # identical — otherwise CI commits a one-line diff every day for a file about "what changed".
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8"))
            if {k: v for k, v in prev.items() if k != "computed_at"} == {k: v for k, v in out.items() if k != "computed_at"}:
                print(f"[changes] unchanged — keeping existing {OUT.relative_to(ROOT)} (computed_at {prev.get('computed_at')})")
                return 0
        except Exception:
            pass
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    n = sum(len(s["items"]) for s in sections)
    print(f"[changes] wrote {OUT.relative_to(ROOT)} — {n} item(s) across {len(sections)} sections")
    return 0


if __name__ == "__main__":
    sys.exit(main())
