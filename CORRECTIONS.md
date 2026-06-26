# Corrections log

A public, dated record of every data correction made to the open project ledger
([`data/projects.json`](data/projects.json)). Accuracy matters more than looking clean, so when we
get something wrong we say so here, in the open.

This log complements the `### Fixed` section of [`CHANGELOG.md`](CHANGELOG.md): the changelog tracks
the dataset by version, this file is the running, human-readable history of *what was wrong and why
we changed it*.

## Policy

- **What gets logged.** Any change to a *published* fact in `data/projects.json` — capacity, state,
  location, status, power model/generation, operator, or a source that turned out not to support a
  claim. New records and pure additions are tracked in `CHANGELOG.md`, not here.
- **Format.** Each entry records: **date** (when the correction landed), **record `id`**, **what
  changed** as `before → after`, and **the source that prompted it** (a URL we opened and read).
- **Mechanics.** When a record is corrected, its `revision` field in `projects.json` is bumped and
  the change is mirrored into `CHANGELOG.md`. New entries go at the **top** of the log below
  (reverse-chronological).
- **How to request a correction.** Open an issue with the record `id`, the before → after, and a
  source URL: <https://github.com/vijay-sachdeva/us-ai-infra/issues>. See
  [`CONTRIBUTING.md`](CONTRIBUTING.md) for the sourcing bar (every source URL must be opened and
  verified; `supports_claim` reflects what the page actually states).

---

## 2026-06-24 — corrections surfaced during source verification (dataset v0.1.0)

These four corrections were caught while opening and checking every source URL for the initial
public release of the ledger. Each affected record was set to `revision: 1` at publication.

### `delta-forge-1-applied-la` — Delta Forge 1 (Applied Digital)

- **`state` / `power.generation` / `capacity_mw`:** `TX / ERCOT / 640 MW` → **`LA / Cleco /
  430 MW`** (Boyce, Rapides Parish, Louisiana).
- **Why:** the 640 MW figure conflated Delta Forge 1 (430 MW total / 300 MW IT) with a separate
  Delta Forge 2 (210 MW IT); "Harwood" is Applied Digital's Polaris Forge 2 in North Dakota, not
  this site.
- **Source that prompted it:** Applied Digital IR — *"Applied Digital breaks ground on Delta Forge 1
  (430 MW)"*, <https://ir.applieddigital.com/news-events/press-releases/detail/144/applied-digital-breaks-ground-on-delta-forge-1-a-430-mw-ai>
  (corroborated by Louisiana Economic Development and Data Center Dynamics).

### `aligned-caprock-hale-tx` — Project Caprock (Aligned, Hale County)

- **`power.generation`:** `ERCOT` → **`Xcel Energy (SPP)`**.
- **Why:** the Hale County / Abernathy campus is powered by Xcel Energy in the SPP region, not
  ERCOT.
- **Source that prompted it:** Aligned Data Centers — *"Aligned breaks ground on Project Caprock
  (540 MW, Xcel Energy)"*, <https://aligneddc.com/press-release/aligned-breaks-ground-on-project-caprock/>
  (corroborated by Data Center Dynamics).

### `polaris-forge-1-applied-nd` — Polaris Forge 1 (Applied Digital, Ellendale ND)

- **`capacity_mw`:** `500` → **`400` MW critical IT load**.
- **`power`:** `on-site gas / BTM` → **grid-served by Montana-Dakota Utilities** (the prior
  behind-the-meter gas tag was not confirmed for the Ellendale site; the Babcock & Wilcox >1 GW gas
  deal did not name this campus).
- **Source that prompted it:** Applied Digital IR — *"Applied Digital energizes first 100 MW building
  at Polaris Forge 1"*, <https://ir.applieddigital.com/news-events/press-releases/detail/137/applied-digital-completes-phase-ii-ready-for-service-at>
  (corroborated by Data Center Dynamics: 400 MW total, 100 MW live).

### `colossus-2-xai-tn` — Colossus 2 (xAI)

- **`status` / `confidence`:** status updated to **operational**, with the headline **1 GW** figure
  flagged as **medium confidence** (`transformation: estimated`).
- **Why:** xAI declared Colossus 2 online in Jan 2026 as a "1 GW AI cluster", but SemiAnalysis
  satellite analysis found only ~350 MW of cooling installed — so 1 GW is aspirational/disputed, not
  confirmed draw.
- **Source that prompted it:** SemiAnalysis — *"Colossus 2: satellite analysis (~350 MW cooling vs
  1 GW claim)"*, <https://newsletter.semianalysis.com/p/xais-colossus-2-first-gigawatt-datacenter>
  (analyst source — pointer only, not relicensed).

---

See also: [`CHANGELOG.md`](CHANGELOG.md) · issue tracker:
<https://github.com/vijay-sachdeva/us-ai-infra/issues>
