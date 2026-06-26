#!/usr/bin/env python3
"""Link-rot check for every public URL in the dataset (NETWORK; non-blocking).

This is intended for a SCHEDULED CI job, NOT the per-push gate -- it makes live
HTTP requests and tolerates transient flakiness. It collects all unique http(s)
URLs from data/sources.json (ledger[].url) and data/projects.json
(records[].sources[].url), probes each one (HEAD, falling back to a ranged GET),
prints a human-readable report, and exits non-zero ONLY if the share of dead
links exceeds a high threshold -- so one server having a bad day does not fail
the build.

Stdlib-only (urllib). Run via pytest or standalone:
    python tests/test_links.py
    pytest tests/test_links.py -s -m network

Environment knobs:
    LINK_CHECK_TIMEOUT      per-request timeout, seconds (default 20)
    LINK_CHECK_FAIL_RATIO   fraction of dead links that fails the run (default 0.20)
    LINK_CHECK_MIN_DEAD     don't fail unless at least this many links are dead (default 5)
    LINK_CHECK_MAX_WORKERS  parallel probe workers (default 8)
"""
import io
import json
import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SOURCES_JSON = os.path.join(DATA, "sources.json")
PROJECTS_JSON = os.path.join(DATA, "projects.json")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
    "us-ai-infra-linkcheck/1.0 (+https://github.com/vijay-sachdeva/us-ai-infra)"
)

TIMEOUT = float(os.environ.get("LINK_CHECK_TIMEOUT", "20"))
FAIL_RATIO = float(os.environ.get("LINK_CHECK_FAIL_RATIO", "0.20"))
MIN_DEAD = int(os.environ.get("LINK_CHECK_MIN_DEAD", "5"))
MAX_WORKERS = int(os.environ.get("LINK_CHECK_MAX_WORKERS", "8"))

# Hosts known to 403/405 automated fetchers despite the page being live for
# humans (documented in data/sources.json coverage.note). A 401/403/405/406/429
# from anywhere is treated as "reachable but bot-gated", not dead -- the server
# answered, it just declined the bot.
BOT_GATE_CODES = {401, 403, 405, 406, 429}


def _load_json(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def collect_urls():
    """Return a sorted, de-duplicated list of all http(s) URLs in the dataset."""
    urls = set()

    sources = _load_json(SOURCES_JSON)
    for e in sources.get("ledger", []):
        u = e.get("url")
        if isinstance(u, str) and u.startswith(("http://", "https://")):
            urls.add(u.strip())

    projects = _load_json(PROJECTS_JSON)
    for r in projects.get("records", []):
        for s in r.get("sources", []) or []:
            u = s.get("url")
            if isinstance(u, str) and u.startswith(("http://", "https://")):
                urls.add(u.strip())

    return sorted(urls)


def _request(url, method):
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if method == "GET":
        # A tiny range keeps us from downloading whole pages.
        headers["Range"] = "bytes=0-2047"
    req = urllib.request.Request(url, method=method, headers=headers)
    return urllib.request.urlopen(req, timeout=TIMEOUT)


def probe(url):
    """Return (url, status_code_or_None, detail). status is int HTTP code or None."""
    # Try HEAD first; some servers reject HEAD, so fall back to a ranged GET.
    for method in ("HEAD", "GET"):
        try:
            resp = _request(url, method)
            code = resp.getcode()
            resp.close()
            return url, code, method
        except urllib.error.HTTPError as exc:
            code = exc.code
            if method == "HEAD" and code in (400, 403, 405, 406, 501):
                # HEAD not honored -- retry with GET before judging.
                continue
            return url, code, "%s->HTTP %s" % (method, code)
        except urllib.error.URLError as exc:
            if method == "HEAD":
                continue
            return url, None, "URLError: %s" % (exc.reason,)
        except Exception as exc:  # noqa: BLE001 - report anything else, don't crash the run
            if method == "HEAD":
                continue
            return url, None, "%s: %s" % (type(exc).__name__, exc)
    return url, None, "unreachable"


def classify(code):
    """'ok' (2xx/3xx), 'gated' (bot-gate code), or 'dead' (4xx/5xx/None)."""
    if code is None:
        return "dead"
    if 200 <= code < 400:
        return "ok"
    if code in BOT_GATE_CODES:
        return "gated"
    return "dead"


def run_link_check():
    """Probe all URLs, print a report, return (dead, gated, ok, total)."""
    urls = collect_urls()
    total = len(urls)
    print("\nLink-rot check: %d unique http(s) URLs" % total)
    print("  timeout=%ss fail_ratio=%.0f%% min_dead=%d workers=%d"
          % (TIMEOUT, FAIL_RATIO * 100, MIN_DEAD, MAX_WORKERS))

    results = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for res in pool.map(probe, urls):
            results.append(res)

    ok, gated, dead = [], [], []
    for url, code, detail in results:
        bucket = classify(code)
        if bucket == "ok":
            ok.append((url, code, detail))
        elif bucket == "gated":
            gated.append((url, code, detail))
        else:
            dead.append((url, code, detail))

    if gated:
        print("\n  Reachable but bot-gated (NOT counted as dead): %d" % len(gated))
        for url, code, _ in sorted(gated):
            print("    [%s] %s" % (code, url))

    if dead:
        print("\n  DEAD / unreachable: %d" % len(dead))
        for url, code, detail in sorted(dead):
            print("    [%s] %s  (%s)" % (code if code is not None else "ERR", url, detail))
    else:
        print("\n  No dead links.")

    print("\n  Summary: ok=%d gated=%d dead=%d total=%d"
          % (len(ok), len(gated), len(dead), total))
    return dead, gated, ok, total


@pytest.mark.network
def test_links_not_mostly_dead():
    dead, gated, ok, total = run_link_check()
    if total == 0:
        pytest.skip("no URLs found to check")
    ratio = len(dead) / total
    # Non-blocking by design: only fail when a HIGH share of links is dead AND
    # an absolute floor is exceeded, so transient single-host outages pass.
    fail = len(dead) >= MIN_DEAD and ratio > FAIL_RATIO
    assert not fail, (
        "%d/%d links dead (%.0f%%), exceeding the %.0f%% threshold (min_dead=%d).\n"
        "See the report above for the offending URLs."
        % (len(dead), total, ratio * 100, FAIL_RATIO * 100, MIN_DEAD)
    )


def main():
    dead, gated, ok, total = run_link_check()
    if total == 0:
        print("No URLs to check.")
        return 0
    ratio = len(dead) / total
    if len(dead) >= MIN_DEAD and ratio > FAIL_RATIO:
        print("\nFAIL: dead-link ratio %.0f%% exceeds threshold %.0f%%."
              % (ratio * 100, FAIL_RATIO * 100))
        return 1
    print("\nPASS: dead-link ratio within tolerance.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
