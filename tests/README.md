# Tests / QA suite

Automated quality checks for the **US AI Infrastructure Monitor** open dataset.
The repo is Python scripts + a static site, so the suite is plain `pytest` over
the data files. There are two tiers:

| Tier | File(s) | Network? | CI trigger | Blocks merge? |
|------|---------|----------|------------|---------------|
| **Data quality** | `test_data_quality.py` | No | every push / PR | **Yes** |
| **Link rot** | `test_links.py` | Yes | weekly cron + manual | No |
| **Freshness** | `test_freshness.py` | No | weekly cron + manual | No (warn-only) |
| **Refresh contract** | `test_refresh_schedule.py` | No | every push / PR | Yes |

CI is defined in [`.github/workflows/qa.yml`](../.github/workflows/qa.yml).

## What each test does

### `test_data_quality.py` (per-push gate, fast, offline)

- **Schema validation** -- `data/projects.json` validates against
  `schemas/projects.schema.json` (JSON Schema draft 2020-12).
- **Enum membership** -- every record's `provenance`, `transformation`, and
  `confidence`, plus each source's `provenance`, is one of the schema's allowed
  enum values. `record_count` matches `len(records)`, and record `id`s are unique.
- **Export sync** -- `data/projects.csv` and `data/projects.geojson` are
  regenerable from `projects.json` and match what's committed. The test
  **imports the real builder** (`scripts/build_projects_exports.py`) and reuses
  its `COLS` / `primary_source()` logic -- it never shells out. CSV is compared
  row-by-row (CRLF/LF-agnostic); GeoJSON is compared as parsed objects
  (indentation/key-order-agnostic). Records with null coordinates are expected
  to be omitted from the GeoJSON, and that count is checked.
- **`sources.json` integrity** -- every entry has a label and a boolean
  `linkable`; provenance is in the allowed set (the schema's source enum **plus**
  `modeled` for derived/composite refs); and the invariant *`linkable` iff a
  non-empty http(s) URL is present* holds in both directions.
- **Coordinate sanity** -- when `location.precision != "unknown"`, `lat`/`lon`
  are present and inside a padded US bounding box. `unknown`-precision records
  (e.g. undisclosed sites) are allowed null coordinates.
- **Capacity sanity** -- `capacity_mw` is a positive number whenever it is
  non-null.

### `test_links.py` (scheduled, networked, non-blocking)

Collects every unique `http(s)` URL from `sources.json` (`ledger[].url`) and
`projects.json` (`records[].sources[].url`), de-dupes them, and probes each with
a `HEAD` request (falling back to a ranged `GET`) using a desktop User-Agent and
a timeout. It prints a report (ok / bot-gated / dead) and **exits non-zero only
if a high share of links is dead** -- so a single host having a bad day, or the
known bot-gating hosts (SEC EDGAR, IEA, Oracle, etc. -- see
`data/sources.json` `coverage.note`), don't fail the run. `401/403/405/406/429`
are treated as "reachable but bot-gated", not dead.

### `test_freshness.py` (scheduled, offline, warn-only)

Confirms each metric feed's timestamp is **parseable** (hard failure if not) and
**not older than a threshold** (default 21 days -- a warning by default). Feeds
checked: `grid.json`, `power_econ.json`, `queues.json`, `siting.json`
(`lastUpdated`), and `projects.json` (`generated`).

## Running locally

```bash
# One-time: install test deps (jsonschema is only needed for schema validation)
python -m pip install --upgrade pytest jsonschema

# The per-push gate (fast, no network):
python -m pytest tests/test_data_quality.py -v

# Link-rot sweep (makes live HTTP requests; -s shows the report):
python tests/test_links.py          # standalone runner
python -m pytest tests/test_links.py -s

# Freshness (prints a report; warn-only by default):
python tests/test_freshness.py
FRESHNESS_STRICT=1 python -m pytest tests/test_freshness.py   # make staleness fail

# Everything at once (network tests included):
python -m pytest tests/ -v
```

## Tuning knobs (environment variables)

**`test_links.py`**

| Var | Default | Meaning |
|-----|---------|---------|
| `LINK_CHECK_TIMEOUT` | `20` | Per-request timeout (seconds) |
| `LINK_CHECK_FAIL_RATIO` | `0.20` | Dead-link fraction that fails the run |
| `LINK_CHECK_MIN_DEAD` | `5` | Don't fail unless at least this many are dead |
| `LINK_CHECK_MAX_WORKERS` | `8` | Parallel probe workers |

**`test_freshness.py`**

| Var | Default | Meaning |
|-----|---------|---------|
| `FRESHNESS_MAX_AGE_DAYS` | `21` | Staleness threshold (days) |
| `FRESHNESS_STRICT` | unset | `1`/`true` makes staleness a hard failure |

## After editing `data/projects.json`

Regenerate the flat/geo exports so `test_data_quality.py` stays green:

```bash
python scripts/build_projects_exports.py
```

## Notes

- `test_links.py` uses a `network` pytest marker. To silence the
  "unknown marker" warning, register it in `pyproject.toml` or `pytest.ini`:

  ```ini
  [pytest]
  markers =
      network: tests that make live HTTP requests (scheduled CI only)
  ```

- License: code is MIT, data is CC BY 4.0. These tests are code (MIT).
