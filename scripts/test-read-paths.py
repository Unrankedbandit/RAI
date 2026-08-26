#!/usr/bin/env python3
"""test-read-paths — offline verification of the re-validate-on-read
hardening for stored reports.

No network, no LLM: the report store + share registry are pointed at a temp
dir and the real FastAPI app is exercised via TestClient (same pattern as
scripts/test-in-app-review.py).

  (a) happy path  — valid report served by id + listed in /api/projects
  (b) 422, not 500 — schema-invalid and truncated-JSON reports are concise
                    422s from GET /api/reports/{id}
  (c) isolation   — one corrupt file does NOT poison /api/projects: valid
                    rows still list, the bad filename lands in
                    skipped_invalid, and a warning is logged
  (d) archived    — archived ids stay hidden AND are excluded before
                    validation (never listed, never in skipped_invalid)
  (e) share       — public GET + claim re-validate: corrupt source -> 422
                    and claim writes NO copy; valid share round-trips

Run from repo root with the venv on PATH:
  PATH=".venv/bin:$PATH" python scripts/test-read-paths.py
"""
from __future__ import annotations

import json
import logging
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Keep the Trace console printer quiet so the check output stays readable.
os.environ["TRACE_LEVEL"] = "error"

from fastapi.testclient import TestClient  # noqa: E402

from agent_backend import main, share  # noqa: E402

