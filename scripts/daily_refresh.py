#!/usr/bin/env python3
"""Daily refresh for the US AI Infrastructure Monitor dashboard.

Asks Claude (via Anthropic API, with web search) to identify fresh US AI
data-center news, applies surgical edits to two fields inside the
`const DATA = {...}` object in index.html, and writes the file back.

Safety guards:
  * Only touches two fields: lastUpdated and topStory. (Other "news-shaped"
    fields like `deals` are curated on a quarterly cadence, not daily.)
  * Aborts (does not write) if the post-edit file size moves outside
    [95%, 110%] of the pre-edit size.
  * Aborts and reverts if `git diff --stat index.html` shows more than
    MAX_DIFF_LINES insertions+deletions.

If anything goes wrong, the script exits non-zero — the workflow's
commit step will skip when there are no changes to index.html, so a
failed run produces no commit.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from anthropic import Anthropic


# -------------------- configuration --------------------

INDEX_HTML = Path("index.html")

# Use a current Sonnet model. Update if your account has a newer one.
MODEL = "claude-sonnet-4-5-20250929"
MAX_TOKENS = 8192

# Web-search budget. Each search counts toward Anthropic's per-search cost.
WEB_SEARCH_MAX_USES = 5

# Safety bounds. A normal daily refresh adds/removes < 30 lines and moves
# the file size by < 1 KB.
MIN_SIZE_RATIO = 0.95
MAX_SIZE_RATIO = 1.10
MAX_DIFF_LINES = 30


# -------------------- parsing helpers --------------------

LAST_UPDATED_RE = re.compile(r'(?m)^\s*lastUpdated:\s*"(\d{4}-\d{2}-\d{2})"')

# topStory: { ... }  followed by a `},` — single-line or multi-line.
TOP_STORY_RE = re.compile(
    r'(?ms)^(\s*)topStory:\s*\{(.*?)\n\s*\},'
)


def extract_current_state(html: str) -> tuple[str | None, str]:
    """Return (lastUpdated, topStory_raw_block)."""
    m_last = LAST_UPDATED_RE.search(html)
    last_updated = m_last.group(1) if m_last else None

    m_top = TOP_STORY_RE.search(html)
    top_story = m_top.group(0) if m_top else ""

    return last_updated, top_story


# -------------------- prompt --------------------

def build_prompt(last_updated: str | None,
                 top_story_block: str,
                 today_iso: str) -> str:
    return f"""You are doing the daily news refresh for the US AI Infrastructure Monitor dashboard
at https://vijay-sachdeva.github.io/us-ai-infra/.

GOAL
Identify significant US AI data-center news from roughly the past 24-72 hours and decide whether to update two fields in the dashboard's DATA object:
  - lastUpdated:   YYYY-MM-DD date
  - topStory:      {{ date, text, src, url }} — the prominent news banner near the top

Other "news-shaped" fields on the dashboard (e.g. `deals`) are curated on a quarterly cadence with richer metadata and are OUT OF SCOPE for this daily refresh — do not propose changes to them.

CONSTRAINTS
- Use the web_search tool to find fresh news. Prefer primary sources (company press releases, SEC filings, earnings calls) and credible industry outlets (Data Center Dynamics, Data Center Knowledge, Data Center Frontier, Bloomberg, Reuters, WSJ, CNBC, Fortune, S&P Global, Utility Dive).
- Avoid speculation, opinion, paywalled sources you cannot read, and generic AI-hype coverage with no concrete US data-center hook.

ALWAYS-SIGNIFICANT SUBJECTS — a material announcement from any of these is a strong TOP STORY candidate:
- Hyperscalers: Amazon/AWS, Microsoft, Google/Alphabet, Meta, Oracle
- AI chip makers: NVIDIA, AMD; AI-native clouds: CoreWeave, Nebius, Lambda, Crusoe, Applied Digital
- AI labs: OpenAI, Anthropic, xAI; adjacent: Tesla (Dojo), Broadcom
Other valid topics: material data-center projects (>100 MW sites, expansions, capex revisions), power/grid news (interconnection, transformers, utility deals), notable analyst reports (Goldman Sachs, CBRE, JLL, Morgan Stanley, SemiAnalysis), major M&A or regulation.

ROTATE FOR FRESHNESS — this is the DEFAULT behavior. The banner reads as "current," so prefer a fresh headline over a stale big one:
- If you find ANY material US AI-infra item dated MORE RECENTLY than the current topStory's date, SWAP to the freshest such item — even if its dollar figure is smaller than the current story. Recency beats magnitude.
- If the current topStory is more than ~3 days old, you MUST swap to the best material item from the past ~7 days (do not leave it unchanged).
- Keep the current story (topStory: null) ONLY when, after searching, you genuinely found nothing dated more recently than it — OR the current topStory is itself from the last ~2 days and is clearly the single biggest live story.

