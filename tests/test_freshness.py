#!/usr/bin/env python3
"""Stale-data check for the public metric feeds.

Each metric feed exposes a top-level 'lastUpdated' timestamp (ISO 8601, e.g.
'2026-06-25T13:37:45Z'). projects.json instead carries a 'generated' date
('YYYY-MM-DD'). This test confirms each timestamp is PARSEABLE and not older
than a generous threshold (default 21 days).

By default a stale feed only WARNS (prints) rather than failing the build, so
the scheduled job can surface drift without breaking on a missed refresh. Set
FRESHNESS_STRICT=1 to make staleness a hard failure.

Stdlib-only. Run:
    python tests/test_freshness.py
    pytest tests/test_freshness.py -s
    FRESHNESS_STRICT=1 pytest tests/test_freshness.py

Environment knobs:
    FRESHNESS_MAX_AGE_DAYS  staleness threshold in days (default 21)
    FRESHNESS_STRICT        '1'/'true' to fail (not just warn) on stale feeds
"""
import io
import json
import os
from datetime import datetime, timezone

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

MAX_AGE_DAYS = int(os.environ.get("FRESHNESS_MAX_AGE_DAYS", "21"))
STRICT = os.environ.get("FRESHNESS_STRICT", "").strip().lower() in ("1", "true", "yes", "on")

# (filename, key holding the timestamp). These are the daily-refreshed feeds
# plus the canonical ledger (which uses 'generated' rather than 'lastUpdated').
FEEDS = [
    ("grid.json", "lastUpdated"),
    ("power_econ.json", "lastUpdated"),
    ("queues.json", "lastUpdated"),
    ("siting.json", "lastUpdated"),
    ("projects.json", "generated"),
]


def _load_json(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def parse_timestamp(raw):
    """Parse an ISO date or datetime into an aware UTC datetime.

    Accepts 'YYYY-MM-DD', 'YYYY-MM-DDThh:mm:ssZ', and offset forms. Raises
    ValueError if unparseable.
    """
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("empty or non-string timestamp: %r" % (raw,))
    s = raw.strip()
    # datetime.fromisoformat (3.11+) understands 'Z'; normalize for older 3.x.
    s_norm = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s_norm)
    except ValueError:
        # Date-only fallback.
        dt = datetime.strptime(s, "%Y-%m-%d")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def age_days(dt, now=None):
    now = now or datetime.now(timezone.utc)
    return (now - dt).total_seconds() / 86400.0


def check_feeds():
    """Return (parse_errors, stale, fresh) lists of detail strings/tuples."""
    now = datetime.now(timezone.utc)
    parse_errors, stale, fresh = [], [], []
    print("\nFreshness check (threshold=%d days, strict=%s)" % (MAX_AGE_DAYS, STRICT))
    for fname, key in FEEDS:
        path = os.path.join(DATA, fname)
        if not os.path.exists(path):
            parse_errors.append("%s: file not found" % fname)
            continue
        data = _load_json(path)
        raw = data.get(key)
        try:
            ts = parse_timestamp(raw)
        except ValueError as exc:
            parse_errors.append("%s: %s ('%s' unparseable: %s)" % (fname, key, raw, exc))
            continue
        days = age_days(ts, now)
        line = "  %-18s %s = %s  (%.1f days old)" % (fname, key, raw, days)
        if days > MAX_AGE_DAYS:
            stale.append((fname, raw, days))
            print(line + "  <-- STALE")
        else:
            fresh.append((fname, raw, days))
            print(line)
    return parse_errors, stale, fresh


def test_feed_timestamps_parseable():
    """Hard failure: every feed's timestamp must exist and be parseable."""
    parse_errors, _stale, _fresh = check_feeds()
    assert not parse_errors, "unparseable / missing feed timestamps:\n" + "\n".join(parse_errors)


def test_feeds_not_stale():
    """WARN by default, hard-fail only when FRESHNESS_STRICT is set."""
    parse_errors, stale, _fresh = check_feeds()
    # Parse errors are covered by the test above; don't double-fail here.
    if not stale:
        return
    msg = "stale feeds (older than %d days):\n" % MAX_AGE_DAYS + "\n".join(
        "  %s (%s, %.1f days old)" % (f, raw, d) for f, raw, d in stale
    )
    if STRICT:
        assert not stale, msg
    else:
        print("\nWARNING: " + msg)
        print("(non-fatal; set FRESHNESS_STRICT=1 to make this a hard failure)")
        pytest.skip("stale feeds detected (warn-only mode); see report above")


def main():
    parse_errors, stale, _fresh = check_feeds()
    rc = 0
    if parse_errors:
        print("\nFAIL: unparseable/missing timestamps:")
        for e in parse_errors:
            print("  " + e)
        rc = 1
    if stale:
        if STRICT:
            print("\nFAIL (strict): %d stale feed(s)." % len(stale))
            rc = 1
        else:
            print("\nWARNING: %d stale feed(s) (non-fatal in warn mode)." % len(stale))
    if rc == 0 and not stale:
        print("\nPASS: all feeds parseable and fresh.")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
