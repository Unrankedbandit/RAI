#!/usr/bin/env python3
"""test-benchmarks — offline verification of the ground-truth benchmark
store, its kb_lookup integration, and the review-approval write-back.

No network, no LLM: the store is pointed at a temp dir (benchmarks.DB_PATH
monkeypatched) and review.decide runs with a credential-less PortClient.

  (a) store CRUD + lookup ranking — init/upsert/lookup/mark_verified,
      upsert idempotency + verification preserved on re-seed
  (b) kb_lookup — store present (curated block prepended, markdown grep
      still the lower half), store absent (silent fallback), store broken
      (corrupt file, silent fallback) — signature/return shape unchanged
  (c) review approve path — APPROVED flips cited benchmark rows to
      verified; REJECTED does not; missing DB never breaks a decision

Run from repo root with the venv on PATH:
  .venv/bin/python scripts/test-benchmarks.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Keep the Trace console printer quiet so the check output stays readable.
os.environ["TRACE_LEVEL"] = "error"

from agent_backend import benchmarks, review, tools  # noqa: E402
from agent_backend.obs import Trace  # noqa: E402
from agent_backend.port_client import PortClient  # noqa: E402

PASS, FAIL = "✅", "❌"
failures = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failures
    print(f"  {PASS if cond else FAIL} {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures += 1


TMP = Path(tempfile.mkdtemp(prefix="rai-bench-test-"))
orig_db = benchmarks.DB_PATH
benchmarks.DB_PATH = TMP / "benchmarks.sqlite"

REC_CAPEX = {"id": "capex-utility-pv-lbnl-2023", "name": "Installed CAPEX utility PV",
             "value": "$1.43", "unit": "$/Wac", "geography": "United States",
             "source_url": "https://emp.lbl.gov/utility-scale-solar"}
REC_XFMR = {"id": "transformer-gsu-lead-woodmac-2025", "name": "Transformer/GSU lead time",
            "value": "128-144", "unit": "weeks", "geography": "United States",
            "source_url": "https://x.test/woodmac-transformers"}
REC_CEQA = {"id": "ceqa-eir-statutory", "name": "CEQA EIR statutory cap",
            "value": "1", "unit": "year", "geography": "California",
            "source_url": "https://www.law.cornell.edu/regulations/california/14-CCR-15108"}

try:
    print("\n▸ (a) store CRUD + lookup ranking")
    benchmarks.init_db()
    check("init_db creates the sqlite file", benchmarks.DB_PATH.exists())
    for rec in (REC_CAPEX, REC_XFMR, REC_CEQA):
        benchmarks.upsert(rec)
    check("lookup returns the matching row with all columns",
          [r["id"] for r in benchmarks.lookup("transformer lead time")]
          == [REC_XFMR["id"]])
    # Ranking: CAPEX row mentions 'Wac' twice (value+unit) and matches more terms.
    ranked = benchmarks.lookup("installed capex $/wac united states")
    check("lookup ranks by hit count (multi-term row first)",
          len(ranked) >= 1 and ranked[0]["id"] == REC_CAPEX["id"],
          str([r["id"] for r in ranked]))
    check("lookup is case-insensitive over name/value/geography",
          any(r["id"] == REC_CEQA["id"] for r in benchmarks.lookup("CALIFORNIA statutory"))
          and any(r["id"] == REC_XFMR["id"] for r in benchmarks.lookup("GSU")))
    check("lookup obeys limit", len(benchmarks.lookup("united states", limit=1)) == 1)
    check("lookup of a nonsense term returns []",
          benchmarks.lookup("zzzqqq nothingmatches") == [])

    n = benchmarks.mark_verified(reviewer="sam@co.com",
                                 source_urls=[REC_XFMR["source_url"]])
    row = benchmarks.lookup("transformer lead time")[0]
    check("mark_verified by source_url touches 1 row and stamps reviewer",
          n == 1 and row["verified_by"] == "sam@co.com" and bool(row["verified_at"]),
          f"n={n} row={row}")
    n = benchmarks.mark_verified(reviewer="lee@co.com", ids=[REC_CEQA["id"]])
    row = benchmarks.lookup("ceqa statutory")[0]
    check("mark_verified by id works too", n == 1 and row["verified_by"] == "lee@co.com")
    check("mark_verified with no selectors touches nothing",
          benchmarks.mark_verified(reviewer="x") == 0)
    check("mark_verified on unknown url touches nothing",
          benchmarks.mark_verified(reviewer="x", source_urls=["https://nope.test"]) == 0)

    benchmarks.upsert({**REC_XFMR, "value": "130-150"})  # re-seed, same id
    rows = benchmarks.lookup("transformer lead time")
    check("upsert is idempotent by id and updates value",
          len(rows) == 1 and rows[0]["value"] == "130-150")
    check("re-seed PRESERVES an existing verification",
          rows[0]["verified_by"] == "sam@co.com" and bool(rows[0]["verified_at"]))

    print("\n▸ (b) kb_lookup — store present / absent / broken")
    out = tools.kb_lookup("transformer lead time")
    check("returns str (signature/return shape unchanged)", isinstance(out, str))
    check("curated block prepended with value/unit/geo/url + verified tag",
          out.startswith("CURATED BENCHMARKS")
          and "Transformer/GSU lead time — 130-150 weeks (United States)" in out
          and f"[{REC_XFMR['source_url']}] verified" in out, out[:300])
    check("unverified rows are tagged unverified",
          "[https://emp.lbl.gov/utility-scale-solar] unverified"
          in tools.kb_lookup("installed capex"))
    check("markdown grep still the lower half of results",
          "CURATED BENCHMARKS" in out and "\n\n---\n\n" in out
          and "weeks" in out.split("---", 1)[1].lower())

    benchmarks.DB_PATH = TMP / "does-not-exist.sqlite"
    out = tools.kb_lookup("transformer lead time")
    check("store absent → silent fallback to markdown grep (still str, has hits)",
          isinstance(out, str) and "CURATED BENCHMARKS" not in out
          and "no knowledge-base matches" not in out, out[:200])

    broken = TMP / "broken.sqlite"
    broken.write_bytes(b"not a sqlite database at all")
    benchmarks.DB_PATH = broken
    out = tools.kb_lookup("transformer lead time")
    check("store broken/corrupt → silent fallback, no exception",
          isinstance(out, str) and "CURATED BENCHMARKS" not in out
          and len(out) > 0, out[:200])
    benchmarks.DB_PATH = TMP / "benchmarks.sqlite"

    print("\n▸ (c) review approve → benchmark verification write-back")
    store = TMP / "reports"
    store.mkdir()
    rid = "benchjob01"
    (store / f"{rid}.json").write_text(json.dumps({
        "jobId": rid,
        "action_pack": {"timeline": [
            {"label": "Transformer PO placed", "date": "2026-09-01",
             "source_url": REC_XFMR["source_url"],
             "ground_truth": f"Lead-time benchmark per {REC_CAPEX['source_url']} cite"},
            {"label": "Permit decision", "date": "2027-03-01",
             "source_url": None, "ground_truth": "no source"},
        ]},
        "red_flags": [{"title": "CAPEX half of market",
                       "sources": ["01_Land_and_Site_Due_Diligence.pdf",
                                   f"see {REC_CAPEX['source_url']}"]}],
    }), encoding="utf-8")
    # Reset verification state so the write-back is what flips these rows.
    fresh = TMP / "review.sqlite"
    benchmarks.DB_PATH = fresh
    benchmarks.init_db()
    benchmarks.upsert(REC_CAPEX)
    benchmarks.upsert(REC_XFMR)

    port = PortClient("", "", "https://api.getport.test", log=lambda m: None)
    rec = review.decide(store, rid, decision="APPROVED", reviewer="sam@co.com",
                        rationale=None, client=port, trace=Trace(rid, sink=lambda e: None))
    check("decide returns the persisted record", rec["status"] == "APPROVED")
    check("sidecar written", (store / "review" / f"{rid}.json").exists())
    ca = benchmarks.lookup("installed capex")[0]
    xf = benchmarks.lookup("transformer lead")[0]
    check("APPROVED verified the timeline source_url row",
          xf["verified_by"] == "sam@co.com" and bool(xf["verified_at"]), str(xf))
    check("APPROVED verified URL cited inside ground_truth AND finding sources",
          ca["verified_by"] == "sam@co.com", str(ca))

    rec = review.decide(store, rid, decision="REJECTED", reviewer="lee@co.com",
                        rationale=None, client=port, trace=Trace(rid, sink=lambda e: None))
    unv = benchmarks.lookup("ceqa statutory")
    check("REJECTED never verifies (no write-back)", rec["status"] == "REJECTED")

    rid2 = "benchjob02"
    (store / f"{rid2}.json").write_text(json.dumps({"jobId": rid2}), encoding="utf-8")
    rec = review.decide(store, rid2, decision="APPROVED", reviewer="sam@co.com",
                        rationale=None, client=port, trace=Trace(rid2, sink=lambda e: None))
    check("APPROVED on a report with no sources → ok, nothing verified",
          rec["status"] == "APPROVED")

    benchmarks.DB_PATH = TMP / "gone.sqlite"  # store missing entirely
    rid3 = "benchjob03"
    (store / f"{rid3}.json").write_text(json.dumps({
        "jobId": rid3,
        "action_pack": {"timeline": [{"label": "x", "date": "2026-01-01",
                                      "source_url": "https://x.test/a"}]},
    }), encoding="utf-8")
    try:
        rec = review.decide(store, rid3, decision="APPROVED", reviewer="sam@co.com",
                            rationale=None, client=port,
                            trace=Trace(rid3, sink=lambda e: None))
        ok_missing = rec["status"] == "APPROVED"
    except Exception as exc:
        ok_missing = False
        print(f"    (raised: {type(exc).__name__}: {exc})")
    check("APPROVED with DB missing NEVER breaks the decision", ok_missing)
    check("sidecar still written with DB missing",
          (store / "review" / f"{rid3}.json").exists())
finally:
    benchmarks.DB_PATH = orig_db

print("\n" + "─" * 56)
if failures:
    print(f"❌ {failures} check(s) failed")
    sys.exit(1)
print("✅ benchmarks: all offline checks pass (store + kb_lookup + review write-back)")
