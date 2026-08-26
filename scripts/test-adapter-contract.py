#!/usr/bin/env python3
"""test-adapter-contract — offline branch coverage for the Python Sentinel
adapter's date-precision and decision->status contract, mirroring the TS-side
assertions in scripts/test-adapter-parity.mjs.

  (a) status()   — exact Literal mapping + conservative legacy fallback
  (b) _iso_from  — vague date strings -> (first-of-period ISO, precision)
  (c) _date_display — rendering never shows a fabricated day
  (d) to_sentinel — the synthetic fixtures (agent_backend/sentinel-samples/
      _synthetic-*.report.json) produce the stored expected output AND carry
      honest per-event datePrecision/dateDisplay

Run from repo root with the venv on PATH:
  PATH=".venv/bin:$PATH" python scripts/test-adapter-contract.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agent_backend.schemas import Report  # noqa: E402
from agent_backend.sentinel_adapter import (  # noqa: E402
    _date_display, _iso_from, status, to_sentinel,
)

SAMPLES = Path(__file__).resolve().parent.parent / "agent_backend" / "sentinel-samples"

PASS, FAIL = "✅", "❌"
failures = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failures
    print(f"  {PASS if cond else FAIL} {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures += 1


print("\n▸ (a) status() — exact decision mapping, conservative fallback")
for decision, expected in [
    ("Proceed", "on-track"),
    ("Investigate", "needs-review"),
    ("Hold", "at-risk"),
    ("proceed", "on-track"),            # case variant
    ("  Hold  ", "at-risk"),            # whitespace-tolerant
    ("Do not proceed", "needs-review"),  # the audit's substring-match bug
    ("Conditional", "needs-review"),     # unrecognized -> conservative
    ("", "needs-review"),
]:
    got = status(decision)
    check(f"status({decision!r}) -> {expected}", got == expected, got)

print("\n▸ (b) _iso_from() — first-of-period sort date + honest precision")
for text, expected in [
    ("Sep 2027", ("2027-09-01", "month")),
    ("September 2027.", ("2027-09-01", "month")),
    ("Q3 2027", ("2027-07-01", "quarter")),
    ("Q1 2028, before construction start", ("2028-01-01", "quarter")),
    ("2028", ("2028-01-01", "year")),
    ("Before ground disturbance (2028)", ("2028-01-01", "year")),
    ("within 90 days", None),
    ("whenever permits allow", None),
    ("7460-1 at least 45 days before construction", None),  # 4 digits, not a year
    (None, None),
    ("", None),
]:
    got = _iso_from(text)
    check(f"_iso_from({text!r}) -> {expected}", got == expected, repr(got))

print("\n▸ (c) _date_display() — no fabricated days")
for args, expected in [
    (("2027-09-15", "day"), "Sep 15, 2027"),
    (("2027-09-01", "month"), "Sep 2027"),
    (("2027-07-01", "quarter"), "Q3 2027"),
    (("2028-01-01", "year"), "2028"),
]:
    got = _date_display(*args)
    check(f"_date_display{args} -> {expected!r}", got == expected, got)

print("\n▸ (d) to_sentinel() on the synthetic fixtures — matches stored expected + branches")
for f in sorted(SAMPLES.glob("_synthetic-*.report.json")):
    pid = f.name.replace("_synthetic-", "").replace(".report.json", "")
    raw_text = f.read_text(encoding="utf-8")
    report = Report.model_validate_json(raw_text)
    # Adapters consume RAW stored JSON in production (read paths validate but
    # serve the stored bytes), so restore the pre-normalization decision —
    # same shim the fixture generator and the parity harness rely on.
    report.decision = json.loads(raw_text)["decision"]
    out = to_sentinel(report, pid)
    expected = json.loads((SAMPLES / f.name.replace(".report.json", ".sentinel.json"))
                          .read_text(encoding="utf-8"))
    check(f"{f.name}: output identical to stored expected fixture",
          out == expected,
          "regenerate: see scripts/test-adapter-parity.mjs header")
    by_label = {e["label"]: e for e in out["timeline"]}
    check(f"{f.name}: every timeline event carries datePrecision",
          all(e.get("datePrecision") in ("day", "month", "quarter", "year")
              for e in out["timeline"]))

precision = json.loads((SAMPLES / "_synthetic-precision.report.json").read_text(encoding="utf-8"))
r = Report.model_validate(precision)
r.decision = precision["decision"]
out = to_sentinel(r, "synthetic-precision")
by_label = {e["label"]: e for e in out["timeline"]}
check("timeline path: 'Sep 2027' sorts 2027-09-01, displays 'Sep 2027'",
      by_label["Month-vague milestone"]["date"] == "2027-09-01"
      and by_label["Month-vague milestone"]["datePrecision"] == "month"
      and by_label["Month-vague milestone"]["dateDisplay"] == "Sep 2027")
check("timeline path: 'Q3 2027' sorts 2027-07-01, displays 'Q3 2027'",
      by_label["Quarter-vague deadline"]["date"] == "2027-07-01"
      and by_label["Quarter-vague deadline"]["datePrecision"] == "quarter"
      and by_label["Quarter-vague deadline"]["dateDisplay"] == "Q3 2027")
check("timeline path: bare '2028' sorts 2028-01-01, displays '2028'",
      by_label["Year-vague milestone"]["date"] == "2028-01-01"
      and by_label["Year-vague milestone"]["datePrecision"] == "year"
      and by_label["Year-vague milestone"]["dateDisplay"] == "2028")
check("timeline path: undated entry dropped, not fabricated",
      "Undated milestone" not in by_label)

legacy = json.loads((SAMPLES / "_synthetic-legacy.report.json").read_text(encoding="utf-8"))
r = Report.model_validate(legacy)
r.decision = legacy["decision"]
out = to_sentinel(r, "synthetic-legacy")
by_label = {e["label"]: e for e in out["timeline"]}
check("legacy 'Do not proceed' -> needs-review (never on-track)",
      out["project"]["status"] == "needs-review", out["project"]["status"])
check("fallback path: 'Sep 2027' agency deadline -> month precision",
      by_label["CDFW — Protocol surveys"]["datePrecision"] == "month"
      and by_label["CDFW — Protocol surveys"]["date"] == "2027-09-01")
check("fallback path: 'Q1 2028, ...' agency deadline -> quarter precision",
      by_label["County — CUP application"]["datePrecision"] == "quarter"
      and by_label["County — CUP application"]["date"] == "2028-01-01")
check("fallback path: 'within 90 days' has no date -> dropped",
      "BLM — Undated action" not in by_label)

print("\n" + "─" * 56)
if failures:
    print(f"❌ {failures} check(s) failed")
    sys.exit(1)
print("✅ adapter-contract: all offline checks pass")
