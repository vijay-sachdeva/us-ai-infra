// US AI Infrastructure Monitor — region-agnostic ENGINE.
// Reads REGION_CONFIG (config.js) + DATA (inline in index.html), both defined before this loads.
// Per-region sites reuse this file unchanged; they supply their own config.js + DATA.
const $ = (id) => document.getElementById(id);

  // Populate "Updated" date in the top banner from DATA.lastUpdated (named so hydrate() can re-call it).
  function renderUpdatedStamp() {
    if (!DATA || !DATA.lastUpdated) return;
    const d = new Date(DATA.lastUpdated + "T00:00:00");
    const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    document.querySelectorAll(".tb-date").forEach(el => el.textContent = formatted);
  }
  renderUpdatedStamp();

  function renderTopStory() {
    if (!$("topStory") || !DATA.topStory) return;
    const ts = DATA.topStory;
    const inner =
      '<span class="ts-tag"><span class="dot"></span> Top story</span>' +
      '<span class="ts-text">' + ts.text + '</span>' +
      '<span class="ts-src">' + ts.date + ' · ' + ts.src + (ts.url ? ' ↗' : '') + '</span>';
    $("topStory").innerHTML = ts.url
      ? '<a class="topstory" href="' + ts.url + '" target="_blank" rel="noopener">' + inner + '</a>'
      : '<div class="topstory">' + inner + '</div>';
  }

  function renderKpis() {
    if (!$("kpis")) return;
    const isPlainNumber = (v) => /^\$?\d+\.?\d*$/.test(String(v));
    $("kpis").innerHTML = DATA.kpis.map(k => {
      const animatable = isPlainNumber(k.value);
      const prefix = String(k.value).startsWith("$") ? "$" : "";
      const initialText = animatable ? prefix + "0" : k.value;
      const dataAttr = animatable ? ` data-target="${k.value}"` : "";
      return `
        <div class="kpi">
          <div class="label">${k.label}</div>
          <div class="value"><span class="num"${dataAttr}>${initialText}</span><span class="unit"> ${k.unit}</span></div>
          ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ""}
          <div class="delta">${k.delta}</div>
          <div class="kpi-src"><span class="kpi-srclabel">Source: ${k.src.label}</span></div>
        </div>`;
    }).join("");
    motionObserveAll();   // pick up the new .num[data-target] elements
  }

  /* ----- Investor tab renders ----- */
  function renderCostStack(targetId) {
    targetId = targetId || "costStack";
    if (!$(targetId) || typeof Chart === "undefined" || !DATA.costStack) return;
    if (_charts[targetId]) return;                       // per-target guard (two callers)
    initCharts(); applyChartDefaults();
    const cs = DATA.costStack, cl = getChartColors();
    const facColor = "#1d9e75", compColor = "#1d4ed8";
    const rows = cs.layers.slice().sort((a, b) => b.value - a.value);   // largest layer (GPUs) first
    _charts[targetId] = new Chart($(targetId), {
      type: "bar",
      data: { labels: rows.map(l => l.name), datasets: [{
        label: "$M / MW",
        data: rows.map(l => l.value),
        backgroundColor: rows.map(l => l.group === "facility" ? facColor : compColor),
        borderRadius: 6, maxBarThickness: 22
      }]},
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 30 } },
        plugins: {
          legend: { display: false },
          datalabels: Object.assign({}, LABEL_STYLE_FN(), { display: true, anchor: "end", align: "end", formatter: v => "$" + v + "M" }),
          tooltip: { callbacks: { label: c => { const l = rows[c.dataIndex]; return " $" + l.value + "M/MW · " + (l.group === "facility" ? "facility" : "compute") + (l.detail ? " — " + l.detail : ""); } } }
        },
        scales: {
          x: { grid: { color: cl.grid }, ticks: { callback: v => "$" + v + "M" }, beginAtZero: true },
          y: { grid: { display: false } }
        }
      }
    });
    const m = $(targetId + "Method");
    if (m) m.innerHTML = "<b>All-in ~$" + cs.allInTotal + "M / MW</b> — facility $" + cs.facilitySubtotal + "M (green) + compute $" + (cs.allInTotal - cs.facilitySubtotal) + "M (blue) · illustrative · GPUs dominate.";
  }

  function renderDeals() {
    if (!$("dealsGrid") || !DATA.deals) return;
    $("dealsGrid").innerHTML = DATA.deals.map(d => `
      <div class="deal-card">
        <div class="deal-head">
          <span class="deal-date">${d.date}</span>
          <span class="deal-theme ${d.themeKey}">${d.theme}</span>
        </div>
        <div class="deal-size">${d.size}</div>
        <div class="deal-parties">${d.parties}</div>
        <div class="deal-note">${d.note}</div>
        <div class="deal-src">Source: ${d.src}</div>
      </div>`).join("");
  }

  function renderPlays() {
    if (!$("playsList") || !DATA.publicMarketPlays) return;
    $("playsList").innerHTML = DATA.publicMarketPlays.map(p => `
      <div class="play-block">
        <div class="play-thesis">${p.thesis}</div>
        <div class="ticker-row">${p.tickers.map(t => `<span class="ticker-chip">${brandMark(t)}${t}</span>`).join("")}</div>
        <div class="play-note">${p.note}</div>
      </div>`).join("");
  }

  // One-time Chart.js setup — register datalabels plugin and set defaults
  let _chartsInit = false;
  const _charts = {};  // id → Chart instance, used to destroy on theme change

  // Buildout reconciliation palette — role → hex. Matches existing dashboard hexes.
  // Color law: blue=headline/requested · amber=uncertain pipeline · red=modeled
  // deduction · green=operational/plausibly-buildable · gray=context.
  const PL_COLORS = { blue: "#1d4ed8", amber: "#c2710c", red: "#c0322b", green: "#10b981", gray: "#94a3b8" };
  const PL_QUEUE  = 97;                              // headline queue (analyst-cited)
  const PL_RANGE  = { min: 19, max: 33, mid: 24 };   // modeled buildable envelope
  // Sequential haircut scenarios. Integers are pre-rounded — do NOT recompute %→GW live
  // (97×0.65=63.05≠63). high.specDelta is 40 (not 44) by design; do not "fix".
  const PL_SCENARIOS = {
    low:  { afterDup: 63, dupDelta: 34, buildable: 19, specDelta: 44, dupPct: "−35%", specPct: "−70%" },
    mid:  { afterDup: 68, dupDelta: 29, buildable: 24, specDelta: 44, dupPct: "−30%", specPct: "−65%" },
    high: { afterDup: 73, dupDelta: 24, buildable: 33, specDelta: 40, dupPct: "−25%", specPct: "−55%" }
  };

  // ===== Unified modern-chart system =====
  // One semantic palette for the whole dashboard — color encodes MEANING, not series order.
  const CHART_PALETTE = {
    demand:     "#1d4ed8",   // requested / demand / headline
    supply:     "#15803d",   // operational / supply / "real"
    constraint: "#c0322b",   // constraint / deduction / pressure
    pipeline:   "#c2710c",   // uncertain / in-progress pipeline
    context:    "#94a3b8",   // neutral context
    accent:     "#0ea5e9"    // secondary series
  };
  const hexA = (h, a) => { const n = parseInt(h.slice(1), 16); return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")"; };

  // Plain-language tooltip for the source-label pills, mapping the legacy "tier" word to the
  // open dataset's provenance / transformation / confidence model (see the footer legend).
  function tierTitle(t) {
    if (t === "primary") return "Primary — directly reported by a government, filing, or operator source (provenance).";
    if (t === "analyst") return "Analyst — third-party research estimate (provenance).";
    if (t === "modeled" || t === "derived") return t.charAt(0).toUpperCase() + t.slice(1) + " — computed/estimated here, not directly reported (transformation).";
    return String(t);
  }

  // Per-chart caption metadata, keyed by canvas id: { take: one-sentence insight, asof: data
  // vintage (not the page refresh date), src: { label, url } }. Every takeaway is grounded in the
  // chart's own data — fact-checked, no invented figures. enhanceCharts() renders these under each
  // chart; charts absent from the map simply get no caption (graceful).
  const CHART_META = {
    coCapexChart: { reviewed: "2026-07", take: "Amazon leads 2026 AI-infra capex at $200B, ahead of Microsoft ($190B), Google ($185B) and Meta ($135B — midpoint of its filed $125-145B range), with AI-native challengers far smaller: Oracle $56B (FY26 actual), CoreWeave $33B, Nebius $22B and xAI $18B.", asof: "2026 guidance", src: { label: "company 2026 capex guidance" } },
    capexAiShareChart: { reviewed: "2026-07", take: "Across ~$799B of tracked operator capex roughly 90% is AI/data-center-attributed, with pure-plays like Oracle and CoreWeave near 100% and diversified operators lower — but the infra-vs-non-core split is an editorial Modeled estimate, not a reported line item.", asof: "2026 guidance", src: { label: "modeled (this dashboard)" } },
    costStack: { reviewed: "2026-06", take: "Building one MW of AI capacity runs ~$42M all-in, with compute ($31M) dwarfing facility ($11M) and GPUs/accelerators alone ($23M) the single largest layer — more than the entire shell, power, cooling and servers combined.", asof: "illustrative", src: { label: "illustrative per-MW build stack (JLL + analyst)" } },
    capexTrendChart: { reviewed: "2026-06", take: "Combined Big-5 hyperscaler capex (Amazon, Microsoft, Alphabet, Meta, Oracle) more than quintupled from $128B in 2021 to a guided ~$684B in 2026, where the 2026 figure is company guidance/estimate rather than reported actuals.", asof: "2021-2025 actuals + 2026 guidance", src: { label: "company 10-Ks / earnings (2026 = guidance)" } },
    capexVsCashflowChart: { reviewed: "2026-06", take: "Through FY2025 combined Big-5 capex ($381B) was ~66% of operating cash flow ($577B), up from ~44% in 2021, and Oracle is already the lone single-name crossover — its FY2026 capex ($55.7B) exceeds operating cash flow ($32.0B) for roughly -$24B free cash flow.", asof: "2021-2025 actuals + 2026 guidance", src: { label: "company 10-Ks / earnings (2026 = guidance)" } },
    vacancyChart: { reviewed: "2026-06", take: "Primary-market data-center vacancy collapsed from 9.5% in 2019 to 1.4% in 2025 — far below the ~5% healthy-market floor — evidencing the supply-tightness and landlord pricing-power story.", asof: "2025 (year-end)", src: { label: "CBRE — North America Data Center Trends" } },
    funnelCompare: { reviewed: "2026-06", take: "The US data-center interconnect queue (97 GW) sits about 16x the 6 GW actively under construction, and even existing operational stock (41 GW) and modeled near-term buildable capacity (24 GW) dwarf active builds — these are four independent snapshots, not one cohort moving through stages.", asof: "2025 snapshots", src: { label: "LBNL Queued Up 2025 + CBRE + Goldman Sachs" } },
    phantomWaterfall: { reviewed: "2026-06", take: "Stripping the 97 GW headline queue of duplicate/multi-utility filings (-30% at midpoint) and speculative/unfinanced requests (-65%) leaves only about 24 GW — roughly a quarter, within a modeled 19–33 GW range — that appears buildable near-term.", asof: "2025 queue · haircuts modeled", src: { label: "LBNL Queued Up 2025" } },
    queueChart: { reviewed: "2026-06", take: "Across US ISOs the generation+storage interconnection queue is dominated by phantom volume — applying LBNL's 78% historical withdrawal rate leaves only ~22% credible, e.g. MISO 340 GW active but just 75 GW credible and PJM 290 GW active vs 64 GW credible.", asof: "annual LBNL snapshot (fetched in CI)", src: { label: "LBNL Queued Up" } },
    leadTimeChart: { reviewed: "2026-06", take: "Time from greenfield to energized ranges from about 3 years in fast-growth markets (Dallas, Louisiana, Central Ohio) up to 7 years in power-constrained Northern Virginia, with Silicon Valley at 6 — where you build drives the wait.", asof: "current market estimates", src: { label: "market estimates (curated)" } },
    costStackEngineer: { reviewed: "2026-06", take: "Compute, not the building, dominates the per-MW build cost: GPUs/accelerators alone run $23M/MW and servers/networking $8M, so the compute layers ($31M) far outweigh the entire facility shell, power and cooling stack ($11M).", asof: "current build-cost estimates", src: { label: "illustrative build stack (curated)" } },
    buildoutChart: { reviewed: "2026-06", take: "Across the top 5 hyperscalers self-built pipeline capacity exceeds operational capacity at every one — e.g. Meta has ~1,500 MW operational vs ~3,100 MW in pipeline and Amazon ~2,300 MW vs ~2,600 MW — signaling buildout still ramping well ahead of what is live.", asof: "modeled from IR + analyst sources", src: { label: "operator IR + analyst estimates (modeled)" } },
    timeToPowerChart: { reviewed: "2026-06", take: "On-site paths energize a site fastest — fuel cells in 3–12 months and behind-the-meter gas in 6–18 — while a full grid interconnect takes 48–84 months (4–7 years), making procurement path, not power scarcity, the binding 2026 timing variable.", asof: "2026 · grid duration cited, on-site bands modeled", src: { label: "LBNL Queued Up 2025" } },
    perfPerWattChart: { reviewed: "2026-06", take: "On a pinned dense FP16/BF16 silicon metric, per-watt efficiency only rose ~3x from A100 (index 100) to B200 (289) — but separate modeled effective-inference markers (FP4 + NVL72 rack-scale) reach 1,000 for GB200 NVL72 and ~3,500 for Rubin, showing the real deployment gains come from lower precision and rack design, not raw FP16 FLOPS/W.", asof: "2020–2025 GPU generations · markers modeled", src: { label: "NVIDIA datasheets (A100/H100/H200/Blackwell)" } },
    demandGapChart: { reviewed: "2026-06", take: "Annual US data-center demand additions outrun new firm generation committed to DC load nearly every year of the projection, with the widest single-year gap of 7 GW in 2027 (17 GW demand added vs. 10 GW firm gen) and demand exceeding new firm gen through 2030.", asof: "2024-2030 projection", src: { label: "modeled (GS / Wood Mackenzie / EIA + IRPs)" } },
    headroomChart: { reviewed: "2026-06", take: "On a derived nameplate-capacity proxy, all nine tracked balancing authorities sit above the 10% 'healthy' line, ranging from Southern Co. (SOCO) tightest at 16.3% to Duke (DUK) loosest at 57.8% spare.", asof: "fetched in CI (see feed stamp)", src: { label: "EIA-930 + EIA-860" } },
    powerPriceBoard: { reviewed: "2026-07", take: "Industrial retail power across the AI data-center corridor spans ~1.6x — Texas and Iowa cheapest near $63/MWh, Georgia ~$68, while Pennsylvania, Virginia and Ohio (the PJM data-center heartland) run ~$98–100/MWh — a standing incentive for megawatts to migrate.", asof: "fetched daily in CI (see method note)", src: { label: "EIA-861 prices" } },
    overcommitmentBoard: { reviewed: "2026-07", take: "Oracle has ~$327B of filed lease + purchase commitments against $32B of annual operating cash flow — ~10 years pre-committed — and CoreWeave ~$58B against ~$6B (~10 yrs, before a $19B excluded lease); the hyperscalers sit at 2.3–3.7 years, but every book is ACCELERATING (Microsoft's unopened leases doubled to $196.6B in nine months; Google's purchase commitments doubled in one quarter).", asof: "latest 10-K/10-Q per operator (Mar–May 2026)", src: { label: "SEC 10-K / 10-Q filings" } },
    tenorClocks: { reviewed: "2026-07", take: "The revenue-bearing asset depreciates over a filed 5.5–6 years, the leases financing it run 12–25 years, and new firm power arrives in 3–7 — every long-tenor take-or-pay signature bets that demand outlives at least two chip refresh cycles.", asof: "filed useful lives + lease terms (2026 filings)", src: { label: "SEC filings + equipment lead-time panels" } },
    jevonsChart: { reviewed: "2026-07", take: "The cheapest frontier flagship fell ~73% ($30 → $8/M tokens) across ten quarters while industry token volume grew ~22x (100T → 2,180T/quarter) — demand grew far faster than price fell, the Jevons pattern the buildout thesis rests on.", asof: "Q1 2024–Q2 2026 · derived from the two charts above", src: { label: "Derived: price-compression + token-volume series (modeled)" } },
    pjmAuctionChart: { reviewed: "2026-07", take: "PJM capacity prices exploded ~11x from $28.92/MW-day (2024/25) to $269.92 (2025/26), then cleared AT the FERC cap in back-to-back auctions ($329.17, then $333.44 for 2027/28) — data-center load is the primary driver, and the 2028/29 print lands July 14, 2026 under the extended collar.", asof: "by delivery year · through the 2027/28 auction (Dec 2025)", src: { label: "PJM Base Residual Auction reports" } },
    rateImpactChart: { reviewed: "2026-06", take: "Under high-DC-load scenarios, Virginia faces a projected +57% residential rate increase by 2030 vs. 2024 — more than double any other state, with only Texas (+28%) and Ohio (+22%) also above 20%.", asof: "by 2030 vs. 2024 (modeled)", src: { label: "Fortune analysis, utility IRPs (modeled)" } },
    cumDeficitChart: { reviewed: "2026-07", take: "The base path widens to ~19 GW of standing shortfall by 2030 — but the published range brackets it hard: on EPRI's 2024 low case the gap CLOSES entirely, while LBNL's 2028 high end implies a ~100+ GW problem. (The Bloom ~35 GW reference is yet-to-be-ANNOUNCED capacity from its Jan-2025 survey, not a measured shortfall.)", asof: "2024-2030 (modeled + published scenario anchors)", src: { label: "modeled (GS / Wood Mackenzie) · anchors: EPRI 2024, LBNL 2024" } },
    turbineSlots: { reviewed: "2026-06", take: "Gas-turbine order books are effectively sold out near-term: GE Vernova carries ~100 GW combined (44 GW firm backlog + 56 GW deposit-backed slot reservations), with the earliest new delivery slots not opening until 2029-2030 across GE Vernova, Siemens Energy and Mitsubishi.", asof: "Q1 FY2026 (reported Apr 2026)", src: { label: "GE Vernova / Siemens Energy / MHI earnings" } },
    powerSourceMixChart: { reviewed: "2026-06", take: "Gas carries US data-center load growth this decade — grid gas (+130 TWh) plus behind-the-meter on-site gas (+60 TWh) dominate the additional annual generation committed to 2030, ahead of renewables+storage (+110 TWh) and nuclear (+50 TWh, overwhelmingly post-2030 SMRs).", asof: "outlook to 2030 (period split modeled)", src: { label: "IEA, EIA STEO, S&P Global (period split modeled)" } },
    // Tokens tab (drafted from chart data after the tokens agent dropped mid-run; same grounding bar)
    tokenVolumeChart: { reviewed: "2026-06", take: "Externally-billed API token volume grew ~22× in two years — from ~100T tokens/quarter (Q1 2024) to ~2,180T (Q2 2026), led by OpenAI (~800T) — and even this excludes the far larger in-product inference load.", asof: "Q1 2024–Q2 2026 · modeled", src: { label: "Epoch AI, SemiAnalysis + provider disclosures (modeled)" } },
    priceCompressionChart: { reviewed: "2026-06", take: "Output-token prices keep falling — GPT-4's $60 per 1M (2023) to $8 (GPT-4.1, 2025), Claude 3 Opus $75 to $15 — and span roughly 125× from today's frontier down to OSS-hosted models near $0.60 per 1M.", asof: "2023–2025 launch prices", src: { label: "Provider pricing pages, OpenRouter, Together AI" } },
    costPerTaskChart: { reviewed: "2026-06", take: "Cheaper tokens don't always mean cheaper work: a simple chat task's cost collapsed (~$0.04→$0.0003), but a 2026 coding/agentic task burns ~1.2M tokens (vs ~2,000 in 2023), so its cost to COMPLETE rose to ~$18 even as sticker $/token fell ~100–300×.", asof: "2023 vs 2026 frontier · $/token cited, tokens-per-task modeled", src: { label: "modeled basket; $/token from provider pricing" } },
    splitChart: { reviewed: "2026-06", take: "Inference now dominates AI compute — ~92% of compute-hours vs 8% for training — but training stays more cost-concentrated, taking ~35% of spend versus 65% for inference.", asof: "late-2025 estimates", src: { label: "SemiAnalysis, Epoch AI" } },
  };

  // Lollipop ranking chart — thin stem + end dot. The modern replacement for ranked bars.
  // rows: [{label, value, color}]; opts: {fmt, tick, suggestedMax, rightPad, dotR, tooltipCallbacks, annotation, seriesLabel}
  function renderLollipop(canvasId, rows, opts) {
    if (!$(canvasId) || typeof Chart === "undefined") return;
    opts = opts || {};
    initCharts(); applyChartDefaults();
    const cl = getChartColors();
    const fmt = opts.fmt || (v => v);
    const colors = rows.map(x => x.color || CHART_PALETTE.demand);
    const r = opts.dotR || 7;
    if (_charts[canvasId]) { try { _charts[canvasId].destroy(); } catch (_) {} delete _charts[canvasId]; }
    const dots = { id: "lolly-" + canvasId, afterDatasetsDraw(chart) {
      const ctx = chart.ctx, meta = chart.getDatasetMeta(0);
      meta.data.forEach((el, i) => { ctx.save(); ctx.beginPath(); ctx.arc(el.x, el.y, r, 0, 6.2832); ctx.fillStyle = colors[i]; ctx.fill(); ctx.restore(); });
    } };
    _charts[canvasId] = new Chart($(canvasId), {
      type: "bar",
      data: { labels: rows.map(x => x.label), datasets: [{ label: opts.seriesLabel, data: rows.map(x => x.value), backgroundColor: colors.map(c => hexA(c, 0.45)), borderWidth: 0, barThickness: 3 }] },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: opts.rightPad || 52 } },
        plugins: {
          legend: { display: false },
          datalabels: Object.assign({}, LABEL_STYLE_FN(), { display: true, anchor: "end", align: "end", offset: r + 6, formatter: (v, c) => fmt(v, rows[c.dataIndex]) }),
          tooltip: { callbacks: opts.tooltipCallbacks || { label: c => " " + fmt(c.parsed.x, rows[c.dataIndex]) } },
          annotation: opts.annotation
        },
        scales: {
          x: { beginAtZero: true, suggestedMax: opts.suggestedMax, grid: { color: cl.grid }, ticks: { callback: opts.tick || (v => v) } },
          y: { grid: { display: false }, ticks: { font: { weight: 700 } } }
        }
      },
      plugins: [dots]
    });
    return _charts[canvasId];
  }

  function getChartColors() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    return {
      text:  dark ? "#cbd5e1" : "#0f1b2d",
      label: dark ? "#cbd5e1" : "#475569",
      grid:  dark ? "#334155" : "#eef1f5"
    };
  }
  function applyChartDefaults() {
    if (typeof Chart === "undefined") return;
    const c = getChartColors();
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 12.5;                     // bolder, more legible
    Chart.defaults.color = c.text;
    Chart.defaults.borderColor = c.grid;                 // soft, consistent grid lines everywhere
    // Bars — consistently rounded + chunkier
    Chart.defaults.elements.bar.borderRadius = 7;
    Chart.defaults.elements.bar.borderSkipped = false;
    try {
      Chart.defaults.datasets.bar.categoryPercentage = 0.82;
      Chart.defaults.datasets.bar.barPercentage = 0.94;
    } catch (_) {}
    // Lines — smooth + heavier stroke, no dotty points until hover
    Chart.defaults.elements.line.tension = 0.35;
    Chart.defaults.elements.line.borderWidth = 2.6;
    Chart.defaults.elements.point.radius = 0;
    Chart.defaults.elements.point.hoverRadius = 5;
    Chart.defaults.elements.point.hitRadius = 10;
    // Legend (where shown) — tidy bottom row with point markers
    try {
      const L = Chart.defaults.plugins.legend;
      L.position = "bottom";
      L.labels = Object.assign(L.labels || {}, { usePointStyle: true, boxWidth: 7, padding: 14 });
      const T = Chart.defaults.plugins.tooltip;
      T.usePointStyle = true; T.padding = 10; T.cornerRadius = 8; T.boxPadding = 5;
    } catch (_) {}
    // Gentle, consistent motion — honor prefers-reduced-motion in one place
    const _reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    Chart.defaults.animation = _reduce ? false : { duration: 550, easing: "easeOutQuart" };
  }
  function initCharts() {
    if (_chartsInit || typeof Chart === "undefined") return;
    _chartsInit = true;
    if (typeof ChartDataLabels !== "undefined") {
      Chart.register(ChartDataLabels);
      Chart.defaults.plugins = Chart.defaults.plugins || {};
      Chart.defaults.plugins.datalabels = { display: false };
    }
    if (window["chartjs-plugin-annotation"]) { try { Chart.register(window["chartjs-plugin-annotation"]); } catch (_) {} }
    applyChartDefaults();
  }
  // Common datalabel style — picks up current theme color
  function LABEL_STYLE_FN() {
    return {
      color: getChartColors().label,
      font: { weight: 800, size: 12 },
      anchor: "end",
      align: "end"
    };
  }
  // Backward-compat: legacy `LABEL_STYLE` callsites still see the current theme's values
  const LABEL_STYLE = new Proxy({}, {
    get(_, prop) { return LABEL_STYLE_FN()[prop]; }
  });

  /* ---- Per-chart tools: accessible data table, PNG/CSV export, deep-link (ranks 6 + 7) ----
     One shared helper auto-attaches a small toolbar + a hidden <table> under every
     Chart.js canvas, so every chart gets the same affordances for free. */
  function _csvEscape(s) { s = String(s == null ? "" : s); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function _downloadBlob(name, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function _chartTitle(canvas) {
    const card = canvas.closest(".stub-card");
    const h = card && card.querySelector("h4");
    return h ? h.textContent.replace(/\s+/g, " ").trim() : canvas.id;
  }
  // Self-contained PNG: composite the chart with a title header + source/date/license
  // footer, so a shared image stands on its own (title, source, date, license, permalink).
  function _exportChartPng(id) {
    const live = Chart.getChart(id); if (!live) return;
    const cv = live.canvas;
    const scale = (cv.clientWidth ? cv.width / cv.clientWidth : (window.devicePixelRatio || 1)) || 1;
    const padX = Math.round(20 * scale), headH = Math.round(48 * scale), footH = Math.round(34 * scale);
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const out = document.createElement("canvas");
    out.width = cv.width; out.height = headH + cv.height + footH;
    const ctx = out.getContext("2d");
    ctx.fillStyle = dark ? "#0b1220" : "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.textBaseline = "middle";
    ctx.fillStyle = dark ? "#e2e8f0" : "#0f1b2d";
    ctx.font = "600 " + Math.round(15 * scale) + "px Inter, sans-serif";
    ctx.fillText(_chartTitle(cv), padX, headH / 2, out.width - 2 * padX);
    ctx.drawImage(cv, 0, headH);
    ctx.fillStyle = dark ? "#94a3b8" : "#64748b";
    ctx.font = Math.round(11 * scale) + "px Inter, sans-serif";
    const asOf = (window.DATA && DATA.lastUpdated) ? "as of " + DATA.lastUpdated + " · " : "";
    ctx.fillText("US AI Infrastructure Monitor · " + asOf + "CC BY 4.0 · vijay-sachdeva.github.io/us-ai-infra",
      padX, headH + cv.height + footH / 2, out.width - 2 * padX);
    out.toBlob(b => { if (b) _downloadBlob(id + ".png", b); }, "image/png");
  }
  function _chartRows(chart) {
    const labels = chart.data.labels || [];
    const dss = (chart.data.datasets || []).filter(d => d && d.data && (!d.label || d.label[0] !== "_"));
    const head = ["", ...dss.map(d => d.label || "value")];
    const body = labels.map((lab, i) => ["" + lab, ...dss.map(d => {
      const v = d.data[i];
      return (v == null || typeof v === "object") ? "" : v;
    })]);
    return { head, body };
  }
  function _buildDataTable(chart, canvas) {
    const { head, body } = _chartRows(chart);
    const wrap = document.createElement("div");
    wrap.className = "chart-data-wrap"; wrap.hidden = true;
    const t = document.createElement("table");
    t.className = "chart-data-table";
    const cap = document.createElement("caption");
    cap.textContent = _chartTitle(canvas) + " — data";
    t.appendChild(cap);
    const thead = document.createElement("thead"), hr = document.createElement("tr");
    head.forEach((h, i) => { const c = document.createElement("th"); c.scope = "col"; c.textContent = i === 0 ? "" : h; hr.appendChild(c); });
    thead.appendChild(hr); t.appendChild(thead);
    const tb = document.createElement("tbody");
    body.forEach(row => {
      const tr = document.createElement("tr");
      row.forEach((cell, i) => {
        const c = document.createElement(i === 0 ? "th" : "td");
        if (i === 0) c.scope = "row";
        c.textContent = cell === "" ? "—" : cell;
        tr.appendChild(c);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t);
    return wrap;
  }
  // Rebuild a canvas's inline accessible data table in place (e.g. after a scenario
  // re-render) so the screen-reader table never lags the chart. Preserves the wrap's
  // id / hidden state / toggle binding; no-op before enhanceCharts has built the table.
  function refreshChartTable(id) {
    const wrap = document.getElementById(id + "-data");
    const chart = (typeof Chart !== "undefined") && Chart.getChart(id);
    if (!wrap || !chart) return;
    const fresh = _buildDataTable(chart, chart.canvas).querySelector("table");
    const old = wrap.querySelector("table");
    if (fresh && old) old.replaceWith(fresh);
  }
  function _mkToolBtn(label, title) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chart-tool-btn"; b.textContent = label;
    b.setAttribute("aria-label", title); b.title = title;
    return b;
  }
  function enhanceCharts(scope) {
    if (typeof Chart === "undefined") return;
    const sec = document.querySelector('section.tab-content[data-tab="' + scope + '"]') || document;
    sec.querySelectorAll(".chart-box > canvas[id]").forEach(canvas => {
      const id = canvas.id;
      const chart = Chart.getChart(id);
      if (!chart) return;
      const box = canvas.closest(".chart-box");
      if (!box) return;
      box.setAttribute("data-chart-anchor", id);
      // a11y: expose each chart canvas as a labelled image (screen readers ignore bare <canvas>)
      if (!canvas.getAttribute("aria-label")) {
        const card = canvas.closest(".stub-card");
        const h = card && card.querySelector("h4");
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", (h ? h.textContent.replace(/\s+/g, " ").trim() : id) + " — chart; underlying numbers in the Data table below.");
      }
      // idempotent — survives theme re-render (charts are destroyed but the caption/toolbar DOM stays)
      if (box.dataset.enhanced) return;
      box.dataset.enhanced = "1";
      const tools = document.createElement("div");
      tools.className = "chart-tools";
      const table = _buildDataTable(chart, canvas);

      const dataBtn = _mkToolBtn("Data", "Show the underlying numbers as a table");
      dataBtn.setAttribute("aria-expanded", "false");
      dataBtn.setAttribute("aria-controls", id + "-data");
      table.id = id + "-data";
      dataBtn.addEventListener("click", () => {
        const open = table.hidden; table.hidden = !open;
        dataBtn.setAttribute("aria-expanded", String(open));
      });

      const pngBtn = _mkToolBtn("PNG", "Download this chart as a PNG (with title, source + license)");
      pngBtn.addEventListener("click", () => _exportChartPng(id));

      const csvBtn = _mkToolBtn("CSV", "Download this chart's data as CSV");
      csvBtn.addEventListener("click", () => {
        const live = Chart.getChart(id); if (!live) return;
        const { head, body } = _chartRows(live);
        _downloadBlob(id + ".csv", [head, ...body].map(r => r.map(_csvEscape).join(",")).join("\r\n"), "text/csv");
      });

      const linkBtn = _mkToolBtn("Link", "Copy a direct link to this chart");
      linkBtn.addEventListener("click", async () => {
        const url = location.origin + location.pathname + "#" + scope + ":" + id;
        try { await navigator.clipboard.writeText(url); }
        catch (_) { const ta = document.createElement("textarea"); ta.value = url; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); }
        const prev = linkBtn.textContent; linkBtn.textContent = "Copied ✓";
        setTimeout(() => { linkBtn.textContent = prev; }, 1400);
      });

      tools.append(dataBtn, pngBtn, csvBtn, linkBtn);
      // Optional standardized caption (grounded takeaway + as-of + source) between chart and toolbar.
      const cm = (typeof CHART_META !== "undefined") ? CHART_META[id] : null;
      let anchorEl = box;
      if (cm && (cm.take || cm.asof || (cm.src && cm.src.label))) {
        const cap = document.createElement("div");
        cap.className = "chart-cap";
        let capHtml = "";
        if (cm.take) capHtml += '<div class="cap-take">' + cm.take + '</div>';
        const bits = [];
        if (cm.asof) bits.push("As of " + cm.asof);
        if (cm.src && cm.src.label) bits.push("Source: " + (cm.src.url ? '<a href="' + cm.src.url + '" target="_blank" rel="noopener">' + cm.src.label + '</a>' : cm.src.label));
        // Staleness governance: `reviewed` = when a curator last re-verified this module's
        // numbers (YYYY-MM). Amber past ~100 days, red past ~150 — the same thresholds the QA
        // gate enforces, so a rotting curated panel warns here before it fails CI.
        if (cm.reviewed) {
          const ageDays = (Date.now() - new Date(cm.reviewed + "-01T00:00:00Z").getTime()) / 864e5;
          if (ageDays > 150) bits.push('<span class="cf-tier cf-crit" title="Curated figures last re-verified ' + cm.reviewed + ' — review overdue.">review overdue</span>');
          else if (ageDays > 100) bits.push('<span class="cf-tier cf-warn" title="Curated figures last re-verified ' + cm.reviewed + ' — due for re-verification.">review due</span>');
        }
        if (bits.length) capHtml += '<div class="cap-meta">' + bits.join(" · ") + '</div>';
        cap.innerHTML = capHtml;
        box.insertAdjacentElement("afterend", cap);
        anchorEl = cap;
      }
      anchorEl.insertAdjacentElement("afterend", tools);
      tools.insertAdjacentElement("afterend", table);
    });
  }
  // Deep-link target: after a tab renders, scroll to (and briefly flash) the linked chart.
  function scrollToChartAnchor(anchor) {
    if (!anchor) return;
    const tryScroll = () => {
      const box = document.querySelector('.chart-box[data-chart-anchor="' + (window.CSS && CSS.escape ? CSS.escape(anchor) : anchor) + '"]');
      if (!box) return false;
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      box.classList.remove("chart-link-flash"); void box.offsetWidth; box.classList.add("chart-link-flash");
      return true;
    };
    if (!tryScroll()) setTimeout(tryScroll, 120);   // charts may still be laying out
  }

  function renderCapexSankey(view) {
    const host = $("capexSankey");
    if (!host || !DATA.capexFlow) return;
    if (typeof d3 === "undefined" || typeof d3.sankey !== "function") {
      host.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">Flow chart requires d3-sankey — reload when online.</div>';
      return;
    }
    const cf = DATA.capexFlow;
    if (view) renderCapexSankey._view = view;
    view = renderCapexSankey._view || "all";

    const nodes = [], links = [], idx = {};
    const node = (name, color) => { if (!(name in idx)) { idx[name] = nodes.length; nodes.push({ name, color }); } return idx[name]; };
    const catColor = k => (cf.cats[k] || {}).color || "#64748b";

    if (view === "all") {
      const t = node("Total capex", "#f59e0b");
      cf.companies.forEach(c => {
        const cn = node(c.name, c.color);
        links.push({ source: t, target: cn, value: c.total, color: c.color });
        const byCat = {};
        c.buckets.forEach(b => { byCat[b.cat] = (byCat[b.cat] || 0) + b.value; });
        Object.keys(byCat).forEach(k => links.push({ source: cn, target: node((cf.cats[k] || {}).label || k, catColor(k)), value: byCat[k], color: catColor(k) }));
      });
    } else {
      const c = cf.companies.find(x => x.name === view) || cf.companies[0];
      const t = node(c.name, c.color);
      cf.lanes.forEach(lane => {
        const lb = c.buckets.filter(b => b.lane === lane.key);
        const lt = lb.reduce((s, b) => s + b.value, 0);
        if (lt <= 0) return;
        const lc = lane.key === "infra" ? c.color : "#64748b";
        const ln = node(lane.label, lc);
        links.push({ source: t, target: ln, value: lt, color: lc });
        lb.forEach(b => links.push({ source: ln, target: node(b.label, catColor(b.cat)), value: b.value, color: catColor(b.cat) }));
      });
    }

    host.querySelectorAll("svg").forEach(s => s.remove());
    // Keep the flow legible on phones: lay out at >=MINW and let the host scroll horizontally
    // (labels sit on both sides of the middle column, so it can't compress below this).
    const MINW = 680;
    const W = Math.max(host.clientWidth || 760, MINW);
    const H = view === "all" ? 480 : 360;
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const txt = isDark ? "#e2e8f0" : "#1e293b", muted = isDark ? "#94a3b8" : "#64748b";
    const svg = d3.select(host).append("svg")
      .attr("viewBox", "0 0 " + W + " " + H).style("width", "100%").style("height", "auto").style("min-width", MINW + "px")
      .attr("font-family", "Inter, sans-serif");
    const sankey = d3.sankey().nodeWidth(20).nodePadding(view === "all" ? 12 : 26)
      .extent([[4, 46], [W - 220, H - 14]]);
    const g = sankey({ nodes: nodes.map(d => Object.assign({}, d)), links: links.map(d => Object.assign({}, d)) });
    const maxDepth = d3.max(g.nodes, d => d.depth);

    // Gradient ribbons (source colour → target colour)
    const defs = svg.append("defs");
    g.links.forEach((d, i) => {
      const lg = defs.append("linearGradient").attr("id", "cfg" + i).attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", d.source.x1).attr("x2", d.target.x0);
      lg.append("stop").attr("offset", "0%").attr("stop-color", d.source.color || "#64748b");
      lg.append("stop").attr("offset", "100%").attr("stop-color", d.target.color || "#64748b");
    });

    // Column headers
    const byDepth = {};
    g.nodes.forEach(n => { (byDepth[n.depth] = byDepth[n.depth] || []).push(n); });
    Object.keys(byDepth).forEach(dep => {
      const arr = byDepth[dep], d0 = +dep;
      const label = d0 === 0 ? "TOTAL CAPEX" : (d0 === maxDepth ? "SPEND BUCKETS" : (view === "all" ? "OPERATORS" : "ALLOCATION"));
      const hx = d0 === maxDepth ? arr[0].x1 + 8 : arr[0].x0;
      svg.append("text").attr("x", hx).attr("y", 22).attr("text-anchor", "start")
        .attr("fill", muted).attr("font-size", "10px").attr("font-weight", "700").attr("letter-spacing", ".07em").text(label);
    });

    // Links
    svg.append("g").attr("fill", "none").selectAll("path").data(g.links).join("path")
      .attr("d", d3.sankeyLinkHorizontal())
      .attr("stroke", (d, i) => "url(#cfg" + i + ")").attr("stroke-opacity", isDark ? 0.55 : 0.48)
      .attr("stroke-width", d => Math.max(1.5, d.width))
      .append("title").text(d => d.source.name + " → " + d.target.name + ": $" + d.value + "B");

    // Nodes + labels
    const nn = svg.append("g").selectAll("g").data(g.nodes).join("g");
    nn.append("rect").attr("x", d => d.x0).attr("y", d => d.y0)
      .attr("width", d => d.x1 - d.x0).attr("height", d => Math.max(2, d.y1 - d.y0))
      .attr("fill", d => d.color || "#64748b").attr("rx", 3)
      .append("title").text(d => d.name + ": $" + Math.round(d.value) + "B");
    nn.each(function (d) {
      const rightmost = d.depth === maxDepth, leftmost = d.depth === 0;
      const cy = (d.y0 + d.y1) / 2, val = "$" + Math.round(d.value) + "B";
      const t = d3.select(this).append("text").attr("font-weight", "700").attr("fill", txt);
      if (rightmost) {
        t.attr("x", d.x1 + 9).attr("y", cy).attr("dy", "0.34em").attr("text-anchor", "start").attr("font-size", "10.5px");
        t.append("tspan").text(d.name);
        t.append("tspan").attr("dx", "6").attr("fill", muted).attr("font-weight", "600").text(val);
      } else if (leftmost) {
        t.attr("x", d.x0).attr("y", d.y0 - 8).attr("text-anchor", "start").attr("font-size", "11.5px").text(d.name + "  " + val);
      } else {
        t.attr("x", d.x0 - 9).attr("y", cy).attr("dy", "0.34em").attr("text-anchor", "end").attr("font-size", "11px").text(d.name + "  " + val);
      }
    });

    const method = $("capexMethod");
    if (method) method.innerHTML = "<b>Modeled split.</b> " + cf.methodology;

    const toggle = $("capexViewToggle");
    if (toggle && !toggle._wired) {
      toggle._wired = true;
      toggle.querySelectorAll(".map-view-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const v = btn.dataset.cview;
          if (v === renderCapexSankey._view) return;
          toggle.querySelectorAll(".map-view-btn").forEach(b => b.classList.toggle("active", b === btn));
          renderCapexSankey(v);
        });
      });
    }
  }

  // Reconciliation WATERFALL: 97 GW headline queue → modeled ~24 GW buildable, via two
  // sequential modeled haircuts. Floating bars (transparent _base + visible value), with a
  // Low/Mid/High scenario control and a fixed 19–33 GW modeled-range box on the result.
  function renderPhantomWaterfall(scenario) {
    if (!$("phantomWaterfall") || typeof Chart === "undefined" || !DATA.phantomLoad) return;
    scenario = scenario || renderPhantomWaterfall._view || "mid";
    renderPhantomWaterfall._view = scenario;        // persists across destroy → theme rebuild keeps scenario
    initCharts(); applyChartDefaults();
    const s  = PL_SCENARIOS[scenario];
    const cl = getChartColors();
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const labels = ["Headline queued", "− Duplicate / multi-utility", "− Speculative / unfinanced", "= Buildable (modeled)"];
    const base   = [0, s.afterDup, s.buildable, 0];
    const value  = [PL_QUEUE, s.dupDelta, s.specDelta, s.buildable];
    const colors = [PL_COLORS.blue, PL_COLORS.red, PL_COLORS.red, PL_COLORS.green];
    const signs  = ["", "−", "−", "="];

    if (_charts.phantomWaterfall) { try { _charts.phantomWaterfall.destroy(); } catch (_) {} delete _charts.phantomWaterfall; }

    _charts.phantomWaterfall = new Chart($("phantomWaterfall"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "_base", data: base, backgroundColor: "rgba(0,0,0,0)", stack: "wf", datalabels: { display: false } },
          { label: "GW", data: value, stack: "wf",
            backgroundColor: colors,
            borderColor:  colors.map((c, i) => i === 3 ? cl.label : c),
            borderWidth:  colors.map((_, i) => i === 3 ? 1.5 : 0),
            borderDash: [4, 3], borderRadius: 7, maxBarThickness: 34 }
        ]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        animation: reduce ? false : undefined,
        layout: { padding: { right: 64, top: 6 } },
        scales: {
          x: { stacked: true, beginAtZero: true, suggestedMax: 105, grid: { color: cl.grid }, ticks: { callback: v => v + " GW" } },
          y: { stacked: true, grid: { display: false }, ticks: { font: { weight: 700 } } }
        },
        plugins: {
          legend: { display: false },
          datalabels: {
            display: c => c.datasetIndex === 1,        // only the visible dataset labels
            color: cl.label, font: { weight: 800, size: 12 },
            anchor: "end", align: "end", clamp: true,
            formatter: (v, c) => signs[c.dataIndex] + v + " GW"
          },
          annotation: { annotations: {
            range: {
              type: "box", xScaleID: "x", yScaleID: "y",
              yMin: 2.6, yMax: 3.4,
              xMin: PL_RANGE.min, xMax: PL_RANGE.max,
              backgroundColor: "rgba(16,185,129,0.16)",
              borderColor: "rgba(16,185,129,0.55)", borderWidth: 1, borderDash: [3, 3],
              label: { display: true, content: PL_RANGE.min + "–" + PL_RANGE.max + " GW range (" + PL_RANGE.mid + " = midpoint)",
                       position: { x: "end", y: "start" }, color: PL_COLORS.green,
                       font: { size: 9.5, weight: 700 }, backgroundColor: "rgba(0,0,0,0)" }
            }
          }},
          tooltip: {
            filter: item => item.datasetIndex === 1,
            callbacks: {
              title: items => labels[items[0].dataIndex],
              label: c => {
                const i = c.dataIndex;
                if (i === 0) return " Headline queued: 97 GW (LBNL, analyst)";
                if (i === 3) return " Buildable near-term: " + s.buildable + " GW (modeled; range " + PL_RANGE.min + "–" + PL_RANGE.max + " GW)";
                const pct = i === 1 ? s.dupPct : s.specPct;
                const running = i === 1 ? s.afterDup : s.buildable;
                return " −" + value[i] + " GW (" + pct + ") → " + running + " GW remaining";
              },
              footer: items => {
                const i = items[0].dataIndex;
                if (i === 1) return DATA.phantomLoad.stages[1].src.label;
                if (i === 2) return DATA.phantomLoad.stages[2].src.label;
                if (i === 3) return "Modeled residual — see Methodology";
                return DATA.phantomLoad.queuedSrc.label;
              }
            }
          }
        }
      }
    });

    if ($("phantomLoadConv")) {
      const frac = Math.round(s.buildable / PL_QUEUE * 100);   // tracks the scenario (no fixed "one-quarter")
      $("phantomLoadConv").innerHTML =
        'About <b>' + frac + '%</b> of the ' + PL_QUEUE + ' GW headline queue (~<b>' + s.buildable +
        ' GW</b>; modeled range ' + PL_RANGE.min + '–' + PL_RANGE.max +
        ' GW) appears buildable near-term once duplicate and speculative requests are removed.' +
        '<br><span class="pl-onesrc">Modeled estimate using LBNL queue data and cited industry haircut ranges.</span>';
    }
    refreshChartTable("phantomWaterfall");   // keep the inline a11y table in sync with the scenario
    renderPhantomMethod();
  }

  // Full source chain for the waterfall — folded into a <details>; scenario-independent.
  function renderPhantomMethod() {
    if (!$("phantomLoadMethod")) return;
    const p = DATA.phantomLoad;
    $("phantomLoadMethod").innerHTML =
      '<b>Modeled reconciliation.</b> Haircut bands: duplicate/multi-utility ' + p.stages[1].haircutPct +
      ', speculative/unfinanced ' + p.stages[2].haircutPct + '. The ' + PL_RANGE.mid +
      ' GW buildable endpoint is a midpoint; the ' + PL_RANGE.min + '–' + PL_RANGE.max +
      ' GW range spans Low/High haircut assumptions. ' +
      '<b>Citation tiers:</b> 41 / 6 / 97 GW are analyst-cited; the 24 GW buildable endpoint and the haircut bands are modeled.<br>' +
      '<b>Queue base:</b> ' + p.queuedSrc.label + '.<br>' +
      '<b>Duplicate basis:</b> ' + p.stages[1].src.label + '.<br>' +
      '<b>Speculative basis:</b> ' + p.stages[2].src.label + '.<br>' +
      '<b>Real-world check:</b> ' + p.validation.text + ' <span class="stack-src">— ' + p.validation.src.label + '.</span>';
  }

  // Low / Midpoint / High scenario control (idempotent — survives theme rebuild via _wired).
  function wirePhantomScenario() {
    const toggle = $("phantomScenario");
    if (!toggle || toggle._wired) return;
    toggle._wired = true;
    toggle.querySelectorAll(".map-view-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.scenario;
        if (v === renderPhantomWaterfall._view) return;
        toggle.querySelectorAll(".map-view-btn").forEach(b => {
          const on = b === btn;
          b.classList.toggle("active", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
        renderPhantomWaterfall(v);
      });
    });
  }

  // Demand scenarios for the cumulative-deficit chart — anchored STRICTLY to published
  // forecasts (never a homegrown elasticity model). Factors scale the modeled demand-adds
  // path so its implied TOTAL US DC load hits the named anchor; committed firm generation is
  // held constant. Baseline pre-2024 load ≈21 GW is inferred from the site's own GS 41 GW
  // 2026 KPI minus the modeled 20 GW of 2024–26 adds; all arithmetic stated in the method.
  const DEFICIT_SCENARIOS = {
    base: { label: "Base — GS / Wood Mackenzie", factor: 1, scenario: false,
      note: "The modeled base path: cumulative demand adds ~79 GW by 2030 vs ~60 GW of committed firm generation — the ~19 GW standing gap. (LBNL's 2028 LOW end, 325 TWh ≈ 74 GW total load, lands almost exactly on this path.)" },
    low: { label: "Published low — EPRI '24", factor: 0.30, scenario: true,
      note: "SCENARIO: EPRI's May-2024 low case holds data centers near ~4.6% of US generation through 2030 — essentially flat vs the 4.4% share LBNL measured for 2023 (~45 GW total load in 2030 at 50% utilization). Demand adds fall to ~0.30x the base and the gap CLOSES — committed generation overshoots instead. This is the published bear case; whoever signed the longest take-or-pay paper owns it (see the commitment book on Capital)." },
    high: { label: "Published high — LBNL '28", factor: 2.13, scenario: true,
      note: "SCENARIO: LBNL's 2028 HIGH end — 580 TWh ≈ 132 GW of total DC power demand at the report's stated 50%-utilization assumption — implies ~2.1x the base demand path. The 2030 standing gap becomes ~100+ GW, not 19: on the published high case the grid problem is ~5x the headline." }
  };
  function renderCumDeficitChart() {
    if (!$("cumDeficitChart") || typeof Chart === "undefined") return;
    if (renderCumDeficitChart._done) return;
    renderCumDeficitChart._done = true;
    initCharts(); applyChartDefaults();
    const dp = DATA.demandProjection;
    const cd = DATA.cumulativeDeficit;
    const cl = getChartColors();
    const scenKey = renderCumDeficitChart._scenario || "base";
    const scen = DEFICIT_SCENARIOS[scenKey];
    // Cumulative running deficit, computed live so it can never drift from demandProjection.
    let cumDemand = 0, cumGen = 0;
    const deficit = dp.years.map((_, i) => {
      cumDemand += dp.yoyDemandGrowthGW[i];
      cumGen    += dp.newFirmGenForDC[i];
      return Math.round((cumDemand * scen.factor - cumGen) * 10) / 10;
    });
    if (_charts.cumDeficitChart) { try { _charts.cumDeficitChart.destroy(); } catch (_) {} delete _charts.cumDeficitChart; }
    const lineCol = scenKey === "low" ? CHART_PALETTE.supply : "#c0322b";
    _charts.cumDeficitChart = new Chart($("cumDeficitChart"), {
      type: "line",
      data: {
        labels: dp.years,
        datasets: [{
          label: "Standing cumulative deficit",
          data: deficit,
          borderColor: lineCol,
          backgroundColor: hexA(lineCol, 0.12),
          fill: true, tension: 0.3,
          pointRadius: 5, pointBackgroundColor: lineCol,
          borderWidth: 2.5
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { display: false },
          datalabels: { display: true, color: cl.label, font: { weight: 700, size: 11 }, align: "top", offset: 6, formatter: v => v + " GW" },
          annotation: { annotations: { bloom: { type: "line", yMin: 35, yMax: 35, borderColor: "#c2710c", borderWidth: 1, borderDash: [5, 4], label: { display: true, content: "Bloom '25 survey: ~35 GW of capacity YET TO BE ANNOUNCED by 2030 (not a measured shortfall)", position: "end", backgroundColor: "rgba(194,113,12,0.85)", color: "#fff", font: { size: 8.5, weight: 700 }, padding: 3 } } } },
          tooltip: { callbacks: {
            label: c => " " + c.parsed.y + " GW " + (c.parsed.y >= 0 ? "standing shortfall" : "surplus vs committed gen (scenario)"),
            footer: () => scenKey === "base" ? "Source: " + cd.src.label : "Scenario anchor: " + scen.label
          }}
        },
        scales: {
          y: { grid: { color: cl.grid }, ticks: { callback: v => v + " GW" }, beginAtZero: scenKey !== "low", suggestedMax: scenKey === "high" ? 115 : 38, title: { display: true, text: "Cumulative shortfall (GW)" } },
          x: { grid: { display: false } }
        }
      }
    });
    if ($("cumDeficitMethod")) {
      const baseMethod = "<b>Cumulative deficit (modeled)</b> = &Sigma; DC demand added &minus; &Sigma; new firm generation for DC, from the demand-vs-generation series above. ";
      const scenMethod = scenKey === "base" ? ("Widens to ~" + deficit[deficit.length - 1] + " GW standing shortfall by 2030. " + cd.crosscheck + " ") : "";
      $("cumDeficitMethod").innerHTML = baseMethod + scenMethod + "<b>" + scen.label + ":</b> " + scen.note +
        (scen.scenario ? " <i>Scenario arithmetic: demand path scaled to the published anchor (baseline ≈21 GW pre-2024 load inferred from the GS 41 GW 2026 total minus modeled adds); firm-gen path unchanged.</i>" : "");
    }
    // Wire the scenario toggle once.
    const tog = $("cumDeficitScenario");
    if (tog && !tog._wired) {
      tog._wired = true;
      tog.querySelectorAll(".map-view-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const v = btn.dataset.scen;
          if (v === (renderCumDeficitChart._scenario || "base")) return;
          renderCumDeficitChart._scenario = v;
          tog.querySelectorAll(".map-view-btn").forEach(b => b.classList.toggle("active", b === btn));
          renderCumDeficitChart._done = false;
          renderCumDeficitChart();
        });
      });
    }
  }

  function renderTurbineSlots() {
    if (!$("turbineSlots") || typeof Chart === "undefined" || !DATA.turbineSlots) return;
    if (renderTurbineSlots._done) return;
    renderTurbineSlots._done = true;
    initCharts(); applyChartDefaults();
    const ts = DATA.turbineSlots;
    const cl = getChartColors();
    _charts.turbineSlots = new Chart($("turbineSlots"), {
      type: "bar",
      data: {
        labels: ts.oems.map(o => o.name),
        datasets: [
          { label: "Firm equipment backlog", data: ts.oems.map(o => o.backlog),
            backgroundColor: ts.colors.backlog, borderRadius: 4, maxBarThickness: 26, stack: "s" },
          { label: "Slot reservation agreements", data: ts.oems.map(o => o.slots),
            backgroundColor: ts.colors.slots, borderRadius: 4, maxBarThickness: 26, stack: "s" }
        ]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 40 } },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, padding: 14 } },
          datalabels: Object.assign({}, LABEL_STYLE_FN(), {
            display: c => c.dataset.data[c.dataIndex] >= 18,
            formatter: v => v + " GW"
          }),
          tooltip: { callbacks: {
            label: c => " " + c.dataset.label + ": " + c.parsed.x + " GW",
            footer: items => {
              const o = ts.oems[items[0].dataIndex];
              return o.note + "\nSource: " + o.src.label;
            }
          }}
        },
        scales: {
          x: { stacked: true, grid: { color: cl.grid }, ticks: { callback: v => v + " GW" }, beginAtZero: true },
          y: { stacked: true, grid: { display: false } }
        }
      }
    });
    const mk = $("turbineSlotsMarkers");
    if (mk) {
      mk.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:8px;font-size:11px">' +
        ts.oems.map(o =>
          '<span style="background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:3px 8px">' +
          '<b>' + o.name + '</b> earliest new slot: <b style="color:var(--red)">' + o.firstSlot + '</b></span>'
        ).join("") + '</div>';
    }
    const m = $("turbineSlotsMethod");
    if (m) m.innerHTML = "<b>Cited to OEM earnings / 8-K (primary).</b> " + ts.methodology +
      " <b>US-DC share is modeled:</b> " + ts.attributable;
  }

  function renderPowerSourceMixChart() {
    if (!$("powerSourceMixChart") || typeof Chart === "undefined") return;
    if (renderPowerSourceMixChart._done) return;
    renderPowerSourceMixChart._done = true;
    initCharts(); applyChartDefaults();
    const pm = DATA.powerSourceMix;
    const cl = getChartColors();
    _charts.powerSourceMixChart = new Chart($("powerSourceMixChart"), {
      type: "bar",
      data: {
        labels: pm.periods,
        datasets: pm.sources.map(s => ({
          label: s.name,
          data: s.values,
          backgroundColor: s.color,
          borderRadius: 4,
          maxBarThickness: 70,
          _src: s.src
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 12 } },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, padding: 12 } },
          datalabels: Object.assign({}, LABEL_STYLE_FN(), {
            display: ctx => ctx.dataset.data[ctx.dataIndex] >= 20,
            color: "#fff", font: { weight: 700, size: 10 },
            formatter: v => v + " TWh"
          }),
          tooltip: { callbacks: {
            label: c => " " + c.dataset.label + ": " + c.parsed.y + " TWh",
            footer: items => { const s = items[0].dataset._src; return s ? "Source: " + s.label : ""; }
          }}
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: cl.grid }, ticks: { callback: v => v + " TWh" }, beginAtZero: true }
        }
      }
    });
    const method = $("powerSourceMixMethod");
    if (method) method.innerHTML = "<b>Modeled split.</b> " + pm.method + " " + pm.taxonomyNote;
  }

  function renderOfftakeCoverage() {
    if (!$("offtakeCoverage") || !DATA.offtakeCoverage) return;
    const oc = DATA.offtakeCoverage;

    // Segmented coverage bar (widths = modeled midpoints; labels show the band)
    const total = oc.segments.reduce((a, s) => a + s.mid, 0) || 1;
    const barSegs = oc.segments.map(s =>
      `<div class="oc-seg" title="${s.label}: ${s.band} — ${s.desc}" style="width:${(s.mid / total * 100).toFixed(1)}%;background:${s.color}"></div>`
    ).join("");
    const legend = oc.segments.map(s => `
      <div class="oc-leg">
        <span class="oc-dot" style="background:${s.color}"></span>
        <span class="oc-leg-band">${s.band}</span>
        <span class="oc-leg-label">${s.label}</span>
        <span class="oc-leg-desc">${s.desc}</span>
      </div>`).join("");

    // Banded ledger — reuse the .stack-row family
    const coverPill = { contracted: "ok", partial: "warn", spec: "crit" };
    const coverText = { contracted: "Offtake", partial: "Partial", spec: "No offtake" };
    const rows = oc.ledger.map(r => `
      <div class="stack-row" title="${r.note.replace(/"/g, '&quot;')}">
        <div class="stack-head">
          <div class="stack-name">
            ${r.party}
            <span class="stack-what">— ${r.metric} &middot; ${r.term}</span>
            ${r.dollars ? '' : '<span class="oc-flag">$ undisclosed</span>'}
          </div>
          <span class="stack-pill ${coverPill[r.cover] || 'ok'}">${coverText[r.cover] || r.cover}</span>
        </div>
        <div class="stack-evidence">${r.note} <span class="stack-src">— ${r.src.label}</span></div>
      </div>`).join("");

    $("offtakeCoverage").innerHTML =
      `<div class="oc-bar">${barSegs}</div>
       <div class="oc-legend">${legend}</div>
       <div class="oc-ledger-title">Signed-commitment ledger — backlog/RPO &amp; named leases</div>
       ${rows}`;

    if ($("offtakeMethod")) $("offtakeMethod").textContent = oc.method;
  }

  // Counterparty-exposure sidebar — click a node on the circular-financing map to see its
  // disclosed commitments in/out (from the same cited edge set), a mutual-vs-one-sided
  // dependence read, and any filed concentration figures (DATA.cfConcentration; tiered).
  function renderCfSidebar(nodeId) {
    const host = $("cfSidebar");
    if (!host || !DATA.circularFinancing) return;
    const cf = DATA.circularFinancing;
    const outE = cf.edges.filter(e => e.from === nodeId);
    const inE = cf.edges.filter(e => e.to === nodeId);
    const partners = {};
    outE.forEach(e => { (partners[e.to] = partners[e.to] || { out: 0, inn: 0 }).out++; });
    inE.forEach(e => { (partners[e.from] = partners[e.from] || { out: 0, inn: 0 }).inn++; });
    const fmt = e => '<div class="cf-row" style="grid-template-columns:1fr auto">' +
      '<span class="cf-row-lbl"><b>' + e.from + '</b> → <b>' + e.to + '</b> · ' + e.label + '</span>' +
      '<span class="cf-row-amt">' + (e.v == null ? "qual." : "$" + e.v + "B") + '</span></div>';
    const mutual = Object.keys(partners).filter(p => partners[p].out && partners[p].inn);
    const conc = (DATA.cfConcentration || {})[nodeId] || [];
    const tierCls = t => t === "primary" ? "ok" : (t === "analyst" ? "warn" : "crit");
    host.style.display = "";
    host.innerHTML =
      '<div class="cf-sb-head"><b>' + nodeId + '</b> — disclosed counterparty exposure ' +
      '<button class="cf-sb-close" aria-label="close">×</button></div>' +
      (mutual.length ? '<div class="cf-sb-tag">Mutual dependence with: ' + mutual.join(", ") + ' (commitments run BOTH directions — the circularity)</div>' : '') +
      (outE.length ? '<div class="cf-sb-sec">Commitments / capital OUT (' + outE.length + ')</div>' + outE.map(fmt).join("") : '') +
      (inE.length ? '<div class="cf-sb-sec">Commitments / capital IN (' + inE.length + ')</div>' + inE.map(fmt).join("") : '') +
      (conc.length ? '<div class="cf-sb-sec">Filed concentration & balance-sheet reads</div>' + conc.map(c =>
        '<div class="cf-row" style="grid-template-columns:1fr auto"><span class="cf-row-lbl">' + c.fact + '</span>' +
        '<span class="cf-tier cf-' + tierCls(c.tier) + '" title="' + tierTitle(c.tier) + '">' + c.tier + '</span></div>').join("") : '') +
      '<div class="cf-sb-foot">Edges inherit the map\'s per-edge citations (ledger below) · concentration rows cite the counterparty\'s own filings · anonymized filing labels ("Customer A") are never name-attributed here beyond what a filing states.</div>';
    const closeBtn = host.querySelector(".cf-sb-close");
    if (closeBtn) closeBtn.addEventListener("click", () => { host.style.display = "none"; });
  }

  function renderCircularFinancing(view) {
    const host = $("circularFinancing");
    if (!host || !DATA.circularFinancing) return;
    if (typeof d3 === "undefined") {
      host.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">Counterparty map requires D3 — reload when online.</div>';
      return;
    }
    const cf = DATA.circularFinancing;
    if (view) renderCircularFinancing._view = view;
    view = renderCircularFinancing._view || "all";

    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const txt = isDark ? "#e2e8f0" : "#1e293b", muted = isDark ? "#94a3b8" : "#64748b";
    const ringStroke = isDark ? "#334155" : "#e2e8f0";

    const edges = cf.edges.filter(e => view === "all" || e.kind === view);

    const order = ["NVIDIA","AMD","Broadcom","Apollo","Blackstone","Google","AWS","Oracle","Microsoft","CoreWeave","xAI","Anthropic","OpenAI"];
    const present = cf.nodes.slice().sort((a,b) => order.indexOf(a.id) - order.indexOf(b.id));

    host.querySelectorAll("svg").forEach(s => s.remove());
    // Keep the 13-node ring + labels from colliding on phones: lay out at >=MINW and scroll.
    const MINW = 620;
    const W = Math.max(host.clientWidth || 760, MINW);
    const H = 460;
    const cx = W / 2, cy = H / 2 + 6;
    const R = Math.min(W, H) / 2 - 92;

    const svg = d3.select(host).append("svg")
      .attr("viewBox", "0 0 " + W + " " + H).style("width", "100%").style("height", "auto").style("min-width", MINW + "px")
      .attr("font-family", "Inter, sans-serif");

    const N = present.length;
    const pos = {};
    present.forEach((n, i) => {
      const ang = (i / N) * 2 * Math.PI - Math.PI / 2;
      pos[n.id] = {
        x: cx + R * Math.cos(ang),
        y: cy + R * Math.sin(ang),
        ang: ang,
        role: n.role
      };
    });

    svg.append("circle").attr("cx", cx).attr("cy", cy).attr("r", R)
      .attr("fill", "none").attr("stroke", ringStroke).attr("stroke-width", 1).attr("stroke-dasharray", "2 5");

    const defs = svg.append("defs");
    Object.keys(cf.kinds).forEach(k => {
      defs.append("marker").attr("id", "cfarrow-" + k)
        .attr("viewBox", "0 0 10 10").attr("refX", 9).attr("refY", 5)
        .attr("markerWidth", 7).attr("markerHeight", 7).attr("orient", "auto-start-reverse")
        .append("path").attr("d", "M0,0 L10,5 L0,10 Z").attr("fill", cf.kinds[k].color);
    });

    const radius = 9;

    const linkG = svg.append("g");
    edges.forEach(e => {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) return;
      const col = cf.kinds[e.kind].color;
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const x1 = a.x + ux * radius, y1 = a.y + uy * radius;
      const x2 = b.x - ux * (radius + 6), y2 = b.y - uy * (radius + 6);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const k = 0.28;
      const cxp = mx + (cx - mx) * k, cyp = my + (cy - my) * k;
      const w = e.v == null ? 1.4 : Math.max(1.6, Math.min(6, Math.sqrt(e.v) * 0.5));
      const p = linkG.append("path")
        .attr("d", "M" + x1 + "," + y1 + " Q" + cxp + "," + cyp + " " + x2 + "," + y2)
        .attr("fill", "none").attr("stroke", col)
        .attr("stroke-opacity", e.v == null ? 0.42 : 0.6)
        .attr("stroke-width", w)
        .attr("stroke-dasharray", e.v == null ? "4 3" : null)
        .attr("marker-end", "url(#cfarrow-" + e.kind + ")");
      p.append("title").text(e.from + " → " + e.to + "  ·  " + e.label + "  ·  " + e.src.label);
    });

    const nodeG = svg.append("g");
    present.forEach(n => {
      const p = pos[n.id];
      const col = (cf.roles[n.role] || {}).color || "#64748b";
      const g = nodeG.append("g").style("cursor", "pointer")
        .on("click", () => renderCfSidebar(n.id));
      g.append("circle").attr("cx", p.x).attr("cy", p.y).attr("r", radius)
        .attr("fill", col).attr("stroke", isDark ? "#0f172a" : "#ffffff").attr("stroke-width", 2)
        .append("title").text(n.id + " — " + (cf.roles[n.role] || {}).label + " · click for counterparty exposure");
      const right = Math.cos(p.ang) >= -0.01;
      const lx = p.x + Math.cos(p.ang) * 16;
      const ly = p.y + Math.sin(p.ang) * 16;
      g.append("text").attr("x", lx).attr("y", ly).attr("dy", "0.34em")
        .attr("text-anchor", right ? "start" : "end")
        .attr("fill", txt).attr("font-size", "11.5px").attr("font-weight", "700")
        .style("cursor", "pointer").on("click", () => renderCfSidebar(n.id))
        .text(n.id);
    });

    const lg = $("cfLegend");
    if (lg) {
      lg.innerHTML = Object.keys(cf.kinds).map(k =>
        '<span class="cf-leg-item"><span class="cf-leg-swatch" style="background:' + cf.kinds[k].color + '"></span>' + cf.kinds[k].label + '</span>'
      ).join("") + '<span class="cf-leg-item cf-leg-note">dashed = no public $ (qualitative)</span>';
    }

    const led = $("cfLedger");
    if (led) {
      const tierClass = t => t === "primary" ? "ok" : (t === "analyst" ? "warn" : "crit");
      led.innerHTML = edges.map(e => {
        const col = cf.kinds[e.kind].color;
        const amt = e.v == null ? "qual." : "$" + (e.v >= 100 ? e.v : e.v) + "B";
        return '<div class="cf-row">' +
          '<span class="cf-row-edge"><span class="cf-row-dot" style="background:' + col + '"></span>' +
          '<b>' + e.from + '</b> → <b>' + e.to + '</b></span>' +
          '<span class="cf-row-amt">' + amt + '</span>' +
          '<span class="cf-row-lbl">' + e.label + '</span>' +
          '<span class="cf-row-src">' + e.src.label +
          ' <span class="cf-tier cf-' + tierClass(e.src.tier) + '" title="' + tierTitle(e.src.tier) + '">' + e.src.tier + '</span></span>' +
          '</div>';
      }).join("");
    }

    const method = $("cfMethod");
    if (method) method.innerHTML = "<b>Descriptive map.</b> " + cf.methodology;

    const toggle = $("cfViewToggle");
    if (toggle && !toggle._wired) {
      toggle._wired = true;
      toggle.querySelectorAll(".map-view-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const v = btn.dataset.cfview;
          if (v === renderCircularFinancing._view) return;
          toggle.querySelectorAll(".map-view-btn").forEach(b => b.classList.toggle("active", b === btn));
          renderCircularFinancing(v);
        });
      });
    }
  }

  function renderTimeToPower() {
    if (!$("timeToPowerChart") || typeof Chart === "undefined" || !DATA.timeToPower) return;
    if (renderTimeToPower._done) return;
    renderTimeToPower._done = true;
    initCharts(); applyChartDefaults();
    const tp = DATA.timeToPower, cl = getChartColors();
    const rows = tp.items.slice().sort((a, b) => a.minVal - b.minVal);   // fastest first
    const sev = { ok: "#15803d", warn: "#c2710c", crit: "#c0322b" };      // green=fast → red=slow
    _charts.timeToPowerChart = new Chart($("timeToPowerChart"), {
      type: "bar",
      data: { labels: rows.map(r => r.name), datasets: [{
        label: "months to first power",
        data: rows.map(r => [r.minVal, r.maxVal]),                        // floating min→max bar
        backgroundColor: rows.map(r => sev[r.severity] || "#1d4ed8"),
        borderRadius: 6, maxBarThickness: 22
      }]},
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 12 } },
        plugins: {
          legend: { display: false }, datalabels: { display: false },
          tooltip: { callbacks: {
            label: c => " " + rows[c.dataIndex].range + " · " + rows[c.dataIndex].firmLabel,
            afterBody: items => rows[items[0].dataIndex].tradeoff,
            footer: items => "Source: " + rows[items[0].dataIndex].src.label
          }}
        },
        scales: {
          x: { min: 0, max: tp.maxScale, grid: { color: cl.grid }, ticks: { callback: v => v + " mo" },
               title: { display: true, text: "months to first power · 0–84 (7-yr) scale" } },
          y: { grid: { display: false } }
        }
      }
    });
    if ($("timeToPowerMethod")) {
      $("timeToPowerMethod").innerHTML =
        `<b>Bars = months-to-first-power range</b> (min→max), 0–84 mo (7-yr) scale; <b>green = fastest, red = slowest</b>. ` +
        `<b>Firmness</b> (on hover): Firm = dispatchable 24/7 (grid / nuclear); Bridge = interim on-site gas; On-site = fastest but fuel-dependent. ` +
        `<b>Cited:</b> grid interconnect (LBNL Queued Up 2025), fuel cells (Bloom/Oracle), nuclear restart (Constellation/Microsoft), SMR (DOE / Google–Kairos). ` +
        `<b>Modeled (labeled):</b> behind-the-meter gas + reciprocating-engine bands; trade-off / firmness tags are editorial.`;
    }
  }

  // Jevons check — cheapest frontier $/M tokens vs industry token volume, by quarter.
  // PURE derivation from DATA.priceCompression + DATA.tokenVolume (no new inputs): for each
  // quarter, the floor price is the cheapest closed-frontier flagship (OpenAI/Anthropic/Google
  // families; OSS excluded — it prices below frontier quality) available by that quarter's
  // midpoint; volume is the sum across providers from the token-volume chart.
  function renderJevonsChart() {
    if (!$("jevonsChart") || typeof Chart === "undefined") return;
    if (!DATA.tokenVolume || !DATA.priceCompression) return;
    if (renderJevonsChart._done) return;
    renderJevonsChart._done = true;
    initCharts(); applyChartDefaults();
    const cl = getChartColors();
    const tv = DATA.tokenVolume;
    const FRONTIER = { openai: 1, anthropic: 1, google: 1 };
    const mids = tv.quarters.map(q => {
      const m = /Q(\d)\s*(\d{2})/.exec(q);
      return 2000 + parseInt(m[2], 10) + (parseInt(m[1], 10) - 1) * 0.25 + 0.125;
    });
    const floorPrice = mids.map(t => {
      const avail = DATA.priceCompression.models.filter(mm => FRONTIER[mm.family] && mm.year <= t);
      return avail.length ? Math.min.apply(null, avail.map(mm => mm.price)) : null;
    });
    const volume = tv.quarters.map((_, i) => tv.providers.reduce((s, p) => s + (p.values[i] || 0), 0));
    _charts.jevonsChart = new Chart($("jevonsChart"), {
      type: "line",
      data: { labels: tv.quarters, datasets: [
        { label: "Industry tokens (T / quarter)", data: volume, borderColor: CHART_PALETTE.demand, backgroundColor: hexA(CHART_PALETTE.demand, 0.12), fill: true, tension: 0.3, pointRadius: 0, yAxisID: "y" },
        { label: "Cheapest frontier flagship ($ / M tokens)", data: floorPrice, borderColor: CHART_PALETTE.constraint, borderDash: [6, 4], stepped: "before", pointRadius: 0, yAxisID: "y2" }
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, padding: 14 } },
          datalabels: { display: false },
          tooltip: { callbacks: { label: c => c.datasetIndex === 0
            ? " " + c.parsed.y.toLocaleString() + "T tokens / quarter"
            : " $" + c.parsed.y + " / M tokens (cheapest frontier flagship)" } }
        },
        scales: {
          y:  { position: "left",  grid: { color: cl.grid }, ticks: { callback: v => v.toLocaleString() + "T" }, beginAtZero: true },
          y2: { position: "right", grid: { display: false }, ticks: { callback: v => "$" + v }, beginAtZero: true }
        }
      }
    });
    const m = $("jevonsMethod");
    if (m) {
      const p0 = floorPrice[0], p1 = floorPrice[floorPrice.length - 1];
      const v0 = volume[0], v1 = volume[volume.length - 1];
      m.innerHTML = "<b>Modeled arithmetic on cited inputs.</b> Floor price = cheapest closed-frontier flagship available each quarter (from the price-compression chart; OSS excluded); volume = provider sum from the token-volume chart. Over this window the floor fell ~" +
        Math.round(100 * (1 - p1 / p0)) + "% ($" + p0 + " → $" + p1 + "/M tokens) while volume grew ~" + Math.round(v1 / v0) +
        "x (" + v0.toLocaleString() + "T → " + v1.toLocaleString() + "T/quarter) — demand growing far faster than price fell is the Jevons pattern the buildout thesis rests on. Directional read: both inputs are modeled/analyst series.";
    }
  }

  function renderCostPerTaskChart() {
    if (!$("costPerTaskChart") || typeof Chart === "undefined") return;
    if (renderCostPerTaskChart._done) return;
    renderCostPerTaskChart._done = true;
    initCharts(); applyChartDefaults();
    const cpt = DATA.costPerTask;
    const cl = getChartColors();
    const costOf = (tok, price) => (tok / 1e6) * price;
    const cost2023 = cpt.tasks.map(t => costOf(t.tok2023, t.price2023));
    const cost2026 = cpt.tasks.map(t => costOf(t.tok2026, t.price2026));
    const fmt$ = v => v >= 1 ? "$" + v.toFixed(2) : v >= 0.01 ? "$" + v.toFixed(3) : "$" + v.toFixed(4);
    _charts.costPerTaskChart = new Chart($("costPerTaskChart"), {
      type: "bar",
      data: {
        labels: cpt.tasks.map(t => t.name),
        datasets: [
          { label: "2023 frontier (GPT-4-class)", data: cost2023, backgroundColor: "#94a3b8", borderRadius: 5, maxBarThickness: 38 },
          { label: "2026 frontier (reasoning/agentic)", data: cost2026, backgroundColor: "#1d4ed8", borderRadius: 5, maxBarThickness: 38 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 24 } },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, padding: 14 } },
          datalabels: Object.assign({}, LABEL_STYLE_FN(), { display: true, font: { weight: 700, size: 10 }, formatter: v => fmt$(v) }),
          tooltip: { callbacks: {
            label: c => {
              const t = cpt.tasks[c.dataIndex];
              const isNew = c.datasetIndex === 1;
              const tok = isNew ? t.tok2026 : t.tok2023;
              const price = isNew ? t.price2026 : t.price2023;
              const tokTxt = tok >= 1000 ? Math.round(tok / 1000) + "K" : tok;
              return " " + c.dataset.label + ": " + fmt$(c.parsed.y) + "/task  (~" + tokTxt + " out tok × $" + price + "/1M)";
            },
            footer: () => "tokens/task modeled · $/token cited · " + cpt.src.label
          }}
        },
        scales: {
          y: { type: "logarithmic", grid: { color: cl.grid },
            ticks: { callback: v => { const a = [0.001,0.01,0.1,1,10]; return a.indexOf(v) >= 0 ? fmt$(v) : ""; } },
            title: { display: true, text: "$ per completed task (log)" }
          },
          x: { grid: { display: false } }
        }
      }
    });
    if ($("costPerTaskMethod")) {
      const ratios = cpt.tasks.map(t => {
        const c23 = costOf(t.tok2023, t.price2023), c26 = costOf(t.tok2026, t.price2026);
        const r = c26 / c23;
        const arrow = r >= 1 ? "×" + r.toFixed(1) + " higher" : "÷" + (1 / r).toFixed(0) + " cheaper";
        return t.name + ": " + arrow;
      }).join(" · ");
      $("costPerTaskMethod").innerHTML =
        "<b>$/task (modeled)</b> = era output-tokens/task × that era's <b>cited</b> output price. " +
        cpt.noteBasket +
        " Net effect vs 2023, per task: " + ratios +
        " — i.e. the ~" + cpt.stickerDropX + "× sticker drop is partly (coding/reasoning) or fully (simple chat) eaten by higher tokens-per-task.";
    }
  }

  // Capital: vertical-integration scenarios — bull/bear/wildcard toggle over DATA.verticalIntegration.
  // HTML (no Chart.js); paints sourced points with tier pills; theme-safe (re-called via renderedTabs.clear()).
  function renderVerticalIntegration(view) {
    var host = document.getElementById("verticalIntegration");
    var vi = (DATA && DATA.verticalIntegration) || null;
    if (!host || !vi || !vi.lenses) return;
    var R = renderVerticalIntegration;
    R._view = view || R._view || "bull";
    var toggle = document.getElementById("viToggle");
    if (toggle && !toggle._wired) {
      toggle._wired = true;
      toggle.querySelectorAll(".map-view-btn").forEach(function (b) {
        b.addEventListener("click", function () {
          if (b.dataset.vilens === R._view) return;
          renderVerticalIntegration(b.dataset.vilens);
        });
      });
    }
    // keep the toggle buttons in sync with the active view (also after a theme rebuild)
    if (toggle) toggle.querySelectorAll(".map-view-btn").forEach(function (x) {
      var on = x.dataset.vilens === R._view; x.classList.toggle("active", on); x.setAttribute("aria-pressed", on ? "true" : "false");
    });
    function pill(t) {
      var cls = (t === "primary") ? "cf-ok" : ((t === "analyst" || t === "scenario") ? "cf-warn" : "cf-crit");
      var title = (t === "scenario") ? "Scenario — a labeled projection, not a prediction." : ((typeof tierTitle === "function") ? tierTitle(t) : t);
      return '<span class="cf-tier ' + cls + '" title="' + String(title).replace(/"/g, "&quot;") + '">' + t + "</span>";
    }
    var lens = vi.lenses.filter(function (l) { return l.key === R._view; })[0] || vi.lenses[0];
    var trendSrc = vi.trendSrc ? ' <span class="vi-src">— ' + vi.trendSrc + "</span>" : "";
    var pts = (lens.points || []).map(function (p) {
      var src = p.src ? ' <span class="vi-src">— ' + p.src + "</span>" : "";
      return '<li class="vi-point">' + pill(p.tier) + "<span>" + p.text + src + "</span></li>";
    }).join("");
    host.innerHTML =
      '<div class="vi-trend">' + vi.trend + trendSrc + "</div>" +
      '<div class="vi-lens-head">' + lens.title + "</div>" +
      '<ul class="vi-points">' + pts + "</ul>" +
      (vi.note ? '<div class="vi-disclaim">' + vi.note + "</div>" : "");
  }

  function renderPowerToRevenueYield() {
    if (!$("powerToRevenueYield") || !DATA.powerToRevenueYield) return;
    const d = DATA.powerToRevenueYield;
    const ci = d.costIn, la = d.leaseLane, tl = d.tokenLane;
    const priceRows = tl.prices.map(p => `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;font-size:12px;padding:5px 0;border-top:1px solid var(--line)">
        <span style="color:var(--ink-2)">${p.label}</span>
        <span style="font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap">$${p.revPerMwYr}M/MW-yr · <b style="color:${p.paybackYrs <= la.paybackYrs ? 'var(--green)' : 'var(--amber)'}">~${p.paybackYrs} yr</b></span>
      </div>`).join("");

    const html = `
      <div class="stack-row">
        <div class="stack-head">
          <div class="stack-name"><span class="stack-num">1</span>Cost in <span class="stack-what">— what one MW of AI capacity costs to build</span></div>
          <span class="stack-pill" style="background:var(--accent-soft);color:var(--accent)">$${ci.allInPerMw}M / MW</span>
        </div>
        <div class="stack-evidence">Facility shell $${ci.facilityPerMw}M (developer-paid) + compute $${ci.computePerMw}M (GPUs &amp; servers) = $${ci.allInPerMw}M all-in. <span class="stack-src">— ${ci.src.label}</span></div>
      </div>

      <div class="stack-row">
        <div class="stack-head">
          <div class="stack-name"><span class="stack-num">2</span>Revenue out <span class="stack-what">— lease the megawatt, or sell its tokens</span></div>
        </div>
        <div class="p2r-lanes">
          <div class="p2r-lane">
            <div class="p2r-lane-top"><span class="p2r-lane-name">Facility lease</span><span class="stack-pill ok">$${la.revPerMwYr}M / MW-yr</span></div>
            <div class="p2r-lane-sub">@ $${la.ratePerKwMo}/kW-mo (what wholesale buyers sign) → ~${la.paybackYrs} yr payback on $${ci.allInPerMw}M/MW.</div>
            <div class="p2r-lane-src">${la.src.label}</div>
          </div>
          <div class="p2r-lane">
            <div class="p2r-lane-top"><span class="p2r-lane-name">Token monetization</span><span class="stack-pill warn">price-dependent</span></div>
            <div style="margin:4px 0 2px">${priceRows}</div>
            <div class="p2r-lane-sub">${tl.tokensPerMwHrM}M tokens/MW-hr × output price, 100% sell-through, gross.</div>
            <div class="p2r-lane-src">${tl.src.label}</div>
          </div>
        </div>
      </div>

      <div class="stack-row">
        <div class="stack-head">
          <div class="stack-name"><span class="stack-num">3</span>So what <span class="stack-what">— it rides entirely on token price</span></div>
          <span class="stack-pill" style="background:var(--accent-soft);color:var(--accent)">modeled</span>
        </div>
        <div class="stack-evidence">${d.takeaway}</div>
      </div>

      <div class="sc-method"><b>Modeled</b> — ${d.note}</div>`;

    $("powerToRevenueYield").innerHTML = html;
  }

  function renderPerfPerWattChart() {
    if (!$("perfPerWattChart") || typeof Chart === "undefined") return;
    if (renderPerfPerWattChart._done) return;
    renderPerfPerWattChart._done = true;
    initCharts(); applyChartDefaults();
    const pw = DATA.perfPerWatt;
    const cl = getChartColors();

    const baseLabels = pw.gens.map(g => g.gen + "  ·  " + g.year);
    const effLabels  = pw.effective.map(e => e.gen);
    const labels = baseLabels.concat(effLabels);

    const idxData  = pw.gens.map(g => g.idx).concat(pw.effective.map(() => null));
    const lineData = pw.gens.map(g => g.idx).concat(pw.effective.map(() => null));
    const effData  = pw.gens.map(() => null).concat(pw.effective.map(e => e.idx));

    const allSrcs = pw.gens.map(g => g.src).concat(pw.effective.map(e => e.src));

    _charts.perfPerWattChart = new Chart($("perfPerWattChart"), {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Dense FP16/BF16 perf-per-watt (index, A100=100)",
            type: "bar",
            data: idxData,
            backgroundColor: "#1d4ed8",
            borderRadius: 5, maxBarThickness: 54,
            order: 2
          },
          {
            label: "Trend (same metric)",
            type: "line",
            data: lineData,
            borderColor: "#1d4ed8",
            backgroundColor: "rgba(29,78,216,0.10)",
            tension: 0.3, fill: false,
            pointRadius: 4, pointBackgroundColor: "#1d4ed8",
            borderWidth: 2, spanGaps: false,
            order: 1
          },
          {
            label: "Effective inference perf-per-watt (MODELED — FP4 + NVL72)",
            type: "line",
            data: effData,
            borderColor: "#c2710c",
            backgroundColor: "rgba(194,113,12,0.10)",
            borderDash: [6, 4],
            tension: 0.2, fill: false,
            pointRadius: 5, pointStyle: "rectRot", pointBackgroundColor: "#c2710c",
            borderWidth: 2, spanGaps: false,
            order: 0
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 26 } },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, padding: 12, font: { size: 10.5 } } },
          datalabels: Object.assign({}, LABEL_STYLE_FN(), {
            display: ctx => ctx.dataset.type === "bar" || ctx.dataset.label.indexOf("MODELED") !== -1,
            color: ctx => ctx.dataset.label.indexOf("MODELED") !== -1 ? "#c2710c" : cl.label,
            font: { weight: 700, size: 10 },
            formatter: v => v == null ? "" : v + ""
          }),
          tooltip: { callbacks: {
            label: c => {
              if (c.parsed.y == null) return null;
              if (c.dataset.label.indexOf("MODELED") !== -1)
                return " Effective per-watt (modeled): " + c.parsed.y + " (index, A100=100)";
              const g = pw.gens[c.dataIndex];
              if (c.dataset.type === "bar" && g)
                return [" " + g.idx + " (index, A100=100)", " " + g.denseTflops + " dense TFLOPS @ " + g.tdp + "W = " + g.perfW + " TFLOPS/W"];
              return " " + c.parsed.y + " (index, A100=100)";
            },
            footer: items => { const s = allSrcs[items[0].dataIndex]; return s ? "Source: " + s.label : ""; }
          }}
        },
        scales: {
          y: {
            grid: { color: cl.grid }, beginAtZero: true,
            title: { display: true, text: "Perf-per-watt (index, A100 = 100)", color: cl.label, font: { size: 11 } },
            ticks: { callback: v => v }
          },
          x: { grid: { display: false }, ticks: { font: { size: 10.5 } } }
        }
      }
    });

    if ($("perfPerWattMethod")) {
      $("perfPerWattMethod").innerHTML =
        "<b>Metric (cited):</b> " + pw.metricLabel + " — from NVIDIA datasheets, board TDP. " +
        "<b>Modeled:</b> the cross-gen index (A100 = 100) and the dashed effective-inference markers. " +
        pw.note;
    }
  }

  function renderCapexAiShare() {
    if (!$("capexAiShareChart") || typeof Chart === "undefined" || !DATA.capexFlow) return;
    if (renderCapexAiShare._done) return;
    renderCapexAiShare._done = true;
    const rows = DATA.capexFlow.companies.map(co => {
      const infra = co.buckets.filter(b => b.lane === "infra").reduce((s, b) => s + b.value, 0);
      const total = co.buckets.reduce((s, b) => s + b.value, 0) || co.total;
      return { name: co.name, color: co.color, pct: Math.round(infra / total * 100), infra, total };
    }).sort((a, b) => b.pct - a.pct);
    const sumInfra = rows.reduce((s, r) => s + r.infra, 0);
    const sumTotal = rows.reduce((s, r) => s + r.total, 0);
    const aggPct = Math.round(sumInfra / sumTotal * 100);
    renderLollipop("capexAiShareChart", rows.map(r => ({ label: r.name, value: r.pct, color: r.color })), {
      seriesLabel: "AI / DC share of capex (%)",
      fmt: v => v + "%", tick: v => v + "%", suggestedMax: 100, rightPad: 46,
      tooltipCallbacks: { label: c => { const r = rows[c.dataIndex]; return " ~" + r.pct + "% AI-attributed · $" + r.infra + "B of $" + r.total + "B capex"; } }
    });
    if ($("capexAiShareNote")) {
      $("capexAiShareNote").innerHTML =
        "Aggregate: ~$" + sumTotal + "B tracked capex → <b>~" + aggPct + "% AI / data-center-attributed</b>. " +
        "The AI/DC share is an <b>editorial Modeled estimate</b> (infra vs non-core split), not a reported line item — " +
        "pure-plays (Oracle/CoreWeave/Nebius) ≈ 100%, diversified operators lower.";
    }
  }

  // Rank 3 — combined Big-5 hyperscaler capex over time, as a STACKED AREA ("the wave").
  // Top line = combined total (labelled per year); the 2026 guidance era is shaded.
  function renderCapexTrend() {
    if (!$("capexTrendChart") || typeof Chart === "undefined" || !DATA.capexTrend) return;
    if (renderCapexTrend._done) return;
    renderCapexTrend._done = true;
    initCharts(); applyChartDefaults();
    const cl = getChartColors();
    const t = DATA.capexTrend;
    const gIdx = t.years.indexOf(t.guidanceFrom);   // first guidance year (2026)
    // largest contributor at the bottom of the stack, smallest drawn on top
    const ordered = t.companies.slice().sort((a, b) => b.capex[gIdx] - a.capex[gIdx]);
    const datasets = ordered.map((co, di) => ({
      label: co.name,
      data: co.capex,
      backgroundColor: hexA(co.color, 0.5),
      borderColor: co.color, borderWidth: 1.5,
      fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4,
      _top: di === ordered.length - 1
    }));
    _charts.capexTrendChart = new Chart($("capexTrendChart"), {
      type: "line",
      data: { labels: t.years.map(String), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 26 } },
        plugins: {
          legend: { display: true },
          annotation: { annotations: {
            guidance: { type: "box", xMin: gIdx - 0.5, xMax: t.years.length - 1,
              backgroundColor: hexA(CHART_PALETTE.context, 0.12), borderWidth: 0,
              label: { display: true, content: "2026 = guidance", position: { x: "center", y: "start" }, color: cl.label, font: { size: 9.5, weight: 700 }, backgroundColor: "rgba(0,0,0,0)" } }
          } },
          datalabels: {
            display: ctx => ctx.dataset._top,        // only the top series prints the combined total
            anchor: "end", align: "top", offset: 2,
            color: cl.text, font: { weight: 800, size: 11 },
            formatter: (v, ctx) => "$" + Math.round(t.combined.capex[ctx.dataIndex]) + "B"
          },
          tooltip: { callbacks: {
            title: items => t.years[items[0].dataIndex] + (items[0].dataIndex >= gIdx ? " · guidance" : " · actual"),
            label: c => " " + c.dataset.label + ": $" + c.parsed.y + "B",
            footer: items => "Combined: $" + Math.round(t.combined.capex[items[0].dataIndex]) + "B"
          } }
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, grid: { color: cl.grid }, ticks: { callback: v => "$" + v + "B" }, title: { display: true, text: "Annual capex (USD B)" } }
        }
      }
    });
    const m = $("capexTrendMethod");
    if (m) m.innerHTML = "Combined Big-5 capex <b>$" + t.combined.capex[0] + "B &rarr; $" + t.combined.capex[gIdx] + "B</b> (&rsquo;21&rarr;&rsquo;26) — the wave. " +
      "Solid fill = reported actuals; the shaded 2026 band is <b>guidance</b> (Amazon/Alphabet/Meta company guidance, Microsoft estimate, Oracle actual). " +
      "Big-5 public hyperscalers only. Source: " + t.src.label + ".";
  }

  // Rank 5 — combined capex vs operating cash flow (the crossover watch).
  // OCF is a filled envelope; capex is the rising line. 2026 capex segment is dashed
  // (guidance); 2026 OCF is null on purpose (3 of 5 issue no cash-flow guidance) so the line stops.
  function renderCapexVsCashflow() {
    if (!$("capexVsCashflowChart") || typeof Chart === "undefined" || !DATA.capexTrend) return;
    if (renderCapexVsCashflow._done) return;
    renderCapexVsCashflow._done = true;
    initCharts(); applyChartDefaults();
    const cl = getChartColors();
    const t = DATA.capexTrend;
    const gIdx = t.years.indexOf(t.guidanceFrom);
    const capex = t.combined.capex, ocf = t.combined.ocf;
    _charts.capexVsCashflowChart = new Chart($("capexVsCashflowChart"), {
      type: "line",
      data: { labels: t.years.map(String), datasets: [
        {
          label: "Combined operating cash flow",
          data: ocf, spanGaps: false, fill: true,
          borderColor: "#15803d", backgroundColor: "rgba(21,128,61,0.10)",
          pointRadius: ocf.map((v, i) => v == null ? 0 : (i === gIdx - 1 ? 4 : 0)),
          pointBackgroundColor: "#15803d", pointBorderColor: "#15803d"
        },
        {
          label: "Combined capex",
          data: capex, fill: false, borderColor: "#1d4ed8",
          segment: { borderDash: ctx => ctx.p1DataIndex >= gIdx ? [6, 4] : undefined },
          pointRadius: capex.map((v, i) => (i === 0 || i === gIdx - 1 || i === gIdx) ? 4 : 0),
          pointStyle: capex.map((v, i) => i === gIdx ? "rectRot" : "circle"),
          pointBackgroundColor: capex.map((v, i) => i === gIdx ? "#fff" : "#1d4ed8"),
          pointBorderColor: "#1d4ed8"
        }
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 24, right: 18 } },
        plugins: {
          legend: { display: true },
          annotation: { annotations: {
            guideLine: { type: "line", scaleID: "x", value: gIdx - 0.5, borderColor: cl.label, borderWidth: 1, borderDash: [4, 4],
              label: { display: true, content: "2026 = guidance", position: "start", backgroundColor: "rgba(15,27,45,0.62)", color: "#fff", font: { size: 9.5, weight: 700 }, padding: 3 } }
          } },
          datalabels: {
            color: cl.text, font: { weight: 800, size: 11 }, anchor: "end", align: "top", offset: 5,
            display: ctx => {
              const i = ctx.dataIndex;
              if (ctx.dataset.label === "Combined capex") return i === 0 || i === gIdx - 1 || i === gIdx;
              return i === gIdx - 1;   // OCF: label the last actual (2025)
            },
            formatter: v => v == null ? "" : "$" + Math.round(v) + "B"
          },
          tooltip: { callbacks: {
            title: items => t.years[items[0].dataIndex] + (items[0].dataIndex >= gIdx ? " · capex = guidance" : " · actual"),
            label: c => c.parsed.y == null ? null : " " + c.dataset.label + ": $" + c.parsed.y + "B"
          } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: cl.grid }, ticks: { callback: v => "$" + v + "B" }, title: { display: true, text: "USD B" } }
        }
      }
    });
    const m = $("capexVsCashflowMethod");
    if (m) m.innerHTML = "<b>The crossover watch.</b> " + t.crossover + " <b>" + t.oracleCrossover + "</b> Source: " + t.src.label + ".";
  }

  // The commitment book — undiscounted lease payments (commenced + not-yet-commenced) +
  // disclosed purchase/construction commitments, stacked per operator, with the per-row
  // ratio "years of operating cash flow pre-committed". Every figure filed; see DATA block.
  function renderOvercommitment() {
    if (!$("overcommitmentBoard") || typeof Chart === "undefined" || !DATA.overcommitment) return;
    if (renderOvercommitment._done) return;
    renderOvercommitment._done = true;
    initCharts(); applyChartDefaults();
    const cl = getChartColors();
    const oc = DATA.overcommitment;
    const rows = oc.ops.map(o => {
      const total = (o.leasesCommenced || 0) + (o.leasesNotCommenced || 0) + (o.purchase || 0) + (o.construction || 0);
      return Object.assign({}, o, { total: total, years: total / o.ocf });
    }).sort((a, b) => b.years - a.years);
    const seg = (key) => rows.map(r => r[key] || 0);
    _charts.overcommitmentBoard = new Chart($("overcommitmentBoard"), {
      type: "bar",
      data: { labels: rows.map(r => r.name), datasets: [
        { label: "Leases — commenced (undiscounted)", data: seg("leasesCommenced"), backgroundColor: hexA(CHART_PALETTE.context, 0.55), stack: "s" },
        { label: "Leases — signed, not yet commenced", data: seg("leasesNotCommenced"), backgroundColor: CHART_PALETTE.pipeline, stack: "s" },
        { label: "Purchase commitments", data: seg("purchase"), backgroundColor: hexA(CHART_PALETTE.demand, 0.85), stack: "s" },
        { label: "Construction commitments", data: seg("construction"), backgroundColor: hexA(CHART_PALETTE.supply, 0.7), stack: "s" }
      ]},
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 96 } },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, padding: 12 } },
          datalabels: Object.assign({}, LABEL_STYLE_FN(), { display: (c) => c.datasetIndex === 3, anchor: "end", align: "end", offset: 6,
            formatter: (v, c) => { const r = rows[c.dataIndex]; return "$" + Math.round(r.total) + "B ≈ " + r.years.toFixed(1) + " yrs of OCF"; } }),
          tooltip: { callbacks: {
            label: c => " " + c.dataset.label + ": $" + (c.parsed.x || 0).toLocaleString() + "B",
            afterBody: (items) => { const r = rows[items[0].dataIndex];
              return ["", "OCF: $" + r.ocf + "B (" + r.ocfBasis + ") → ≈" + r.years.toFixed(1) + " years pre-committed",
                      r.accel ? "Inflection: " + r.accel : ""].filter(Boolean); },
            footer: (items) => { const r = rows[items[0].dataIndex]; return (r.detail || "").match(/.{1,90}(\s|$)/g) || []; }
          } }
        },
        scales: {
          x: { stacked: true, grid: { color: cl.grid }, ticks: { callback: v => "$" + v + "B" }, beginAtZero: true },
          y: { stacked: true, grid: { display: false } }
        }
      }
    });
    const m = $("overcommitmentMethod");
    if (m) m.innerHTML = "<b>Method & honesty notes.</b> " + oc.methodology + " Source: " + oc.src.label + ".";
  }

  // The three clocks — floating range bars: asset life vs obligation tenor vs power arrival.
  function renderTenorClocks() {
    if (!$("tenorClocks") || typeof Chart === "undefined" || !DATA.tenorClocks) return;
    if (renderTenorClocks._done) return;
    renderTenorClocks._done = true;
    initCharts(); applyChartDefaults();
    const cl = getChartColors();
    const tc = DATA.tenorClocks;
    _charts.tenorClocks = new Chart($("tenorClocks"), {
      type: "bar",
      data: { labels: tc.items.map(i => i.label), datasets: [{
        label: "years",
        data: tc.items.map(i => [i.lo, i.hi]),
        backgroundColor: tc.items.map(i => hexA(CHART_PALETTE[i.color] || CHART_PALETTE.context, 0.8)),
        borderWidth: 0, barThickness: 26, borderRadius: 4
      }]},
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 70 } },
        plugins: {
          legend: { display: false },
          datalabels: Object.assign({}, LABEL_STYLE_FN(), { display: true, anchor: "end", align: "end", offset: 6,
            formatter: (v, c) => { const i = tc.items[c.dataIndex]; return i.lo + "–" + i.hi + " yrs"; } }),
          tooltip: { callbacks: {
            label: c => " " + tc.items[c.dataIndex].lo + "–" + tc.items[c.dataIndex].hi + " years",
            afterBody: (items) => (tc.items[items[0].dataIndex].note || "").match(/.{1,90}(\s|$)/g) || []
          } }
        },
        scales: {
          x: { grid: { color: cl.grid }, ticks: { callback: v => v + " yrs" }, beginAtZero: true, max: 26 },
          y: { grid: { display: false } }
        }
      }
    });
    const m = $("tenorClocksMethod");
    if (m) m.innerHTML = "<b>The mismatch.</b> " + tc.methodology + " Source: " + tc.src.label + ".";
  }

  function renderCapexChart() {
    if (!$("coCapexChart") || typeof Chart === "undefined") return;
    if (renderCapexChart._done) return;
    renderCapexChart._done = true;
    const cc = DATA.companyCapex;
    const rows = cc.companies.map((name, i) => ({ label: name, value: cc.values[i], color: cc.colors[i], _i: i }))
      .sort((a, b) => b.value - a.value);
    renderLollipop("coCapexChart", rows, {
      seriesLabel: "2026 capex (USD B)",
      fmt: v => "$" + v + "B", tick: v => "$" + v + "B", rightPad: 58,
      suggestedMax: Math.max.apply(null, cc.values) * 1.12,
      tooltipCallbacks: {
        label: c => " $" + c.parsed.x + "B planned capex",
        footer: items => { const s = cc.srcs[rows[items[0].dataIndex]._i]; return s ? "Source: " + s.label : ""; }
      }
    });
  }

  function renderVacancyChart() {
    if (!$("vacancyChart") || typeof Chart === "undefined") return;
    if (renderVacancyChart._done) return;
    renderVacancyChart._done = true;
    initCharts(); applyChartDefaults();
    const v = DATA.vacancyTrend;
    const cl = getChartColors();
    _charts.vacancyChart = new Chart($("vacancyChart"), {
      type: "line",
      data: {
        labels: v.years,
        datasets: [{
          label: "Vacancy %",
          data: v.values,
          borderColor: "#1d4ed8",
          backgroundColor: "rgba(29,78,216,0.10)",
          fill: true, tension: 0.35,
          pointRadius: 5, pointBackgroundColor: "#1d4ed8",
          borderWidth: 2.5
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 18 } },
        plugins: {
          legend: { display: false },
          datalabels: { display: true, color: cl.label, font: { weight: 700, size: 11 }, align: "top", offset: 6, formatter: v => v + "%" },
          annotation: { annotations: { floor: { type: "line", yMin: 5, yMax: 5, borderColor: cl.label, borderWidth: 1, borderDash: [5, 4], label: { display: true, content: "~5% healthy-market floor", position: "start", backgroundColor: "rgba(15,27,45,0.6)", color: "#fff", font: { size: 9.5, weight: 700 }, padding: 3 } } } },
          tooltip: { callbacks: {
            label: c => " " + c.parsed.y + "% vacancy",
            footer: () => v.src ? "Source: " + v.src.label : ""
          }}
        },
        scales: {
          y: { grid: { color: cl.grid }, ticks: { callback: x => x + "%" }, beginAtZero: true, suggestedMax: 11 },
          x: { grid: { display: false } }
        }
      }
    });
  }

  /* IRR via bisection. cashFlows = [-upfront, y1, y2, ..., yN]. */
  function computeIRR(cashFlows) {
    function npv(rate) {
      let s = 0;
      for (let t = 0; t < cashFlows.length; t++) s += cashFlows[t] / Math.pow(1 + rate, t);
      return s;
    }
    let low = -0.5, high = 1.0;
    for (let i = 0; i < 80; i++) {
      const mid = (low + high) / 2;
      if (npv(mid) > 0) low = mid; else high = mid;
      if (high - low < 0.0001) break;
    }
    return (low + high) / 2;
  }

  function projectIRR(leasePerKwMo, powerPerMwh, delayMonths) {
    const MW = 100;
    const buildCost = 42e6 * MW;
    const upfront = -buildCost;
    const annualRevenue = leasePerKwMo * 12 * 1000 * MW;
    const annualPowerCost = MW * 4380 * powerPerMwh;   // ~50% utilization equivalent
    const annualOpex = annualRevenue * 0.05;
    const annualNOI = annualRevenue - annualPowerCost - annualOpex;
    const holdYears = 15;
    const delayYears = delayMonths / 12;
    const cf = [upfront];
    for (let y = 1; y <= holdYears; y++) {
      if (y <= Math.floor(delayYears)) {
        cf.push(0);
      } else if (y - 1 < delayYears && y > delayYears) {
        cf.push(annualNOI * (y - delayYears));
      } else {
        cf.push(annualNOI);
      }
    }
    cf[holdYears] += annualNOI / 0.05;
    return computeIRR(cf);
  }

  function recalculateIRR() {
    const lease = +$("leasePrice").value;
    const power = +$("powerCost").value;
    const delay = +$("delayMonths").value;
    $("leaseVal").textContent = "$" + lease;
    $("powerVal").textContent = "$" + power;
    $("delayVal").textContent = delay;
    const irr = projectIRR(lease, power, delay);
    const irrPct = (irr * 100);
    const cls = irrPct >= 14 ? "high" : irrPct >= 10 ? "mid" : "low";
    $("irrValue").className = "irr-value " + cls;
    $("irrValue").textContent = (irrPct >= 0 ? "~" : "") + irrPct.toFixed(1) + "%";
    const meterPct = Math.max(0, Math.min(100, irrPct / 25 * 100));
    $("irrMeterFill").style.width = meterPct + "%";
  }

  function renderIrrCalculator() {
    if (!$("irrPresets") || !DATA.irrScenarios) return;
    if (renderIrrCalculator._done) return;
    renderIrrCalculator._done = true;

    // Render preset buttons from DATA
    $("irrPresets").innerHTML = DATA.irrScenarios.scenarios.map((s, i) =>
      '<button data-i="' + i + '">' + s.name + '</button>'
    ).join("");

    // Preset click handlers
    $("irrPresets").querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        const s = DATA.irrScenarios.scenarios[+btn.dataset.i];
        if (!s) return;
        $("leasePrice").value = s.lease;
        $("powerCost").value = s.power;
        $("delayMonths").value = s.delay;
        $("irrPresets").querySelectorAll("button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        recalculateIRR();
      });
    });

    // Slider input → clear preset highlight, recalc
    ["leasePrice", "powerCost", "delayMonths"].forEach(id => {
      $(id).addEventListener("input", () => {
        $("irrPresets").querySelectorAll("button").forEach(b => b.classList.remove("active"));
        recalculateIRR();
      });
    });

    // Initial: snap to mid-market preset
    const midBtn = $("irrPresets").querySelector('button[data-i="1"]');
    if (midBtn) midBtn.click(); else recalculateIRR();
  }

  /* ----- Engineer tab renders ----- */
  // Context comparison — FOUR independent capacity snapshots (NOT a flowing cohort).
  // Operational stock is existing capacity, not the downstream of today's queue, so these
  // are separate horizontal bars with no arrows. The 24 GW buildable bar is marked modeled.
  function renderFunnel() {
    if (!$("funnelCompare") || typeof Chart === "undefined" || !DATA.powerBreakdown) return;
    if (renderFunnel._done) return;
    renderFunnel._done = true;
    initCharts(); applyChartDefaults();
    const f  = DATA.powerBreakdown.funnel;          // KEEP source intact — exporter + renderMap read it
    const cl = getChartColors();
    const buildable = DATA.powerBreakdown.modeledBuildableGW;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const rows = [
      { label: "Requested (interconnect queue)",    v: f.values[0], color: PL_COLORS.blue,  modeled: false, srcIdx: 0 },
      { label: "Operational (current stock)",       v: f.values[2], color: PL_COLORS.green, modeled: false, srcIdx: 2 },
      { label: "Modeled buildable near-term",       v: buildable,   color: PL_COLORS.green, modeled: true,  srcIdx: -1 },
      { label: "Under construction (active build)", v: f.values[1], color: PL_COLORS.gray,  modeled: false, srcIdx: 1 }
    ];
    const sub = [
      "Headline interconnect/large-load requests — " + Math.round(f.values[0] / f.values[1]) + "× the " + f.values[1] + " GW under construction.",
      "Existing installed operational stock — not the queue's downstream output.",
      "Modeled — see Phantom-load reconciliation below.",
      "Active build today — the small number the headline dwarfs."
    ];

    _charts.funnelCompare = new Chart($("funnelCompare"), {
      type: "bar",
      data: {
        labels: rows.map(r => r.label),
        datasets: [{
          label: "GW",
          data: rows.map(r => r.v),
          backgroundColor: rows.map(r => r.color),
          borderColor:     rows.map(r => r.modeled ? cl.label : r.color),
          borderWidth:     rows.map(r => r.modeled ? 1.5 : 0),
          borderDash: [4, 3], borderRadius: 7, maxBarThickness: 30
        }]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        animation: reduce ? false : undefined,
        layout: { padding: { right: 56 } },
        plugins: {
          legend: { display: false },
          datalabels: Object.assign({}, LABEL_STYLE_FN(), {
            display: true, anchor: "end", align: "end", clamp: true, color: cl.label,
            formatter: (v, c) => v + " GW" + (rows[c.dataIndex].modeled ? " (modeled)" : "")
          }),
          tooltip: { callbacks: {
            label: c => " " + c.parsed.x + " GW",
            afterLabel: c => rows[c.dataIndex].modeled
              ? "Modeled residual after duplicate + speculative haircuts (range 19–33 GW; 24 = midpoint)."
              : (rows[c.dataIndex].srcIdx >= 0 ? f.srcs[rows[c.dataIndex].srcIdx].label : ""),
            footer: c => sub[c.dataIndex]
          }}
        },
        scales: {
          x: { beginAtZero: true, suggestedMax: 105, grid: { color: cl.grid }, ticks: { callback: v => v + " GW" } },
          y: { grid: { display: false }, ticks: { font: { weight: 700 } } }
        }
      }
    });

    if ($("funnelConv")) {
      const x = Math.round(f.values[0] / f.values[1]);   // 16, live — never drifts
      $("funnelConv").innerHTML =
        'The <b>' + f.values[0] + ' GW</b> interconnect queue is about <b>' + x +
        '&times;</b> the <b>' + f.values[1] + ' GW</b> actively under construction. These are independent snapshots — the <b>' +
        f.values[2] + ' GW</b> operational stock is existing capacity, not the queue&rsquo;s output.';
    }
  }

  function renderLeadTimeChart() {
    if (!$("leadTimeChart") || typeof Chart === "undefined") return;
    if (renderLeadTimeChart._done) return;
    renderLeadTimeChart._done = true;
    const sorted = [...DATA.markets].sort((a, b) => b.lead - a.lead);
    const colorFor = (l) => l >= 6 ? CHART_PALETTE.constraint : l >= 4 ? CHART_PALETTE.pipeline : CHART_PALETTE.supply;
    renderLollipop("leadTimeChart", sorted.map(m => ({ label: m.name, value: m.lead, color: colorFor(m.lead) })), {
      seriesLabel: "Lead time (years)",
      fmt: v => v + " yr", tick: v => v + " yr", suggestedMax: 8, rightPad: 46,
      tooltipCallbacks: {
        label: c => " " + c.parsed.x + " years",
        footer: items => { const m = sorted[items[0].dataIndex]; return m ? m.note : ""; }
      }
    });
  }

  function renderEquipmentLeadTimes() {
    if (!$("equipmentLeadTimes") || !DATA.equipmentLeadTimes) return;
    const el = DATA.equipmentLeadTimes;
    const max = el.maxScale;
    $("equipmentLeadTimes").innerHTML = el.items.map(it => `
      <div class="leadtime-row" title="${it.note}">
        <div class="leadtime-name">${it.name}</div>
        <div class="leadtime-bar-wrap"><div class="leadtime-bar ${it.severity}" style="width:${(it.maxVal / max * 100).toFixed(1)}%"></div></div>
        <div class="leadtime-val ${it.severity}">${it.range}</div>
      </div>`).join("");
  }

  const STACK_SEV = { structural: "crit", tight: "warn", emerging: "warn", resolving: "ok" };

  function renderStackLayers() {
    if (!$("stackLayers") || !DATA.stackLayers) return;
    $("stackLayers").innerHTML = DATA.stackLayers.layers.map(l => `
      <div class="stack-row" title="${l.evidence.replace(/"/g, '&quot;')}">
        <div class="stack-head">
          <div class="stack-name">
            <span class="stack-num">L${l.n}</span>${l.name}
            <span class="stack-what">— ${l.what}</span>
          </div>
          <span class="stack-pill ${STACK_SEV[l.status] || 'ok'}">${l.statusLabel}</span>
        </div>
        <div class="stack-evidence">${l.evidence} <span class="stack-src">— ${l.src.label}</span></div>
      </div>`).join("");
  }

  function renderSubstrateBottlenecks() {
    if (!$("substrateBottlenecks") || !DATA.substrateBottlenecks) return;
    $("substrateBottlenecks").innerHTML = DATA.substrateBottlenecks.items.map(it => `
      <div class="stack-row" title="${it.detail.replace(/"/g, '&quot;')}">
        <div class="stack-head">
          <div class="stack-name">${it.name} <span class="stack-what">— ${it.vendor}</span></div>
          <span class="stack-pill ${it.status}">${it.statusLabel}</span>
        </div>
        <div class="stack-evidence">${it.detail} <span class="stack-src">— ${it.src.label}</span></div>
      </div>`).join("");
  }

  function renderOpticalRoadmap() {
    if (!$("opticalRoadmap") || !DATA.opticalRoadmap) return;
    const r = DATA.opticalRoadmap;
    const gens = r.generations.map(g => `
      <div class="optical-gen-row">
        <div class="optical-gen-name">${g.gen}</div>
        <div class="optical-gen-years">${g.years}</div>
        <div class="optical-gen-note">${g.note}</div>
      </div>`).join("");
    const milestones = r.cpoMilestones.map(m => `
      <div class="optical-milestone">
        <div class="optical-milestone-date">${m.date}</div>
        <div class="optical-milestone-event">${m.event}</div>
      </div>`).join("");
    $("opticalRoadmap").innerHTML = `
      <div class="optical-section-title">Bandwidth generations</div>
      ${gens}
      <div class="optical-section-title" style="margin-top:14px">Co-Packaged Optics (CPO) timeline</div>
      ${milestones}
      <div class="note" style="margin-top:10px;font-style:italic">— ${r.src.label}</div>`;
  }

  function renderBuildoutChart() {
    if (!$("buildoutChart") || typeof Chart === "undefined") return;
    if (renderBuildoutChart._done) return;
    renderBuildoutChart._done = true;
    initCharts(); applyChartDefaults();
    const hm = DATA.hyperscalerMW;
    const cl = getChartColors();
    _charts.buildoutChart = new Chart($("buildoutChart"), {
      type: "bar",
      data: {
        labels: hm.companies,
        datasets: [
          { label: "Operational", data: hm.operational, backgroundColor: "#1d4ed8", borderRadius: 5, maxBarThickness: 22 },
          { label: "Pipeline",    data: hm.pipeline,    backgroundColor: "#c2710c", borderRadius: 5, maxBarThickness: 22 }
        ]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 40 } },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, padding: 14 } },
          datalabels: Object.assign({}, LABEL_STYLE_FN(), {
            display: true,
            font: { weight: 700, size: 10 },
            formatter: v => v >= 1000 ? (v/1000).toFixed(1) + " GW" : v + " MW"
          }),
          tooltip: { callbacks: {
            label: c => " " + c.dataset.label + ": " + c.parsed.x.toLocaleString() + " MW",
            footer: () => "Source: " + hm.srcLabel
          }}
        },
        scales: {
          x: { grid: { color: cl.grid }, ticks: { callback: v => v >= 1000 ? (v/1000).toFixed(1) + " GW" : v + " MW" }, beginAtZero: true },
          y: { grid: { display: false } }
        }
      }
    });
  }

  function renderMap() {
    const container = $("map");
    if (!container) return;
    if (renderMap._done) return;
    if (typeof d3 === "undefined" || typeof topojson === "undefined") {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">Map requires d3 + topojson — reload when online.</div>';
      return;
    }
    renderMap._done = true;
    renderMap._view = renderMap._view || "pipeline";  // default view

    const typeColor   = { constrained: "#d4452f", growth: "#1d4ed8", emerging: "#15803d" };
    const isPipeline  = renderMap._view === "pipeline";
    const sizeField   = isPipeline ? "pipeline" : "operational";
    // pipeline values are MW (large); operational are GW (small). Normalize for max.
    const maxSize     = Math.max.apply(null, DATA.markets.map(m => m[sizeField]));
    const fmtGW       = isPipeline
      ? (v) => (v / 1000).toFixed(v >= 1000 ? 1 : 2)  // MW → GW
      : (v) => String(v);                              // already GW

    // Tooltip element (singleton)
    let tip = container.querySelector(".map-tip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "map-tip";
      container.appendChild(tip);
    }
    function moveTip(event) {
      const rect = container.getBoundingClientRect();
      let tx = event.clientX - rect.left + 14;
      let ty = event.clientY - rect.top - 10;
      if (tx + 240 > container.clientWidth) tx = event.clientX - rect.left - 244;
      tip.style.left = tx + "px";
      tip.style.top  = ty + "px";
    }

    function buildMap() {
      // Remove any prior SVG (for resize redraws)
      container.querySelectorAll("svg").forEach(s => s.remove());
      const W = container.clientWidth || 560;
      const H = Math.round(W * 0.58);
      container.style.minHeight = H + "px";

      const svg = d3.select(container).append("svg")
        .attr("viewBox", "0 0 " + W + " " + H)
        .attr("width", W).attr("height", H);

      const _ws = renderMap._view === "whitespace";
      const _topoUrl = _ws
        ? "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json"   // counties + states + nation
        : "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
      d3.json(_topoUrl).then(us => {
        const proj = d3.geoAlbersUsa()
          .fitExtent([[12, 12], [W - 12, H - 12]],
            topojson.feature(us, us.objects.nation));
        const path = d3.geoPath().projection(proj);

        // Theme-aware palette — blend the map into the dark card instead of a white blob
        const _mDark = document.documentElement.getAttribute("data-theme") === "dark";
        const mFill = _mDark ? "#243246" : "#eaeff5";
        const mState = _mDark ? "#0f172a" : "#fff";
        const mBorder = _mDark ? "#3a4a60" : "#d0d9e4";
        const mCity = _mDark ? "#cbd5e1" : "#3a4a5c";
        const mBubbleStroke = _mDark ? "#0b1220" : "#fff";

        // White-space view: county choropleth shaded by the modeled per-state siting score.
        if (_ws) {
          const scores = (DATA.siting && DATA.siting.states) || null;
          const wsColor = (typeof d3.interpolateViridis === "function")
            ? d3.scaleSequential(d3.interpolateViridis).domain([0, 100])
            : d3.scaleLinear().domain([0, 50, 100]).range(["#440154", "#21918c", "#fde725"]);
          const noData = _mDark ? "#243246" : "#e7edf4";
          svg.append("g").selectAll("path")
            .data(topojson.feature(us, us.objects.counties).features)
            .join("path")
            .attr("d", path)
            .attr("fill", d => { const s = scores ? scores[d.id.slice(0, 2)] : null; return s == null ? noData : wsColor(s); })
            .attr("stroke", "none")
            .append("title").text(d => { const s = scores ? scores[d.id.slice(0, 2)] : null; return "FIPS " + d.id + " · white-space " + (s == null ? "n/a" : s); });
          svg.append("path")
            .datum(topojson.mesh(us, us.objects.states, (a, b) => a !== b))
            .attr("d", path).attr("fill", "none").attr("stroke", mBorder).attr("stroke-width", 0.6);
          if (!scores) {
            svg.append("text").attr("x", W / 2).attr("y", H - 8).attr("text-anchor", "middle")
              .attr("fill", "#8a97a8").attr("font-size", "12px").attr("font-family", "Inter, sans-serif")
              .text("white-space feed not yet available — add EIA_API_KEY + run refresh-data");
          }
          return;
        }

        // States
        svg.append("g").selectAll("path")
          .data(topojson.feature(us, us.objects.states).features)
          .join("path")
          .attr("d", path)
          .attr("fill", mFill)
          .attr("stroke", mState)
          .attr("stroke-width", 1.2);

        // Internal borders
        svg.append("path")
          .datum(topojson.mesh(us, us.objects.states, (a, b) => a !== b))
          .attr("d", path)
          .attr("fill", "none")
          .attr("stroke", mBorder)
          .attr("stroke-width", 0.5);

        // Bubble drop shadow
        const defs = svg.append("defs");
        const filter = defs.append("filter").attr("id", "mapShadow")
          .attr("x", "-40%").attr("y", "-40%").attr("width", "180%").attr("height", "180%");
        filter.append("feDropShadow")
          .attr("dx", 0).attr("dy", 2).attr("stdDeviation", 3)
          .attr("flood-color", "rgba(15,27,45,.25)");

        // Market bubbles (sized by current view: operational GW or pipeline MW)
        DATA.markets.forEach(m => {
          const xy = proj([m.lon, m.lat]);
          if (!xy) return;
          const [x, y] = xy;
          const v = m[sizeField];
          const r = 16 + (v / maxSize) * 22;
          const col = typeColor[m.type] || "#475569";

          const g = svg.append("g").style("cursor", "default");

          g.append("circle")
            .attr("cx", x).attr("cy", y).attr("r", r)
            .attr("fill", col).attr("fill-opacity", 0.88)
            .attr("stroke", mBubbleStroke).attr("stroke-width", 2.5)
            .attr("filter", "url(#mapShadow)");

          g.append("text")
            .attr("x", x).attr("y", y)
            .attr("text-anchor", "middle").attr("dominant-baseline", "central")
            .attr("fill", "#fff")
            .attr("font-family", "Inter, sans-serif")
            .attr("font-size", Math.max(11, Math.round(r * 0.6)) + "px")
            .attr("font-weight", "800")
            .attr("pointer-events", "none")
            .text(fmtGW(v));

          g.append("text")
            .attr("x", x).attr("y", y + r + 11)
            .attr("text-anchor", "middle")
            .attr("fill", mCity)
            .attr("font-family", "Inter, sans-serif")
            .attr("font-size", "9.5px").attr("font-weight", "700")
            .attr("pointer-events", "none")
            .attr("class", "map-city-label")
            .text(m.name.replace(", AZ", "").replace(", IL", "").replace(", GA", "").replace(", TX", ""));

          g.on("mouseenter", function (event) {
              tip.innerHTML = "<b>" + m.name + "</b>" +
                m.operational + " GW operational · " + m.pipeline.toLocaleString() + " MW pipeline" +
                '<br><span class="tip-muted">~' + m.lead + ' yr to power · ' + m.status + '</span>';
              tip.style.display = "block";
              moveTip(event);
            })
            .on("mousemove", moveTip)
            .on("mouseleave", () => { tip.style.display = "none"; });
        });

      }).catch(() => {
        svg.append("text")
          .attr("x", W / 2).attr("y", H / 2)
          .attr("text-anchor", "middle")
          .attr("fill", "#8a97a8").attr("font-size", "13px")
          .attr("font-family", "Inter, sans-serif")
          .text("Map requires network — reload when online");
      });
    }

    buildMap();
    // Redraw on resize (debounced)
    let rto;
    window.addEventListener("resize", () => {
      clearTimeout(rto);
      rto = setTimeout(() => {
        renderMap._done = false;  // allow rebuild
        renderMap();
      }, 200);
    });

    // Wire view toggle once
    const toggle = document.getElementById("mapViewToggle");
    if (toggle && !toggle._wired) {
      toggle._wired = true;
      toggle.querySelectorAll(".map-view-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const view = btn.dataset.view;
          if (view === renderMap._view) return;
          renderMap._view = view;
          toggle.querySelectorAll(".map-view-btn").forEach(b => b.classList.toggle("active", b === btn));
          const note = document.getElementById("mapNote");
          const NOTE = {
            pipeline: "Pipeline view · bubbles sum to ≈ 97 GW interconnect queue (LBNL Queued Up 2025, allocation modeled) · color = market status · hover for detail",
            operational: "Operational view · bubbles sum to ≈ 36 GW operational at primary markets · color = market status · hover for detail",
            whitespace: "White-space view · counties shaded by modeled per-state siting score (0–100) — higher = more grid headroom, less queue congestion, cheaper industrial power · hover a county"
          };
          if (note) note.innerHTML = NOTE[view] || NOTE.pipeline;
          const stdLeg = document.querySelector(".map-legend");
          const wsLeg = document.getElementById("mapLegendWS");
          if (stdLeg) stdLeg.style.display = (view === "whitespace") ? "none" : "";
          if (wsLeg)  wsLeg.style.display  = (view === "whitespace") ? "flex" : "none";
          renderMap._done = false;  // allow rebuild
          renderMap();
        });
      });
    }
  }

  function renderMegaProjects() {
    if (!$("megaProjectsList")) return;
    // Prefer the canonical open dataset (data/projects.json, source-linked + verified);
    // fall back to the inline seed only if the feed hasn't loaded (offline / fetch fail).
    const pj = (DATA.projects && Array.isArray(DATA.projects.records)) ? DATA.projects.records : null;
    let rows, totalMW, count, foot;
    // Region-aware bits (default to US behaviour): the geo column label ("State" vs "Country")
    // and the repo that hosts the schema/licence, so a non-US ledger links to its own repo.
    const GEO = (typeof REGION_CONFIG !== "undefined" && REGION_CONFIG.geoLabel) || "State";
    const REPO = (typeof REGION_CONFIG !== "undefined" && REGION_CONFIG.repoUrl) || "https://github.com/vijay-sachdeva/us-ai-infra";
    // "disclosed" only when some records have no MW (capex-only) — keeps the US footer identical.
    const anyNullMw = pj ? pj.some(p => p.capacity_mw == null) : false;
    if (pj) {
      const conf = { high: "ok", medium: "warn", low: "crit" };
      // Active builds only — stalled/paused/cancelled records render in the Graveyard panel
      // instead, and never count toward the headline GW total.
      const live = pj.filter(p => GRAVEYARD_STATUSES.indexOf(p.status) === -1);
      const sorted = [...live].sort((a, b) => (b.capacity_mw || 0) - (a.capacity_mw || 0));
      totalMW = sorted.reduce((s, p) => s + (p.capacity_mw || 0), 0); count = sorted.length;
      rows = sorted.map(p => {
        const src = (p.sources || []).find(s => s.url && s.supports_claim) || (p.sources || []).find(s => s.url);
        const srcHtml = src
          ? `<a class="mp-src" href="${src.url}" target="_blank" rel="noopener">— ${src.publisher} ↗</a>`
          : `<span class="mp-src">— source pending</span>`;
        const cpill = (p.confidence && p.confidence !== "high")
          ? ` <span class="cf-tier cf-${conf[p.confidence] || "warn"}" title="confidence in this record">${p.confidence}</span>` : "";
        const note = p.note ? `<span class="mp-risk">${p.note}</span>` : "";
        const pw = p.power ? `<span class="mp-power ${(p.power.model || "").toLowerCase()}" title="${p.power.model} power-procurement">${p.power.generation} · ${p.power.model}</span>` : "";
        const mwT = (p.capacity_type && p.capacity_type !== "unspecified") ? p.capacity_type.replace(/_/g, " ") : "capacity (MW)";
        return `
      <tr>
        <td><span class="mp-name">${p.name}</span>${cpill}${srcHtml}${note}</td>
        <td class="mp-op">${p.operator}</td>
        <td>${p.state}</td>
        <td>${pw}</td>
        <td class="mp-mw" title="${mwT}">${p.capacity_mw != null ? p.capacity_mw.toLocaleString() : "&mdash;"}</td>
        <td><span class="mp-status ${p.status}">${p.status}</span></td>
      </tr>`;
      }).join("");
      foot = `${count} named builds · <a href="data/projects.json" target="_blank" rel="noopener">open dataset</a>`;
    } else {
      if (!Array.isArray(DATA.megaProjects)) return;
      const sorted = [...DATA.megaProjects].sort((a, b) => (b.mw || 0) - (a.mw || 0));
      totalMW = sorted.reduce((s, p) => s + (p.mw || 0), 0); count = sorted.length;
      rows = sorted.map(p => {
        const risk = p.keyRisk ? `<span class="mp-risk"><span class="mp-gate">${p.keyRisk.gate}</span>${p.keyRisk.text}</span>` : "";
        const upd  = p.latestUpdate ? `<span class="mp-upd"><b>${p.latestUpdate.date}</b> · ${p.latestUpdate.text}<span class="mp-src" style="display:inline"> — ${p.latestUpdate.src.label}</span></span>` : "";
        return `
      <tr>
        <td><span class="mp-name">${p.name}</span><span class="mp-src">— ${p.src.label}</span>${risk}${upd}</td>
        <td class="mp-op">${p.operator}</td>
        <td>${p.state}</td>
        <td>${p.power ? '<span class="mp-power ' + p.power.model.toLowerCase() + '" title="' + p.power.model + ' power-procurement">' + p.power.gen + ' · ' + p.power.model + '</span>' : ''}</td>
        <td class="mp-mw">${p.mw.toLocaleString()}</td>
        <td><span class="mp-status ${p.status}">${p.status}</span></td>
      </tr>`;
      }).join("");
      foot = `${count} named builds`;
    }
    $("megaProjectsList").innerHTML = `
      <table class="mp-table">
        <thead>
          <tr><th>Project</th><th>Operator</th><th>${GEO}</th><th>Power</th><th style="text-align:right">MW</th><th>Status</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td colspan="4">${foot}</td><td class="mp-mw">${totalMW ? totalMW.toLocaleString() : "&mdash;"}</td><td>${totalMW ? "≈ " + (totalMW / 1000).toFixed(1) + " GW" + (anyNullMw ? " disclosed" : "") : "MW mostly undisclosed"}</td></tr>
        </tfoot>
      </table>
      ${pj ? '<div class="mp-data-actions">Open data: <a href="data/projects.json" target="_blank" rel="noopener">download JSON ↓</a> · <a href="' + REPO + '/blob/main/schemas/projects.schema.json" target="_blank" rel="noopener">schema</a> · licensed <a href="' + REPO + '/blob/main/data/LICENSE" target="_blank" rel="noopener">CC BY 4.0</a> · sources verified per record</div>' : ''}`;
  }

  function renderBuildabilityMovements() {
    if (!$("buildabilityMovements") || !Array.isArray(DATA.buildabilityMovements)) return;
    const dirClass = { easing: "ok", tightening: "crit", stalled: "warn" };
    const moves = [...DATA.buildabilityMovements].sort((a, b) => a.date < b.date ? 1 : -1);
    $("buildabilityMovements").innerHTML = moves.map(e => `
      <div class="stack-row">
        <div class="stack-head">
          <span class="stack-name"><span class="stack-num">${e.date}</span>${e.market} · ${e.gate}</span>
          <span class="stack-pill ${dirClass[e.direction] || "warn"}">${e.direction}</span>
        </div>
        <div class="stack-evidence">${e.headline} <span class="stack-src">— ${e.src.label}</span></div>
      </div>`).join("");
  }

  function renderScorecard() {
    if (!$("scorecardWrap") || !DATA.siteScorecards) return;
    const sc = DATA.siteScorecards;
    const classFor = (n) => n >= 7 ? "s-high" : n >= 4 ? "s-mid" : "s-low";
    const wSum = sc.factors.reduce((a, f) => a + (f.weight || 0), 0) || 1;
    const head = `<tr><th style="text-align:left;padding-left:10px">Market</th>${
      sc.factors.map(f => `<th title="${f.src ? f.src.label : ""}${f.proxy ? " · market-level proxy" : ""}">${f.label}${f.proxy ? "*" : ""}</th>`).join("")
    }<th>Readiness<span class="rd-mod">modeled</span></th></tr>`;
    const rows = sc.markets.map(m => {
      const readiness = (m.scores.reduce((a, s, i) => a + s * (sc.factors[i].weight || 0), 0) / wSum).toFixed(1);
      return `<tr><td class="market">${m.name}</td>${m.scores.map(s => `<td class="score ${classFor(s)}">${s}</td>`).join("")}<td class="score ${classFor(parseFloat(readiness))}">${readiness}</td></tr>`;
    }).join("");
    const weights = sc.factors.map(f => `${f.label} ${f.weight}`).join(" · ");
    const bases = sc.factors.map(f => f.src ? `${f.label} → ${f.src.label}` : null).filter(Boolean).join("; ");
    $("scorecardWrap").innerHTML = `
      <table class="scorecard">
        <thead>${head}</thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="sc-note">${sc.note}</div>
      <div class="sc-method"><b>Readiness (modeled)</b> = weighted sum of the cited per-factor scores. Weights: ${weights}. Basis: ${bases}.${sc.factors.some(f => f.proxy) ? " * = market-level proxy." : ""}</div>`;
  }

  /* ----- Energy & Policy tab renders ----- */
  function renderDemandGapChart() {
    if (!$("demandGapChart") || typeof Chart === "undefined") return;
    if (renderDemandGapChart._done) return;
    renderDemandGapChart._done = true;
    initCharts(); applyChartDefaults();
    const dp = DATA.demandProjection;
    const cl = getChartColors();
    _charts.demandGapChart = new Chart($("demandGapChart"), {
      type: "bar",
      data: {
        labels: dp.years,
        datasets: [
          { label: "DC demand added", data: dp.yoyDemandGrowthGW, backgroundColor: CHART_PALETTE.demand, borderRadius: 5, maxBarThickness: 26 },
          { label: "New firm gen for DC", data: dp.newFirmGenForDC, backgroundColor: CHART_PALETTE.supply, borderRadius: 5, maxBarThickness: 26 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, padding: 14 } },
          datalabels: Object.assign({}, LABEL_STYLE_FN(), { display: true, font: { weight: 700, size: 10 }, formatter: v => v + " GW" }),
          tooltip: { callbacks: {
            label: c => " " + c.dataset.label + ": " + c.parsed.y + " GW",
            footer: () => "Source: " + dp.src.label
          }}
        },
        scales: {
          y: { grid: { color: cl.grid }, ticks: { callback: v => v + " GW" }, beginAtZero: true },
          x: { grid: { display: false } }
        }
      }
    });
  }

  function renderRateImpactChart() {
    if (!$("rateImpactChart") || typeof Chart === "undefined") return;
    if (renderRateImpactChart._done) return;
    renderRateImpactChart._done = true;
    const ri = DATA.rateImpacts;
    const colorFor = (v) => v >= 25 ? CHART_PALETTE.constraint : v >= 15 ? CHART_PALETTE.pipeline : CHART_PALETTE.supply;
    const rows = ri.states.map(s => ({ label: s.state, value: s.increase, color: colorFor(s.increase) })).sort((a, b) => b.value - a.value);
    renderLollipop("rateImpactChart", rows, {
      seriesLabel: "Rate increase by 2030 (%)",
      fmt: v => "+" + v + "%", tick: v => "+" + v + "%", suggestedMax: 60, rightPad: 48,
      tooltipCallbacks: {
        label: c => " +" + c.parsed.x + "% by 2030",
        footer: () => "Source: " + ri.src.label
      }
    });
  }

  function renderIsoTable() {
    if (!$("isoTable") || !DATA.isos) return;
    const sevLabel = { crit: "Critical", warn: "High", ok: "Moderate" };
    const rows = DATA.isos.map(iso => `
      <tr title="${iso.note}">
        <td class="iso-name">${iso.name}</td>
        <td>${iso.region}</td>
        <td class="iso-queue">${iso.queueYears}</td>
        <td><span class="sev-pill ${iso.severity}">${sevLabel[iso.severity]}</span></td>
        <td>${iso.note}</td>
      </tr>`).join("");
    $("isoTable").innerHTML = `
      <table class="iso-table">
        <thead><tr><th>ISO</th><th>Region</th><th>Queue depth</th><th>Severity</th><th>Key constraint</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderActionList(targetId, items, renderItem) {
    if (!$(targetId) || !items) return;
    $(targetId).innerHTML = items.map(renderItem).join("");
  }

  function renderRegList() {
    renderActionList("regList", DATA.regulatoryActions, r => `
      <div class="action-row">
        <div class="action-head">
          <span class="action-tag ${r.status}">${r.status}</span>
          <span class="action-title">${r.action}</span>
        </div>
        <div class="action-meta">${r.jurisdiction}</div>
        <div class="action-note">${r.note}</div>
      </div>`);
  }

  function renderUtilList() {
    renderActionList("utilList", DATA.utilityActions, u => `
      <div class="action-row">
        <div class="action-head">
          <span class="action-title">${u.utility}</span>
        </div>
        <div class="action-meta">${u.action} &middot; ${u.meta}</div>
        <div class="action-note">${u.note}</div>
      </div>`);
  }

  function renderDrList() {
    renderActionList("drList", DATA.demandResponse, d => `
      <div class="action-row">
        <div class="action-head">
          ${brandMark(d.company)}
          <span class="action-title">${d.company}</span>
          <span class="action-tag">${d.mw}</span>
        </div>
        <div class="action-meta">${d.type}</div>
        <div class="action-note">${d.note}</div>
      </div>`);
  }

  /* ----- Token Economics tab renders ----- */
  function renderDisclosedTokens() {
    if (!$("disclosedTokenTotals") || !DATA.disclosedTokenTotals) return;
    const dt = DATA.disclosedTokenTotals;
    const rows = dt.rows.map(r => `
      <div class="stack-row">
        <div class="stack-head">
          <div class="stack-name">${r.provider} <span class="stack-what">— ${r.asOf}</span></div>
          <span class="stack-pill" style="background:var(--accent-soft);color:var(--accent)">${r.monthly}/mo</span>
        </div>
        <div class="stack-evidence stack-src">— ${r.src.label}</div>
      </div>`).join("");
    $("disclosedTokenTotals").innerHTML = rows + `
      <div style="margin-top:14px;padding:11px 13px;background:var(--accent-soft);border-left:3px solid var(--accent);border-radius:0 5px 5px 0;font-size:12.5px;line-height:1.5;color:var(--ink)">
        <strong>So what:</strong> ${dt.soWhat}
      </div>`;
  }

  function renderTokenVolumeChart() {
    if (!$("tokenVolumeChart") || typeof Chart === "undefined") return;
    if (renderTokenVolumeChart._done) return;
    renderTokenVolumeChart._done = true;
    initCharts(); applyChartDefaults();
    const tv = DATA.tokenVolume;
    const cl = getChartColors();
    const datasets = tv.providers.map(p => ({
      label: p.name,
      data: p.values,
      backgroundColor: p.color + "cc",
      borderColor: p.color,
      borderWidth: 1.5,
      fill: true,
      tension: 0.32,
      pointRadius: 0
    }));
    _charts.tokenVolumeChart = new Chart($("tokenVolumeChart"), {
      type: "line",
      data: { labels: tv.quarters, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, padding: 14 } },
          tooltip: { callbacks: {
            label: c => " " + c.dataset.label + ": " + c.parsed.y.toLocaleString() + "T",
            footer: () => "Source: " + tv.src.label
          }}
        },
        scales: {
          y: { stacked: true, grid: { color: cl.grid }, ticks: { callback: v => v.toLocaleString() + "T" }, beginAtZero: true },
          x: { grid: { display: false } }
        }
      }
    });
  }

  function renderPriceCompressionChart() {
    if (!$("priceCompressionChart") || typeof Chart === "undefined") return;
    if (renderPriceCompressionChart._done) return;
    renderPriceCompressionChart._done = true;
    initCharts(); applyChartDefaults();
    const pc = DATA.priceCompression;
    const cl = getChartColors();
    // Group models by family for color-coded scatter datasets
    const byFamily = {};
    pc.models.forEach(m => {
      if (!byFamily[m.family]) byFamily[m.family] = [];
      byFamily[m.family].push({ x: m.year, y: m.price, label: m.name });
    });
    const datasets = Object.keys(byFamily).map(fam => ({
      label: pc.familyLabels[fam],
      data: byFamily[fam],
      backgroundColor: pc.familyColors[fam],
      borderColor: pc.familyColors[fam],
      borderWidth: 2,
      showLine: true,
      tension: 0,
      pointRadius: 6,
      pointHoverRadius: 8
    }));
    _charts.priceCompressionChart = new Chart($("priceCompressionChart"), {
      type: "scatter",
      data: { datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, padding: 14 } },
          tooltip: { callbacks: {
            label: c => " " + c.raw.label + ": $" + c.raw.y + " / 1M output tokens"
          }}
        },
        scales: {
          y: { type: "logarithmic", grid: { color: cl.grid },
            ticks: { callback: v => "$" + v },
            title: { display: true, text: "$/1M output tokens (log)" }
          },
          x: { type: "linear", min: 2023, max: 2026,
            grid: { display: false },
            ticks: { stepSize: 0.5, callback: v => {
              const y = Math.floor(v);
              const frac = v - y;
              if (frac < 0.1) return y + "-H1";
              if (frac > 0.4 && frac < 0.6) return y + "-H2";
              return "";
            }},
            title: { display: true, text: "Launch date" }
          }
        }
      }
    });
  }

  function renderTokenJourney() {
    if (!$("tjStage") || !DATA.tokenJourney) return;
    const tj = DATA.tokenJourney, steps = tj.steps, ex = tj.example, R = renderTokenJourney;
    const reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (R._step == null) R._step = 0;
    if (R._depth == null) R._depth = "plain";
    if (R._timer) { clearInterval(R._timer); R._timer = null; }

    const N = steps.length;
    const totalWh  = (ex.inputTokens + ex.outputTokens) * ex.whPerToken;     // ~2.04 Wh
    const totalUsd = ex.outputTokens / 1e6 * ex.usdPerMtokOut;               // ~$0.0004
    const fmtWh  = w => w === 0 ? "—" : (w < 1 ? Math.round(w * 1000) + " mWh" : w.toFixed(1) + " Wh");
    const fmtUsd = u => u === 0 ? "—" : (u < 0.01 ? "$" + u.toFixed(4) : "$" + u.toFixed(2));
    // step order: 0 text,1 tokenize,2 context,3 datacenter,4 forward,5 score,6 decode,7 power,8 cost,9 stream
    const meterAt = i => ({
      tokens: i >= 6 ? ex.inputTokens + ex.outputTokens : (i >= 1 ? ex.inputTokens : 0),
      wh:     i >= 7 ? totalWh  : 0,
      usd:    i >= 8 ? totalUsd : 0
    });

    function paintStage() {
      const stops = steps.map((s, i) => {
        const cls = i === R._step ? "tj-stop active" : (i < R._step ? "tj-stop done" : "tj-stop");
        return `<button type="button" class="${cls}" data-i="${i}">` +
          `<span class="tj-layer${s.layer ? '' : ' tj-layer-blank'}">${s.layer || ''}</span>` +
          `<span class="tj-dot"></span>` +
          `<span class="tj-slabel">${i + 1}. ${s.label}</span></button>`;
      }).join('<span class="tj-rail-seg"></span>');
      $("tjStage").innerHTML = `<div class="tj-rail">${stops}</div>`;
      $("tjStage").querySelectorAll(".tj-stop").forEach(b => b.addEventListener("click", () => { stopAuto(); go(+b.dataset.i); }));
    }
    function paintPanel() {
      const s = steps[R._step];
      let extra = "";
      if (s.showChips) extra += `<div class="tj-chips">${ex.chips.map(c => `<span class="tj-chip">${c.t.replace(/ /g, '·')}<span class="tj-chip-id">${c.id}</span></span>`).join("")}<div class="tj-illus">${ex.illustrative}</div></div>`;
      if (s.showCandidates) extra += `<div class="tj-cands">${ex.candidates.map(c => `<div class="tj-cand"><span class="tj-cand-tok">${c.tok}${c.tok === ex.picked ? ' ✓' : ''}</span><span class="tj-cand-bar"><i style="width:${(c.p * 100).toFixed(0)}%;background:${c.tok === ex.picked ? 'var(--green)' : 'var(--accent)'}"></i></span><span class="tj-cand-p">${(c.p * 100).toFixed(0)}%</span></div>`).join("")}<div class="tj-illus">Illustrative probabilities.</div></div>`;
      if (s.isReceipt) { const m = meterAt(R._step); extra += `<div class="tj-receipt">Input ${ex.inputTokens} · Output ${ex.outputTokens} tokens &nbsp;·&nbsp; Energy ${fmtWh(m.wh)} &nbsp;·&nbsp; Cost ${fmtUsd(m.usd)}</div>`; }
      const deep = (R._depth === "deep" && s.deep) ? `<div class="tj-deep"><b>Deeper:</b> ${s.deep}</div>` : "";
      $("tjStepPanel").innerHTML = `<div class="tj-step-title">${R._step + 1}. ${s.label}</div><div class="tj-step-plain">${s.plain}</div>${deep}${extra}`;
    }
    function paintMeter() {
      const m = meterAt(R._step);
      $("tjMeter").innerHTML =
        `<div class="tj-mcell"><span class="tj-mv">${m.tokens}</span><span class="tj-ml">tokens</span></div>` +
        `<div class="tj-mcell"><span class="tj-mv">${fmtWh(m.wh)}</span><span class="tj-ml">energy</span></div>` +
        `<div class="tj-mcell"><span class="tj-mv">${fmtUsd(m.usd)}</span><span class="tj-ml">cost</span></div>`;
    }
    function paintControls() {
      $("tjControls").innerHTML =
        `<button type="button" class="tj-btn" data-act="prev" ${R._step === 0 ? "disabled" : ""}>‹ Prev</button>` +
        `<button type="button" class="tj-btn tj-play" data-act="play"${reduce ? ' style="display:none"' : ''}>${R._timer ? "❚❚ Pause" : "▶ Play"}</button>` +
        `<button type="button" class="tj-btn" data-act="next" ${R._step === N - 1 ? "disabled" : ""}>Next ›</button>` +
        `<span class="tj-count">Step ${R._step + 1} / ${N}</span>`;
      $("tjControls").querySelectorAll(".tj-btn").forEach(b => b.addEventListener("click", () => {
        const a = b.dataset.act;
        if (a === "prev") { stopAuto(); go(R._step - 1); }
        else if (a === "next") { stopAuto(); go(R._step + 1); }
        else if (a === "play") { R._timer ? stopAuto() : startAuto(); }
      }));
    }
    function paintScaleup() {
      const su = tj.scaleUp, whMo = su.aggregate.tokens * ex.whPerToken;
      const twhMo = whMo / 1e12, gw = whMo / 730 / 1e9;
      const wr = su.whRange || [ex.whPerToken, ex.whPerToken];
      const gwLo = su.aggregate.tokens * wr[0] / 730 / 1e9, gwHi = su.aggregate.tokens * wr[1] / 730 / 1e9;
      const queueGW = (DATA.powerBreakdown && DATA.powerBreakdown.funnel) ? DATA.powerBreakdown.funnel.values[0] : 97;
      const capexB = DATA.companyCapex ? DATA.companyCapex.values.reduce((a, b) => a + b, 0) : 839;
      const cell = (v, l, n) => `<div class="bridge-cell"><div class="bv">${v}</div><div class="bl">${l}</div><div class="bn">${n}</div></div>`;
      const arrow = `<div class="bridge-arrow">→</div>`;
      $("tjScaleup").innerHTML =
        `<div class="tj-scaleup-title">Scale one token up to the buildout</div>` +
        `<div class="bridge-row">` +
        cell("~" + totalWh.toFixed(0) + " Wh", "One answer", "≈ " + (ex.inputTokens + ex.outputTokens) + " tokens at ~0.005 Wh/token (cited bridge).") + arrow +
        cell(su.aggregate.value, su.aggregate.unit, su.aggregate.who + " — " + su.aggregate.src.label + ".") + arrow +
        cell("~" + Math.round(gwLo) + "–" + Math.round(gwHi) + " GW", "continuous · ≈" + gw.toFixed(0) + " GW midpoint", "Modeled range: ~" + Math.round(twhMo) + " TWh/mo at the ~5 kWh/1M midpoint; band = ~3–10 kWh/1M (model size, output mix, batching, utilization, PUE). One company's inference — not an observed figure.") + arrow +
        cell("~" + queueGW + " GW", "US interconnect queue", "All operators, training + inference + headroom (LBNL Queued Up 2025).") + arrow +
        cell("~$" + capexB + "B", "2026 operator capex", "What it costs to build (company 2026 guidance).") +
        `</div><div class="tj-sowhat">${su.soWhat}</div>`;
    }
    function go(i) {
      R._step = Math.max(0, Math.min(N - 1, i));
      paintStage(); paintPanel(); paintMeter(); paintControls();
    }
    function startAuto() {
      if (reduce) return;
      R._timer = setInterval(() => { if (R._step >= N - 1) { stopAuto(); paintControls(); } else go(R._step + 1); }, 1700);
      paintControls();
    }
    function stopAuto() { if (R._timer) { clearInterval(R._timer); R._timer = null; } }

    const toggle = $("tjDepthToggle");
    if (toggle && !R._wired) {
      R._wired = true;
      toggle.querySelectorAll(".map-view-btn").forEach(b => b.addEventListener("click", () => {
        R._depth = b.dataset.tjdepth;
        toggle.querySelectorAll(".map-view-btn").forEach(x => x.classList.toggle("active", x === b));
        paintPanel();
      }));
    }

    paintStage(); paintPanel(); paintMeter(); paintControls(); paintScaleup();
    if ($("tjMethod")) $("tjMethod").innerHTML = `<b>How to read this.</b> ${tj.scaleUp.note}`;
  }

  function renderEnergyBridge() {
    if (!$("energyBridge") || !DATA.tokenEnergyBridge) return;
    const cells = DATA.tokenEnergyBridge;
    const parts = [];
    cells.forEach((c, i) => {
      parts.push(`<div class="bridge-cell">
        <div class="bv">${c.value}</div>
        <div class="bl">${c.label}</div>
        <div class="bn">${c.note}</div>
      </div>`);
      if (i < cells.length - 1) parts.push('<div class="bridge-arrow">→</div>');
    });
    $("energyBridge").innerHTML = parts.join("");
  }

  function renderSplitChart() {
    if (!$("splitChart") || typeof Chart === "undefined" || !DATA.inferenceTrainingSplit) return;
    if (renderSplitChart._done) return;
    renderSplitChart._done = true;
    initCharts(); applyChartDefaults();
    const s = DATA.inferenceTrainingSplit, cl = getChartColors();
    _charts.splitChart = new Chart($("splitChart"), {
      type: "bar",
      data: {
        labels: ["Compute hours", "Dollar spend"],
        datasets: [
          { label: "Inference", data: [s.computeHours.inference, s.spend.inference], backgroundColor: "#1d4ed8", stack: "s" },
          { label: "Training",  data: [s.computeHours.training,  s.spend.training],  backgroundColor: "#c2710c", stack: "s" }
        ]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true },
          datalabels: { display: true, color: "#fff", font: { weight: 800, size: 12 }, formatter: v => v + "%" },
          tooltip: { callbacks: { label: c => " " + c.dataset.label + ": " + c.parsed.x + "%", footer: () => "Source: " + s.src.label } }
        },
        scales: {
          x: { stacked: true, min: 0, max: 100, grid: { color: cl.grid }, ticks: { callback: v => v + "%" } },
          y: { stacked: true, grid: { display: false } }
        }
      }
    });
    if ($("splitChartMethod")) $("splitChartMethod").innerHTML = s.note + " Source: " + s.src.label + ".";
  }

  /* ----- Lazy per-tab render ----- */
  const renderedTabs = new Set();
  /* ----- Live public-data feeds: data/*.json built by scripts/ + refresh-data.yml.
     Additive + graceful — a missing or failed feed leaves the curated DATA untouched
     and never blanks a chart. ----- */
  function renderHeadroomChart() {
    if (!$("headroomChart") || typeof Chart === "undefined") return;
    if (!DATA.grid || !DATA.grid.regions) return;   // no feed yet -> skip, keep dashboard intact
    if (renderHeadroomChart._done) return;
    renderHeadroomChart._done = true;
    const rows = Object.entries(DATA.grid.regions)
      .filter(([, v]) => v.headroom_pct != null)
      .map(([ba, v]) => ({ ba, ...v }))
      .sort((a, b) => a.headroom_pct - b.headroom_pct);
    const col = v => v <= 6 ? CHART_PALETTE.constraint : (v <= 10 ? CHART_PALETTE.pipeline : CHART_PALETTE.supply);
    renderLollipop("headroomChart", rows.map(r => ({ label: r.ba, value: r.headroom_pct, color: col(r.headroom_pct) })), {
      seriesLabel: "Grid headroom (%)",
      fmt: v => v + "%", tick: v => v + "%", rightPad: 44,
      tooltipCallbacks: {
        label: c => " " + c.parsed.x + "% headroom",
        afterLabel: c => "Peak ≈ " + (rows[c.dataIndex].peak_mw || 0).toLocaleString() + " MW · EIA-930 + EIA-860"
      },
      annotation: { annotations: {
        crit:    { type: "line", scaleID: "x", value: 6,  borderColor: hexA(CHART_PALETTE.constraint, 0.7), borderWidth: 1, borderDash: [4, 4], label: { display: true, content: "6% critical",  position: "start", color: "#fff", backgroundColor: hexA(CHART_PALETTE.constraint, 0.85), font: { size: 9, weight: 700 }, padding: 2 } },
        healthy: { type: "line", scaleID: "x", value: 10, borderColor: hexA(CHART_PALETTE.supply, 0.7),     borderWidth: 1, borderDash: [4, 4], label: { display: true, content: "10% healthy", position: "end",   color: "#fff", backgroundColor: hexA(CHART_PALETTE.supply, 0.85),     font: { size: 9, weight: 700 }, padding: 2 } }
      } }
    });
  }

  // "What power costs, by state" — renders the daily EIA-861 industrial-price feed
  // (data/power_econ.json) that was previously collected but never displayed.
  function renderPowerPriceBoard() {
    if (!$("powerPriceBoard") || typeof Chart === "undefined") return;
    if (!DATA.power_econ || !DATA.power_econ.states) return;   // no feed yet -> skip
    if (renderPowerPriceBoard._done) return;
    renderPowerPriceBoard._done = true;
    // Major AI data-center corridor states (grounded in the project ledger + CBRE primary markets)
    const CORRIDOR = ["VA", "TX", "GA", "OH", "PA", "AZ", "IA", "OR", "WY", "ND", "IN", "LA", "MS", "TN"];
    const st = DATA.power_econ.states;
    const rows = CORRIDOR
      .filter(s => st[s] && st[s].ind_usd_mwh != null)
      .map(s => ({ label: s, value: Math.round(st[s].ind_usd_mwh) }))
      .sort((a, b) => a.value - b.value);
    if (!rows.length) return;
    const col = v => v <= 70 ? CHART_PALETTE.supply : (v <= 90 ? CHART_PALETTE.pipeline : CHART_PALETTE.constraint);
    renderLollipop("powerPriceBoard", rows.map(r => ({ label: r.label, value: r.value, color: col(r.value) })), {
      seriesLabel: "Industrial power price ($/MWh)",
      fmt: v => "$" + v, rightPad: 48,
      tooltipCallbacks: {
        label: c => " $" + c.parsed.x + "/MWh industrial retail",
        afterLabel: () => "EIA retail sales (sector IND) · " + (DATA.power_econ.period || "")
      }
    });
    const m = $("powerPriceMethod");
    if (m) {
      const all = Object.values(st).map(v => v.ind_usd_mwh).filter(v => v != null);
      const lo = Math.round(Math.min.apply(null, all)), hi = Math.round(Math.max.apply(null, all));
      m.innerHTML = "<b>Live feed.</b> EIA retail-sales industrial price, data " + (DATA.power_econ.period || "n/a") +
        " · corridor states shown; national range $" + lo + "–$" + hi + "/MWh · refreshed daily in CI.";
    }
  }

  // PJM capacity-auction clearing prices by DELIVERY YEAR (labels by delivery year, not
  // auction date — auction timing has been irregular). Curated DATA.pjmAuction; primary source.
  function renderPjmAuction() {
    if (!$("pjmAuctionChart") || typeof Chart === "undefined") return;
    if (!DATA.pjmAuction || !Array.isArray(DATA.pjmAuction.series)) return;
    if (renderPjmAuction._done) return;
    renderPjmAuction._done = true;
    initCharts(); applyChartDefaults();
    const cl = getChartColors();
    const pa = DATA.pjmAuction;
    const col = d => d.price == null ? hexA(CHART_PALETTE.context, 0.25)
      : (d.atCap ? CHART_PALETTE.constraint : (d.price >= 200 ? CHART_PALETTE.pipeline : CHART_PALETTE.supply));
    const ann = {};
    if (pa.collar) {
      ann.cap = { type: "line", yMin: pa.collar.cap, yMax: pa.collar.cap, borderColor: hexA(CHART_PALETTE.constraint, 0.75), borderWidth: 1, borderDash: [5, 4],
        label: { display: true, content: "price cap $" + pa.collar.cap + "/MW-day", position: "end", backgroundColor: hexA(CHART_PALETTE.constraint, 0.85), color: "#fff", font: { size: 9, weight: 700 }, padding: 3 } };
      ann.floor = { type: "line", yMin: pa.collar.floor, yMax: pa.collar.floor, borderColor: hexA(CHART_PALETTE.context, 0.6), borderWidth: 1, borderDash: [5, 4],
        label: { display: true, content: "floor $" + pa.collar.floor, position: "end", backgroundColor: hexA(CHART_PALETTE.context, 0.7), color: "#fff", font: { size: 9, weight: 700 }, padding: 3 } };
    }
    _charts.pjmAuctionChart = new Chart($("pjmAuctionChart"), {
      type: "bar",
      data: { labels: pa.series.map(d => d.dy), datasets: [{
        label: "RTO clearing price ($/MW-day)",
        data: pa.series.map(d => d.price),
        backgroundColor: pa.series.map(col), borderWidth: 0
      }]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: Object.assign({}, LABEL_STYLE_FN(), { display: true, anchor: "end", align: "end",
            formatter: (v, c) => v == null ? (pa.series[c.dataIndex].pending || "") : "$" + v.toLocaleString() }),
          tooltip: { callbacks: {
            label: c => c.parsed.y == null ? " results pending" : " $" + c.parsed.y.toLocaleString() + "/MW-day RTO clearing price",
            afterLabel: c => pa.series[c.dataIndex].note || ""
          } },
          annotation: { annotations: ann }
        },
        scales: {
          y: { grid: { color: cl.grid }, ticks: { callback: v => "$" + v }, beginAtZero: true },
          x: { grid: { display: false } }
        }
      }
    });
    const m = $("pjmAuctionMethod");
    if (m && pa.methodology) m.innerHTML = "<b>Primary.</b> " + pa.methodology;
  }

  // Graveyard & stalls — verified retreats from the project ledger (status stalled / paused /
  // cancelled). The honest counterweight to announcement bias: nobody else publishes a cited
  // graveyard of AI-DC projects. Records live in data/projects.json like everything else.
  const GRAVEYARD_STATUSES = ["stalled", "paused", "cancelled"];
  function renderGraveyard() {
    if (!$("graveyardList")) return;
    const pj = (DATA.projects && Array.isArray(DATA.projects.records)) ? DATA.projects.records : null;
    if (!pj) { $("graveyardList").closest(".stub-card") && ($("graveyardList").closest(".stub-card").style.display = "none"); return; }
    const dead = pj.filter(p => GRAVEYARD_STATUSES.indexOf(p.status) !== -1)
      .sort((a, b) => String(b.status_as_of || "").localeCompare(String(a.status_as_of || "")));
    const host = $("graveyardList");
    const card = host.closest(".stub-card");
    if (!dead.length) { if (card) card.style.display = "none"; return; }
    if (card) card.style.display = "";
    const conf = { high: "ok", medium: "warn", low: "crit" };
    host.innerHTML = dead.map(p => {
      const src = (p.sources || []).find(s => s.url && s.supports_claim) || (p.sources || []).find(s => s.url);
      const srcHtml = src ? '<a class="mp-src" href="' + src.url + '" target="_blank" rel="noopener">— ' + src.publisher + ' ↗</a>' : "";
      const hist = (p.status_history || []).slice(-1)[0];
      const note = hist && hist.note ? hist.note : (p.note || "");
      const mw = p.capacity_mw != null ? '<span class="mp-mw" style="text-align:left">' + p.capacity_mw.toLocaleString() + ' MW</span>' : "";
      return '<div class="stack-row">' +
        '<div class="stack-head"><span class="stack-name">' + p.name + ' · ' + p.operator + ' · ' + p.state + '</span>' +
        '<span class="mp-status ' + p.status + '">' + p.status + '</span></div>' +
        '<div class="stack-evidence">' + mw + (mw ? ' · ' : '') + note +
        ' <span class="cf-tier cf-' + (conf[p.confidence] || "warn") + '" title="confidence in this record">' + (p.confidence || "medium") + '</span>' + srcHtml + '</div></div>';
    }).join("");
    const foot = $("graveyardFoot");
    if (foot) {
      const gw = dead.reduce((s, p) => s + (p.capacity_mw || 0), 0);
      foot.innerHTML = dead.length + " verified retreat" + (dead.length > 1 ? "s" : "") + " tracked · " +
        (gw ? "≈ " + (gw / 1000).toFixed(1) + " GW shelved or on hold · " : "") +
        'stated reasons are tiered separately from the status fact — see each source.';
    }
  }

  function renderQueueChart() {
    if (!$("queueChart") || typeof Chart === "undefined") return;
    if (!DATA.queues || !Array.isArray(DATA.queues.iso)) return;
    if (renderQueueChart._done) return;
    renderQueueChart._done = true;
    initCharts(); applyChartDefaults();
    const cl = getChartColors();
    const q = DATA.queues.iso;
    const credPct = Math.round(100 * (1 - (DATA.queues.withdrawal_rate != null ? DATA.queues.withdrawal_rate : 0.78)));
    _charts.queueChart = new Chart($("queueChart"), {
      type: "bar",
      data: { labels: q.map(d => d.iso), datasets: [
        { label: "Credible (post-withdrawal)", data: q.map(d => d.credible_gw), backgroundColor: CHART_PALETTE.supply, stack: "s" },
        { label: "Phantom / speculative", data: q.map(d => d.active_gw - d.credible_gw), backgroundColor: hexA(CHART_PALETTE.context, 0.3), stack: "s" }
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" }, datalabels: { display: false },
          tooltip: { callbacks: { footer: items => { const r = q[items[0].dataIndex]; return "Active queue " + r.active_gw + " GW · ~" + credPct + "% credible"; } } }
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: cl.grid }, beginAtZero: true, title: { display: true, text: "queue (GW) — LBNL Queued Up" } }
        }
      }
    });
  }

  async function hydrate() {
    const feeds = (typeof REGION_CONFIG !== "undefined" && REGION_CONFIG.feeds) || ["grid", "power_econ", "queues", "siting", "projects", "sources"];
    let got;
    try {
      got = await Promise.all(feeds.map(f =>
        fetch("data/" + f + ".json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null)));
    } catch (_) { return; }                            // network down -> keep curated DATA
    feeds.forEach((f, i) => { if (got[i]) DATA[f] = got[i]; });   // missing feed -> keep curated DATA
    // A0: current.json is the live headline/news layer (lastUpdated/topStory/feed/kpis), edited by
    // daily_refresh.py. Overlay it onto the inline DATA (the offline fallback) and re-render the
    // surfaces that read those fields. Additive + graceful: a missing/failed fetch keeps the inline copy.
    try {
      const cur = await fetch("data/current.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null);
      if (cur && typeof cur === "object") {
        ["lastUpdated", "topStory", "feed", "kpis"].forEach(k => { if (cur[k] != null) DATA[k] = cur[k]; });
        renderUpdatedStamp();
        if (typeof renderTopStory === "function") renderTopStory();
        if (typeof renderKpis === "function") renderKpis();
        if (typeof renderBriefing === "function") renderBriefing();
      }
    } catch (_) {}
    const vis = el => !!(el && el.offsetParent !== null);          // only paint into a visible canvas
    if (DATA.grid && vis($("headroomChart")))  { renderHeadroomChart._done = false; renderHeadroomChart(); }
    if (DATA.power_econ && vis($("powerPriceBoard"))) { renderPowerPriceBoard._done = false; renderPowerPriceBoard(); }
    if (DATA.queues && vis($("queueChart")))    { renderQueueChart._done = false; renderQueueChart(); }
    if (DATA.siting && renderMap._view === "whitespace" && vis($("map"))) { renderMap._done = false; renderMap(); }
    if (DATA.projects && vis($("megaProjectsList"))) renderMegaProjects();   // swap the seed table for the canonical dataset
    if (DATA.projects && vis($("graveyardList"))) renderGraveyard();         // verified retreats from the same dataset
    if (vis($("playersCards"))) { renderPlayers(); renderPlayerFeed(); }     // dossier joins pick up the fresh feeds
    renderFeedFreshness();
    if (DATA.sources) linkifySources(document.querySelector("section.tab-content.active"));
  }

  // Linkify cited source labels to the canonical ledger (data/sources.json) — ONE post-render
  // pass, no edits to the 50+ render sites. Walks text nodes inside source-display elements and
  // wraps the first known label per node in a link; modeled/unlinkable labels stay plain text.
  function linkifySources(root) {
    if (!root || !DATA.sources || !Array.isArray(DATA.sources.ledger)) return;
    if (!linkifySources._map) {
      linkifySources._map = DATA.sources.ledger
        .filter(e => e.url && e.linkable !== false)
        .map(e => ({ label: e.label, url: e.url, publisher: e.publisher || "" }))
        .sort((a, b) => b.label.length - a.label.length);   // longest first → compound labels win
    }
    const map = linkifySources._map;
    if (!map.length) return;
    const sel = ".sc-method,.note,.stack-src,.deal-src,.sc-note,.mp-upd,.tab-callout,.funnel-conv,.play-note,.chart-cap,.bn-evidence,.vi-trend,.vi-point";
    root.querySelectorAll(sel).forEach(el => {
      if (el.dataset.srcLinked) return;
      el.dataset.srcLinked = "1";
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => {
        const text = node.nodeValue;
        if (!text || text.length < 4) return;
        if (node.parentNode && node.parentNode.closest && node.parentNode.closest("a")) return;
        // Collect ALL non-overlapping label matches left→right; at each position the
        // earliest-starting label wins, and since `map` is pre-sorted longest-first a
        // compound label (e.g. "LBNL Queued Up 2025") beats its substring ("LBNL Queued Up").
        const matches = [];
        let pos = 0;
        while (pos < text.length) {
          let best = null, bestIdx = -1;
          for (const m of map) {
            const i = text.indexOf(m.label, pos);
            if (i !== -1 && (bestIdx === -1 || i < bestIdx)) { best = m; bestIdx = i; }
          }
          if (!best) break;
          matches.push({ m: best, idx: bestIdx });
          pos = bestIdx + best.label.length;
        }
        if (!matches.length) return;
        const frag = document.createDocumentFragment();
        let cursor = 0;
        matches.forEach(hitObj => {
          const m = hitObj.m, idx = hitObj.idx;
          if (idx < cursor) return;                       // safety: skip any accidental overlap
          if (idx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, idx)));
          const a = document.createElement("a");
          a.className = "src-link"; a.href = m.url; a.target = "_blank"; a.rel = "noopener";
          if (m.publisher) a.title = m.publisher;
          a.textContent = m.label;
          frag.appendChild(a);
          cursor = idx + m.label.length;
        });
        if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
        node.parentNode.replaceChild(frag, node);
      });
    });
  }

  // Surface each live feed's own as-of timestamp (grid/power_econ/queues/siting each carry lastUpdated).
  function renderFeedFreshness() {
    const META = (typeof REGION_CONFIG !== "undefined" && REGION_CONFIG.feedMeta) || { grid: "EIA-930/860", power_econ: "EIA-861 prices", queues: "LBNL queue", siting: "Modeled siting" };
    const fmt = iso => { try { const d = new Date(iso); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC"; } catch (_) { return String(iso); } };
    const ageDays = iso => { try { return (Date.now() - new Date(iso).getTime()) / 864e5; } catch (_) { return 99; } };
    [].forEach.call(document.querySelectorAll(".feed-stamp[data-feed]"), el => {
      const d = DATA[el.getAttribute("data-feed")];
      if (!d || !d.lastUpdated) { el.textContent = ""; el.className = "feed-stamp"; return; }
      el.className = "feed-stamp" + (ageDays(d.lastUpdated) <= 2.5 ? "" : " stale");
      const period = d.period || d.observed || null;   // observation period, when the feed carries one
      el.title = "Fetched " + fmt(d.lastUpdated) + " — when CI last pulled this feed (retrieval)." + (period ? " Underlying data observes " + period + " (observation period, may lag retrieval)." : " The underlying public dataset (EIA, LBNL, …) may report an earlier observation period.");
      el.textContent = "● fetched " + fmt(d.lastUpdated) + (period ? " · data " + period : "");
    });
    const strip = $("ov-livedata");
    if (strip) {
      const items = ["grid", "power_econ", "queues", "siting"]
        .filter(k => DATA[k] && DATA[k].lastUpdated)
        .map(k => { const stale = ageDays(DATA[k].lastUpdated) > 2.5; const per = DATA[k].period || DATA[k].observed; return '<span class="lds-item' + (stale ? " stale" : "") + '" title="fetched ' + fmt(DATA[k].lastUpdated) + (per ? '; data observes ' + per : '') + '"><i></i>' + META[k] + ' · ' + fmt(DATA[k].lastUpdated) + (per ? ' · data ' + per : '') + '</span>'; });
      strip.innerHTML = items.length ? '<span class="lds-label" title="Timestamps are when CI last auto-fetched each feed — the underlying public data (EIA, LBNL) may report an earlier observation period.">◆ Public-data feeds · auto-fetched</span>' + items.join("") : "";
    }
  }

  /* ===== Overview cold open (feat/overview-cold-open + map-toggle addendum).
     Additive + graceful: every piece falls back if its DATA field is missing. ===== */
  function ovCumsum(a){ var s=0; return a.map(function(v){ s+=v; return s; }); }

  function renderPowerWall(){
    var host=document.getElementById('ov-stage'); if(!host) return;
    var S=(DATA&&DATA.demandProjection)||null;   // cumulative demand vs firm gen -> the gap widens
    var years=S?S.years.map(Number):[2024,2025,2026,2027,2028,2029,2030];
    var dem  =S?ovCumsum(S.yoyDemandGrowthGW):[25,31,41,55,72,90,108];
    var gen  =S?ovCumsum(S.newFirmGenForDC):[24,28,33,39,45,50,55];
    var n=years.length, maxG=Math.ceil(Math.max.apply(null,dem)/20)*20;
    var X=function(i){return 56+i*(584/(n-1))}, Y=function(g){return 250-(g/maxG)*210};
    var dP=dem.map(function(g,i){return [X(i),Y(g)]}), gP=gen.map(function(g,i){return [X(i),Y(g)]});
    var pth=function(p){return "M"+p.map(function(q){return q[0].toFixed(1)+" "+q[1].toFixed(1)}).join(" L ")};
    var poly=dP.concat(gP.slice().reverse()).map(function(q){return q[0].toFixed(1)+","+q[1].toFixed(1)}).join(" ");
    var gap=Math.round(dem[n-1]-gen[n-1]);
    var ticks=[0,Math.floor((n-1)/3),Math.floor(2*(n-1)/3),n-1];
    var xlab=ticks.map(function(i){var a=i===0?"start":i===n-1?"end":"middle";
      return '<text x="'+X(i).toFixed(0)+'" y="270" font-size="11" fill="#8b97a3" text-anchor="'+a+'">'+years[i]+'</text>'}).join("");
    host.innerHTML=
     '<svg id="ovpw" viewBox="0 0 680 300" width="100%" role="img" aria-labelledby="ovt ovd" style="display:block">'
     +'<title id="ovt">AI data-center demand versus firm generation</title>'
     +'<desc id="ovd">Two diverging lines; the widening red area is the projected power gap.</desc>'
     +'<line x1="56" y1="250" x2="640" y2="250" stroke="#1f2933"/>'
     +'<text x="56" y="36" font-size="11" fill="#8b97a3">GW of cumulative US data-center load</text>'+xlab
     +'<polygon id="ovgap" points="'+poly+'" fill="#e5534b" opacity="0"/>'
     +'<path id="ovgen" d="'+pth(gP)+'" fill="none" stroke="#8b97a3" stroke-width="2" stroke-dasharray="5 4"/>'
     +'<path id="ovdem" d="'+pth(dP)+'" fill="none" stroke="#58a6ff" stroke-width="2.5"/>'
     +'<circle cx="'+dP[n-1][0]+'" cy="'+dP[n-1][1]+'" r="3.5" fill="#58a6ff"/>'
     +'<circle cx="'+gP[n-1][0]+'" cy="'+gP[n-1][1]+'" r="3.5" fill="#8b97a3"/>'
     +'<line id="ovscrub" x1="0" y1="40" x2="0" y2="250" stroke="#3a4654" opacity="0"/>'
     +'<text id="ovlbl" x="634" y="'+((dP[n-1][1]+gP[n-1][1])/2).toFixed(0)+'" font-size="14" font-weight="700" fill="#fca5a5" stroke="#0b1220" stroke-width="3.4" paint-order="stroke" stroke-linejoin="round" text-anchor="end" opacity="0"></text>'
     +'</svg>'
     +'<div id="ovread" style="position:absolute;top:4px;opacity:0;transform:translate(-50%,0);pointer-events:none;font-size:12px;padding:3px 8px;border-radius:8px;background:#11161b;border:1px solid #2a3543;color:#e6edf3;white-space:nowrap"></div>'
     +'<div class="ov-legend"><span><i class="ov-sw ov-sw-line"></i>AI demand — cumulative load (~79 GW by 2030)</span>'
     +'<span><i class="ov-sw ov-sw-dash"></i>firm generation committed — only ~60 GW</span>'
     +'<span><i class="ov-sw ov-sw-area"></i>red = load without firm power behind it (~19 GW)</span>'
     +'<span style="margin-left:auto">cumulative GW · Goldman / Wood Mackenzie / EIA (modeled)</span></div>';
    host.style.position='relative';
    var reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
    var dem_=document.getElementById('ovdem'), gen_=document.getElementById('ovgen'),
        gapEl=document.getElementById('ovgap'), lbl=document.getElementById('ovlbl');
    function draw(el,d){var L=el.getTotalLength();el.style.strokeDasharray=L;el.style.strokeDashoffset=L;el.getBoundingClientRect();el.style.transition='stroke-dashoffset 1.4s ease '+d+'s';el.style.strokeDashoffset=0;}
    function reveal(){gapEl.style.transition='opacity .9s';gapEl.style.opacity=.22;lbl.style.opacity=1;
      if(reduce){lbl.textContent=gap+' GW gap';return;}
      var t0=null,done=false;requestAnimationFrame(function tick(ts){if(!t0)t0=ts;var k=Math.min(1,(ts-t0)/900);lbl.textContent=Math.round(k*gap)+' GW gap';if(k<1)requestAnimationFrame(tick);else done=true;});
      setTimeout(function(){if(!done)lbl.textContent=gap+' GW gap';},1200);}
    if(reduce){gen_.style.strokeDasharray='5 4';reveal();}
    else{draw(gen_,0);draw(dem_,.15);setTimeout(reveal,1500);}
    var svg=document.getElementById('ovpw'),scrub=document.getElementById('ovscrub'),rd=document.getElementById('ovread');
    svg.addEventListener('mousemove',function(e){try{var r=svg.getBoundingClientRect();var vx=(e.clientX-r.left)/r.width*680;
      var i=Math.max(0,Math.min(n-1,Math.round((vx-56)/(584/(n-1)))));var x=X(i);
      scrub.setAttribute('x1',x);scrub.setAttribute('x2',x);scrub.style.opacity=1;
      rd.style.opacity=1;rd.style.left=(x/680*100)+'%';
      rd.innerHTML='<b>'+years[i]+'</b> · <span style="color:#58a6ff">demand '+Math.round(dem[i])
        +'</span> · <span style="color:#9aa7b3">firm '+Math.round(gen[i])
        +'</span> · <span style="color:#fca5a5">gap '+Math.round(dem[i]-gen[i])+'</span> GW';}catch(_){}});
    svg.addEventListener('mouseleave',function(){scrub.style.opacity=0;rd.style.opacity=0;});
  }

  // "This week" editorial briefing — top developments from the live feed, source-linked.
  function renderBriefing(){
    var host=document.getElementById('ov-briefing'); if(!host) return;
    var feed=(DATA&&DATA.feed)||[];
    if(!feed.length){ host.style.display='none'; return; }
    var tagColor={GRID:'#e5534b',CAPITAL:'#39d98a',BUILDOUT:'#58a6ff',TOKENS:'#e3b341'};
    host.innerHTML=feed.slice(0,5).map(function(it){
      var tag=(it.tag||it.section||'SIGNAL').toUpperCase();
      var head=it.headline||it.title||it.text||'';
      var src=it.src?(it.url?'<a class="ov-bsrc" href="'+it.url+'" target="_blank" rel="noopener">'+it.src+' ↗</a>':'<span class="ov-bsrc">'+it.src+'</span>'):'';
      return '<div class="ov-brief"><div class="ov-brief-top"><span class="ov-tag" style="color:'+(tagColor[tag]||'#8b97a3')+'">'+tag+'</span><time>'+(it.date||'')+'</time></div>'
        +'<div class="ov-brief-text">'+head+'</div>'+(src?'<div class="ov-brief-src">'+src+'</div>':'')+'</div>';
    }).join('');
  }
  // Overview: shifting-bottleneck timeline — minimal interactive step-rail over DATA.bottleneckTimeline.
  // HTML/SVG (no Chart.js); rebuilds markup + rewires listeners each call (theme-safe); state on the fn.
  function renderBottleneckTimeline(){
    var host=document.getElementById('ov-bottleneck'); if(!host) return;
    var tl=(DATA&&DATA.bottleneckTimeline)||null;
    if(!tl||!tl.eras||!tl.eras.length){ host.style.display='none'; return; }
    host.style.display='';
    var eras=tl.eras, R=renderBottleneckTimeline;
    if(typeof R._step!=='number'){ var ni=eras.findIndex(function(e){return e.status==='now';}); R._step=ni<0?0:ni; }
    var railHtml='<div class="bn-rail" role="tablist" aria-label="Bottleneck eras">';
    eras.forEach(function(e,i){
      if(i>0) railHtml+='<div class="bn-seg"></div>';
      railHtml+='<button class="bn-stop" role="tab" data-i="'+i+'" aria-label="'+e.period+' — '+e.title+'">'
        +'<span class="bn-dot"></span><span class="bn-period">'+e.period+'</span>'
        +'<span class="bn-stop-title">'+e.title+'</span></button>';
    });
    railHtml+='</div>';
    host.innerHTML=railHtml
      +'<div class="bn-panel" id="bnPanel"></div>'
      +'<div class="bn-controls"><button class="bn-btn" id="bnPrev">&larr; Prev</button>'
      +'<span class="bn-count" id="bnCount"></span>'
      +'<button class="bn-btn" id="bnNext">Next &rarr;</button></div>';
    var stops=host.querySelectorAll('.bn-stop');
    var panel=host.querySelector('#bnPanel'), countEl=host.querySelector('#bnCount');
    var prevBtn=host.querySelector('#bnPrev'), nextBtn=host.querySelector('#bnNext');
    function paint(i){
      i=Math.max(0,Math.min(eras.length-1,i)); R._step=i;
      var e=eras[i];
      for(var si=0; si<stops.length; si++){
        stops[si].classList.toggle('active',si===i);
        stops[si].classList.toggle('done',si<i);
        stops[si].classList.toggle('projected',eras[si].status==='projected');
        stops[si].setAttribute('aria-selected',si===i?'true':'false');
      }
      var layerTag=e.layer==='both'?'compute + physical':e.layer;
      var ev=(e.evidence||[]).map(function(x){return x.label;}).join(' · ');
      var pill=e.status==='projected'
        ? '<span class="cf-tier cf-warn" title="Scenario — a labeled projection, not a prediction.">scenario</span>'
        : (e.status==='now' ? '<span class="cf-tier cf-ok" title="The binding constraint today.">now</span>' : '');
      panel.innerHTML='<div class="bn-head"><span class="bn-period-lg">'+e.period+'</span>'
        +'<span class="bn-layer">'+layerTag+'</span>'+pill+'</div>'
        +'<div class="bn-binding">Binding: '+e.binding+'</div>'
        +(e.loosened?'<div class="bn-loosened">What just loosened: <b>'+e.loosened+'</b></div>':'')
        +'<div class="bn-detail">'+e.detail+'</div>'
        +(ev?'<div class="bn-evidence">Evidence: '+ev+'</div>':'');
      countEl.textContent=(i+1)+' / '+eras.length;
      prevBtn.disabled=(i===0); nextBtn.disabled=(i===eras.length-1);
    }
    for(var k=0;k<stops.length;k++){ (function(btn){ btn.addEventListener('click',function(){ paint(+btn.dataset.i); }); })(stops[k]); }
    prevBtn.addEventListener('click',function(){ paint(R._step-1); });
    nextBtn.addEventListener('click',function(){ paint(R._step+1); });
    paint(R._step);
  }
  function renderTicker(){
    var host=document.getElementById('ov-ticker'); if(!host) return;
    var feed=(DATA&&(DATA.feed||(DATA.topStory?[DATA.topStory]:[])))||[];
    if(!feed.length){ host.style.display='none'; return; }
    host.style.display='';
    var tagColor={GRID:'#e5534b',CAPITAL:'#39d98a',BUILDOUT:'#58a6ff',TOKENS:'#e3b341'};
    host.innerHTML=feed.slice(0,3).map(function(it){
      var tag=(it.tag||it.section||'SIGNAL').toUpperCase();
      var head=it.headline||it.title||it.text||'';
      var src=it.src?(it.url?' <span class="ov-src">— <a href="'+it.url+'" target="_blank" rel="noopener">'+it.src+'</a></span>'
                            :' <span class="ov-src">— '+it.src+'</span>'):'';
      return '<div class="ov-tick"><time>'+(it.date||'')+'</time>'
        +'<span class="ov-tag" style="color:'+(tagColor[tag]||'#8b97a3')+'">'+tag+'</span>'
        +'<span>'+head+(it.why?' — <span class="ov-why">'+it.why+'</span>':'')+src+'</span></div>';
    }).join('');
  }

  function ensureD3(cb){
    if(window.d3&&window.topojson) return cb();   // dashboard already bundles d3 + topojson -> no-op
    function add(src,next){var s=document.createElement('script');s.src=src;s.onload=next;s.onerror=next;document.head.appendChild(s);}
    add('https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js',function(){
      add('https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js',cb);
    });
  }

  // Fallback seed only used if DATA.markets is absent; coords real, constraint illustrative.
  var DEFAULT_MARKETS=[
    {name:'Northern Virginia (Ashburn)',lat:39.04,lon:-77.49,constraint:95,pipelineGW:8,tag:'power constrained',note:'largest inventory; queues saturated'},
    {name:'Silicon Valley (Santa Clara)',lat:37.35,lon:-121.95,constraint:90,pipelineGW:2.5,tag:'vacancy tight',note:'priciest power; little land'},
    {name:'Phoenix',lat:33.45,lon:-112.07,constraint:82,pipelineGW:4,tag:'power + water limited'},
    {name:'Atlanta',lat:33.75,lon:-84.39,constraint:80,pipelineGW:6,tag:'pipeline-heavy'},
    {name:'Dallas–Fort Worth',lat:32.78,lon:-96.80,constraint:70,pipelineGW:4,tag:'pipeline-heavy'},
    {name:'Chicago',lat:41.85,lon:-87.65,constraint:68,pipelineGW:2.5,tag:'vacancy tight'},
    {name:'Abilene TX (Stargate)',lat:32.45,lon:-99.73,constraint:42,pipelineGW:5,tag:'build-ready',note:'on-site generation'},
    {name:'Richland Parish LA (Meta Hyperion)',lat:32.42,lon:-91.76,constraint:38,pipelineGW:5,tag:'build-ready · nuclear deal'}
  ];
  // Normalize the dashboard's DATA.markets (type/pipeline-MW/status) to the map's schema.
  function ovMarkets(){
    var src=(DATA&&DATA.markets&&DATA.markets.length)?DATA.markets:DEFAULT_MARKETS;
    return src.map(function(m){
      if(m.constraint!=null) return m;
      var c=m.type==='constrained'?92:(m.type==='growth'?66:46);
      return {name:m.name,lat:m.lat,lon:m.lon,constraint:c,
        pipelineGW:(m.pipelineGW!=null?m.pipelineGW:(m.pipeline?Math.round(m.pipeline/1000):1)),
        tag:m.tag||m.status||m.type,note:m.note};
    });
  }

  function renderConstraintMap(){
    var host=document.getElementById('ov-stage'); if(!host) return;
    host.innerHTML='<div id="ov-map" style="position:relative"></div>'
      +'<div class="ov-maplegend"><span><i style="background:#39d98a"></i>build-ready</span>'
      +'<span><i style="background:#e3b341"></i>tightening</span>'
      +'<span><i style="background:#e5534b"></i>power constrained</span>'
      +'<span style="margin-left:auto">bubble = pipeline GW · click = open Buildout · constraint modeled</span></div>'
      +'<ul class="ov-sr" id="ov-srlist"></ul>'
      +'<div class="ov-tip" id="ov-tip"></div>';
    var reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
    var markets=ovMarkets();
    document.getElementById('ov-srlist').innerHTML=markets.map(function(m){
      return '<li>'+m.name+': '+m.tag+', constraint '+m.constraint+' of 100.</li>';}).join('');
    ensureD3(function(){
      if(!window.d3||!window.topojson){host.querySelector('#ov-map').innerHTML=
        '<p style="color:var(--ov-muted);font-size:13px">Map needs a connection to load US topology.</p>';return;}
      var W=900,H=500, tip=document.getElementById('ov-tip'), mapEl=document.getElementById('ov-map');
      var svg=d3.select(mapEl).append('svg').attr('viewBox','0 0 '+W+' '+H).attr('width','100%')
        .attr('role','img').attr('aria-label','US data-center markets shaded by power-constraint severity');
      var proj=d3.geoAlbersUsa().scale(1150).translate([W/2,H/2]); var path=d3.geoPath(proj);
      var color=function(s){return s>=75?'#e5534b':s>=55?'#e3b341':'#39d98a';};
      var R=function(g){return 5+Math.sqrt(g||1)*3.2;};
      d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json').then(function(us){
        svg.append('g').selectAll('path')
          .data(topojson.feature(us,us.objects.states).features).join('path')
          .attr('d',path).attr('fill','#11161b').attr('stroke','#2a3543').attr('stroke-width',0.6);
        var pts=markets.map(function(m){var xy=proj([m.lon,m.lat]);return xy?{m:m,x:xy[0],y:xy[1]}:null;}).filter(Boolean);
        var g=svg.append('g');
        if(!reduce){ g.selectAll('circle.ring').data(pts.filter(function(p){return p.m.constraint>=88;}))
          .join('circle').attr('cx',function(p){return p.x}).attr('cy',function(p){return p.y})
          .attr('r',6).attr('fill','none').attr('stroke','#e5534b').attr('stroke-width',1.2)
          .each(function(){var c=this;
            var a=document.createElementNS('http://www.w3.org/2000/svg','animate');
            a.setAttribute('attributeName','r');a.setAttribute('values','6;16;6');a.setAttribute('dur','2.4s');a.setAttribute('repeatCount','indefinite');c.appendChild(a);
            var o=document.createElementNS('http://www.w3.org/2000/svg','animate');
            o.setAttribute('attributeName','stroke-opacity');o.setAttribute('values','.7;0;.7');o.setAttribute('dur','2.4s');o.setAttribute('repeatCount','indefinite');c.appendChild(o);});
        }
        g.selectAll('circle.mkt').data(pts).join('circle').attr('class','mkt')
          .attr('cx',function(p){return p.x}).attr('cy',function(p){return p.y})
          .attr('r',function(p){return R(p.m.pipelineGW)})
          .attr('fill',function(p){return color(p.m.constraint)}).attr('fill-opacity',.85)
          .attr('stroke','#0a0d10').attr('stroke-width',1).style('cursor','pointer')
          .on('mousemove',function(e,p){var b=mapEl.getBoundingClientRect();
            tip.style.left=(e.clientX-b.left)+'px';tip.style.top=(e.clientY-b.top)+'px';tip.style.opacity=1;
            tip.innerHTML='<b>'+p.m.name+'</b> · '+p.m.constraint+'/100'
              +'<span class="s">'+p.m.tag+(p.m.note?' — '+p.m.note:'')
              +(p.m.pipelineGW?' ('+p.m.pipelineGW+' GW pipeline)':'')+'</span>';})
          .on('mouseleave',function(){tip.style.opacity=0;})
          .on('click',function(e,p){location.hash='#buildout';});
      }).catch(function(){mapEl.innerHTML='<p style="color:var(--ov-muted);font-size:13px">Could not load US topology.</p>';});
    });
  }

  function setHero(which){
    try{localStorage.setItem('ov-hero',which);}catch(e){}
    document.querySelectorAll('.ov-toggle button').forEach(function(b){
      var on=b.dataset.h===which; b.classList.toggle('on',on); b.setAttribute('aria-selected',on);});
    if(which==='map') renderConstraintMap(); else renderPowerWall();
  }
  function initOverview(){
    var tog=document.querySelector('.ov-toggle');
    if(tog&&!tog._wired){ tog._wired=true;
      tog.querySelectorAll('button').forEach(function(b){
        b.addEventListener('click',function(){setHero(b.dataset.h);});});
    }
    var saved='wall'; try{saved=localStorage.getItem('ov-hero')||'wall';}catch(e){}
    setHero(saved);
    renderBottleneckTimeline(); renderBriefing(); renderFeedFreshness();
  }

  /* ----- Players tab: entity index (Wave 2) -----
     Pure JOIN layer: DATA.players holds identity + tier-tagged constraint one-liners only;
     every number below is read at render time from its home dataset (companyCapex,
     overcommitment, projects.json, circularFinancing, cfConcentration, the tagged feed) so
     no figure ever has a second copy that can drift. Rebuilt on every call (cheap HTML). */
  function renderPlayers() {
    const host = $("playersCards");
    if (!host || !Array.isArray(DATA.players)) return;
    const cc = DATA.companyCapex || { companies: [], values: [] };
    const oc = (DATA.overcommitment && DATA.overcommitment.ops) || [];
    const cf = (DATA.circularFinancing && DATA.circularFinancing.edges) || [];
    const conc = DATA.cfConcentration || {};
    const pj = (DATA.projects && Array.isArray(DATA.projects.records)) ? DATA.projects.records : null;
    const feed = DATA.feed || [];
    const tierCls = t => t === "primary" ? "ok" : (t === "analyst" ? "warn" : "crit");
    host.innerHTML = DATA.players.map(p => {
      const rows = [];
      // 2026 capex guidance (headline set on Capital)
      const ci = cc.companies.findIndex(n => p.aliases.indexOf(n) !== -1);
      if (ci !== -1) rows.push('<div class="pl-stat">2026 capex guide <a href="#capital:coCapexChart"><b>$' + cc.values[ci] + 'B</b></a></div>');
      // Commitment book (filing-grade)
      const o = oc.find(x => x.sym === p.sym);
      if (o) {
        const total = (o.leasesCommenced || 0) + (o.leasesNotCommenced || 0) + (o.purchase || 0) + (o.construction || 0);
        rows.push('<div class="pl-stat">Pre-committed <a href="#capital:overcommitmentBoard"><b>$' + Math.round(total) + 'B ≈ ' + (total / o.ocf).toFixed(1) + ' yrs of OCF</b></a></div>');
      }
      // Named-project ledger (announced targets; graveyard split out)
      if (pj) {
        const mine = pj.filter(r => p.aliases.some(a => (r.operator || "").indexOf(a) !== -1));
        const live = mine.filter(r => GRAVEYARD_STATUSES.indexOf(r.status) === -1);
        const dead = mine.length - live.length;
        const mw = live.reduce((s, r) => s + (r.capacity_mw || 0), 0);
        if (mine.length) rows.push('<div class="pl-stat">Ledger <a href="#buildout"><b>' + live.length + ' build' + (live.length === 1 ? "" : "s") + (mw ? ' · ' + (mw / 1000).toFixed(1) + ' GW announced' : '') + '</b></a>' + (dead ? ' <span class="cf-tier cf-warn" title="stalled / paused / cancelled records in the Graveyard">' + dead + ' shelved</span>' : '') + '</div>');
      }
      // Counterparty edges + filed concentration reads
      if (p.cfNode) {
        const outN = cf.filter(e => e.from === p.cfNode).length, inN = cf.filter(e => e.to === p.cfNode).length;
        if (outN + inN) rows.push('<div class="pl-stat">Counterparty edges <a href="#capital"><b>' + outN + ' out · ' + inN + ' in</b></a>' + ((conc[p.cfNode] || []).length ? ' · ' + conc[p.cfNode].length + ' filed reads' : '') + '</div>');
      }
      // Latest tagged signal from the weekly feed
      const sig = feed.find(it => (it.players || []).indexOf(p.sym) !== -1);
      const sigHtml = sig ? '<div class="pl-signal"><b>' + (sig.date || "") + '</b> · ' + sig.text.slice(0, 150) + (sig.text.length > 150 ? "…" : "") + ' <span class="stack-src">— ' + (sig.src || "") + '</span></div>' : "";
      return '<div class="pl-card">' +
        '<div class="pl-head"><span class="brand-mark b-' + (p.brand || "other") + '">' + p.name.charAt(0) + '</span><span class="pl-name">' + p.name + '</span><span class="pl-cls">' + p.cls + '</span></div>' +
        '<div class="pl-stats">' + rows.join("") + '</div>' +
        '<div class="pl-constraint"><span class="pl-klabel">Constraint read</span>' + p.constraint.text +
        ' <span class="cf-tier cf-' + tierCls(p.constraint.tier) + '" title="' + tierTitle(p.constraint.tier) + '">' + p.constraint.tier + '</span></div>' +
        sigHtml + '</div>';
    }).join("");
  }

  function renderPlayerFeed() {
    const host = $("playerFeed");
    if (!host) return;
    const feed = (DATA.feed || []).filter(it => (it.players || []).length);
    if (!feed.length) { host.innerHTML = '<div class="note">No player-tagged items in the current feed.</div>'; return; }
    host.innerHTML = feed.map(it =>
      '<div class="pf-row"><span class="pf-chips">' + it.players.map(s => '<span class="pf-chip">' + s + '</span>').join("") + '</span>' +
      '<span>' + it.text + ' <span class="stack-src">— ' + (it.src || "") + '</span></span></div>').join("");
  }

  /* ----- Capability manifest (region maturity gating) -----
     REGION_CONFIG.capabilities maps a tab/card key -> bool. A MISSING key defaults to
     ENABLED (back-compat: the US config sets everything true, so all of this is a no-op
     there). A key set false does NOT silently hide content — it marks the tab "soon" and
     renders an honest "not yet tracked" placeholder + a contribute link, so a sparse
     geography launches lean and fills in as data matures, never faking parity. */
  const CAPS = (typeof REGION_CONFIG !== "undefined" && REGION_CONFIG.capabilities) || {};
  function capEnabled(key) { return CAPS[key] !== false; }   // default-on; only explicit false disables

  function capPlaceholderHTML(label) {
    const brand = (typeof REGION_CONFIG !== "undefined" && REGION_CONFIG.brand) || "this region";
    const repo  = (typeof REGION_CONFIG !== "undefined" && REGION_CONFIG.repoUrl) || "";
    const contribute = repo
      ? (' <a href="' + repo + '/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener">Contributions welcome &rarr;</a>')
      : "";
    return '<div class="cap-placeholder">' +
             '<div class="cap-ph-badge">Not yet tracked</div>' +
             '<h3>' + label + ' &mdash; no verified ' + brand + ' data yet</h3>' +
             '<p>This dataset is on the roadmap. We only publish a panel once it is backed by a ' +
             'verifiable public source &mdash; we never fabricate parity with a more mature region.' +
             contribute + '</p>' +
           '</div>';
  }
  // Inject gating styles once, and only if SOMETHING is disabled (zero footprint for the US).
  function ensureCapStyles() {
    if (document.getElementById("cap-styles")) return;
    if (!Object.keys(CAPS).some(function (k) { return CAPS[k] === false; })) return;
    const s = document.createElement("style");
    s.id = "cap-styles";
    s.textContent =
      ".tab-soon{opacity:.72}" +
      ".tab-soon::after{content:'soon';font-size:.62em;font-weight:600;letter-spacing:.04em;" +
        "text-transform:uppercase;margin-left:.4em;padding:.1em .4em;border-radius:4px;" +
        "background:var(--surface-2,#23262e);color:var(--muted,#8b93a3);vertical-align:middle}" +
      ".cap-placeholder{max-width:640px;margin:2.5rem auto;padding:1.75rem;text-align:center;" +
        "border:1px dashed var(--border,#2a2f3a);border-radius:12px;background:var(--surface,#16181d)}" +
      ".cap-ph-badge{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.06em;" +
        "text-transform:uppercase;color:var(--muted,#8b93a3);border:1px solid var(--border,#2a2f3a);" +
        "border-radius:999px;padding:.2rem .7rem;margin-bottom:.9rem}" +
      ".cap-placeholder h3{margin:.2rem 0 .6rem;font-size:1.05rem}" +
      ".cap-placeholder p{color:var(--muted,#8b93a3);font-size:.92rem;line-height:1.5;margin:0}";
    document.head.appendChild(s);
  }
  // Gate the nav + any [data-capability] cards once, at startup.
  function gateCapabilities() {
    ensureCapStyles();
    document.querySelectorAll('nav.tabs a[data-tab]').forEach(function (a) {
      if (!capEnabled(a.dataset.tab)) a.classList.add('tab-soon');     // kept clickable -> shows placeholder
    });
    document.querySelectorAll('[data-capability]').forEach(function (el) {
      if (!capEnabled(el.dataset.capability)) {
        el.innerHTML = capPlaceholderHTML(el.dataset.capLabel || el.dataset.capability);
        el.classList.add('cap-gated');
      }
    });
  }

  function renderTab(name) {
    if (renderedTabs.has(name)) return;
    renderedTabs.add(name);
    if (!capEnabled(name)) {                                            // disabled tab -> honest placeholder, skip US render fns
      const sec = document.querySelector('section.tab-content[data-tab="' + name + '"]');
      if (sec && !sec.querySelector('.cap-placeholder')) {
        const label = sec.getAttribute('data-tab-label') || (name.charAt(0).toUpperCase() + name.slice(1));
        sec.innerHTML = capPlaceholderHTML(label);
      }
      return;
    }
    if (name === "overview") {
      initOverview();
    } else if (name === "capital") {
      renderCapexSankey("all");
      renderCostStack("costStack");
      renderDeals();
      renderPlays();
      renderIrrCalculator();
      renderCapexChart();
      renderCapexAiShare();
      renderCapexTrend();
      renderCapexVsCashflow();
      renderOvercommitment();
      renderTenorClocks();
      renderVacancyChart();
      renderOfftakeCoverage();
      renderCircularFinancing("all");
      renderVerticalIntegration();
      renderPowerToRevenueYield();
    } else if (name === "buildout") {
      renderFunnel();
      renderStackLayers();
      renderSubstrateBottlenecks();
      renderOpticalRoadmap();
      renderEquipmentLeadTimes();
      renderCostStack("costStackEngineer");
      renderScorecard();
      renderLeadTimeChart();
      renderBuildoutChart();
      renderMap();
      renderMegaProjects();
      renderGraveyard();
      renderBuildabilityMovements();
      renderPhantomWaterfall();
      wirePhantomScenario();
      renderQueueChart();
      renderTimeToPower();
      renderPerfPerWattChart();
    } else if (name === "grid") {
      renderIsoTable();
      renderRegList();
      renderUtilList();
      renderDrList();
      renderDemandGapChart();
      renderRateImpactChart();
      renderPowerPriceBoard();
      renderPjmAuction();
      renderCumDeficitChart();
      renderTurbineSlots();
      renderPowerSourceMixChart();
      renderHeadroomChart();
    } else if (name === "tokens") {
      renderTokenJourney();
      renderEnergyBridge();
      renderSplitChart();
      renderTokenVolumeChart();
      renderDisclosedTokens();
      renderPriceCompressionChart();
      renderJevonsChart();
      renderCostPerTaskChart();
    } else if (name === "players") {
      renderPlayers();
      renderPlayerFeed();
    }
  }

  // Resize every chart that's currently in a visible tab. A chart created the instant a tab
  // un-hides can size to a not-yet-reflowed (0-width) container and stay blank until reload.
  function resizeVisibleCharts() {
    if (typeof _charts === "undefined") return;
    for (var id in _charts) {
      var c = _charts[id];
      if (c && c.canvas && c.canvas.offsetParent !== null && typeof c.resize === "function") {
        try { c.resize(); } catch (_) {}
      }
    }
  }
  // rAF alone is fragile here: a single frame can predate layout, and rAF is PAUSED while the
  // browser tab is backgrounded (so a chart rendered in a background tab stays 0-width). Retry
  // on timers too — both rAF and timers resume when the tab regains focus — so a chart can't get
  // stranded blank.
  function scheduleChartResize() {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(resizeVisibleCharts);
    setTimeout(resizeVisibleCharts, 160);
    setTimeout(resizeVisibleCharts, 500);
  }

  function showTab(name, anchor) {
    if (!name) name = 'overview';
    document.querySelectorAll('section.tab-content').forEach(function (s) {
      s.classList.toggle('active', s.dataset.tab === name);
    });
    document.querySelectorAll('nav.tabs a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.tab === name);
    });
    if (!anchor) window.scrollTo({ top: 0, behavior: 'instant' });
    document.title = ((typeof REGION_CONFIG !== "undefined" && REGION_CONFIG.brand) || 'US AI Infrastructure Monitor') + ' · ' + name;
    renderTab(name);
    if (typeof enhanceCharts === "function") enhanceCharts(name);   // attach data-table / export / link tools
    motionObserveAll();         // catch any cards/numbers newly rendered for this tab
    if (typeof linkifySources === "function") linkifySources(document.querySelector("section.tab-content.active"));
    // Repaint the now-visible charts after layout settles (see scheduleChartResize).
    scheduleChartResize();
    if (anchor && typeof scrollToChartAnchor === "function") scrollToChartAnchor(anchor);
  }
  // Legacy hash aliases — anyone with a /#investor bookmark from earlier WIP
  // gets routed to the right tab under the new name.
  const HASH_ALIASES = { investor: "capital", engineer: "buildout", policy: "grid" };
  // Hash grammar: "#<tab>" or deep-link "#<tab>:<canvasId>"
  function parseHash() {
    const raw = (location.hash || '#overview').slice(1);
    let [tab, anchor] = raw.split(':');
    if (HASH_ALIASES[tab]) tab = HASH_ALIASES[tab];
    return { tab: tab || 'overview', anchor: anchor || '' };
  }
  function fromHash() { return parseHash().tab; }   // back-compat for any other caller

  /* ----- Theme (dark/light) ----- */
  const THEME_KEY = (typeof REGION_CONFIG !== "undefined" && REGION_CONFIG.themeKey) || "us-dc-theme";
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }
  function toggleTheme() {
    const current = localStorage.getItem(THEME_KEY) || "dark";
    const next = current === "light" ? "dark" : "light";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    // Destroy & rebuild charts so text + grid colors pick up the new theme
    if (typeof _charts !== "undefined") {
      for (const id in _charts) {
        if (_charts[id] && typeof _charts[id].destroy === "function") {
          try { _charts[id].destroy(); } catch (_) {}
        }
        delete _charts[id];
      }
      ["renderCapexChart","renderVacancyChart","renderLeadTimeChart","renderBuildoutChart","renderDemandGapChart","renderRateImpactChart","renderTokenVolumeChart","renderPriceCompressionChart","renderJevonsChart","renderCostPerTaskChart","renderCumDeficitChart","renderTurbineSlots","renderPowerSourceMixChart","renderPerfPerWattChart","renderHeadroomChart","renderPowerPriceBoard","renderPjmAuction","renderQueueChart","renderTimeToPower","renderCapexAiShare","renderSplitChart","renderCapexTrend","renderCapexVsCashflow","renderOvercommitment","renderTenorClocks","renderFunnel"].forEach(fn => {
        if (typeof window[fn] === "function") window[fn]._done = false;
        try { eval(fn)._done = false; } catch(_) {}
      });
      if (typeof renderedTabs !== "undefined" && renderedTabs.clear) renderedTabs.clear();
      // Re-trigger render for current tab
      const cur = (typeof parseHash === "function") ? parseHash().tab : (location.hash || "#overview").slice(1);
      if (typeof showTab === "function") showTab(cur);
    }
  }
  applyTheme(localStorage.getItem(THEME_KEY) || "dark");
  (function () {
    const btn = document.getElementById("themeToggle");
    if (btn) btn.addEventListener("click", toggleTheme);
  })();

  /* ----- Brand monograms (operator logos) — sourced from REGION_CONFIG.operators ----- */
  const BRAND_DEFS = (typeof REGION_CONFIG !== "undefined" && REGION_CONFIG.operators) ? REGION_CONFIG.operators : {};
  function brandFor(key) {
    return BRAND_DEFS[key] || { brand: "other", letter: String(key).charAt(0) };
  }
  function brandMark(key) {
    const b = brandFor(key);
    return '<span class="brand-mark b-' + b.brand + '">' + b.letter + '</span>';
  }

  /* ----- Motion: scroll-triggered fade-in + animated number counters ----- */
  function animateNumber(el) {
    const target = el.getAttribute("data-target");
    if (!target) return;
    const prefix = target.startsWith("$") ? "$" : "";
    const numericTarget = parseFloat(target.replace("$", ""));
    const isInt = !target.includes(".");
    const duration = 1400;
    const t0 = performance.now();
    function step(now) {
      const t = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);  // easeOutCubic
      const current = numericTarget * eased;
      el.textContent = prefix + (isInt ? Math.round(current) : current.toFixed(1));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  let _fadeObserver = null, _numObserver = null;
  function motionObserveAll() {
    if (!("IntersectionObserver" in window)) return;
    if (!_fadeObserver) {
      _fadeObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            _fadeObserver.unobserve(e.target);
          }
        });
      }, { threshold: 0.05, rootMargin: "0px 0px -20px 0px" });
    }
    if (!_numObserver) {
      _numObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && e.target.hasAttribute("data-target")) {
            animateNumber(e.target);
            _numObserver.unobserve(e.target);
          }
        });
      }, { threshold: 0.3 });
    }
    // Fade-in candidates — apply class only once each, then observe
    document.querySelectorAll(
      ".stub-card, .so-what, .hero-headline, .persona-picker a"
    ).forEach(function (el) {
      if (!el.classList.contains("fade-init")) {
        el.classList.add("fade-init");
        _fadeObserver.observe(el);
      }
    });
    // Number counters — observe any not-yet-observed targets
    document.querySelectorAll(".num[data-target]").forEach(function (el) {
      _numObserver.observe(el);
    });
  }

  gateCapabilities();           // mark disabled tabs "soon" + placeholder gated cards (no-op when all caps on)
  (function () { const h = parseHash(); showTab(h.tab, h.anchor); })();   // initial activation also renders the active tab
  motionObserveAll();           // wire up fade-ins + KPI counters
  hydrate();                    // pull live public-data feeds (data/*.json); additive + graceful
  window.addEventListener('hashchange', function () { const h = parseHash(); showTab(h.tab, h.anchor); });
  // If the page rendered/updated while backgrounded (rAF + timers throttled), charts can be
  // left at 0-width; repaint the visible ones once the tab regains focus.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleChartResize(); });
