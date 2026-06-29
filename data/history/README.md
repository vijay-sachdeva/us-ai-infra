# Time-series archive (`data/history/`)

An accumulating, longitudinal record of the dashboard's daily public-data feeds — so the
site's *snapshots* become a **citeable history** (trends over time, not just "today").

Each file is **tidy/long CSV**: one row per `date × entity × metric`. New days are appended
by [`scripts/archive_history.py`](../../scripts/archive_history.py) at the end of the daily
refresh; the series was seeded from existing git history by
[`scripts/backfill_history.py`](../../scripts/backfill_history.py).

## Date semantics (read this first)
- **`date`** — the data's own **as-of day**: the date portion of the feed's `lastUpdated`
  (or the ledger's `generated`). This is the time axis to plot on.
- **`fetched_at`** — the full ISO timestamp the feed carried (when CI retrieved it).
- **`period`** (power_econ only) — the underlying observation period (e.g. EIA-861 publishes
  with a lag), which can be **earlier** than `date`. Treat `date` as capture/as-of, `period`
  as observation.

Rows are an **idempotent upsert keyed on `date`** — re-running the archiver for a day (e.g. the
twice-daily backstop) overwrites that day's rows rather than duplicating them. Exactly one row
per `date × entity`.

## Files
| File | Grain | Key columns | Source |
|---|---|---|---|
| `grid.csv` | balancing authority × day | `date, ba` | EIA-930 (demand) + EIA-860 (capacity) |
| `power_econ.csv` | state × day | `date, state` | EIA retail-sales (sector IND) |
| `queues.csv` | ISO × day | `date, iso` | LBNL Queued Up (+ withdrawal-rate haircut) |
| `siting.csv` | state (FIPS) × day | `date, fips` | Modeled white-space score (derived) |
| `projects_status.csv` | project × ledger-version | `date, id` | Curated project ledger (`projects.json`); `date` = ledger `generated` (changes when the ledger is edited, capturing status/capacity changes over time) |

Columns mirror the live feeds (e.g. `grid.csv`: `peak_mw, avg_mw, latest_mw, capacity_mw,
headroom_pct`; `power_econ.csv`: `ind_cents_kwh, ind_usd_mwh, period`; `queues.csv`:
`active_gw, credible_gw, withdrawal_rate`).

## CSV vs Parquet
The **CSV is canonical** and git-committed (append-only diffs stay small). **Parquet is generated
on demand** by [`scripts/build_history_parquet.py`](../../scripts/build_history_parquet.py)
(`pip install pandas pyarrow`) as the analytical view — it is **not** committed on every daily
refresh (to avoid a churning binary in git) and is `.gitignore`d. Generate it locally, or publish
it as a release asset, when you want the columnar form.

## Rebuild
```sh
python scripts/backfill_history.py        # one-time: seed from git history
python scripts/archive_history.py         # daily: upsert today's snapshot (run by CI)
python scripts/build_history_parquet.py   # on demand: regenerate Parquet mirrors
```

## License & provenance
**CC BY 4.0** (same as the rest of `data/`). Each row carries its `source`; the underlying
public datasets (EIA, LBNL) retain their own terms. Best-available figures with uncertainty;
several feeds are modeled/derived (see `tier`/`source`). Not investment advice.
