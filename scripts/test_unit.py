#!/usr/bin/env python3
"""test_unit — offline unit tests for pure logic. No server, no network, no LLM.

Covers:
  (a) schemas: construct/round-trip + Literal/enum rejection
  (b) grid pure helpers: _num / _mi / _bucket thresholds / _label strings
  (c) agents.base: _extract_json salvage paths, model_for tier lockstep with
      model_tiers.json (derives expectations from the file, not hardcoded)

Run from repo root with the venv on PATH:
  PATH=".venv/bin:$PATH" python scripts/test_unit.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os
os.environ["TRACE_LEVEL"] = "error"

passed = failed = 0


def check(label: str, cond: bool, detail: str = ""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {label}")
    else:
        failed += 1
        print(f"  FAIL {label} {detail}")


# ---------- (a) schemas ----------
print("== schemas ==")
from pydantic import ValidationError

from agent_backend.schemas import (
    DimensionScore,
    Fact,
    ProjectProfile,
    RedFlag,
    Score,
)

p = ProjectProfile(name="t", capacity_mw=5.0, county="Ventura")
check("ProjectProfile defaults", p.technology == "solar+storage" and p.state == "CA")
check("ProjectProfile round-trip",
      ProjectProfile.model_validate_json(p.model_dump_json()) == p)

f = Fact(component="site", claim="acreage", value=40.0, unit="ac", citation="a.pdf p.1")
check("Fact round-trip", Fact.model_validate_json(f.model_dump_json()) == f)

rf = RedFlag(title="x", severity="high", component="grid", evidence="e")
check("RedFlag severity accepted", rf.severity == "high")
try:
    RedFlag(title="x", severity="banana", component="grid", evidence="e")
    check("RedFlag rejects bad severity", False, "no ValidationError raised")
except ValidationError:
    check("RedFlag rejects bad severity", True)

s = Score(
    readiness=72.5,
    decision="Investigate",
    dimensions=[DimensionScore(name="grid", rag="amber", score=60.0, flags=["fl"])],
    top_risks=["r1"],
)
check("Score construct + round-trip",
      Score.model_validate_json(s.model_dump_json()).decision == "Investigate")
try:
    Score(readiness=1.0, decision="Maybe", dimensions=[], top_risks=[])
    check("Score rejects bad decision", False, "no ValidationError raised")
except ValidationError:
    check("Score rejects bad decision", True)

# ---------- (b) grid pure helpers ----------
print("== grid helpers ==")
from agent_backend import grid

check("_num parses numerics",
      grid._num("230") == 230 and grid._num(34.5) == 34.5)
check("_num rejects unknowns",
      grid._num(None) is None and grid._num("abc") is None and grid._num(0) is None)
check("_mi converts", abs(grid._mi(grid.MILE_M) - 1.0) < 1e-9)

# Contract §2 thresholds (miles): substation near<1, moderate 1-2, far 2-5;
# transmission near<0.5, moderate 0.5-1, far 1-3; beyond = remote.
m = grid.MILE_M
check("_bucket substation ladder",
      grid._bucket(0.99 * m, "substation") == "near"
      and grid._bucket(1.5 * m, "substation") == "moderate"
      and grid._bucket(5.0 * m, "substation") == "far"
      and grid._bucket(6.0 * m, "substation") == "remote")
check("_bucket transmission ladder",
      grid._bucket(0.49 * m, "transmission") == "near"
      and grid._bucket(0.75 * m, "transmission") == "moderate"
      and grid._bucket(3.0 * m, "transmission") == "far"
      and grid._bucket(4.0 * m, "transmission") == "remote")

check("_label transmission with kv",
      grid._label("transmission", 0.5 * m, {"kv": 230})
      == "0.5 mi to nearest 230 kV transmission line")
check("_label transmission unknown kv",
      grid._label("transmission", 1.0 * m, {})
      == "1.0 mi to nearest transmission line")
check("_label substation with name",
      grid._label("substation", 2.0 * m, {"name": "Saticoy"})
      == "2.0 mi to nearest substation (Saticoy)")

# ---------- (c) agents.base pure helpers ----------
print("== agents.base ==")
from agent_backend.agents import base

check("_extract_json plain", base._extract_json('{"a": 1}') == {"a": 1})
check("_extract_json fenced",
      base._extract_json('```json\n{"a": 2}\n```') == {"a": 2})
check("_extract_json prose-wrapped",
      base._extract_json('Sure! Here is the result: {"a": 3} hope that helps')
      == {"a": 3})
try:
    base._extract_json("no json here")
    check("_extract_json raises on garbage", False, "no exception raised")
except Exception:
    check("_extract_json raises on garbage", True)

# Tier lockstep: expectations derived from the same model_tiers.json the code
# reads — the test fails if a role drifts to the wrong lane, not on renames.
tiers_doc = json.loads(
    (Path(__file__).resolve().parent.parent / "agent_backend" / "model_tiers.json")
    .read_text(encoding="utf-8"))
main_model = tiers_doc["tiers"]["main"]["model"]
flash_model = tiers_doc["tiers"]["flash"]["model"]
default_model = tiers_doc["default"]

check("model_for main lane", base.model_for("Orchestrator") == main_model)
check("model_for flash lane", base.model_for("Researcher") == flash_model)
check("model_for colon-suffixed subagent stays in lane",
      base.model_for("DataScout:followup-2") == flash_model)
check("model_for case-insensitive", base.model_for("scorer") == main_model)
check("model_for unknown agent falls to default",
      base.model_for("NoSuchAgent") == default_model)

# ---------- summary ----------
print("-" * 48)
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
