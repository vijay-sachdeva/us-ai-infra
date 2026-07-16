#!/usr/bin/env python3
"""Daily news refresh for the US AI Infrastructure Monitor dashboard.

Asks Claude (via Anthropic API, with web search) to identify fresh US
AI-infrastructure news and updates three fields in **data/current.json** — the
live headline/news layer the front-end overlays onto its inline `DATA`:
  * lastUpdated:  YYYY-MM-DD
  * topStory:     { date, text, src, url } — the prominent news banner
  * feed:         up to 3 new items/day prepended (validated per-item; capped)

Selection is MAGNITUDE-FIRST over the past week (freshness breaks ties), with a
significance floor so a minor 8-K never holds the banner over a $10B+ story.
Scope covers the full AI-infra stack: data centers AND the chips/memory/fab
supply chain (Micron, TSMC, SK hynix, ...), power/grid, and capital markets.

If a refresh already ran today, later runs do a SECOND LOOK instead of exiting:
swap only for a materially bigger same-day story (catches morning-ET
announcements the early run missed — e.g. Micron's $250B on 2026-07-09).

This edits a small JSON file (a clean load/modify/write), NOT index.html — so the
daily job never mutates the 6,000-line HTML (no risk of truncation/clobber). The
front-end's hydrate() fetches data/current.json and overlays it; if the fetch
fails, the inline DATA is the graceful fallback.

Safety: validates the model's JSON shape and the date format; on any anomaly it
falls back to a date-bump-only edit so the refresh still advances `lastUpdated`
rather than crashing the workflow. Feed items are validated individually —
a bad item is skipped, never aborts the run.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


# -------------------- configuration --------------------

CURRENT_JSON = Path("data/current.json")

MODEL = "claude-sonnet-4-5-20250929"
MAX_TOKENS = 8192
WEB_SEARCH_MAX_USES = 10   # enough for the 5 mandated beat searches + follow-ups

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TOP_STORY_KEYS = ("date", "text", "src", "url")
FEED_ITEM_KEYS = ("date", "tag", "text", "src", "url")
FEED_TAGS = {"BUILDOUT", "GRID", "CAPITAL", "SUPPLY", "POLICY", "COMPUTE"}
FEED_MAX = 12              # hard cap on feed length after prepends
FEED_ADDS_MAX = 3          # max new feed items accepted per run


# -------------------- prompt --------------------

def build_prompt(last_updated: str | None, top_story_json: str, today_iso: str,
                 feed_summary: str, second_look: bool = False) -> str:
    second_look_block = """
SECOND LOOK — a refresh already ran earlier today and selected the story below.
Swap ONLY if you find a MATERIALLY BIGGER story published today or since this morning
(clearly higher magnitude — e.g. a $10B+/multi-hundred-MW announcement vs a smaller one).
A same-size lateral move is NOT worth a swap: return topStory null. feedAdds are still
welcome if genuinely new and material.
""" if second_look else ""
    return f"""You are doing the daily news refresh for the US AI Infrastructure Monitor dashboard
at https://vijay-sachdeva.github.io/us-ai-infra/.

GOAL
Identify significant US AI-INFRASTRUCTURE news from roughly the past 7 days — data centers AND the
supply chain that feeds them (chips, memory/HBM, fabs, advanced packaging), power/grid, and AI-infra
capital markets — and decide whether to update three fields:
  - lastUpdated:   YYYY-MM-DD date
  - topStory:      {{ date, text, src, url }} — the prominent news banner near the top
  - feedAdds:      up to {FEED_ADDS_MAX} new items for the "Recent developments" feed

Other "news-shaped" content (e.g. the deals tracker) is curated on a quarterly cadence and is OUT OF SCOPE for this daily refresh.
{second_look_block}
SEARCH THE BEATS — run AT LEAST 5 web_search queries covering ALL of these beats before deciding
(one search per beat minimum; follow up where results look material):
  1. Hyperscaler / AI-lab data-center deals, leases, capex revisions
  2. Chips, memory/HBM, fabs, advanced packaging (Micron, TSMC, SK hynix, Samsung, Intel, NVIDIA, AMD)
  3. Power / grid / DOE / FERC / RTO actions affecting large loads
  4. AI-infra capital markets (IPOs/ADR listings, debt raises, infra funds, vendor financing)
  5. Siting, politics, regulation (state/local restrictions, taxes, rate cases)

CONSTRAINTS
- Prefer primary sources (company press releases, SEC filings, earnings calls) and credible industry outlets (Data Center Dynamics, Data Center Knowledge, Data Center Frontier, Bloomberg, Reuters, WSJ, CNBC, Fortune, S&P Global, Utility Dive).
- Avoid speculation, opinion, paywalled sources you cannot read, and generic AI-hype coverage with no concrete US AI-infrastructure hook.

