// Per-region configuration for the AI Infrastructure Monitor template.
// The engine reads `REGION_CONFIG`; each geography ships its own config.js (the US is the
// reference implementation). Keep this LEAN — region identity/config only; large arrays
// (projects, ISO/rate tables, time-series) live in data/, never here.
//
// Loaded before the main script (see the <script src="config.js"> tag in index.html <head>),
// so REGION_CONFIG is defined when the engine runs.
const REGION_CONFIG = {
  id: "us",
  brand: "US AI Infrastructure Monitor",
  repoUrl: "https://github.com/vijay-sachdeva/us-ai-infra",
  liveUrl: "https://vijay-sachdeva.github.io/us-ai-infra",
  themeKey: "us-dc-theme",
  // Live chat backend (Cloudflare Worker → Anthropic). Set null to disable chat for a region.
  chatEndpoint: "https://datacenter-monitor-chat.vijaysachdeva.workers.dev",

  // Capability manifest — which tabs/datasets this geography actually has data for. The US
  // has everything; a sparser geography sets fields false so the engine hides that tab/card
  // and shows an honest "not yet tracked" placeholder (never fakes parity). Defined now;
  // enforced in the engine-extraction increment.
  capabilities: {
    overview: true, capital: true, buildout: true, grid: true, tokens: true, players: true,
    map: true, projects: true, gridFeeds: true, queues: true, rateImpacts: true, connections: true
  },

  // Live public-data feeds this region publishes (data/<feed>.json) + their short source labels.
  feeds: ["grid", "power_econ", "queues", "siting", "projects", "sources", "sec_filings", "connections"],
  feedMeta: { grid: "EIA-930/860", power_econ: "EIA-861 prices", queues: "LBNL queue", siting: "Modeled siting", sec_filings: "SEC EDGAR", connections: "Curated links" },

  // Operator monograms: ticker / company-name -> { brand, letter }. Region-specific operators.
  operators: {
    AMZN: { brand: "aws",       letter: "a" },
    MSFT: { brand: "microsoft", letter: "M" },
    GOOGL:{ brand: "google",    letter: "G" },
    META: { brand: "meta",      letter: "M" },
    ORCL: { brand: "oracle",    letter: "O" },
    CRWV: { brand: "coreweave", letter: "C" },
    NBIS: { brand: "nebius",    letter: "N" },
    APLD: { brand: "applied",   letter: "A" },
    NVDA: { brand: "nvidia",    letter: "N" },
    "Google":    { brand: "google",    letter: "G" },
    "Microsoft": { brand: "microsoft", letter: "M" },
    "Meta":      { brand: "meta",      letter: "M" },
    "Crusoe":    { brand: "other",     letter: "C" }
  }
};
