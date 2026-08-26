#!/usr/bin/env python3
"""test-schema-rollup — offline verification of the schema hardening
(decision literal + normalization, 0-100 score bounds, TimelineEntry
benchmark_id validation) and the code-computed readiness rollup in
pipeline.py.

No network, no LLM: everything runs against in-memory models, the seeded
benchmark store (read-only), and the stored report corpus.

  (a) decision normalization — legacy free-text / case variants map onto the
      canonical Proceed/Investigate/Hold literals on both Score and Report
  (b) score bounds — readiness / dimension score outside 0-100 are rejected
  (c) benchmark_id — real seeded id passes, unknown id rejected, missing
      store no-ops (monkeypatched DB path), broken store no-ops
  (d) readiness rollup — exact weighted sum, advisory LLM value overwritten,
      unmapped dimension names excluded (never invented), empty-dimensions
      degrade keeps 0/Hold untouched, correction trace fires on disagreement
  (e) corpus — every stored agent_backend/reports/*.json still validates

Run from repo root with the venv on PATH:
  .venv/bin/python scripts/test-schema-rollup.py
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

from pydantic import ValidationError  # noqa: E402

from agent_backend import benchmarks  # noqa: E402
from agent_backend.obs import Trace  # noqa: E402
from agent_backend.pipeline import PILLAR_WEIGHTS, apply_readiness_rollup  # noqa: E402
from agent_backend.schemas import (  # noqa: E402
    DimensionScore, Report, Score, TimelineEntry,
)

PASS, FAIL = "✅", "❌"
failures = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failures
    print(f"  {PASS if cond else FAIL} {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures += 1


def dim(name: str, score: float) -> DimensionScore:
    return DimensionScore(name=name, rag="amber", score=score, flags=[])


def score_with(readiness: float, decision: str,
               dimensions: list[DimensionScore]) -> Score:
    return Score(readiness=readiness, decision=decision,
                 dimensions=dimensions, top_risks=["t"])


def raises(fn) -> bool:
    try:
        fn()
        return False
    except (ValidationError, ValueError):
        return True


FIVE = [dim("land", 80), dim("law", 60), dim("finance", 50),
        dim("materials", 70), dim("demand", 40)]
# 0.20*80 + 0.20*60 + 0.25*50 + 0.20*70 + 0.15*40 = 16+12+12.5+14+6
EXPECTED_FIVE = 60.5

print("\n▸ (a) decision normalization (Score + Report)")
check("canonical values pass through unchanged",
      score_with(50, "Proceed", FIVE).decision == "Proceed"
      and score_with(50, "Investigate", FIVE).decision == "Investigate"
      and score_with(50, "Hold", FIVE).decision == "Hold")
check("lowercase variants normalize",
      score_with(50, "proceed", FIVE).decision == "Proceed"
      and score_with(50, "hold", FIVE).decision == "Hold"
      and score_with(50, "investigate", FIVE).decision == "Investigate")
check("legacy free-text variants normalize",
      score_with(50, "do not proceed", FIVE).decision == "Hold"
      and score_with(50, "Proceed with conditions", FIVE).decision == "Investigate")
check("whitespace/case noise tolerated",
      score_with(50, "  HOLD ", FIVE).decision == "Hold")
check("unknown decision strings are rejected",
      raises(lambda: score_with(50, "Maybe", FIVE)))


def report_with(**over):
    base = dict(project="p", location="l", readiness=50, decision="Hold",
                dimensions=FIVE, red_flags=[], contradictions=[],
                missing_info=[], action_pack={})
    base.update(over)
    return Report.model_validate(base)


check("Report.decision normalizes the same way",
      report_with(decision="do not proceed").decision == "Hold"
      and report_with(decision="proceed with conditions").decision == "Investigate")
check("Report.decision rejects unknown strings",
      raises(lambda: report_with(decision="greenlight")))

print("\n▸ (b) score bounds (ge=0, le=100)")
check("readiness 0 and 100 are accepted",
      score_with(0, "Hold", FIVE).readiness == 0
      and score_with(100, "Proceed", FIVE).readiness == 100)
check("Score.readiness out of range rejected",
      raises(lambda: score_with(-0.1, "Hold", FIVE))
      and raises(lambda: score_with(100.1, "Hold", FIVE)))
check("DimensionScore.score out of range rejected",
      raises(lambda: dim("land", -1)) and raises(lambda: dim("land", 101)))
check("Report.readiness out of range rejected",
      raises(lambda: report_with(readiness=-1))
      and raises(lambda: report_with(readiness=150)))

print("\n▸ (c) TimelineEntry.benchmark_id validation")
import sqlite3  # noqa: E402
_conn = sqlite3.connect(str(benchmarks.DB_PATH))
seeded_ids = {r[0] for r in _conn.execute("SELECT id FROM benchmarks")}
_conn.close()
check("seeded store is available with rows", len(seeded_ids) >= 13,
      f"only {len(seeded_ids)} rows")
real_id = "itc-45y-48e-obbba-deadline"
check("real seeded benchmark_id validates",
      TimelineEntry(label="x", date="2026-01-01",
                    benchmark_id=real_id).benchmark_id == real_id
      and real_id in seeded_ids)
check("benchmark_id omitted/null validates (pre-contract entries)",
      TimelineEntry(label="x", date="2026-01-01").benchmark_id is None)
check("unknown benchmark_id rejected while store is up",
      raises(lambda: TimelineEntry(label="x", date="2026-01-01",
                                   benchmark_id="no-such-benchmark")))

orig_db = benchmarks.DB_PATH
TMP = Path(tempfile.mkdtemp(prefix="rai-schema-test-"))
try:
    benchmarks.DB_PATH = TMP / "missing.sqlite"
    check("missing store no-ops: unknown benchmark_id passes (degrade-safe)",
          TimelineEntry(label="x", date="2026-01-01",
                        benchmark_id="anything-goes").benchmark_id == "anything-goes")
    broken = TMP / "broken.sqlite"
    broken.write_bytes(b"not sqlite")
    benchmarks.DB_PATH = broken
    check("broken/corrupt store no-ops the same way",
          TimelineEntry(label="x", date="2026-01-01",
                        benchmark_id="anything-goes").benchmark_id == "anything-goes")
finally:
    benchmarks.DB_PATH = orig_db

print("\n▸ (d) code-computed readiness rollup")
check("pillar weights are the rubric constants (sum to 1.0)",
      PILLAR_WEIGHTS == {"land": 0.20, "law": 0.20, "finance": 0.25,
                         "materials": 0.20, "demand": 0.15}
      and abs(sum(PILLAR_WEIGHTS.values()) - 1.0) < 1e-9)
trace = Trace("t", sink=lambda e: None)
s = score_with(99, "Proceed", FIVE)  # LLM says 99 — wildly off
out = apply_readiness_rollup(s, trace)
check("rollup overwrites advisory LLM readiness with exact weighted sum",
      out.readiness == EXPECTED_FIVE, f"got {out.readiness}")
check("scorer.readiness_corrected warn fired with both values",
      any(e.kind == "scorer.readiness_corrected"
          and e.data.get("llm_readiness") == 99
          and e.data.get("computed_readiness") == EXPECTED_FIVE
          for e in trace.events))
check("scorer decision is untouched (LLM's call stands)",
      out.decision == "Proceed")
trace2 = Trace("t", sink=lambda e: None)
s2 = apply_readiness_rollup(score_with(EXPECTED_FIVE, "Hold", FIVE), trace2)
check("no correction warn when LLM agrees within 1.0",
      not any(e.kind == "scorer.readiness_corrected" for e in trace2.events))
check("dimension names map case-insensitively (corpus style: 'Land' ... 'Demand')",
      apply_readiness_rollup(score_with(0, "Hold", [
          dim("Land", 80), dim("Law", 60), dim("Finance", 50),
          dim("Materials", 70), dim("Demand", 40)])).readiness == EXPECTED_FIVE)
trace3 = Trace("t", sink=lambda e: None)
s3 = apply_readiness_rollup(score_with(0, "Hold", FIVE + [dim("vibes", 100)]), trace3)
check("unmapped dimensions are EXCLUDED from the rollup (not invented)",
      s3.readiness == EXPECTED_FIVE
      and any(e.kind == "scorer.dimension_unmapped" and e.data.get("dimension") == "vibes"
              for e in trace3.events))
s4 = score_with(0, "Hold", [])
trace4 = Trace("t", sink=lambda e: None)
out4 = apply_readiness_rollup(s4, trace4)
check("empty dimensions (degrade path) keeps 0/Hold untouched, no events",
      out4.readiness == 0 and out4.decision == "Hold" and not trace4.events)
check("rollup result stays within 0-100 for extreme dimension scores",
      apply_readiness_rollup(score_with(0, "Hold", [
          dim("land", 100), dim("law", 100), dim("finance", 100),
          dim("materials", 100), dim("demand", 100)])).readiness == 100
      and apply_readiness_rollup(score_with(50, "Hold", [
          dim("land", 0), dim("law", 0), dim("finance", 0),
          dim("materials", 0), dim("demand", 0)])).readiness == 0)

print("\n▸ (e) stored report corpus still validates")
reports = sorted(Path("agent_backend/reports").glob("*.json"))
check("corpus is non-empty", len(reports) >= 21, f"{len(reports)} files")
bad = []
for f in reports:
    try:
        Report.model_validate(json.loads(f.read_text(encoding="utf-8")))
    except Exception as exc:
        bad.append(f"{f.name}: {type(exc).__name__}")
check(f"all {len(reports)} reports validate against the hardened schema",
      not bad, "; ".join(bad[:3]))

print("\n" + "─" * 60)
if failures:
    print(f"❌ {failures} check(s) failed")
    sys.exit(1)
print("✅ schema+rollup: all offline checks pass "
      "(decision normalization, bounds, benchmark_id, rollup, corpus)")