ALWAYS-SIGNIFICANT SUBJECTS — a material announcement from any of these is a strong TOP STORY candidate:
- Hyperscalers: Amazon/AWS, Microsoft, Google/Alphabet, Meta, Oracle
- AI chip makers: NVIDIA, AMD; AI-native clouds: CoreWeave, Nebius, Lambda, Crusoe, Applied Digital
- Memory & fabs: Micron, SK hynix, Samsung (memory/HBM); TSMC, Intel, GlobalFoundries (foundry/packaging) — US-relevant moves (US fabs, capex plans, US listings)
- AI labs: OpenAI, Anthropic, xAI; adjacent: Tesla (Dojo), Broadcom
Other valid topics: material data-center projects (>100 MW sites, expansions, capex revisions), power/grid news (interconnection, transformers, utility deals), notable analyst reports (Goldman Sachs, CBRE, JLL, Morgan Stanley, SemiAnalysis), major M&A or regulation.

PICK THE BIGGEST LIVE STORY — magnitude first, freshness as tiebreak:
- Rank material items from the past ~7 days by disclosed magnitude ($ committed, MW, or structural significance — e.g. a new financing model, a federal grid order).
- SWAP whenever the best-ranked item beats the current topStory on magnitude, or the current topStory is older than ~5 days (then rotate to the best of the week even if smaller).
- SIGNIFICANCE FLOOR: never lead with an item below ~$1B or ~100 MW while an item above ~$10B or ~300 MW from the past week is available.
- Freshness breaks ties between comparable-magnitude items.
- Keep the current story (topStory: null) ONLY when nothing from the past ~7 days beats it on this ranking.

DO NOT FABRICATE. Every swap and every feedAdd must be a real item you found via web_search, with a real publication date and a working source URL. On a dead news day, keep the current story (null) and return no feedAdds — never invent a headline.

TODAY (UTC): {today_iso}
CURRENT lastUpdated: {last_updated}

CURRENT topStory (JSON):
```
{top_story_json}
```

CURRENT feed (summaries — do NOT re-add these stories):
{feed_summary}

OUTPUT
Return STRICTLY a single JSON object (no markdown fences, no commentary). PREFERRED shape (swap in a fresh story):

{{
  "lastUpdated": "{today_iso}",
  "topStory": {{
    "date": "Mon DD, YYYY",
    "text": "1-2 factual sentences, no opinion",
    "src": "Publication",
    "url": "https://...",
    "players": ["MSFT", "OpenAI"]
  }},
  "feedAdds": [
    {{ "date": "Mon DD, YYYY", "tag": "SUPPLY", "text": "1-2 factual sentences", "src": "Publication", "url": "https://..." }}
  ],
  "summary": "one-line description of the swap"
}}

"players" tags the companies/entities the story is ABOUT (deal participants, not passing mentions), using these canonical symbols where they apply: MSFT, AMZN, GOOGL, META, ORCL, NVDA, AMD, MU, TSM, INTC, AVGO, MRVL, WULF, OpenAI, Anthropic, xAI, CRWV, NBIS, APLD, IREN, Crusoe, SK hynix, Samsung, PJM, Dominion — otherwise a short name. Empty list if none apply.

"feedAdds" (0-{FEED_ADDS_MAX} items): material past-~7-day items NOT already in the current feed and NOT the topStory. "tag" is one of BUILDOUT, GRID, CAPITAL, SUPPLY, POLICY, COMPUTE. Every feedAdd MUST carry a real, working url. Return [] when nothing new is material — most days that is the right answer.

When keeping the current story (it still ranks biggest), return:

{{ "lastUpdated": "{today_iso}", "topStory": null, "feedAdds": [], "summary": "Kept — current story still the biggest of the week" }}

Hard rules:
- All strings MUST be valid JSON (escape embedded quotes/backslashes; no literal newlines inside strings; no trailing commas).
- "date" must be the story's real publication date; "url" must be a real link found via web_search.
- "url" must point to the publication named in "src" (or a primary source: company release, SEC filing, regulator). Never cite one outlet and link an aggregator/blog.

