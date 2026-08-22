#!/usr/bin/env python3
"""test-gap-gate — offline verification of the mid-run gap-review gate.

No LLM, no Port, no network: pipeline agents are stubbed via a monkeypatched
pipeline._agent, and the resume endpoint is exercised through FastAPI's
TestClient.

  (a) gate disabled (GAP_REVIEW unset) — no pause, zero gate.* events, scouts
      chase every gap: identical to pre-gate behavior
  (b) enabled + resume — run parks after gap analysis, emits gate.gap_review
      with real gap ids, resume filters the scout fan-out to the approved
      subset, gate.resolved mode=approved
  (b2) enabled + empty approval — scouts skipped entirely (trace note, not an
      error), run still completes
  (c) enabled + timeout (GAP_REVIEW_TIMEOUT_S=1, no resume) — proceeds with
      ALL gaps, gate.resolved mode=timeout at level=warn
  (d) resume endpoint — 409 for a job not awaiting gap review, 404 for an
      unknown job, 200 for a parked job
  (e) Port mapping — gate.gap_review → factory_run AWAITING_GAP_REVIEW,
      gate.resolved → RUNNING

Run from repo root with the venv on PATH:
  PATH=".venv/bin:$PATH" python scripts/test-gap-gate.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Keep the Trace console printer quiet so the check output stays readable —
# assertions below run on the captured sink events, not stdout.
os.environ["TRACE_LEVEL"] = "error"

from agent_backend import main, pipeline  # noqa: E402
from agent_backend.gate import GapGate  # noqa: E402
from agent_backend.obs import Trace  # noqa: E402
from agent_backend.port_client import PortReporter  # noqa: E402
from agent_backend.schemas import (  # noqa: E402
    AcquiredData, ActionPack, ContradictionSet, DataNeed, FactSet, Findings,
    GapAnalysis, ProjectProfile, Score,
)

PASS, FAIL = "✅", "❌"
failures = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failures
    print(f"  {PASS if cond else FAIL} {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures += 1


# ── stubbed agents ────────────────────────────────────────────────────────────

NEEDS = [
    DataNeed(component="grid", missing="interconnection study",
             why_it_matters="queue position drives timeline", source_hint="CAISO queue"),
    DataNeed(component="water", missing="water rights memo",
             why_it_matters="cooling permit", source_hint=None),
    DataNeed(component="finance", missing="capex breakdown",
             why_it_matters="LCOS model", source_hint=None),
]

AGENT_CALLS: list[dict] = []


class FakeAgent:
    def __init__(self, name: str, contract):
        self.name = name
        self.contract = contract

    async def run(self, task: str, context: dict | None = None):
        AGENT_CALLS.append({"name": self.name, "task": task})
        c = self.contract
        suffix = self.name.split(":")[-1]
        if c is ProjectProfile:
            return ProjectProfile(name="Test Solar", capacity_mw=100,
                                  county="Test", components=["grid"])
        if c is FactSet:
            return FactSet(doc=suffix, facts=[], gaps=[])
        if c is GapAnalysis:
            return GapAnalysis(needs=list(NEEDS))
        if c is AcquiredData:
            return AcquiredData(component=suffix, data_points=["stub"], sources=["stub"])
        if c is Findings:
            return Findings(component=suffix)
        if c is ContradictionSet:
            return ContradictionSet()
        if c is Score:
            return Score(readiness=50.0, decision="Investigate", dimensions=[], top_risks=[])
        if c is ActionPack:
            return ActionPack()
        raise AssertionError(f"unstubbed contract: {c}")


def fake_agent(name, prompt, contract, role, on_status, trace=None, max_steps=None):
    return FakeAgent(name, contract)


_orig_agent = pipeline._agent
_orig_mode = pipeline.PIPELINE_MODE
pipeline._agent = fake_agent
pipeline.PIPELINE_MODE = "deep"  # the gate lives on the deep-mode path

_orig_env = {k: os.environ.get(k) for k in ("GAP_REVIEW", "GAP_REVIEW_TIMEOUT_S")}


def set_gate_env(enabled: bool, timeout_s: int = 30) -> None:
    if enabled:
        os.environ["GAP_REVIEW"] = "1"
        os.environ["GAP_REVIEW_TIMEOUT_S"] = str(timeout_s)
    else:
        os.environ.pop("GAP_REVIEW", None)
        os.environ.pop("GAP_REVIEW_TIMEOUT_S", None)


def scout_calls() -> list[str]:
    return [c["name"] for c in AGENT_CALLS if c["name"].startswith("DataScout:")]


def gate_events(events: list[dict]) -> list[dict]:
    return [e for e in events if e["kind"].startswith("gate.")]


async def start_run(events: list[dict], gate: GapGate) -> asyncio.Task:
    return asyncio.create_task(pipeline.run_pipeline(
        "Test Solar", "Test County, CA", ["site-plan.pdf"],
        on_status=lambda m: None,
        trace=Trace("t-gate", sink=events.append),
        gap_gate=gate,
    ))


async def wait_parked(gate: GapGate, seconds: float = 5) -> bool:
    for _ in range(int(seconds / 0.01)):
        if gate.awaiting:
            return True
        await asyncio.sleep(0.01)
    return False


# ── (a) disabled ─────────────────────────────────────────────────────────────

async def case_disabled() -> None:
    print("\n▸ (a) GAP_REVIEW unset — no pause, zero gate events, all gaps chased")
    set_gate_env(False)
    AGENT_CALLS.clear()
    events: list[dict] = []
    gate = GapGate()
    report = await asyncio.wait_for(await start_run(events, gate), timeout=15)
    check("run completes with a report", report.decision == "Investigate")
    check("zero gate.* events emitted", gate_events(events) == [],
          f"saw {[e['kind'] for e in gate_events(events)]}")
    check("gate never parked", not gate.awaiting)
    check("scouts chased ALL gaps",
          scout_calls() == ["DataScout:grid", "DataScout:water", "DataScout:finance"],
          f"saw {scout_calls()}")


# ── (b) enabled + resume ─────────────────────────────────────────────────────

async def case_resume() -> None:
    print("\n▸ (b) GAP_REVIEW=1 + resume — parks, emits real gap ids, scouts filtered")
    set_gate_env(True, timeout_s=30)
    AGENT_CALLS.clear()
    events: list[dict] = []
    gate = GapGate()
    task = await start_run(events, gate)

    parked = await wait_parked(gate)
    check("run parks at the gate after gap analysis", parked and not task.done())
    await asyncio.sleep(0.1)  # give a paused run time to misbehave
    check("no scout launched while parked", scout_calls() == [],
          f"saw {scout_calls()}")

    review = [e for e in events if e["kind"] == "gate.gap_review"]
    check("exactly one gate.gap_review event", len(review) == 1)
    if review:
        data = review[0].get("data", {})
        gaps = data.get("gaps", [])
        check("payload shape is {gaps, timeoutS}", set(data) == {"gaps", "timeoutS"},
              f"keys={sorted(data)}")
        check("gap items are {id,title,detail,severity}",
              all(set(g) == {"id", "title", "detail", "severity"} for g in gaps))
        check("gap ids are synthesized gap-1..n in gap order",
              [g["id"] for g in gaps] == ["gap-1", "gap-2", "gap-3"],
              f"saw {[g.get('id') for g in gaps]}")
        check("gap content maps real DataNeed fields",
              gaps[0]["title"] == "grid" and "interconnection study" in gaps[0]["detail"])
        check("timeoutS passed through", data.get("timeoutS") == 30)

    gate.resolve(["gap-1", "gap-3"])
    report = await asyncio.wait_for(task, timeout=15)
    check("run completes after resume", report.decision == "Investigate")
    check("scouts chased only the approved subset, in gap order",
          scout_calls() == ["DataScout:grid", "DataScout:finance"],
          f"saw {scout_calls()}")
    resolved = [e for e in events if e["kind"] == "gate.resolved"]
    check("gate.resolved emitted once", len(resolved) == 1)
    if resolved:
        check("resolved payload is mode=approved with the approved ids",
              resolved[0].get("data") == {"mode": "approved", "approved": ["gap-1", "gap-3"]},
              f"saw {resolved[0].get('data')}")
        check("resolved event at info level", resolved[0].get("level") == "info")
    check("gate no longer parked after resume", not gate.awaiting)


async def case_resume_empty() -> None:
    print("\n▸ (b2) enabled + empty approval — scouts skipped entirely, not an error")
    set_gate_env(True, timeout_s=30)
    AGENT_CALLS.clear()
    events: list[dict] = []
    gate = GapGate()
    task = await start_run(events, gate)
    await wait_parked(gate)
    gate.resolve([])
    report = await asyncio.wait_for(task, timeout=15)
    check("run completes with zero approved gaps", report.decision == "Investigate")
    check("zero scouts dispatched", scout_calls() == [], f"saw {scout_calls()}")
    skipped = [e for e in events if e["kind"] == "gate.scouts_skipped"]
    check("skip surfaced as a trace note (not an error)",
          len(skipped) == 1 and skipped[0]["level"] == "info")
    check("resolved payload records the empty approval",
          any(e["kind"] == "gate.resolved"
              and e.get("data") == {"mode": "approved", "approved": []} for e in events))


# ── (c) enabled + timeout ────────────────────────────────────────────────────

async def case_timeout() -> None:
    print("\n▸ (c) GAP_REVIEW=1, TIMEOUT_S=1, no resume — all gaps, mode=timeout, warn")
    set_gate_env(True, timeout_s=1)
    AGENT_CALLS.clear()
    events: list[dict] = []
    gate = GapGate()
    t0 = time.monotonic()
    report = await asyncio.wait_for(await start_run(events, gate), timeout=15)
    elapsed = time.monotonic() - t0
    check("run completes without any resume", report.decision == "Investigate")
    check("the wait actually happened (~1s)", elapsed >= 1.0, f"elapsed={elapsed:.2f}s")
    check("scouts chased ALL gaps after timeout",
          scout_calls() == ["DataScout:grid", "DataScout:water", "DataScout:finance"],
          f"saw {scout_calls()}")
    resolved = [e for e in events if e["kind"] == "gate.resolved"]
    check("gate.resolved emitted once", len(resolved) == 1)
    if resolved:
        check("resolved payload is mode=timeout with every gap id",
              resolved[0].get("data")
              == {"mode": "timeout", "approved": ["gap-1", "gap-2", "gap-3"]},
              f"saw {resolved[0].get('data')}")
        check("timeout resolved at WARN level", resolved[0].get("level") == "warn",
              f"level={resolved[0].get('level')}")


# ── (d) resume endpoint ───────────────────────────────────────────────────────

def case_endpoint() -> None:
    print("\n▸ (d) POST /api/jobs/{id}/resume — 404 / 409 / 200 contract")
    from fastapi.testclient import TestClient
    client = TestClient(main.app)

    r = client.post("/api/jobs/nope/resume", json={"approved": []})
    check("unknown job → 404", r.status_code == 404, f"got {r.status_code}")

    # Known job (trace exists) with no gate registered → not awaiting.
    main.JOB_TRACES["t-known"] = Trace("t-known")
    r = client.post("/api/jobs/t-known/resume", json={"approved": ["gap-1"]})
    check("known job, no gate → 409", r.status_code == 409, f"got {r.status_code}")
    main.JOB_TRACES.pop("t-known", None)

    # Known job whose gate exists but isn't parked (GAP_REVIEW off or already
    # resolved) → still 409.
    g = GapGate()
    main.JOB_TRACES["t-idle"] = Trace("t-idle")
    main.JOB_GATES["t-idle"] = g
    r = client.post("/api/jobs/t-idle/resume", json={"approved": ["gap-1"]})
    check("known job, gate not awaiting → 409", r.status_code == 409, f"got {r.status_code}")

    # Parked job → 200 and the waiting pipeline's mailbox is filled.
    g.awaiting = True
    r = client.post("/api/jobs/t-idle/resume", json={"approved": ["gap-2"]})
    check("parked job → 200 {'ok':true,'mode':'approved'}",
          r.status_code == 200 and r.json() == {"ok": True, "mode": "approved"},
          f"got {r.status_code} {r.text[:80]}")
    check("resume releases the event and stores the approved ids",
          g.event.is_set() and g.approved == ["gap-2"])
    g.awaiting = False  # pipeline flips this when it wakes
    r = client.post("/api/jobs/t-idle/resume", json={"approved": ["gap-1"]})
    check("already-resolved gate → 409", r.status_code == 409, f"got {r.status_code}")
    main.JOB_TRACES.pop("t-idle", None)
    main.JOB_GATES.pop("t-idle", None)


# ── (e) Port mapping ─────────────────────────────────────────────────────────

def case_port_mapping() -> None:
    print("\n▸ (e) Port mirror — gate.gap_review → AWAITING_GAP_REVIEW, resolved → RUNNING")

    class FakeClient:
        def __init__(self):
            self.upserts: list[dict] = []

        def upsert_entity(self, blueprint, identifier, title="",
                          properties=None, relations=None):
            self.upserts.append({"bp": blueprint, "id": identifier,
                                 "props": properties or {}})

    fake = FakeClient()
    rep = PortReporter("jobp", client=fake, log=lambda m: None)
    rep.handle_event({"kind": "gate.gap_review",
                      "data": {"gaps": [{"id": "gap-1"}], "timeoutS": 300}})
    rep.handle_event({"kind": "gate.resolved",
                      "data": {"mode": "approved", "approved": ["gap-1"]}})
    check("gap_review parks the factory_run as AWAITING_GAP_REVIEW",
          len(fake.upserts) >= 1 and fake.upserts[0]["bp"] == "factory_run"
          and fake.upserts[0]["props"].get("status") == "AWAITING_GAP_REVIEW",
          f"saw {fake.upserts[:1]}")
    check("gate.resolved flips the factory_run back to RUNNING",
          len(fake.upserts) == 2 and fake.upserts[1]["props"].get("status") == "RUNNING",
          f"saw {fake.upserts[1:]}")
    check("handler never raises on junk events",
          rep.handle_event({"kind": "gate.gap_review"}) is None or True)


# ── driver ────────────────────────────────────────────────────────────────────

async def main_async() -> None:
    await case_disabled()
    await case_resume()
    await case_resume_empty()
    await case_timeout()


try:
    asyncio.run(main_async())
    case_endpoint()
    case_port_mapping()
finally:
    pipeline._agent = _orig_agent
    pipeline.PIPELINE_MODE = _orig_mode
    for k, v in _orig_env.items():
        os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)

print("\n" + "─" * 56)
if failures:
    print(f"❌ {failures} check(s) failed")
    sys.exit(1)
print("✅ gap-gate: all offline checks pass (no LLM, no Port, no network)")