DO NOT FABRICATE. Every swap must be a real item you found via web_search, with a real publication date and a working source URL. On a genuinely dead news day with nothing newer than the current story, keep it (null) — never invent a headline to force a rotation.

TODAY (UTC): {today_iso}
CURRENT lastUpdated: {last_updated}

CURRENT topStory block:
```
{top_story_block}
```

OUTPUT
Return STRICTLY a single JSON object (no markdown fences, no commentary before or after). The PREFERRED shape swaps in a fresh story:

{{
  "lastUpdated": "{today_iso}",
  "topStory": {{
    "date": "Mon DD, YYYY",
    "text": "1-2 factual sentences, no opinion",
    "src": "Publication",
    "url": "https://..."
  }},
  "summary": "one-line description of the swap"
}}

ONLY on a genuinely dead news day (nothing dated more recently than the current story), return the keep-current shape:

{{ "lastUpdated": "{today_iso}", "topStory": null, "summary": "Date bump only — no fresher story than current" }}

Field semantics:
  - "lastUpdated": always today's date in YYYY-MM-DD.
  - "topStory":  the fresh story object (preferred — see ROTATE FOR FRESHNESS), or null to keep the current one (dead-day fallback only).
  - "summary": short one-line description of what changed today.

Hard rules:
- All text strings MUST be valid JSON: escape any embedded double quotes as \\" and any embedded backslashes as \\\\.
- Do NOT include literal newlines inside string values.
- Do NOT include trailing commas.
- "date" must be the story's real publication date; "url" must be a real link you found via web_search.

Begin.
"""


# -------------------- Anthropic call --------------------

def _date_bump_only(today_iso: str, reason: str) -> dict:
    """Fallback edit that only updates lastUpdated and leaves topStory alone."""
    return {
        "lastUpdated": today_iso,
        "topStory": None,
        "summary": f"Date bump only ({reason})",
    }


def _extract_json(text: str) -> dict | None:
    """Robustly extract a JSON object from a possibly-noisy model response.

    Claude often wraps the JSON in ```json ... ``` fences and writes a
    preamble explaining its reasoning. We try several strategies before
    giving up.
    """
    text = text.strip()
    if not text:
        return None

    # Strategy 1: the whole text is already valid JSON.
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Strategy 2: text contains a ```json ... ``` (or ``` ... ```) fence.
    for fence_pattern in (
        r'```json\s*(\{[\s\S]*?\})\s*```',
        r'```\s*(\{[\s\S]*?\})\s*```',
    ):
        for m in re.finditer(fence_pattern, text):
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                continue

    # Strategy 3: scan for any balanced { ... } slice that parses as JSON.
    # Walk through every '{' as a potential start and use a brace counter
    # to find its matching '}'. Try parsing each candidate.
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            if depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    candidate = text[start : i + 1]
                    try:
                        parsed = json.loads(candidate)
                        # Prefer objects that look like our schema.
                        if isinstance(parsed, dict) and "lastUpdated" in parsed:
                            return parsed
                    except json.JSONDecodeError:
                        pass

    return None


def call_claude(prompt: str, today_iso: str) -> dict:
    """Call the Anthropic API with web_search; return parsed JSON edits.

    On any anomaly (no text content, malformed JSON, etc.) returns a
    date-bump-only edit so the daily refresh still advances `lastUpdated`
    rather than crashing the whole workflow.
    """
    client = Anthropic()  # picks up ANTHROPIC_API_KEY from env

    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        tools=[{
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": WEB_SEARCH_MAX_USES,
        }],
        messages=[{"role": "user", "content": prompt}],
    )

    # Diagnostic logging — visible in the GitHub Actions log on every run.
    print(f"[refresh] API stop_reason: {response.stop_reason}")
    print(f"[refresh] API model used:  {response.model}")
    print(f"[refresh] content blocks:  {len(response.content)}")
    for i, block in enumerate(response.content):
        block_type = getattr(block, "type", "?")
        if block_type == "text":
            preview = block.text[:240].replace("\n", " ⏎ ")
            print(f"[refresh]   block[{i}] text ({len(block.text)} chars): {preview}")
        else:
            print(f"[refresh]   block[{i}] type: {block_type}")

    # Concatenate any text blocks in the final response.
    text = "".join(
        block.text for block in response.content
        if getattr(block, "type", None) == "text"
    ).strip()

    if not text:
        print(
            f"[refresh] No text content in response (stop_reason={response.stop_reason}). "
            "Falling back to date-bump-only edit.",
            file=sys.stderr,
        )
        return _date_bump_only(today_iso, f"no text from model; stop_reason={response.stop_reason}")

    parsed = _extract_json(text)
    if parsed is None:
        print(f"[refresh] JSON extraction failed.", file=sys.stderr)
        print(f"[refresh] raw text (first 1500 chars):\n{text[:1500]}", file=sys.stderr)
        print("[refresh] Falling back to date-bump-only edit.", file=sys.stderr)
        return _date_bump_only(today_iso, "JSON extraction failed")

    return parsed


# -------------------- edit application --------------------

def js_string(s: str) -> str:
    """Serialize a Python string to a JS double-quoted string literal."""
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


def render_top_story_block(indent: str, top: dict) -> str:
    """Render a topStory block in the existing file's style."""
    item_indent = indent + "  "
    return (
        f"{indent}topStory: {{\n"
        f"{item_indent}date: {js_string(top['date'])},\n"
        f"{item_indent}text: {js_string(top['text'])},\n"
        f"{item_indent}src: {js_string(top['src'])},\n"
        f"{item_indent}url: {js_string(top['url'])}\n"
        f"{indent}}},"
    )


