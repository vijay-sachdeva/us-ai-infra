/* ============================================================
   US AI Infrastructure Monitor — chat backend
   Cloudflare Worker that proxies the dashboard's chat assistant
   to the Anthropic API. The API key is stored as a Worker secret
   and is NEVER placed in this file or in the public dashboard.

   Uses Anthropic prompt caching so the system prompt (dashboard
   data) is reused at ~10% cost on repeat queries within 5 minutes.

   ------------------------------------------------------------
   ONE-TIME SETUP (you do this — the Cloudflare account, key and
   deploy steps cannot be automated for you):

   OPTION A — Cloudflare web UI (easier, no Node required):
   1. Sign in at https://dash.cloudflare.com
   2. Workers & Pages → Create → "Hello World" → name it
      `datacenter-monitor-chat`.
   3. After it deploys, open the worker → "Quick edit" → replace
      the code with the contents of this file → Save and deploy.
   4. In the worker's Settings → Variables → Environment Variables,
      add a new SECRET named `ANTHROPIC_API_KEY` with your Anthropic
      key from https://console.anthropic.com.
   5. Copy the deployed URL (e.g.
      `https://datacenter-monitor-chat.<your-subdomain>.workers.dev`)
      and paste it into CHAT_CONFIG.apiEndpoint in v2/index.html.
   6. Set a low billing limit in your Anthropic console (e.g. $10/mo)
      so public traffic cannot surprise you.

   OPTION B — Wrangler CLI (requires Node.js):
   1. `npm install -g wrangler`
   2. `wrangler login`
   3. `wrangler secret put ANTHROPIC_API_KEY` (paste key when prompted)
   4. `wrangler deploy`

   AFTER LAUNCH — security hardening:
   Once your dashboard is at a known URL, set ALLOWED_ORIGIN below
   to that URL (e.g. `https://vijay-sachdeva.github.io`) and redeploy.
   That prevents other sites from using your key.
   ------------------------------------------------------------ */

const ALLOWED_ORIGIN  = "*";                         // tighten to your site URL once live
const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929"; // good default; swap to haiku for ~10× cheaper
const MAX_TOKENS      = 500;
const MAX_QUESTION    = 1000;
const MAX_CONTEXT     = 12000;
const MAX_HISTORY     = 6;       // turns of prior conversation to keep

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age":       "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Use POST." }, 405, cors);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: "Server is missing ANTHROPIC_API_KEY secret." }, 500, cors);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return jsonResponse({ error: "Invalid JSON body." }, 400, cors);
    }

    const question = String(payload.question || "").slice(0, MAX_QUESTION).trim();
    if (!question) {
      return jsonResponse({ error: "Empty question." }, 400, cors);
    }
    const context = String(payload.context || "").slice(0, MAX_CONTEXT);
    const historyRaw = Array.isArray(payload.history) ? payload.history.slice(-MAX_HISTORY * 2) : [];

    // Build messages array — strictly user/assistant turns.
    const messages = [];
    for (const m of historyRaw) {
      if (!m || !m.role || !m.content) continue;
      const role = m.role === "user" ? "user" : "assistant";
      messages.push({ role, content: String(m.content).slice(0, 2000) });
    }
    messages.push({ role: "user", content: question });

    // System prompt — sent as a cache-control'd block so the dashboard data
    // body is cached for ~5 min, costing ~10% on repeat queries.
    const systemText =
      "You are the assistant for the US AI Infrastructure Monitor — a dashboard tracking " +
      "US data center power demand, capital spending, deployment geography and the " +
      "bottlenecks holding the build-out back.\n\n" +
      "Rules:\n" +
      "- Answer ONLY from the dashboard data provided below. If a question is outside " +
      "this data, say so briefly rather than guessing.\n" +
      "- Be concise — typically 2-5 sentences. Bullet lists are fine for comparisons.\n" +
      "- Factual and neutral tone. No investment advice. No speculation.\n" +
      "- When you cite a number, mention the unit (GW, MW, $B, $/kW, etc.).\n" +
      "- If asked which tab to look at, point users to the right persona view " +
      "(Overview / Investor / Engineer / Energy & Policy / Token Economics).\n\n" +
      "DASHBOARD DATA:\n" + context;

    let aiRes;
    try {
      aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":       "application/json",
          "x-api-key":          env.ANTHROPIC_API_KEY,
          "anthropic-version":  "2023-06-01"
        },
        body: JSON.stringify({
          model:      ANTHROPIC_MODEL,
          max_tokens: MAX_TOKENS,
          system: [
            { type: "text", text: systemText, cache_control: { type: "ephemeral" } }
          ],
          messages
        })
      });
    } catch (e) {
      return jsonResponse({ error: "Could not reach Anthropic." }, 502, cors);
    }

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      return jsonResponse(
        { error: "Anthropic returned an error.", status: aiRes.status, detail: detail.slice(0, 300) },
        502,
        cors
      );
    }

    const data = await aiRes.json();
    let answer = "";
    if (data && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block && block.type === "text" && block.text) answer += block.text;
      }
    }
    answer = answer.trim() || "No answer was returned.";

    return jsonResponse({
      answer,
      usage: data && data.usage ? data.usage : null   // optional: surfaces cache hits etc.
    }, 200, cors);
  }
};

function jsonResponse(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ "Content-Type": "application/json" }, cors)
  });
}
