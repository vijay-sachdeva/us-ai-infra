# Contributing

Thanks for helping keep the **US AI Infrastructure Monitor** accurate. This is primarily an
**open-data** project: the asset people cite is the named project + power-deal ledger
([`data/projects.json`](data/projects.json)), so most contributions are *data* contributions —
fixing a wrong number, adding a verified campus, or pointing at a better source. This guide is
specific to how this repo actually works; it is not generic boilerplate.

Before anything else, two ground rules that the whole dataset rests on:

1. **Every claim must trace to a clickable public URL that you opened and read.** We do not take
   numbers on trust, and we do not invent or guess URLs. If a fact has no verifiable public
   source, it does not go in.
2. **`supports_claim` means exactly what it says.** A source's `supports_claim: true` asserts
   that *you opened that page and it states this operator + ~MW + status*. If the page only
   supports part of the claim (e.g. operator and status but not MW), it is `supports_claim: false`
   and the gap is explained in the record's `note`.

## Ways to contribute

### 1. Report a data error or correction (no code required)

This is the most valuable contribution. If a record looks wrong — a campus is in the wrong state,
the MW is stale, the power model flipped from behind-the-meter to grid, a source 404s — **open a
GitHub issue**: <https://github.com/vijay-sachdeva/us-ai-infra/issues>.

A good correction issue includes:

- **The record `id`** (the stable slug, e.g. `delta-forge-1-applied-la`, `colossus-2-xai-tn`).
  Find it in `data/projects.json`; it is the most reliable way to point at a row.
- **What is wrong**, stated as **before → after** (e.g. "`capacity_mw` 640 → 430; `state` TX → LA").
- **A source URL you opened** that supports the corrected value, ideally operator/filing/government
  (see the provenance hierarchy below). Tell us what the page actually says.

Accepted corrections are recorded twice: as a dated entry in
[`CORRECTIONS.md`](CORRECTIONS.md) (the public corrections log) and in the `### Fixed` section of
[`CHANGELOG.md`](CHANGELOG.md), and the affected record's `revision` is bumped.

### 2. Propose a new project record

New campuses are welcome when they clear the sourcing bar. Add a record to the `records[]` array in
`data/projects.json` that validates against [`schemas/projects.schema.json`](schemas/projects.schema.json),
then regenerate the exports (see the build step). Open a PR, or open an issue with the details if
you would rather someone else add it.

**Inclusion bar:** a *named* US AI data-center campus or a specific power deal serving one, with at
least one source you opened that states operator + approximate MW + status. Unnamed "a hyperscaler
is rumored to be looking at..." leads do not qualify.

**Required fields** (per the schema): `id`, `name`, `operator`, `state` (USPS 2-letter),
`capacity_mw`, `capacity_type`, `status`, `provenance`, `transformation`, `confidence`, `revision`,
and a `sources[]` array. Conventions used throughout the existing 15 records:

- **`id`** — a stable, lowercase slug; once published it does not change (downstream users key on
  it). Pattern in use: descriptive name + operator + state, e.g. `polaris-forge-1-applied-nd`.
- **`location`** — `{ lat, lon, precision }`. `precision` is one of `site` / `city` / `county` /
  `unknown`. If you do not have coordinates, use `null` lat/lon with `precision: "unknown"`
  (e.g. the undisclosed `nebius-pa` site) — do **not** fabricate coordinates.
- **`capacity_mw` + `capacity_type`** — `capacity_type` is one of `total_power` /
  `it_critical_load` / `unspecified`. Be honest about *what the MW measures*: a 5 GW "ultimate
  compute target" is not the same as confirmed current draw. State the distinction in `note`.
- **`status`** — `operational` / `construction` / `planned` / `announced` / `unknown`, plus
  `status_as_of` as `YYYY-MM` (the month you observed it).
- **`power`** — `{ generation, model }`; `model` is `BTM` (behind-the-meter) / `Colocated` / `Grid`.
- **`revision`** — start at `1` for a new record; bump on every subsequent field change.
- **`note`** — use it to flag the weak point: which figure is announced/ultimate vs. confirmed,
  what is disputed, what a source does *not* say.

#### The provenance / transformation / confidence model

Every record carries three **orthogonal** fields instead of a single "tier". Set all three honestly —
they are how downstream users decide how much to trust a row:

- **`provenance`** — *class of the primary source*: `government` · `filing` · `operator` ·
  `trade_press` · `analyst` · `unknown`. Prefer the strongest available: a company filing or PUC
  docket beats a press release, which beats trade press, which beats an analyst estimate.
- **`transformation`** — *how the value relates to the source*: `reported` (the source states it
  directly) · `calculated` · `estimated` · `forecast` (an announced/ultimate target) · `scenario`.
