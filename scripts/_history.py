"""Shared extractors + CSV upsert for the time-series archive (data/history/).

Stdlib-only. Each feed's rows are keyed on the data's own as-of date — the feed's
`lastUpdated` (or `generated` for the project ledger) — so forward archiving
(archive_history.py) and git-history backfill (backfill_history.py) produce
IDENTICAL rows, and re-runs are idempotent (exactly one row per date x entity).

The observation period (e.g. EIA-861 `period`) and the full fetch timestamp are
carried as extra columns, so `date` (capture/as-of day) stays distinct from the
underlying data's observation period.
"""
import csv
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIST_DIR = os.path.join(ROOT, "data", "history")

# Output CSV name per feed (defaults to the feed key).
HIST_NAME = {"projects": "projects_status"}


def _date(ts):
    """YYYY-MM-DD from an ISO timestamp or date string; '' if missing."""
    return str(ts)[:10] if ts else ""


# Each extractor: parsed JSON -> (columns, key_cols, rows[list[dict]]).
def extract_grid(d):
    cols = ["date", "ba", "peak_mw", "avg_mw", "latest_mw", "capacity_mw", "headroom_pct", "source", "fetched_at"]
    date, src, fetched = _date(d.get("lastUpdated")), d.get("source", ""), d.get("lastUpdated", "")
    rows = [{"date": date, "ba": ba, "peak_mw": r.get("peak_mw"), "avg_mw": r.get("avg_mw"),
             "latest_mw": r.get("latest_mw"), "capacity_mw": r.get("capacity_mw"),
             "headroom_pct": r.get("headroom_pct"), "source": src, "fetched_at": fetched}
            for ba, r in (d.get("regions") or {}).items()]
    return cols, ["date", "ba"], rows


def extract_power_econ(d):
    cols = ["date", "state", "ind_cents_kwh", "ind_usd_mwh", "period", "source", "fetched_at"]
    date, src, period, fetched = _date(d.get("lastUpdated")), d.get("source", ""), d.get("period", ""), d.get("lastUpdated", "")
    rows = [{"date": date, "state": st, "ind_cents_kwh": r.get("ind_cents_kwh"),
             "ind_usd_mwh": r.get("ind_usd_mwh"), "period": period, "source": src, "fetched_at": fetched}
            for st, r in (d.get("states") or {}).items()]
    return cols, ["date", "state"], rows


def extract_queues(d):
    cols = ["date", "iso", "active_gw", "credible_gw", "withdrawal_rate", "source", "fetched_at"]
    date, src, wr, fetched = _date(d.get("lastUpdated")), d.get("source", ""), d.get("withdrawal_rate"), d.get("lastUpdated", "")
    rows = [{"date": date, "iso": r.get("iso"), "active_gw": r.get("active_gw"),
             "credible_gw": r.get("credible_gw"), "withdrawal_rate": wr, "source": src, "fetched_at": fetched}
            for r in (d.get("iso") or [])]
    return cols, ["date", "iso"], rows


def extract_siting(d):
    cols = ["date", "fips", "score", "source", "fetched_at"]
    date, src, fetched = _date(d.get("lastUpdated")), d.get("tier", "modeled"), d.get("lastUpdated", "")
    rows = [{"date": date, "fips": fips, "score": score, "source": src, "fetched_at": fetched}
            for fips, score in (d.get("states") or {}).items()]
    return cols, ["date", "fips"], rows


def extract_projects(d):
    # Status snapshot keyed on the ledger's `generated` date (changes when the ledger is edited).
    cols = ["date", "id", "operator", "state", "capacity_mw", "capacity_type", "status", "status_as_of"]
    date = _date(d.get("generated"))
    rows = [{"date": date, "id": r.get("id"), "operator": r.get("operator"), "state": r.get("state"),
             "capacity_mw": r.get("capacity_mw"), "capacity_type": r.get("capacity_type"),
             "status": r.get("status"), "status_as_of": r.get("status_as_of")}
            for r in (d.get("records") or [])]
    return cols, ["date", "id"], rows


FEEDS = {
    "grid": extract_grid,
    "power_econ": extract_power_econ,
    "queues": extract_queues,
    "siting": extract_siting,
    "projects": extract_projects,
}


def hist_csv_path(feed):
    return os.path.join(HIST_DIR, HIST_NAME.get(feed, feed) + ".csv")


def row_key(row, key_cols):
    return tuple(str(row.get(k, "")) for k in key_cols)


def load_csv(path):
    if not os.path.exists(path):
        return []
    with io.open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path, cols, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # newline="\n" so the LF-normalized blob matches the working tree (small diffs).
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({c: ("" if r.get(c) is None else r.get(c)) for c in cols})


def upsert(path, cols, key_cols, new_rows):
    """Replace any existing rows whose `date` matches an incoming date, then add the
    new rows, sort by key_cols, and write. Idempotent: re-running with the same data
    overwrites that date's rows rather than duplicating them."""
    new_rows = [r for r in new_rows if r.get("date")]
    if not new_rows:
        return 0, 0
    incoming_dates = {r["date"] for r in new_rows}
    kept = [r for r in load_csv(path) if r.get("date") not in incoming_dates]
    merged = kept + new_rows
    merged.sort(key=lambda r: row_key(r, key_cols))
    write_csv(path, cols, merged)
    return len(merged), len(new_rows)
