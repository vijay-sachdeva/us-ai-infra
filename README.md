# US AI Infrastructure Monitor

A persona-targeted dashboard tracking the US AI infrastructure buildout — power demand, capex, deployment geography, the bottlenecks holding it back, and the token economics underneath it all.

**Live**: https://vijay-sachdeva.github.io/us-ai-infra/
**v2 (in development)**: https://vijay-sachdeva.github.io/us-ai-infra/v2/

## What it answers

Five persona-targeted tabs, each with a distinct "so what":

| Tab | Audience | Key question |
|---|---|---|
| 🌐 Overview | Everyone | What's happening at a glance? |
| 💰 Investor | Capital allocators | Where do I deploy capital? |
| ⚙️ Engineer | Infra leaders | What constraints do I plan around? |
| 🏛️ Energy & Policy | Utility / regulator | What does this mean for the grid? |
| 🪙 Token Economics | Cross-cutting | What does the AI economy actually run on? |

Plus a live AI chatbot (Cloudflare Worker → Anthropic Claude with prompt caching) that answers free-form questions across the dashboard's data.

## What's tracked

**Investor**: capex by operator, M&A heatmap, public-market plays, vacancy & pricing-power trend, project IRR scenarios.

**Engineer**: interconnection funnel (97 → 6 → 41 GW), time-to-deployment by region, equipment lead times by component, hyperscaler buildout cadence, site-selection scorecard across top US markets.

**Energy & Policy**: annual DC demand vs. new firm generation, retail rate impact by state, ISO/RTO constraints, regulatory tracker (FERC, IRA, state laws), utility actions (M&A, nuclear restarts, peakers), demand-response commitments.

**Token Economics**: industry token volume by provider (stacked area), $/token compression on log Y (100× drop), tokens × energy bridge tying inference to MW, inference vs. training compute/spend split.

## How it stays current

`.github/workflows/daily-refresh.yml` runs at **6:00 AM and 2:00 PM Pacific** every day. The schedule declares the IANA timezone `America/Los_Angeles`, so GitHub keeps those local times through daylight-saving changes. Each run:

1. Pulls every programmatic public feed: EIA grid demand, EIA industrial power prices, LBNL queue inputs, the derived siting screen, published GPU-cloud list prices, and SEC EDGAR filings for tracked public players.
2. Uses the public web to scan the buildout, chips/memory/fabs, grid/power, policy, and capital-markets beats for material primary-source signals.
3. Rebuilds connection-review candidates, daily history, and the "What changed" layer.
4. Validates every generated JSON feed, commits all successful changes together, and opens one deduplicated GitHub issue if any stage failed.

The refresh attempts all sources even when one pull fails. Last-good observations remain in place for degraded sources, and each feed exposes its own retrieval timestamp and failures where supported. `.github/workflows/refresh-data.yml` is retained as a manual data-only recovery path.

## Live public-data feeds

The scheduled workflow hydrates the dashboard from authoritative public data. Small stdlib-only Python scripts in `scripts/` write pre-computed JSON into `data/`, and the front-end's `hydrate()` merges those files into `DATA` on load.

| Feed | File | Source | Tier |
|---|---|---|---|
| Grid headroom by balancing authority | `data/grid.json` | EIA-930 demand + EIA-860 capacity | Primary |
| Industrial power price by state | `data/power_econ.json` | EIA retail-sales (sector IND) | Primary |
| Interconnection queue by ISO | `data/queues.json` | LBNL Queued Up + 78% withdrawal haircut | Analyst |
| Per-state power "white-space" score | `data/siting.json` | Modeled join of the above | Modeled |
| GPU-cloud list prices | `data/gpu_prices.json` | Provider pricing pages | Primary |
| Disclosure-relevant filings | `data/sec_filings.json` | SEC EDGAR submissions API | Primary |
| Material news signals | `data/current.json` | Public web, prioritizing primary sources | Mixed, labeled per item |

