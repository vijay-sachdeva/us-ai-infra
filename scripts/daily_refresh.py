#!/usr/bin/env python3
"""Daily news refresh for the US AI Infrastructure Monitor dashboard.

Asks Claude (via Anthropic API, with web search) to identify fresh US AI
data-center news and updates two fields in **data/current.json** — the live
headline/news layer the front-end overlays onto its inline `DATA`:
  * lastUpdated:  YYYY-MM-DD
  * topStory:     { date, text, src, url } — the prominent news banner

This edits a small JSON file (a clean load/modify/write), NOT index.html — so the
daily job never mutates the 6,000-line HTML (no risk of truncation/clobber). The
front-end's hydrate() fetches data/current.json and overlays it; if the fetch
fails, the inline DATA is the graceful fallback.

Safety: validates the model's JSON shape and the date format; on any anomaly it
falls back to a date-bump-only edit so the refresh still advances `lastUpdated`
rather than crashing the workflow.
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
WEB_SEARCH_MAX_USES = 5

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TOP_STORY_KEYS = ("date", "text", "src", "url")


# -------------------- prompt --------------------

def build_prompt(last_updated: str | None, top_story_json: str, today_iso: str) -> str:
    return f"""You are doing the daily news refresh for the US AI Infrastructure Monitor dashboard
at https://vijay-sachdeva.github.io/us-ai-infra/.

GOAL
Identify significant US AI data-center news from roughly the past 24-72 hours and decide whether to update two fields:
  - lastUpdated:   YYYY-MM-DD date
  - topStory:      {{ date, text, src, url }} — the prominent news banner near the top

Other "news-shaped" content (e.g. the deals tracker) is curated on a quarterly cadence and is OUT OF SCOPE for this daily refresh.

CONSTRAINTS
- Use the web_search tool to find fresh news. Prefer primary sources (company press releases, SEC filings, earnings calls) and credible industry outlets (Data Center Dynamics, Data Center Knowledge, Data Center Frontier, Bloomberg, Reuters, WSJ, CNBC, Fortune, S&P Global, Utility Dive).
- Avoid speculation, opinion, paywalled sources you cannot read, and generic AI-hype coverage with no concrete US data-center hook.

ALWAYS-SIGNIFICANT SUBJECTS — a material announcement from any of these is a strong TOP STORY candidate:
- Hyperscalers: Amazon/AWS, Microsoft, Google/Alphabet, Meta, Oracle
- AI chip makers: NVIDIA, AMD; AI-native clouds: CoreWeave, Nebius, Lambda, Crusoe, Applied Digital
- AI labs: OpenAI, Anthropic, xAI; adjacent: Tesla (Dojo), Broadcom
Other valid topics: material data-center projects (>100 MW sites, expansions, capex revisions), power/grid news (interconnection, transformers, utility deals), notable analyst reports (Goldman Sachs, CBRE, JLL, Morgan Stanley, SemiAnalysis), major M&A or regulation.

ROTATE FOR FRESHNESS — this is the DEFAULT behavior:
- If you find ANY material US AI-infra item dated MORE RECENTLY than the current topStory's date, SWAP to the freshest such item — recency beats magnitude.
- If the current topStory is more than ~3 days old, you MUST swap to the best material item from the past ~7 days.
- Keep the current story (topStory: null) ONLY when, after searching, you genuinely found nothing dated more recently — OR the current topStory is itself from the last ~2 days and is clearly the single biggest live story.

DO NOT FABRICATE. Every swap must be a real item you found via web_search, with a real publication date and a working source URL. On a dead news day, keep the current story (null) — never invent a headline.

TODAY (UTC): {today_iso}
CURRENT lastUpdated: {last_updated}

CURRENT topStory (JSON):
```
{top_story_json}
```

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
  "summary": "one-line description of the swap"
}}

"players" tags the companies/entities the story is ABOUT (deal participants, not passing mentions), using these canonical symbols where they apply: MSFT, AMZN, GOOGL, META, ORCL, NVDA, AMD, OpenAI, Anthropic, xAI, CRWV, NBIS, APLD, IREN, Crusoe, PJM, Dominion — otherwise a short name. Empty list if none apply.

ONLY on a genuinely dead news day, return the keep-current shape:

{{ "lastUpdated": "{today_iso}", "topStory": null, "summary": "Date bump only — no fresher story than current" }}

Hard rules:
- All strings MUST be valid JSON (escape embedded quotes/backslashes; no literal newlines inside strings; no trailing commas).
- "date" must be the story's real publication date; "url" must be a real link found via web_search.

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
    print(f"[refresh] current lastUpdated: {last_updated}")
    if last_updated == today_iso:
        print("[refresh] already updated today — exiting cleanly with no change")
        return 0

    prompt = build_prompt(last_updated, json.dumps(top, ensure_ascii=False, indent=2), today_iso)
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

    # newline="\n": always LF so the working tree matches the LF-normalized blob (small diffs).
    CURRENT_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"[refresh] OK: {edits.get('summary', '(no summary)')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
