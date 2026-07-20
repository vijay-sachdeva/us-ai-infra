#!/usr/bin/env python3
"""Propose CANDIDATE connections for human verification -> data/connections.proposals.json.

The connections layer (data/connections.json) is the dashboard's connect-the-dots surface, and
it is HAND-CURATED on purpose: every published edge is verified and tier-tagged so an unverified
link can never ship. This script is the sustainability half of that model — it does NOT publish
anything. It mines the feeds we already have for *candidate* links and writes them to a separate
proposals file that the front end never loads, so a maintainer can glance at the candidates,
verify the ones that hold up against sources, and promote them BY HAND into connections.json with
a connectionTier.

Heuristics (deterministic, stdlib-only — no API, no fabrication):
  1. co-mention        — a feed item tagging >=2 players is a candidate relationship, unless that
                         exact player-set is already represented in a published connection.
  2. recurring-player  — a player appearing in >=3 feed items is a candidate narrative thread.
  3. filing-after-review — a published connection whose player filed a new 10-K/10-Q after the
                         ledger's `reviewed` stamp needs re-verification (mirrors the Filings-watch
                         signal, but scoped to connections).

Run: python scripts/propose_connections.py   (runs twice daily in daily-refresh.yml, commits proposals)
"""
from __future__ import annotations

import itertools
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "connections.proposals.json"

# Feed player-tags use short symbols/names; map the tracked public ones to EDGAR tickers so the
# filing-after-review heuristic can look them up in sec_filings.json.
PLAYER_TO_TICKER = {
    "MSFT": "MSFT", "AMZN": "AMZN", "GOOGL": "GOOGL", "META": "META", "ORCL": "ORCL",
    "NVDA": "NVDA", "CRWV": "CRWV", "APLD": "APLD", "IREN": "IREN", "NBIS": "NBIS",
}
PERIODIC = {"10-K", "10-Q", "10-K/A", "10-Q/A", "20-F"}


def load(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def published_player_sets(connections):
    """Sorted player tuples already represented by a published connection (for dedupe)."""
    sets = set()
    for c in (connections or {}).get("items", []):
        players = tuple(sorted(c.get("players", [])))
        if players:
            sets.add(players)
            # also record every pair, so a 2-player feed item covered by a larger connection dedupes
            for pair in itertools.combinations(players, 2):
                sets.add(pair)
    return sets


def main() -> int:
    current = load(DATA / "current.json", {}) or {}
    connections = load(DATA / "connections.json", {}) or {}
    filings = load(DATA / "sec_filings.json", {}) or {}
    feed = current.get("feed", [])
    covered = published_player_sets(connections)

    candidates = []

    # 1. co-mention — feed items tagging >=2 players
    seen_pairs = set()
    for it in feed:
        players = sorted(set(it.get("players", [])))
        if len(players) < 2:
            continue
        key = tuple(players)
        if key in covered or key in seen_pairs:
            continue
        # skip if every pair within is already covered by a published connection
        pairs = list(itertools.combinations(players, 2))
        if pairs and all(p in covered for p in pairs):
            continue
        seen_pairs.add(key)
        candidates.append({
            "reason": "co-mention",
            "players": players,
            "date": it.get("date", ""),
            "src": it.get("src", ""),
            "evidence_text": (it.get("text", "") or "")[:220],
            "suggestion": "These players co-occur in one item but aren't yet a published connection — check whether there's a real two-sided relationship to verify.",
        })

    # 2. recurring-player — appears in >=3 feed items => candidate thread
    counts = Counter(p for it in feed for p in set(it.get("players", [])))
    for player, n in counts.most_common():
        if n < 3:
            continue
        already = any(
            c.get("kind") == "thread" and player in c.get("players", [])
            for c in connections.get("items", [])
        )
        if already:
            continue
        items = [it.get("text", "")[:80] for it in feed if player in set(it.get("players", []))]
        candidates.append({
            "reason": "recurring-player",
            "players": [player],
            "count": n,
            "items": items,
            "suggestion": "%s appears in %d feed items — candidate for a narrative thread (one motion across weeks)." % (player, n),
        })

    # 3. filing-after-review — a published connection's player filed a new periodic after `reviewed`
    reviewed = connections.get("reviewed")
    review_flags = []
    if reviewed:
        try:
            reviewed_dt = datetime.strptime(reviewed + "-01", "%Y-%m-%d").date()
        except ValueError:
            reviewed_dt = None
        companies = filings.get("companies", {}) if isinstance(filings, dict) else {}
        if reviewed_dt:
            connected_players = {p for c in connections.get("items", []) for p in c.get("players", [])}
            for p in sorted(connected_players):
                tkr = PLAYER_TO_TICKER.get(p)
                if not tkr or tkr not in companies:
                    continue
                for f in companies[tkr].get("filings", []):
                    if f.get("form") in PERIODIC and f.get("filed", "") >= reviewed_dt.isoformat():
                        review_flags.append({
                            "reason": "filing-after-review",
                            "players": [p],
                            "filing": f.get("form") + " " + f.get("filed", ""),
                            "url": f.get("url", ""),
                            "suggestion": "%s filed a %s after the connections ledger was last reviewed (%s) — re-verify %s's connections against the new filing." % (p, f.get("form"), reviewed, p),
                        })
                        break
    candidates.extend(review_flags)

    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out = {
        "name": "Candidate connections — PROPOSED, not published",
        "note": "Auto-generated heuristic candidates for human verification. The dashboard NEVER loads this file. Promote a verified candidate into data/connections.json BY HAND with a connectionTier; delete stale candidates. This is the proposal half of the curation model — it suggests, it does not publish.",
        "generated_at": stamp,
        "counts": {
            "co_mention": sum(1 for c in candidates if c["reason"] == "co-mention"),
            "recurring_player": sum(1 for c in candidates if c["reason"] == "recurring-player"),
            "filing_after_review": sum(1 for c in candidates if c["reason"] == "filing-after-review"),
        },
        "candidates": candidates,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("[propose] wrote %s: %d candidates (%s)" % (OUT.name, len(candidates), out["counts"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
