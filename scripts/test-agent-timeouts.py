#!/usr/bin/env python3
"""test-agent-timeouts — offline proof that a stuck agent can never hang a run.

No LLM, no Port, no network: pipeline agents are stubbed via a monkeypatched
pipeline._agent / main.Agent whose run() sleeps forever. Encodes the incident
this change fixes: one agent timed out, the degrade printed "continuing with
empty result", and the run then HUNG — on the next agent, which had no cap.

  (a) _degrade caps a never-returning agent and returns the fallback
  (b) run_pipeline with EVERY agent hanging still completes (bounded) and
      produces the explicit degraded report (readiness 0 / Hold)
  (c) the whole-job watchdog in main: a pipeline that outlives
      PIPELINE_TIMEOUT ends the job with a terminal __ERROR__ frame, so the
      SSE stream always terminates
  (d) the Ask rail: a hanging analyst degrades to a grounded=False answer
      instead of hanging the stream

Run from repo root with the venv on PATH:
  PATH=".venv/bin:$PATH" python scripts/test-agent-timeouts.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Test environment BEFORE importing the backend: quiet trace printer, fast
# lane, and a dummy bridge key so the analyze endpoint passes its config check
# (no call is ever made — every agent is stubbed).
os.environ["TRACE_LEVEL"] = "error"
os.environ.pop("PIPELINE_MODE", None)
os.environ.setdefault("LLM_API_KEY", "test-offline")

from fastapi.testclient import TestClient  # noqa: E402

from agent_backend import main, pipeline  # noqa: E402
from agent_backend.schemas import ActionPack, ChatAnswer, Report  # noqa: E402

PASS, FAIL = "PASS", "FAIL"
failures = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failures
    print(f"  {PASS if cond else FAIL}  {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures += 1


# ---------------------------------------------------------------- stubs ----

class _HangAgent:
    """An agent whose turn never returns — the sick-bridge worst case."""

    def __init__(self, *args, **kwargs):
        pass

    async def run(self, *args, **kwargs):
        await asyncio.sleep(3600)
        raise AssertionError("stub agent should have been cancelled, not completed")


# -------------------------------------------------------- (a) _degrade ----
print("(a) _degrade caps a never-returning agent")
pipeline.AGENT_TIMEOUT = 1  # 1s wall per agent for the whole test file


async def _a():
    t0 = time.monotonic()
    msgs: list[str] = []
    out = await pipeline._degrade(asyncio.sleep(3600), "FALLBACK", msgs.append, "stuck-agent")
    return time.monotonic() - t0, out, msgs


elapsed, out, msgs = asyncio.run(_a())
check("fallback returned", out == "FALLBACK")
check("capped near AGENT_TIMEOUT", elapsed < 15, f"took {elapsed:.1f}s")
check("degrade narrated", any("continuing with empty result" in m for m in msgs), str(msgs))

# -------------------------------------- (b) run_pipeline, every agent hung ----
print("(b) run_pipeline completes with every agent hanging")


async def _b():
    t0 = time.monotonic()
    statuses: list[str] = []
    orig = pipeline._agent
    pipeline._agent = lambda *a, **k: _HangAgent()
    try:
        report = await pipeline.run_pipeline(
            "Timeout Test", "Nowhere County, CA", ["a.pdf", "b.xlsx"],
            on_status=statuses.append,
        )
    finally:
        pipeline._agent = orig
    return time.monotonic() - t0, report, statuses


elapsed, report, statuses = asyncio.run(_b())
check("pipeline returned a Report", isinstance(report, Report))
check("bounded (~5 capped phases)", elapsed < 30, f"took {elapsed:.1f}s")
check("degraded scorer -> 0/Hold",
      report.readiness == 0 and report.decision == "Hold",
      f"readiness={report.readiness} decision={report.decision}")
check("project identity preserved", report.project == "Timeout Test")
check("every phase degraded", all(
    any(s.startswith(f"[{label}] degraded") for s in statuses)
    for label in ("Orchestrator", "Extractor:a.pdf", "Researcher:core",
                  "CrossExaminer", "Scorer", "Liaison")
), "\n" + "\n".join(statuses))

# --------------------------------------------- (c) whole-job watchdog ----
print("(c) main watchdog terminates a stuck job with __ERROR__")
main.PIPELINE_TIMEOUT = 2


async def _hang_pipeline(*args, **kwargs):
    await asyncio.sleep(3600)


orig_run_pipeline = main.run_pipeline
main.run_pipeline = _hang_pipeline
try:
    # The `with` matters: the background work() task lives on the TestClient
    # portal's event loop, which only keeps running for the life of the context.
    with TestClient(main.app) as client:
        job_id = client.post(
            "/api/projects/analyze",
            json={"name": "watchdog", "location": "x", "docs": []},
        ).json()["jobId"]
        deadline = time.monotonic() + 20
        terminal = ""
        while time.monotonic() < deadline:
            frames = [m for m in main.JOB_LOGS.get(job_id, []) if isinstance(m, str)]
            terminal = next((m for m in frames if m.startswith(("__DONE__", "__ERROR__"))), "")
            if terminal:
                break
            time.sleep(0.2)
    check("job reached a terminal frame", bool(terminal), "stream would hang forever")
    check("terminal frame names the watchdog", "PIPELINE_TIMEOUT" in terminal, terminal)
finally:
    main.run_pipeline = orig_run_pipeline

# ---------------------------------------------------- (d) Ask rail cap ----
print("(d) Ask rail degrades instead of hanging")
rid = "timeout-test-report"
report_path = main.STORE / f"{rid}.json"
report_path.write_text(Report(
    project="p", location="l", readiness=50, decision="Investigate",
    dimensions=[], red_flags=[], contradictions=[], missing_info=[],
    action_pack=ActionPack(),
).model_dump_json(), encoding="utf-8")
orig_agent = main.Agent
main.Agent = lambda *a, **k: _HangAgent()
try:
    with TestClient(main.app) as client:
        ask_id = client.post(
            f"/api/reports/{rid}/ask", json={"question": "anything"},
        ).json()["jobId"]
        deadline = time.monotonic() + 20
        answer = None
        while time.monotonic() < deadline:
            answer = main._ANSWERS_CACHE.get(ask_id)
            if answer is not None:
                break
            time.sleep(0.2)
    check("ask produced an answer object", isinstance(answer, ChatAnswer))
    check("answer is explicitly ungrounded",
          answer is not None and answer.grounded is False and "timed out" in answer.answer,
          getattr(answer, "answer", None))
finally:
    main.Agent = orig_agent
    report_path.unlink(missing_ok=True)

print()
if failures:
    print(f"{FAIL}  {failures} check(s) failed")
    sys.exit(1)
print(f"{PASS}  all timeout-handling checks pass — a stuck agent can no longer hang a run")
