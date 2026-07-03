# Competitive-intelligence roadmap (July 2026 review)

The product plan from the 2026-07-01 strategy review: the dashboard critiqued from the point of
view of a strategy / corp-dev / competitive-intelligence team at a company deploying AI-infra
capex (hyperscaler, AI lab, neo-cloud, utility, infra investor). Method: six analyst lenses
(player-centric CI, game theory, value chain & scale/scope economics, pricing & elasticity,
missteps & gaps, product/IA) grounded in the actual repo, cross-checked by three adversarial
critics (public-data feasibility, redundancy vs the ~40 existing modules, decision-usefulness),
plus an independent second-opinion review — 46 raw findings, ~30 survivors after verification.

## Verdict on the dashboard today

Best-in-class public **system monitor**; not yet a **competitive-intelligence product**:

1. **Organized by resource, not by player.** "What is Microsoft's position?" requires
   self-assembly across ~10 panels on 3 tabs. CI users think entity-first.
2. **Structurally a bull-case machine.** The ledger schema cannot represent a cancelled
   project; demand is a single line; negative signals live in footnotes.
3. **Collected-but-invisible data.** 50-state industrial power prices fetched daily and never
   rendered; the PJM capacity-auction bellwether promoted in the top story with no chart to
   land it; per-operator ledger rollups skewed by missing records (Amazon Rainier).

## Information architecture — the tab decision

**Add exactly ONE new tab: "Players"** (entity index; hard cap ~6 modules), appended after
Tokens. It is a pure join/render layer over existing cited data — no number gets a second copy;
every field deep-links to its evidence chart and inherits its tier pill. The five theme tabs are
the causal-chain spine and do not restructure; Capital (14 modules) and Buildout (16) are at
capacity. Rejected tab concepts (they are lenses, not entities): Strategy, Risk, Prices, Game
theory, Supply chain — each lives as panels inside existing tabs.

Launch modules for Players: per-player dossier cards (~10 entities); player × constraint/risk
grid (mechanically derived columns, cited-quote chips); secured-MW "power bank" league table
with a capex-vs-GW scatter toggle; neo-cloud survival scoreboard; player-tagged "who did what
this week" feed; cross-link footer. Ships progressively behind the capability-gate placeholder
pattern, only after the Wave-0 gates land.

## Wave 0 — integrity fixes + calendar-forced (S efforts, ship first)

| Item | What | Why first |
|---|---|---|
| PJM capacity-auction card (Grid) | BRA clearing price by **delivery year** with the price collar annotated; slot for the 2028/29 print | The site's own top story promised the July 14, 2026 result a home |
| Rainier ledger gap-fill | Add Amazon New Carlisle, IN to `data/projects.json` (MW estimate-tagged; Amazon discloses $ not MW); fix stale inline `megaProjects` fallback facts | Per-operator rollups are skewed ~4:1 without it; gates all Players-tab aggregation |
| Graveyard v1 | Schema: add `stalled/paused/cancelled` + `status_history[]`; seed verified retreats (Crusoe Cheyenne et al.); "Graveyard & stalls" sub-panel by the ledger | Nobody publishes a verified AI-DC graveyard; the honest counterweight to announcement bias |
| Power-price board (Grid) | Render the daily EIA-861 feed (`data/power_econ.json`) as a by-state board, DC-corridor states highlighted | Zero new collection — the data is already fetched daily and shown nowhere |
| GPU-price fetcher (start only) | `scripts/fetch_gpu_prices.py` → `data/gpu_prices.json` + history CSV from published rate pages | History starts accruing now; the chart ships in Wave 3 |

## Wave 1 — the credibility layer (weeks 2–4, filings-grade, no new tab)

- **Committed-vs-generated overcommitment board** (extends capex-vs-cashflow): per operator,
  capex guidance + undiscounted future lease obligations + purchase obligations vs operating
  cash flow → "years of OCF pre-committed, and to whom" with QoQ inflection flags.
  Sources: 10-K/10-Q lease-maturity tables (MSFT, META, GOOGL, AMZN, ORCL, CRWV).
- **Demand-downside scenario toggle** on the cumulative-deficit chart (published low/high
  forecasts only — LBNL range, EPRI, GS/MS spread) + a thin "what could break this" chip strip
  on Overview deep-linking to the risk panels.
- **Counterparty-exposure sidebar** on the circular-financing map: click a node → disclosed
  commitments in/out, largest-counterparty share where filed, mutual-vs-one-sided dependence.
- **Staleness governance** (load-bearing for everything after): amber/red staleness on curated
  `asOf` dates, player tags in the daily feed, and a staleness check in the QA merge gate.
- Smaller: tenor "three clocks" chart (chip depreciation vs lease terms vs power timelines),
  Jevons price-vs-volume curve from existing token data, turbine "disclosed buyer" column,
  EU-dashboard cross-link.

## Wave 2 — the Players tab (month 2)

Build order: dossier cards → constraint/risk grid → power-bank table + scatter →
neo-cloud scoreboard. Same month, feeding it: **NVIDIA & silicon supply-side card** (Capital;
NVDA DC revenue vs the Sankey's modeled accelerator bucket — a validation instrument) and
**per-utility DC order books** (Grid; Dominion, Georgia Power, Entergy, AEP, Oncor, Duke,
NextEra — stage-labeled bars, never a summed total).

## Wave 3 — pricing & chain depth (month 3+)

- **GPU-rental price tracker chart** (the fetcher now has weeks of history) — a free, citeable
  $/GPU-hr series exists nowhere public; also the collateral mark under ~$8.5B of GPU-backed debt.
- **Margin waterfall**: $/MWh (live feed) → $/GPU-hr (tracker) → $/M tokens (existing price
  compression), modeled-tagged per the site's discipline — the "who survives compression" view.
- **HBM memory gate** (mirrors the turbine order-book pattern; discrete dated price-move markers,
  no fitted index), **transformer PPI** line (BLS successor series), then chain-segment cards:
  fiber/DCI (genuine white space), cooling supply chain (Vertiv backlog), ODM throughput; the
  unifying chain map last, after two clean quarterly refresh cycles.

## Killed ideas (do not relitigate without new data)

- $/MW-vs-campus-size scale scatter — mixes build capex, JV financing, lease TCV on one axis.
- PPA price panel — AI-relevant PPA prices are not disclosed; generic solar/wind data answers
  a different question.
- Game-move tag taxonomy (preempt/commit/hedge/coalesce) — editorial labels, no decision value.
- "Priced below modeled cost" callouts on named providers — 2–3× model error, defamation-adjacent.
- Cross-market queue-cost "index" — averages structurally different instruments (survives as a
  per-market terms table).
- Per-operator water/WUE bars, land $/acre — not systematically buildable from public data
  (declared honestly untracked in the methodology footer instead).

## Standing risks

- **Curation debt is the central risk.** The staleness CI gate ships before any new curated
  surface. Module caps are hard caps.
- Per-player ledger sums stay coverage-biased even after Rainier: every league-table axis needs
  a "GW in ledger" coverage disclosure.
- The GPU scraper will break silently (JS-rendered pages): day-one QA gate + manual fallback.
- Concentration figures and stated pause reasons blend primary facts with analyst attribution —
  tier them separately everywhere.

*Full review artifacts (46 findings, critic verdicts, second-opinion review) archived in the
2026-07-01 session records.*
