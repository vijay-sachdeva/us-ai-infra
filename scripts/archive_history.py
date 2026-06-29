#!/usr/bin/env python3
"""Append today's feed snapshots to the accumulating time-series under data/history/.

Runs at the END of the daily data refresh (after fetch_grid / fetch_power_econ /
build_queues / build_siting have written today's data/*.json). For each feed it
extracts today's rows (keyed on the feed's own as-of date) and upserts them into
data/history/<feed>.csv — idempotent, so the twice-daily backstop overwrites
today's row instead of duplicating it.

Stdlib-only. The Parquet mirror is built separately (build_history_parquet.py) and
is not part of the daily commit (see data/history/README.md).
"""
import json
import os
import sys

import _history as H


def main():
    total = 0
    for feed, extractor in H.FEEDS.items():
        src_path = os.path.join(H.ROOT, "data", feed + ".json")
        if not os.path.exists(src_path):
            print("[archive] skip %s (no %s.json)" % (feed, feed))
            continue
        try:
            d = json.load(open(src_path, encoding="utf-8"))
        except Exception as e:
            print("[archive] skip %s (parse error: %s)" % (feed, e), file=sys.stderr)
            continue
        cols, key_cols, rows = extractor(d)
        n_total, n_new = H.upsert(H.hist_csv_path(feed), cols, key_cols, rows)
        if n_new:
            print("[archive] %s: +%d rows for %s -> %s (%d total)" % (
                feed, n_new, rows[0]["date"], os.path.relpath(H.hist_csv_path(feed), H.ROOT), n_total))
            total += n_new
        else:
            print("[archive] %s: no dated rows to add" % feed)
    print("[archive] done (%d rows upserted this run)" % total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
