#!/usr/bin/env python3
"""Regenerate Parquet mirrors of the time-series CSVs under data/history/.

The CSVs are the canonical, git-committed source (append-only, small diffs). The
Parquet files are the analytical "rich database" view — generated ON DEMAND (not
committed on every daily refresh, to avoid a churning binary in git; see
data/history/README.md). Run after archiving/backfilling:
    python scripts/build_history_parquet.py            # -> data/history/*.parquet

Requires pandas + pyarrow:  pip install pandas pyarrow
"""
import glob
import os
import sys


def main():
    try:
        import pandas as pd
    except ImportError:
        sys.stderr.write("build_history_parquet.py needs pandas + pyarrow: pip install pandas pyarrow\n")
        raise
    here = os.path.dirname(os.path.abspath(__file__))
    hist = os.path.join(os.path.dirname(here), "data", "history")
    csvs = sorted(glob.glob(os.path.join(hist, "*.csv")))
    if not csvs:
        print("no CSVs in data/history/ — run backfill_history.py / archive_history.py first")
        return 0
    for csv_path in csvs:
        df = pd.read_csv(csv_path)
        out = csv_path[:-4] + ".parquet"
        try:
            df.to_parquet(out, engine="pyarrow", index=False)
        except ImportError:
            sys.stderr.write("build_history_parquet.py needs pyarrow: pip install pyarrow\n")
            raise
        print("%s: %d rows x %d cols -> %s" % (
            os.path.basename(csv_path), len(df), len(df.columns), os.path.basename(out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