def apply_edits(html: str, edits: dict) -> str:
    """Apply the JSON-described edits to the HTML text. Returns new html."""
    new_html = html

    # 1. lastUpdated
    new_date = edits.get("lastUpdated")
    if new_date:
        new_html, n = LAST_UPDATED_RE.subn(
            lambda m: m.group(0).replace(m.group(1), new_date),
            new_html,
            count=1,
        )
        if n != 1:
            raise RuntimeError("Could not locate lastUpdated line")

    # 2. topStory
    top = edits.get("topStory")
    if top is not None:
        m = TOP_STORY_RE.search(new_html)
        if not m:
            raise RuntimeError("Could not locate topStory block")
        indent = m.group(1)
        new_block = render_top_story_block(indent, top)
        new_html = new_html[: m.start()] + new_block + new_html[m.end():]

    return new_html


# -------------------- validation & main --------------------

def git_diff_lines(path: str) -> int:
    """Return total insertions+deletions for one file vs HEAD."""
    out = subprocess.run(
        ["git", "diff", "--numstat", "--ignore-cr-at-eol", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    if not out:
        return 0
    ins, dels, _ = out.split(maxsplit=2)
    return int(ins) + int(dels)


def revert_index():
    subprocess.run(["git", "checkout", "--", str(INDEX_HTML)], check=True)


def main() -> int:
    today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(f"[refresh] today (UTC): {today_iso}")

    html_before = INDEX_HTML.read_text(encoding="utf-8")
    size_before = len(html_before.encode("utf-8"))
    print(f"[refresh] file size before: {size_before} bytes")

    last_updated, top_block = extract_current_state(html_before)
    print(f"[refresh] current lastUpdated: {last_updated}")

    if last_updated == today_iso:
        print("[refresh] already updated today — exiting cleanly with no change")
        return 0

    prompt = build_prompt(last_updated, top_block, today_iso)
    print("[refresh] calling Anthropic API ...")

    try:
        edits = call_claude(prompt, today_iso)
    except Exception as e:
        print(f"[refresh] ERROR calling Claude: {e}", file=sys.stderr)
        return 1

    print("[refresh] model returned:")
    print(json.dumps(edits, indent=2)[:1500])

    try:
        html_after = apply_edits(html_before, edits)
    except Exception as e:
        print(f"[refresh] ERROR applying edits: {e}", file=sys.stderr)
        return 1

    size_after = len(html_after.encode("utf-8"))
    ratio = size_after / size_before
    print(f"[refresh] file size after:  {size_after} bytes (ratio {ratio:.4f})")

    if ratio < MIN_SIZE_RATIO or ratio > MAX_SIZE_RATIO:
        print(
            f"[refresh] ABORT: size ratio {ratio:.4f} outside "
            f"[{MIN_SIZE_RATIO}, {MAX_SIZE_RATIO}] — refusing to write",
            file=sys.stderr,
        )
        return 1

    # newline="\n": always write LF, regardless of runner OS, so the working
    # tree matches the LF-normalized blob (.gitattributes) and git diff stays small.
    INDEX_HTML.write_text(html_after, encoding="utf-8", newline="\n")

    diff_lines = git_diff_lines(str(INDEX_HTML))
    print(f"[refresh] git diff lines: {diff_lines}")

    if diff_lines > MAX_DIFF_LINES:
        print(
            f"[refresh] ABORT: diff {diff_lines} lines exceeds limit "
            f"{MAX_DIFF_LINES} — reverting",
            file=sys.stderr,
        )
        revert_index()
        return 1

    print(f"[refresh] OK: {edits.get('summary', '(no summary)')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