The white-space score (0–100, rendered as the map's county choropleth) is `0.45·headroom + 0.33·(1−queue_congestion) + 0.22·(1−industrial_price)` — a regional screen, not a site confirmation.

Feeds are **additive and degrade gracefully**: a missing or failed feed leaves the curated `DATA` in place and never blanks a chart. Fast-changing data (hourly demand, monthly price) comes from the EIA API in CI; slow-changing reference data (BA capacity, the annual LBNL queue) is committed CSV under `scripts/data_sources/`, refreshed manually once a year. Requires a free `EIA_API_KEY` repo secret ([register here](https://www.eia.gov/opendata/register.php)).

## Tech

- **Frontend**: vanilla HTML + Chart.js (+ D3 / topojson on production for the map). No build step.
- **Chatbot backend**: a Cloudflare Worker (free tier) proxying to the Anthropic Messages API. The system prompt is cache-controlled, so repeat queries cost ~10% of fresh ones.
- **Twice-daily refresh**: GitHub Actions at 6:00 AM / 2:00 PM Pacific; public-data pulls + a public-web scan, validation, and one atomic commit.
- **Hosting**: GitHub Pages from `main`.

## Data discipline

Every figure carries a tier label:

- **Primary** — directly from a company filing, SEC document, or official release.
- **Analyst** — credible third-party research (CBRE, JLL, Goldman Sachs, Morgan Stanley, SemiAnalysis, Wood Mackenzie, Epoch AI, LBNL).
- **Modeled** — derived from multiple sources; explicitly flagged.

All insights derive from publicly available information — disclosed prominently in the top banner.

## Sources (selected)

CBRE & JLL data-center reports, Goldman Sachs research, SemiAnalysis, Epoch AI, LBNL Queued Up, EIA, company IR pages, FERC filings, Bloomberg, Reuters, WSJ, CNBC, Fortune, Data Center Knowledge, Data Center Dynamics, Data Center Frontier, S&P Global.

## Open data

The named-project + power-deal ledger is published as a citeable open dataset:

- **`data/projects.json`** — named US AI data-center campuses, each with verified, **clickable source URLs** (operator filings, utility/PUC dockets, primary press), coordinates, status, power model, and a three-part provenance model: `provenance` (government / filing / operator / trade_press / analyst), `transformation` (reported / estimated / forecast / …), and `confidence` (high / medium / low). Every source URL was opened and checked — `supports_claim` marks whether the page actually states the operator + MW + status. Headline MW that are announced/ultimate targets are flagged (`capacity_type`, `transformation`, `note`).
- **`data/projects.csv`** / **`data/projects.geojson`** — the same ledger flat (spreadsheets) and as geocoded points (maps).
- **`schemas/projects.schema.json`** — machine-readable JSON Schema for the records.
- **`data/sources.json`** — the source ledger (every cited label → verified URL + provenance).

### API & bulk downloads

The data is a **static, CORS-open, plain-GET API** served from GitHub Pages — no auth, no key. See **[`api/openapi.yaml`](api/openapi.yaml)** for the OpenAPI 3.1 description and **[`data/README.md`](data/README.md)** for the data dictionary. Base URL `https://vijay-sachdeva.github.io/us-ai-infra`; e.g. `GET /data/projects.json`, `/data/projects.csv`, `/data/projects.geojson`, `/data/sources.json`, plus the four metric feeds (`grid`/`power_econ`/`queues`/`siting`). The dashboard's "Named builds & power deals" table renders directly from `projects.json`. (Parquet release pending a CI build dep.)

## Contributing & corrections

Data corrections and new project records are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the sourcing bar (every source URL must be opened and verified, and `supports_claim` reflects what the page actually states) and the schema / provenance conventions. Past corrections are logged publicly in [CORRECTIONS.md](CORRECTIONS.md).

## License & citation

- **Code** (`index.html`, `scripts/`, `tools/`): **MIT** — see [LICENSE](LICENSE).
- **Curated data** (`data/`): **CC BY 4.0** — see [data/LICENSE](data/LICENSE). Suggested attribution: *"US AI Infrastructure Monitor — data CC BY 4.0, https://vijay-sachdeva.github.io/us-ai-infra"*. Third-party analyst sources cited per record retain their own terms and are **not** relicensed (marked via `sources[].provenance`).
- Cite the project via [CITATION.cff](CITATION.cff).

Figures are best-available estimates carrying meaningful uncertainty; several headline MW figures are announced/ultimate targets (flagged per record). Not investment advice.

Contact: Vijay Sachdeva · vijaysachdeva@gmail.com
