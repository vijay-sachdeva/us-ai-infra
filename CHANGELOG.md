# Changelog

All notable changes to the US AI Infrastructure Monitor — code and the open datasets.
Dataset versions track `data/projects.json` (`version` field); code/site changes ship via PRs.

## [Unreleased]

### Added
- **Open project ledger — `data/projects.json` v0.1.0** (flagship open dataset). 15 named US
  AI data-center campuses with verified, clickable source URLs, coordinates, status, power
  model, and a three-part provenance model (`provenance` / `transformation` / `confidence`).
  Every source URL was opened and checked (`supports_claim`).
- **`schemas/projects.schema.json`** — JSON Schema for the project records.
- **Licensing**: `LICENSE` (MIT, code) + `data/LICENSE` (CC BY 4.0, curated data) + `CITATION.cff`.
- The "Named builds & power deals" table now renders from `projects.json` with clickable
  per-row sources, a confidence flag on medium/low records, and a "download dataset" link.

### Fixed (data corrections surfaced during source verification)
- **Delta Forge 1 (Applied Digital)** — corrected from "TX / ERCOT / 640 MW" to
  **Boyce, Louisiana / Cleco / 430 MW**. The 640 MW conflated Delta Forge 1 (430) and a
  separate Delta Forge 2 (210 MW IT); "Harwood" is Applied Digital's Polaris Forge 2 in ND.
- **Aligned "Project Caprock" (Hale County, TX)** — power corrected from ERCOT to
  **Xcel Energy (SPP)**.
- **Polaris Forge 1 (Applied Digital, Ellendale ND)** — corrected to **400 MW critical IT load**
  (was 500) and **grid-served by Montana-Dakota Utilities** (the prior on-site-gas/BTM tag was
  not confirmed for this site).
- **Colossus 2 (xAI)** — status updated to operational, with the disputed 1 GW figure
  (~350 MW built per SemiAnalysis satellite analysis) flagged as medium confidence.

### Notes
- Several headline MW figures (Hyperion 5 GW, Prometheus 1 GW, Colossus 2 1 GW, Joule 4 GW)
  are announced/ultimate targets, not confirmed current draw — flagged per record.
