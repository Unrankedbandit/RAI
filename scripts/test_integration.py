#!/usr/bin/env python3
"""test_integration — API contract tests against the FastAPI app in-process
(TestClient). No live server, no LLM key, no network.

Covers:
  (a) /api/health shape (llm deliberately UNconfigured in this process)
  (b) analyze contract: 200 + jobId even with the key missing, and the job
      surfaces the missing-credential frame instead of an HTTP error
  (c) job trace: unknown job -> {"error": ...}
  (d) resume endpoint: 404 unknown job
  (e) reports: 404 for unknown report
  (f) share: 404 for unknown token
  (g) grid status shape + tiles contract ADAPTIVE to data presence:
      loaded:false -> tiles 503 "not loaded"; loaded:true -> Range -> 206
  (h) grid/nearest follows the same contract

Run from repo root with the venv on PATH:
  PATH=".venv/bin:$PATH" python scripts/test_integration.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Deliberately unconfigured: the analyze contract under test is the
# missing-credential branch, and nothing here may touch the network.
os.environ.pop("LLM_API_KEY", None)
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ["TRACE_LEVEL"] = "error"

from fastapi.testclient import TestClient  # noqa: E402

from agent_backend.main import app  # noqa: E402

passed = failed = 0


def check(label: str, cond: bool, detail: str = ""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {label}")
    else:
        failed += 1
        print(f"  FAIL {label} {detail}")


c = TestClient(app)

# ---------- (a) health ----------
print("== health ==")
r = c.get("/api/health")
check("health 200", r.status_code == 200)
body = r.json()
check("health shape", "ok" in body and "llm" in body and "webSearch" in body,
      str(body)[:200])
check("health ok mirrors llm.configured", body["ok"] == body["llm"].get("configured"))
check("health reports llm unconfigured in this process",
      body["llm"].get("configured") is False, str(body["llm"]))

# ---------- (b) analyze contract (missing credential) ----------
print("== analyze ==")
r = c.post("/api/projects/analyze",
           json={"name": "integration probe", "location": "Ventura County, CA",
                 "docs": [], "mode": "fast"})
check("analyze 200 even without key", r.status_code == 200, r.text[:200])
job = r.json().get("jobId")
check("analyze returns jobId", isinstance(job, str) and len(job) == 12)

# The job must surface the missing-credential frame (the demo's live-feedback
# pipe depends on the error riding the stream, not the HTTP status).
r = c.get(f"/api/jobs/{job}/trace")
check("trace 200 for live job", r.status_code == 200)
check("missing-credential surfaced in job events",
      "LLM_API_KEY" in r.text and "not configured" in r.text)

# ---------- (c/d/e/f) negative-path contracts ----------
print("== negative paths ==")
r = c.get("/api/jobs/zzzzzzzzzzzz/trace")
check("unknown job trace -> error doc", r.json().get("error") == "unknown job")

r = c.post("/api/jobs/zzzzzzzzzzzz/resume", json={"approved": []})
check("resume unknown job -> 404", r.status_code == 404)

r = c.get("/api/reports/zzzzzzzzzzzz")
check("unknown report -> 404", r.status_code == 404)

r = c.get("/api/share/not-a-real-token")
check("unknown share token -> 404", r.status_code == 404)

# ---------- (g/h) grid contract (adaptive to data presence) ----------
print("== grid ==")
r = c.get("/api/grid/status")
check("grid status 200", r.status_code == 200)
st = r.json()
check("grid status shape",
      all(k in st for k in ("pmtiles_bytes", "offlimits_pmtiles_bytes",
                            "lines", "substations", "loaded", "layers")),
      str(st)[:200])

if st["loaded"]:
    r = c.get("/api/grid/tiles/grid.pmtiles", headers={"Range": "bytes=0-255"})
    check("grid.pmtiles Range -> 206 partial", r.status_code == 206
          and len(r.content) == 256, f"got {r.status_code}")
    r = c.get("/api/grid/nearest", params={"lat": 36.74, "lng": -119.79})
    check("grid nearest -> 200 with data", r.status_code == 200)
else:
    # CI runners carry no baked archives — the documented contract is 503
    # "grid data not loaded", not a crash or an empty 200.
    r = c.get("/api/grid/tiles/grid.pmtiles")
    check("grid.pmtiles without data -> 503", r.status_code == 503,
          f"got {r.status_code}")
    check("503 names the cause", "not loaded" in r.text.lower(), r.text[:160])
    r = c.get("/api/grid/nearest", params={"lat": 36.74, "lng": -119.79})
    check("grid nearest without data -> 503", r.status_code == 503,
          f"got {r.status_code}")

# ---------- summary ----------
print("-" * 48)
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
