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

A GitHub Actions workflow (`daily-refresh.yml`) runs twice daily — 10:17 and 16:17 UTC (a primary slot plus an idempotent backstop). Each run:

1. Calls Anthropic Claude with the `web_search` tool to find significant US AI data-center news from the past 24-72 hours.
2. Updates `DATA.lastUpdated` and `DATA.topStory` in `index.html`.
3. Validates the change is small (size delta < ±10%, diff < 30 lines) — aborts and reverts otherwise.
4. Commits and pushes.

The second daily slot is an idempotent backstop if the first run is delayed or dropped (it no-ops once the day is already refreshed); GitHub Actions is the sole update path. No human in the loop on update days.

## Live public-data feeds

A second GitHub Actions job (`.github/workflows/refresh-data.yml`) hydrates the dashboard from authoritative public data. Small stdlib-only Python scripts in `scripts/` write pre-computed JSON into `data/`, and the front-end's `hydrate()` merges those files into `DATA` on load.

| Feed | File | Source | Tier |
|---|---|---|---|
| Grid headroom by balancing authority | `data/grid.json` | EIA-930 demand + EIA-860 capacity | Primary |
| Industrial power price by state | `data/power_econ.json` | EIA retail-sales (sector IND) | Primary |
| Interconnection queue by ISO | `data/queues.json` | LBNL Queued Up + 78% withdrawal haircut | Analyst |
| Per-state power "white-space" score | `data/siting.json` | modeled join of the above | Modeled |

The white-space score (0–100, rendered as the map's county choropleth) is `0.45·headroom + 0.33·(1−queue_congestion) + 0.22·(1−industrial_price)` — a regional screen, not a site confirmation.

Feeds are **additive and degrade gracefully**: a missing or failed feed leaves the curated `DATA` in place and never blanks a chart. Fast-changing data (hourly demand, monthly price) comes from the EIA API in CI; slow-changing reference data (BA capacity, the annual LBNL queue) is committed CSV under `scripts/data_sources/`, refreshed manually once a year. Requires a free `EIA_API_KEY` repo secret ([register here](https://www.eia.gov/opendata/register.php)).

## Tech

- **Frontend**: vanilla HTML + Chart.js (+ D3 / topojson on production for the map). No build step.
- **Chatbot backend**: a Cloudflare Worker (free tier) proxying to the Anthropic Messages API. The system prompt is cache-controlled, so repeat queries cost ~10% of fresh ones.
- **Daily refresh**: GitHub Actions cron + a Python driver script that calls Anthropic with web search, validates the edit, commits.
- **Hosting**: GitHub Pages from `main`.

## Data discipline

Every figure carries a tier label:

- **Primary** — directly from a company filing, SEC document, or official release.
- **Analyst** — credible third-party research (CBRE, JLL, Goldman Sachs, Morgan Stanley, SemiAnalysis, Wood Mackenzie, Epoch AI, LBNL).
- **Modeled** — derived from multiple sources; explicitly flagged.

All insights derive from publicly available information — disclosed prominently in the top banner.

## Sources (selected)

CBRE & JLL data-center reports, Goldman Sachs research, SemiAnalysis, Epoch AI, LBNL Queued Up, EIA, company IR pages, FERC filings, Bloomberg, Reuters, WSJ, CNBC, Fortune, Data Center Knowledge, Data Center Dynamics, Data Center Frontier, S&P Global.

## License & disclaimer

Portfolio project. Figures are best-available estimates carrying meaningful uncertainty; not investment advice.

Contact: Vijay Sachdeva · vijaysachdeva@gmail.com
