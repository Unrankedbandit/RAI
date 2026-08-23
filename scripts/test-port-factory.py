#!/usr/bin/env python3
"""test-port-factory — offline verification of the Port control-plane wiring.

No Port account, no network: httpx.post is monkeypatched with a recorder.

  (a) happy path   — a simulated full job emits the expected Port call sequence
                     (token → run upsert → stage updates → agent runs →
                     AWAITING_REVIEW with report URL → findings)
  (b) Port down    — connection errors and 401s are swallowed; the job flow
                     still completes and can report its own failure
  (c) no creds     — a disabled client performs ZERO HTTP calls

Run from repo root with the venv on PATH:
  PATH=".venv/bin:$PATH" python scripts/test-port-factory.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from agent_backend.port_client import PortClient, PortReporter  # noqa: E402

PASS, FAIL = "✅", "❌"
failures = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failures
    print(f"  {PASS if cond else FAIL} {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures += 1


class FakeResponse:
    def __init__(self, payload: dict, status: int = 200):
        self.payload = payload
        self.status_code = status

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            req = httpx.Request("POST", "https://fake")
            raise httpx.HTTPStatusError(
                f"{self.status_code}", request=req,
                response=httpx.Response(self.status_code, request=req))

    def json(self) -> dict:
        return self.payload


def make_recorder(fail_with: Exception | None = None):
    calls: list[dict] = []

    def fake_post(url, json=None, params=None, headers=None, timeout=None):
        calls.append({"url": url, "json": json or {}, "params": params or {},
                      "headers": headers or {}})
        if fail_with is not None:
            raise fail_with
        if url.endswith("/auth/access_token"):
            return FakeResponse({"accessToken": "fake-token"})
        return FakeResponse({"ok": True, "entity": {"identifier": (json or {}).get("identifier")}})

    return calls, fake_post


def drive_full_job(reporter: PortReporter) -> None:
    """Emit the same trace events pipeline.py/main.py emit for one job."""
    reporter.start("Sunspire Solar", "Mohave County, AZ", ["site-plan.pdf"])
    for phase in ("orchestrate", "extract", "score", "liaison", "compose"):
        reporter.handle_event({"kind": "phase", "data": {"phase": phase}})
    reporter.handle_event({"kind": "tool.done", "agent": "Extractor:site-plan.pdf"})
    reporter.handle_event({"kind": "tool.done", "agent": "Extractor:site-plan.pdf"})
    reporter.handle_event({"kind": "agent.done", "agent": "Extractor:site-plan.pdf",
                           "durationMs": 1234})
    reporter.handle_event({"kind": "agent.error", "agent": "Researcher:core",
                           "durationMs": 555})
    report = SimpleNamespace(
        red_flags=[SimpleNamespace(title="Flood plain overlap", severity="high",
                                   evidence="FEMA map vs site plan")],
        contradictions=[SimpleNamespace(claim_a="100MW stated", severity="medium")],
        missing_info=["interconnection study"],
    )
    reporter.awaiting_review("http://localhost:8000/api/reports/job1",
                             readiness=62, decision="CONDITIONAL", report=report)


def entity_upserts(calls: list[dict]) -> list[dict]:
    return [c for c in calls if "/entities" in c["url"]]


print("\n▸ (a) happy path — full job emits the expected Port call sequence")
calls, fake = make_recorder()
orig_post = httpx.post
httpx.post = fake
try:
    client = PortClient("id", "secret", "https://api.getport.test", log=lambda m: None)
    drive_full_job(PortReporter("job1", client=client, log=lambda m: None))
    client.flush()
finally:
    httpx.post = orig_post

upserts = entity_upserts(calls)
run_upserts = [u for u in upserts if "factory_run" in u["url"]]
agent_upserts = [u for u in upserts if "factory_agent_run" in u["url"]]
finding_upserts = [u for u in upserts if "factory_finding" in u["url"]]

check("one token call, cached for the whole run",
      sum(1 for c in calls if c["url"].endswith("/auth/access_token")) == 1)
check("token call carries clientId/clientSecret",
      calls[0]["json"] == {"clientId": "id", "clientSecret": "secret"})
check("upserts use ?upsert=true&merge=true",
      all(u["params"] == {"upsert": "true", "merge": "true"} for u in upserts))
check("upserts are authorized", all(
    u["headers"].get("Authorization") == "Bearer fake-token" for u in upserts))
check("run entity created at start (stage=queued, RUNNING)",
      run_upserts[0]["json"]["properties"]["stage"] == "queued"
      and run_upserts[0]["json"]["properties"]["status"] == "RUNNING")
check("every phase boundary updates run.stage",
      [u["json"]["properties"]["stage"] for u in run_upserts[1:6]]
      == ["orchestrate", "extract", "score", "liaison", "compose"])
check("agent runs parented to the run via relation",
      all(u["json"]["relations"] == {"factory_run": "job1"} for u in agent_upserts))
check("agent durations + tool-call counts recorded",
      any(u["json"]["properties"]["durationMs"] == 1234
          and u["json"]["properties"]["toolCalls"] == 2 for u in agent_upserts)
      and any(u["json"]["properties"]["status"] == "FAILED" for u in agent_upserts))
final = run_upserts[-1]["json"]["properties"]
check("terminal state is AWAITING_REVIEW with report URL + score",
      final["status"] == "AWAITING_REVIEW"
      and final["reportUrl"] == "http://localhost:8000/api/reports/job1"
      and final["readiness"] == 62 and final["decision"] == "CONDITIONAL")
check("findings emitted as entities related to the run",
      len(finding_upserts) == 3
      and {f["json"]["properties"]["kind"] for f in finding_upserts}
      == {"red_flag", "contradiction", "missing_info"})
print(f"     ({len(calls)} HTTP calls total: 1 token + {len(upserts)} upserts)")

print("\n▸ (b) Port down / 401 — job still completes")
for label, err in [("connection refused",
                    httpx.ConnectError("refused", request=httpx.Request("POST", "https://x"))),
                   ("401 unauthorized", None)]:
    calls_b, fake_b = make_recorder(fail_with=err) if err else (None, None)
    if err is None:
        def fake_401(url, json=None, params=None, headers=None, timeout=None):
            calls_b.append({"url": url})
            req = httpx.Request("POST", url)
            raise httpx.HTTPStatusError("401", request=req,
                                        response=httpx.Response(401, request=req))
        calls_b, fake_b = [], fake_401
    httpx.post = fake_b
    try:
        client_b = PortClient("id", "secret", "https://api.getport.test", log=lambda m: None)
        rep = PortReporter("job2", client=client_b, log=lambda m: None)
        rep.start("P", "L", [])
        rep.handle_event({"kind": "phase", "data": {"phase": "score"}})
        rep.awaiting_review("http://x/api/reports/job2", 40, "HOLD", report=None)
        rep.failed("AgentDidNotConverge", "Scorer did not converge")
        client_b.flush()
        completed = True
    except Exception:
        completed = False
    finally:
        httpx.post = orig_post
    check(f"job flow survives Port {label}", completed and len(calls_b) > 0)

print("\n▸ (c) no credentials — zero HTTP calls")
calls_c, fake_c = make_recorder()
httpx.post = fake_c
try:
    client_c = PortClient("", "", "https://api.getport.test", log=lambda m: None)
    rep = PortReporter("job3", client=client_c, log=lambda m: None)
    drive_full_job(rep)
    rep.failed("Boom", "x")
    client_c.flush()
finally:
    httpx.post = orig_post
check("disabled client performed zero HTTP calls", len(calls_c) == 0,
      f"saw {len(calls_c)} calls")

# ── (d) startup reconciliation: RUNNING zombies → FAILED/WorkerLost ──────────
print("\n▸ (d) orphan reconciliation sweeps dead workers' RUNNING runs")
calls_d: list[dict] = []
orig_get = httpx.get


def fake_post_d(url, json=None, params=None, headers=None, timeout=None):
    calls_d.append({"url": url, "json": json or {}})
    if url.endswith("/v1/auth/access_token"):
        return FakeResponse({"accessToken": "t"})
    return FakeResponse({"ok": True})


def fake_get_d(url, headers=None, timeout=None):
    return FakeResponse({"entities": [
        {"identifier": "zombie-1", "properties": {"status": "RUNNING"}},
        {"identifier": "alive-1", "properties": {"status": "RUNNING"}},
        {"identifier": "done-1", "properties": {"status": "AWAITING_REVIEW"}},
    ]})


httpx.post = fake_post_d
httpx.get = fake_get_d
try:
    client_d = PortClient("id", "secret", "https://api.getport.test", log=lambda m: None)
    client_d.reconcile_orphans(active_ids={"alive-1"})
    client_d.flush()
finally:
    httpx.post = orig_post
    httpx.get = orig_get

upserts = [c for c in calls_d if "entities" in c["url"]]
zombie = [c for c in upserts if c["json"].get("identifier") == "zombie-1"]
check("exactly one orphan upserted", len(zombie) == 1,
      f"upserts: {[c['json'].get('identifier') for c in upserts]}")
check("orphan flipped to FAILED/WorkerLost",
      bool(zombie) and zombie[0]["json"]["properties"]["status"] == "FAILED"
      and zombie[0]["json"]["properties"]["errorClass"] == "WorkerLost")
check("active and non-RUNNING runs untouched",
      all(c["json"].get("identifier") not in ("alive-1", "done-1") for c in upserts))

print("\n" + "─" * 56)
if failures:
    print(f"❌ {failures} check(s) failed")
    sys.exit(1)
print("✅ port-factory: all offline checks pass (no Port account used)")
