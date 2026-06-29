#!/usr/bin/env python3
"""One-time seed of data/history/*.csv from the git history of the data feeds.

Walks every committed version of each data/<feed>.json (oldest -> newest), extracts
its rows keyed on that version's own as-of date, and keeps the latest content per
(date x entity). Because each row is dated by the data's self-declared timestamp,
this reconstruction is identical to what archive_history.py would have produced day
by day — and re-running it is deterministic.

Backfilling from the externalized JSON feeds is robust (vs parsing index.html);
that is exactly why data externalization (A0) precedes the archive in the plan.

Stdlib-only (uses `git` via subprocess). Run from the repo root:
    python scripts/backfill_history.py
"""
import json
import subprocess
import sys

import _history as H


def _git(args):
    return subprocess.run(["git"] + args, cwd=H.ROOT, capture_output=True, text=True)


def revisions(rel_path):
    """Commit hashes that touched rel_path, oldest first."""
    out = _git(["log", "--reverse", "--format=%H", "--", rel_path]).stdout.strip()
    return out.splitlines() if out else []


def file_at(rev, rel_path):
    r = _git(["show", "%s:%s" % (rev, rel_path)])
    if r.returncode != 0 or not r.stdout.strip():
        return None
    try:
        return json.loads(r.stdout)
    except Exception:
        return None


def main():
    for feed, extractor in H.FEEDS.items():
        rel = "data/%s.json" % feed
        revs = revisions(rel)
        acc, cols, key_cols = {}, None, None
        seen_dates = set()
        for rev in revs:
            d = file_at(rev, rel)
            if d is None:
                continue
            cols, key_cols, rows = extractor(d)
            for row in rows:
                if not row.get("date"):
                    continue
                acc[H.row_key(row, key_cols)] = row  # latest content per (date x entity) wins
                seen_dates.add(row["date"])
        if not acc:
            print("[backfill] %s: no committed history found" % feed)
            continue
        merged = sorted(acc.values(), key=lambda r: H.row_key(r, key_cols))
        H.write_csv(H.hist_csv_path(feed), cols, merged)
        print("[backfill] %s -> %s: %d rows across %d dates (%s ... %s)" % (
            feed, H.hist_csv_path(feed).split("history")[-1].lstrip("\\/"),
            len(merged), len(seen_dates), min(seen_dates), max(seen_dates)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
