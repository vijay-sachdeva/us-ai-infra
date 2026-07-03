#!/usr/bin/env python3
"""Track published GPU-cloud rental list prices ($/GPU-hr) -> data/gpu_prices.json (+ history CSV).

A free, citeable $/GPU-hr series exists nowhere public; this starts one. Scrapes PUBLISHED
on-demand list prices for flagship SKUs (H100 SXM, H200, B200) from provider pricing pages:

    CoreWeave   https://www.coreweave.com/pricing
    Lambda      https://lambda.ai/pricing            (a.k.a. lambdalabs.com)
    RunPod      https://www.runpod.io/pricing
    Nebius      https://nebius.com/prices

HONESTY RULES (this feeds a no-fabrication dashboard):
  * List prices only — published pages, not negotiated/spot/reserved rates.
  * Pages are JS-rendered React apps; extraction is best-effort regex over the served HTML
    (incl. embedded JSON blobs). A provider that fails to parse is SKIPPED and recorded in
    `failures` — the dashboard must never show a stale number stamped fresh.
  * Every observation carries source_url + retrieved_at. History is append-only
    (data/history/gpu_prices.csv, one row per date x provider x sku).
  * If NOTHING parses, current values in gpu_prices.json are left untouched (only
    checked_at advances) so a rendering layer can show honest staleness.

Run:  python scripts/fetch_gpu_prices.py          (stdlib only)
"""
from __future__ import annotations

import csv
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "gpu_prices.json"
HIST = ROOT / "data" / "history" / "gpu_prices.csv"

UA = {"User-Agent": "Mozilla/5.0 (compatible; us-ai-infra-monitor; +https://vijay-sachdeva.github.io/us-ai-infra/)"}

# Provider -> url, price BASIS (what kind of list price this is — bases differ across
# providers and are NOT directly comparable without this label), and per-SKU regex patterns.
# Patterns capture a $x.xx figure adjacent to the SKU name; they are deliberately narrow —
# a miss is recorded as a failure rather than risking grabbing the wrong number.
# (?<![A-Z0-9]) guards stop "H200" matching inside "GH200"/"BH200" etc.
PROVIDERS = {
    "coreweave": {
        "url": "https://www.coreweave.com/pricing",
        "basis": "on-demand instance, per GPU-hr",
        "skus": {
            "H100 SXM": [r"H100\s*SXM[^$]{0,300}?\$(\d{1,2}\.\d{2})"],
            "H200":     [r"(?<![A-Z0-9])H200[^$]{0,300}?\$(\d{1,2}\.\d{2})"],
            "B200":     [r"(?<![A-Z0-9])B200[^$]{0,300}?\$(\d{1,2}\.\d{2})"],
        },
    },
    "lambda": {
        "url": "https://lambda.ai/pricing",
        # The pricing page lists 1-Click CLUSTER rates first (higher) and on-demand
        # instance rates further down; the SXM-qualified patterns target the instance
        # table ("H100 SXM" / "B200 SXM6"), whose first row is the 8x node per-GPU rate.
        "basis": "on-demand instance (multi-GPU node), per GPU-hr",
        "skus": {
            "H100 SXM": [r"H100\s*SXM[^$]{0,200}?\$(\d{1,2}\.\d{2})"],
            "B200":     [r"B200\s*SXM\d?[^$]{0,200}?\$(\d{1,2}\.\d{2})"],
        },
    },
    "runpod": {
        "url": "https://www.runpod.io/pricing",
        "basis": "on-demand, per GPU-hr",
        "skus": {
            "H100 SXM": [r"H100\s*SXM[^$]{0,300}?\$(\d{1,2}\.\d{2})"],
            "H200":     [r"(?<![A-Z0-9])H200[^$]{0,300}?\$(\d{1,2}\.\d{2})"],
            "B200":     [r"(?<![A-Z0-9])B200[^$]{0,300}?\$(\d{1,2}\.\d{2})"],
        },
    },
    "nebius": {
        "url": "https://nebius.com/prices",
        "basis": "on-demand, per GPU-hr",
        "skus": {
            "H100 SXM": [r"H100[^$]{0,300}?\$(\d{1,2}\.\d{2})"],
            "H200":     [r"(?<![A-Z0-9])H200[^$]{0,300}?\$(\d{1,2}\.\d{2})"],
            "B200":     [r"(?<![A-Z0-9])B200[^$]{0,300}?\$(\d{1,2}\.\d{2})"],
        },
    },
}

SANE = (0.25, 25.0)   # $/GPU-hr sanity band — outside this, treat as a parse error


def fetch(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"[gpu] fetch failed {url}: {e}", file=sys.stderr)
        return None


def extract(html: str, patterns: list[str]) -> float | None:
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        if m:
            try:
                v = float(m.group(1))
            except ValueError:
                continue
            if SANE[0] <= v <= SANE[1]:
                return v
    return None


def upsert_history(rows: list[dict]) -> None:
    """Append today's observations; idempotent on (date, provider, sku)."""
    HIST.parent.mkdir(parents=True, exist_ok=True)
    cols = ["date", "provider", "sku", "usd_per_gpu_hr", "source_url", "retrieved_at"]
    existing: dict[tuple, dict] = {}
    if HIST.exists():
        with open(HIST, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                existing[(r["date"], r["provider"], r["sku"])] = r
    for r in rows:
        existing[(r["date"], r["provider"], r["sku"])] = r
    with open(HIST, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for k in sorted(existing):
            w.writerow(existing[k])


def main() -> int:
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    stamp = now.isoformat(timespec="seconds")

    prior = {}
    if OUT.exists():
        try:
            prior = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            prior = {}

    providers_out = dict(prior.get("providers", {}))
    hist_rows, failures = [], []

    for name, cfg in PROVIDERS.items():
        html = fetch(cfg["url"])
        if html is None:
            failures.append({"provider": name, "reason": "fetch failed"})
            continue
        got = {}
        for sku, pats in cfg["skus"].items():
            v = extract(html, pats)
            if v is not None:
                got[sku] = v
        if not got:
            failures.append({"provider": name, "reason": "no price parsed (JS-rendered page?)"})
            continue
        providers_out[name] = {
            "url": cfg["url"],
            "basis": cfg.get("basis", "published list price, per GPU-hr"),
            "retrieved_at": stamp,
            "prices_usd_per_gpu_hr": got,
        }
        for sku, v in got.items():
            hist_rows.append({"date": today, "provider": name, "sku": sku,
                              "usd_per_gpu_hr": v, "source_url": cfg["url"], "retrieved_at": stamp})
        print(f"[gpu] {name}: " + ", ".join(f"{k} ${v}" for k, v in got.items()))

    out = {
        "name": "GPU-cloud on-demand list prices",
        "unit": "USD per GPU-hour, published on-demand list price",
        "tier": "primary",
        "note": ("Published list prices scraped from provider pricing pages; negotiated, reserved and spot "
                 "rates differ. A provider listed under `failures` did not parse on this run and its last "
                 "good observation (see retrieved_at) is NOT refreshed — never treat checked_at as data freshness."),
        "checked_at": stamp,
        "providers": providers_out,
        "failures": failures,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    if hist_rows:
        upsert_history(hist_rows)
    print(f"[gpu] wrote {OUT.name}: {len(providers_out)} providers current, {len(failures)} failures, {len(hist_rows)} history rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
