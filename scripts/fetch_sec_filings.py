#!/usr/bin/env python3
"""Track SEC filings for the dashboard's covered players -> data/sec_filings.json.

Source: SEC EDGAR's free JSON APIs (primary, no key needed; requires a declared User-Agent):
  * https://www.sec.gov/files/company_tickers.json      (ticker -> CIK resolution)
  * https://data.sec.gov/submissions/CIK##########.json (per-company filing index)

For each tracked ticker, keeps the latest disclosure-relevant filings (10-K/10-Q/8-K, plus
20-F/6-K for foreign private issuers like Nebius) with direct EDGAR document links. This is
pure PRIMARY metadata — form type, filing date, accession, link — no interpretation.

The dashboard's "Filings watch" module flags forms filed after the commitment book's last
review stamp, so a fresh 10-Q visibly demands re-verification instead of rotting silently
(the staleness gate's companion signal).

Run: python scripts/fetch_sec_filings.py    (stdlib only; runs daily in refresh-data.yml)
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "sec_filings.json"

UA = {"User-Agent": "us-ai-infra-monitor (vijaysachdeva@gmail.com)"}

# Tracked players (public filers only). Keep in sync with DATA.players where applicable.
TICKERS = ["MSFT", "AMZN", "GOOGL", "META", "ORCL", "NVDA", "CRWV", "APLD", "IREN", "NBIS"]
# Disclosure-relevant forms (incl. amendments); NBIS is a foreign private issuer (20-F/6-K).
FORMS = {"10-K", "10-Q", "8-K", "10-K/A", "10-Q/A", "20-F", "6-K"}
PER_COMPANY = 6   # latest N relevant filings kept per company


def get_json(url: str):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode("utf-8"))


def resolve_ciks() -> dict:
    """ticker -> zero-padded CIK via SEC's official mapping file."""
    data = get_json("https://www.sec.gov/files/company_tickers.json")
    want = {t.upper() for t in TICKERS}
    out = {}
    for row in data.values():
        t = str(row.get("ticker", "")).upper()
        if t in want:
            out[t] = str(row["cik_str"]).zfill(10)
    missing = want - set(out)
    if missing:
        print(f"[sec] WARNING: no CIK resolved for {sorted(missing)} — skipped this run", file=sys.stderr)
    return out


def latest_filings(cik: str) -> list[dict]:
    sub = get_json(f"https://data.sec.gov/submissions/CIK{cik}.json")
    recent = sub.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    out = []
    for i, form in enumerate(forms):
        if form not in FORMS:
            continue
        accession = recent["accessionNumber"][i]
        acc_nodash = accession.replace("-", "")
        doc = recent.get("primaryDocument", [""] * len(forms))[i]
        out.append({
            "form": form,
            "filed": recent["filingDate"][i],
            "report_period": recent.get("reportDate", [""] * len(forms))[i] or None,
            "accession": accession,
            "url": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_nodash}/{doc}" if doc
                   else f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type={form}",
            "description": recent.get("primaryDocDescription", [""] * len(forms))[i] or None,
        })
        if len(out) >= PER_COMPANY:
            break
    return out


def main() -> int:
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        ciks = resolve_ciks()
    except Exception as e:
        print(f"[sec] ERROR resolving CIKs: {e}", file=sys.stderr)
        return 1

    companies, failures = {}, []
    for t in TICKERS:
        cik = ciks.get(t.upper())
        if not cik:
            failures.append({"ticker": t, "reason": "CIK not resolved"})
            continue
        try:
            fl = latest_filings(cik)
            companies[t] = {"cik": cik, "filings": fl}
            print(f"[sec] {t}: {len(fl)} filings, latest {fl[0]['form']} {fl[0]['filed']}" if fl else f"[sec] {t}: none")
        except Exception as e:
            failures.append({"ticker": t, "reason": str(e)[:120]})
            print(f"[sec] {t} failed: {e}", file=sys.stderr)
        time.sleep(0.3)   # be polite to data.sec.gov (10 req/s limit; we stay far under)

    if not companies:
        print("[sec] nothing fetched — not writing.", file=sys.stderr)
        return 1
    out = {
        "name": "SEC filings watch — tracked players",
        "tier": "primary",
        "source": "SEC EDGAR submissions API (data.sec.gov)",
        "note": "Latest disclosure-relevant filings (10-K/10-Q/8-K; 20-F/6-K for foreign filers) per tracked public player. Pure primary metadata with direct EDGAR links; a company under `failures` keeps its last good data.",
        "lastUpdated": stamp,   # feed-stamp compatibility (renderFeedFreshness)
        "fetched_at": stamp,
        "companies": companies,
        "failures": failures,
    }
    # Preserve last good data for failed companies
    if OUT.exists():
        try:
            prior = json.loads(OUT.read_text(encoding="utf-8"))
            for t, v in prior.get("companies", {}).items():
                if t not in out["companies"]:
                    out["companies"][t] = v
        except Exception:
            pass
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"[sec] wrote {OUT.name}: {len(out['companies'])} companies, {len(failures)} failures")
    return 0


if __name__ == "__main__":
    sys.exit(main())