Begin.
"""


# -------------------- Anthropic call --------------------

def _date_bump_only(today_iso: str, reason: str) -> dict:
    return {"lastUpdated": today_iso, "topStory": None, "summary": f"Date bump only ({reason})"}


def _extract_json(text: str) -> dict | None:
    """Robustly extract a JSON object from a possibly-noisy model response."""
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for fence_pattern in (r'```json\s*(\{[\s\S]*?\})\s*```', r'```\s*(\{[\s\S]*?\})\s*```'):
        for m in re.finditer(fence_pattern, text):
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                continue
    depth, start = 0, -1
    for i, ch in enumerate(text):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            if depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    try:
                        parsed = json.loads(text[start:i + 1])
                        if isinstance(parsed, dict) and "lastUpdated" in parsed:
                            return parsed
                    except json.JSONDecodeError:
                        pass
    return None


def call_claude(prompt: str, today_iso: str) -> dict:
    from anthropic import Anthropic  # lazy import: only needed when actually calling the API
    client = Anthropic()  # ANTHROPIC_API_KEY from env
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": WEB_SEARCH_MAX_USES}],
        messages=[{"role": "user", "content": prompt}],
    )
    print(f"[refresh] stop_reason={response.stop_reason} model={response.model} blocks={len(response.content)}")
    text = "".join(b.text for b in response.content if getattr(b, "type", None) == "text").strip()
    if not text:
        print(f"[refresh] no text content (stop_reason={response.stop_reason}); date-bump only.", file=sys.stderr)
        return _date_bump_only(today_iso, f"no text; stop_reason={response.stop_reason}")
    parsed = _extract_json(text)
    if parsed is None:
        print("[refresh] JSON extraction failed; date-bump only.", file=sys.stderr)
        print(f"[refresh] raw (first 1500): {text[:1500]}", file=sys.stderr)
        return _date_bump_only(today_iso, "JSON extraction failed")
    return parsed


# -------------------- main --------------------

def main() -> int:
    today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(f"[refresh] today (UTC): {today_iso}")

    if not CURRENT_JSON.exists():
        print(f"[refresh] ERROR: {CURRENT_JSON} not found", file=sys.stderr)
        return 1
    data = json.loads(CURRENT_JSON.read_text(encoding="utf-8"))

    last_updated = data.get("lastUpdated")
    top = data.get("topStory") or {}
    feed = data.get("feed") or []
    print(f"[refresh] current lastUpdated: {last_updated}")
    # A same-day rerun is a SECOND LOOK, not a no-op: the ~06:17 ET run predates most
    # morning-ET announcements, so the later run must be able to swap in a bigger story
    # (this exact dead-end is how Micron's $250B was missed on 2026-07-09).
    second_look = last_updated == today_iso
    if second_look:
        print("[refresh] already updated today — running a SECOND LOOK (swap only for materially bigger)")

    feed_summary = "\n".join(
        f"- [{it.get('date', '?')}] ({it.get('tag', '?')}) {str(it.get('text', ''))[:110]}"
        for it in feed[:FEED_MAX]
    ) or "(empty)"
    prompt = build_prompt(last_updated, json.dumps(top, ensure_ascii=False, indent=2), today_iso,
                          feed_summary, second_look=second_look)
    print("[refresh] calling Anthropic API ...")
    try:
        edits = call_claude(prompt, today_iso)
    except Exception as e:
        print(f"[refresh] ERROR calling Claude: {e}", file=sys.stderr)
        return 1
    print("[refresh] model returned:", json.dumps(edits, ensure_ascii=False)[:800])

    # Apply: lastUpdated (validated date), then topStory only if a well-formed object was returned.
    new_date = edits.get("lastUpdated") or today_iso
    if not DATE_RE.match(str(new_date)):
        new_date = today_iso
    data["lastUpdated"] = new_date

    new_top = edits.get("topStory")
    if new_top is not None:
        if not (isinstance(new_top, dict) and all(k in new_top and isinstance(new_top[k], str) and new_top[k].strip()
                                                  for k in TOP_STORY_KEYS)):
            print("[refresh] ABORT: malformed topStory in model output — not writing.", file=sys.stderr)
            return 1
        if not str(new_top["url"]).startswith("http"):
            print("[refresh] ABORT: topStory.url is not a URL — not writing.", file=sys.stderr)
            return 1
        data["topStory"] = {k: new_top[k] for k in TOP_STORY_KEYS}
        # Optional player tags (list of short strings) — consumed by the Players tab.
        players = new_top.get("players")
        if isinstance(players, list) and all(isinstance(x, str) and 0 < len(x) <= 24 for x in players):
            data["topStory"]["players"] = players[:8]

    # feedAdds: validated PER ITEM — a bad item is skipped (never aborts the run),
    # deduped against the existing feed by url and by leading text, capped at FEED_MAX.
    adds = edits.get("feedAdds")
    if isinstance(adds, list) and adds:
        existing_urls = {str(it.get("url", "")) for it in feed if it.get("url")}
        existing_keys = {str(it.get("text", ""))[:60].lower() for it in feed}
        accepted = []
        for it in adds[:FEED_ADDS_MAX]:
            if not (isinstance(it, dict) and all(k in it and isinstance(it[k], str) and it[k].strip()
                                                 for k in FEED_ITEM_KEYS)):
                print(f"[refresh] feedAdd skipped (malformed): {str(it)[:120]}", file=sys.stderr)
                continue
            if it["tag"] not in FEED_TAGS:
                print(f"[refresh] feedAdd skipped (bad tag {it['tag']!r}): {it['text'][:80]}", file=sys.stderr)
                continue
            if not it["url"].startswith("http") or len(it["text"]) > 500:
                print(f"[refresh] feedAdd skipped (url/length): {it['text'][:80]}", file=sys.stderr)
                continue
            if it["url"] in existing_urls or it["text"][:60].lower() in existing_keys:
                print(f"[refresh] feedAdd skipped (duplicate): {it['text'][:80]}", file=sys.stderr)
                continue
            accepted.append({k: it[k] for k in FEED_ITEM_KEYS})
            existing_urls.add(it["url"]); existing_keys.add(it["text"][:60].lower())
        if accepted:
            data["feed"] = (accepted + feed)[:FEED_MAX]
            print(f"[refresh] feed: prepended {len(accepted)} item(s), length now {len(data['feed'])}")

    # newline="\n": always LF so the working tree matches the LF-normalized blob (small diffs).
    CURRENT_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"[refresh] OK: {edits.get('summary', '(no summary)')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