PASS, FAIL = "✅", "❌"
failures = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failures
    print(f"  {PASS if cond else FAIL} {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures += 1


# ── fixture: temp report store + share registry ─────────────────────────────

TMP = Path(tempfile.mkdtemp(prefix="rai-readpaths-test-"))

VALID = {
    "project": "Read-Path Probe", "location": "Test County, CA",
    "readiness": 55.0, "decision": "Investigate",
    "dimensions": [{"name": "Land", "rag": "amber", "score": 55.0, "flags": ["probe flag"]}],
    "red_flags": [], "contradictions": [], "missing_info": [],
    "action_pack": {"rfis": [], "agency_actions": [], "verification_requests": [],
                    "conditions_precedent": [], "timeline": []},
    "recommended_next_action": None, "acquired_data": [], "user": None,
}
ARCHIVED = {**VALID, "project": "Archived Probe", "readiness": 80.0}

(TMP / "validjob01.json").write_text(json.dumps(VALID), encoding="utf-8")
(TMP / "archivedjob1.json").write_text(json.dumps(ARCHIVED), encoding="utf-8")
# Schema-invalid: readiness is a string, decision not a known literal.
(TMP / "corruptjob01.json").write_text(
    json.dumps({**VALID, "readiness": "very high", "decision": "Maybe"}),
    encoding="utf-8")
# Not even JSON.
(TMP / "truncjob01.json").write_text('{"project": "half-written", ', encoding="utf-8")
# Archived AND corrupt: hidden before validation, so silently excluded.
(TMP / "archcorrupt1.json").write_text('{"project": ', encoding="utf-8")
(TMP / "archived.txt").write_text("archivedjob1\narchcorrupt1\n", encoding="utf-8")

orig_store, orig_archive = main.STORE, main.ARCHIVE_LIST
orig_share_store, orig_shares = share.STORE, share.SHARES
main.STORE = share.STORE = TMP
main.ARCHIVE_LIST = TMP / "archived.txt"
share.SHARES = TMP / "shares.json"

api = TestClient(main.app)

try:
    print("\n▸ (a) happy path — valid report by id + in the portfolio envelope")
    r = api.get("/api/reports/validjob01")
    check("GET valid report → 200 with the stored payload",
          r.status_code == 200 and r.json()["project"] == "Read-Path Probe",
          r.text[:200])
    r = api.get("/api/projects")
    check("GET /api/projects → 200 envelope with projects + skipped_invalid",
          r.status_code == 200 and isinstance(r.json(), dict)
          and "projects" in r.json() and "skipped_invalid" in r.json(), r.text[:200])
    rows = r.json()["projects"]
    check("valid report listed with its row fields",
          any(row["id"] == "validjob01" and row["project"] == "Read-Path Probe"
              and row["decision"] == "Investigate" for row in rows), str(rows)[:200])

    print("\n▸ (b) 422, not 500 — invalid stored reports are concise errors")
    r = api.get("/api/reports/corruptjob01")
    check("schema-invalid report → 422", r.status_code == 422, f"got {r.status_code}")
    detail = r.json().get("detail", "")
    check("422 detail names the id + broken field, no traceback",
          "corruptjob01" in detail and "readiness" in detail
          and "Traceback" not in r.text, detail[:200])
    r = api.get("/api/reports/truncjob01")
    check("truncated-JSON report → 422 (pydantic wraps JSON errors)",
          r.status_code == 422 and "truncjob01" in r.json().get("detail", ""),
          f"got {r.status_code}: {r.text[:160]}")

    print("\n▸ (c) isolation — one corrupt file does not poison /api/projects")
    logger = logging.getLogger("agent_backend.main")
    records: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record.getMessage())

    handler = _Capture()
    logger.addHandler(handler)
    try:
        r = api.get("/api/projects")
    finally:
        logger.removeHandler(handler)
    body = r.json()
    check("200 despite two invalid files", r.status_code == 200, f"got {r.status_code}")
    check("skipped_invalid names exactly the invalid filenames",
          body["skipped_invalid"] == ["corruptjob01.json", "truncjob01.json"],
          str(body["skipped_invalid"]))
    check("invalid rows absent, valid rows still present",
          [row["id"] for row in body["projects"]] == ["validjob01"],
          str([row["id"] for row in body["projects"]]))
    check("warning logged per skipped file (filename included)",
          sum("corruptjob01.json" in m for m in records) == 1
          and sum("truncjob01.json" in m for m in records) == 1,
          str(records))

    print("\n▸ (d) archived — hidden from the list, excluded before validation")
    check("archived valid id not listed",
          all(row["id"] != "archivedjob1" for row in body["projects"]))
    check("archived corrupt file not in skipped_invalid (never validated)",
          "archcorrupt1.json" not in body["skipped_invalid"])
    r = api.get("/api/reports/archivedjob1")
    check("archived report still fetchable by id (permalink contract)",
          r.status_code == 200 and r.json()["project"] == "Archived Probe",
          f"got {r.status_code}")

    print("\n▸ (e) share — public GET + claim re-validate before serving/copying")
    r = api.post("/api/reports/validjob01/share")
    check("mint share token for valid report", r.status_code == 200 and "token" in r.json(),
          r.text[:200])
    token = r.json()["token"]
    r = api.get(f"/api/share/{token}")
    check("public share GET → 200 with the report",
          r.status_code == 200 and r.json()["project"] == "Read-Path Probe",
          f"got {r.status_code}")
    r = api.post(f"/api/share/{token}/claim", headers={"X-Hax-User": "viewer@test"})
    check("claim valid share → 200 with a fresh report id",
          r.status_code == 200 and r.json().get("reportId") not in (None, "validjob01"),
          r.text[:200])
    copy_id = r.json()["reportId"]
    check("the claimed copy is itself valid + servable",
          api.get(f"/api/reports/{copy_id}").status_code == 200
          and api.get(f"/api/reports/{copy_id}").json()["user"] == "viewer@test")

    r = api.post("/api/reports/corruptjob01/share")
    bad_token = r.json()["token"]
    r = api.get(f"/api/share/{bad_token}")
    check("public share GET on corrupt report → 422, not 500",
          r.status_code == 422 and "corruptjob01" in r.json().get("detail", ""),
          f"got {r.status_code}: {r.text[:160]}")
    before = {p.name for p in TMP.glob("*.json")}
    r = api.post(f"/api/share/{bad_token}/claim", headers={"X-Hax-User": "viewer2@test"})
    after = {p.name for p in TMP.glob("*.json")}
    check("claim of corrupt share → 422 and NO copy file written",
          r.status_code == 422 and before == after,
          f"got {r.status_code}; new files: {after - before}")
finally:
    main.STORE, main.ARCHIVE_LIST = orig_store, orig_archive
    share.STORE, share.SHARES = orig_share_store, orig_shares

print("\n" + "─" * 56)
if failures:
    print(f"❌ {failures} check(s) failed")
    sys.exit(1)
print("✅ read-paths: all offline checks pass (no network, no LLM)")
