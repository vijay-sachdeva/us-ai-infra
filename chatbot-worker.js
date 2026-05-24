/* ============================================================
   US AI Infrastructure Monitor — chat backend
   A Cloudflare Worker that proxies the dashboard's chat assistant
   to the OpenAI API. The API key is stored as a Worker secret and
   is NEVER placed in this file or in the public dashboard.

   ------------------------------------------------------------
   ONE-TIME SETUP (you do this — it cannot be done for you):

   1. Create a free Cloudflare account, then install Wrangler:
        npm install -g wrangler
        wrangler login

   2. Get an OpenAI API key at platform.openai.com.
      IMPORTANT: in OpenAI Billing -> Limits, set a low monthly
      usage cap (e.g. $5-10) so public traffic cannot surprise you.

   3. Keep this file and wrangler.toml together in a folder.

   4. Store the key as a secret (it is encrypted, not in code):
        wrangler secret put OPENAI_API_KEY
      Paste the key when prompted.

   5. Deploy:
        wrangler deploy

   6. Copy the deployed URL, e.g.
        https://datacenter-monitor-chat.<your-subdomain>.workers.dev
      and paste it into CHAT_CONFIG.apiEndpoint in index.html.

   7. Once the dashboard is live, lock ALLOWED_ORIGIN below to your
      published URL (e.g. "https://<you>.github.io") and redeploy.
   ------------------------------------------------------------ */

const ALLOWED_ORIGIN = "*";          // set to your dashboard URL once live
const OPENAI_MODEL = "gpt-4o-mini";  // cheap + capable; change if you like
const MAX_TOKENS = 500;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Use POST." }, 405, cors);
    }
    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ error: "Server is missing OPENAI_API_KEY secret." }, 500, cors);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return jsonResponse({ error: "Invalid JSON body." }, 400, cors);
    }

    const question = String(payload.question || "").slice(0, 1000).trim();
    if (!question) {
      return jsonResponse({ error: "Empty question." }, 400, cors);
    }
    const context = String(payload.context || "").slice(0, 6000);
    const history = Array.isArray(payload.history) ? payload.history.slice(-8) : [];

    const messages = [
      {
        role: "system",
        content:
          "You are the assistant for the US AI Infrastructure Monitor, a dashboard " +
          "tracking AI data center power demand, capex, deployment geography and " +
          "infrastructure bottlenecks. Answer only from the dashboard data provided " +
          "below. Be concise, factual and neutral. If a question goes beyond this " +
          "data, say so briefly rather than guessing. Do not give investment advice.\n\n" +
          "DASHBOARD DATA:\n" + context
      }
    ];
    for (const m of history) {
      if (m && m.role && m.content) {
        messages.push({
          role: m.role === "user" ? "user" : "assistant",
          content: String(m.content).slice(0, 2000)
        });
      }
    }
    messages.push({ role: "user", content: question });

    let aiRes;
    try {
      aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + env.OPENAI_API_KEY
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: messages,
          temperature: 0.3,
          max_tokens: MAX_TOKENS
        })
      });
    } catch (e) {
      return jsonResponse({ error: "Could not reach OpenAI." }, 502, cors);
    }

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      return jsonResponse(
        { error: "OpenAI returned an error.", status: aiRes.status, detail: detail.slice(0, 300) },
        502,
        cors
      );
    }

    const data = await aiRes.json();
    const answer =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? String(data.choices[0].message.content || "").trim()
        : "No answer was returned.";

    return jsonResponse({ answer: answer }, 200, cors);
  }
};

function jsonResponse(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, cors)
  });
}