- **`confidence`** — `high` · `medium` · `low`. An analyst estimate or a figure no primary source
  states should not be `high`. For example, `fairwater-msft-wi` is `medium` because operator and
  operational status are primary-confirmed but **no** primary source states the 500 MW;
  `colossus-2-xai-tn` is `medium` because the 1 GW claim is disputed by satellite analysis.

#### Sources — open every URL

Each entry in `sources[]` needs `source_id`, `url` (or `null` if no verifiable public source
exists — do not invent one), `publisher`, `provenance`, and `supports_claim`; `label`, `published`
(`YYYY-MM-DD` or `YYYY-MM`), and `retrieved` (ISO date you last checked the URL) are expected too.

The non-negotiable part: **open every URL and confirm it before setting `supports_claim`.** Set
`supports_claim: true` only if the page actually states this operator + ~MW + status. A source that
is relevant context but does *not* fully back the claim stays `supports_claim: false` (see the
Silicon Report aggregator row on `fairwater-msft-wi`). Some authoritative hosts (SEC EDGAR, LBNL,
Oracle, OpenAI) block automated fetchers but are fine in a browser — verify by hand and keep the
canonical URL.

### 3. Code, dashboard, and tooling

The front-end (`index.html`), the Python scripts in `scripts/`, and tooling are MIT-licensed code.
PRs welcome. Note two things specific to this repo:

- **Do not hand-edit the CI-generated metric feeds.** `data/grid.json`, `data/power_econ.json`,
  `data/queues.json`, and `data/siting.json` are regenerated from authoritative public data by the
  scripts in `scripts/` via [`.github/workflows/refresh-data.yml`](.github/workflows/refresh-data.yml).
  Edit the script (or the committed reference CSVs under `scripts/data_sources/`), not the JSON
  output — a hand edit will be overwritten on the next run. Likewise `index.html`'s `DATA.lastUpdated`
  / `DATA.topStory` are written by the daily-refresh workflow.
- **Keep Python stdlib-only** unless a dependency is genuinely required. The build and feed scripts
  run in CI with no install step; if you must add a dep, call it out explicitly in the PR.

## The build step (regenerating the flat/geo exports)

`data/projects.json` is the **canonical** source. `data/projects.csv` (one row per campus),
`data/projects.geojson` (geocoded points), and `data/projects.parquet` (columnar) are **derived** —
never edit them by hand. After any change to `projects.json`, regenerate them:

```sh
python scripts/build_projects_exports.py        # CSV + GeoJSON — stdlib-only
python scripts/build_parquet.py                 # Parquet — needs: pip install pandas pyarrow
```

The first is stdlib-only and prints a row/feature count (e.g. `projects.csv: 15 rows · projects.geojson: 14 features` —
records without coordinates are omitted from the GeoJSON). Commit the regenerated `projects.csv`,
`projects.geojson`, and `projects.parquet` alongside your `projects.json` change so they stay in sync.

If you add or remove records, update `record_count` in `projects.json` to match, and bump the
dataset `version` on schema/record changes (see [`CHANGELOG.md`](CHANGELOG.md) and
[`CITATION.cff`](CITATION.cff)).

## Licensing (please read before contributing data)

This project is **dual-licensed**, and that affects what you may contribute:

- **Code** (`index.html`, `scripts/`, `tools/`) is **MIT** — see [LICENSE](LICENSE).
- **Curated data** (`data/`) is **CC BY 4.0** — see [data/LICENSE](data/LICENSE). By contributing
  data you agree it is released under CC BY 4.0.
- **Third-party analyst material is *not* relicensed.** When a record relies on an analyst source
  (e.g. SemiAnalysis, CBRE, JLL), cite it as a pointer with `provenance: "analyst"` — record the
  operator/MW/status fact and link the source; do **not** paste in the analyst's proprietary text,
  tables, or figures. Those sources retain their own terms. The same applies to any source whose
  license you are unsure of: link to it, summarize the public fact, do not copy the content.

## Pull request checklist

- [ ] New/changed records validate against `schemas/projects.schema.json`.
- [ ] Every `sources[].url` was opened; `supports_claim` reflects what the page actually states.
- [ ] `provenance` / `transformation` / `confidence` set honestly; weak points flagged in `note`.
- [ ] Ran `python scripts/build_projects_exports.py` (and `build_parquet.py`) and committed the regenerated `projects.csv` + `projects.geojson` + `projects.parquet`.
- [ ] `record_count` (and `version` if appropriate) updated in `projects.json`.
- [ ] No hand edits to the CI-generated feeds (`grid` / `power_econ` / `queues` / `siting`) or to `index.html`'s auto-refreshed fields.
- [ ] A data correction is logged in [`CORRECTIONS.md`](CORRECTIONS.md) and `CHANGELOG.md`, with `revision` bumped.

## Questions

Open an issue, or contact the maintainer: **Vijay Sachdeva** · <vijaysachdeva@gmail.com>.
