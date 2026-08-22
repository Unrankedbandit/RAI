#!/usr/bin/env python3
"""test-in-app-review — offline verification of the human review endpoints.

No Port account, no network, no LLM: httpx.post is monkeypatched with a
recorder and the report store is pointed at a temp dir. Exercises the real
FastAPI app via TestClient.

  (a) round-trip  — GET (AWAITING_REVIEW default) → POST APPROVED → GET
  (b) guardrails  — 404 unknown report (GET+POST), 409 on re-decide, explicit
                    override:true changes the decision, 422 on bad input
  (c) Port mirror — POST upserts factory_run with status/reviewedBy/
                    reviewedAt/reviewRationale (httpx mocked)
  (d) Port down   — connection error → POST still 200, sidecar written
  (e) no creds    — disabled client → POST 200 with ZERO HTTP calls

Run from repo root with the venv on PATH:
  PATH=".venv/bin:$PATH" python scripts/test-in-app-review.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Keep the Trace console printer quiet so the check output stays readable.
os.environ["TRACE_LEVEL"] = "error"

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from agent_backend import main  # noqa: E402
from agent_backend.obs import Trace  # noqa: E402
from agent_backend.port_client import PortClient  # noqa: E402

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
        return FakeResponse({"ok": True})

    return calls, fake_post


# ── fixture: temp report store + app client ──────────────────────────────────

TMP = Path(tempfile.mkdtemp(prefix="rai-review-test-"))
REPORT_ID = "reviewjob01"
(TMP / f"{REPORT_ID}.json").write_text(json.dumps({"jobId": REPORT_ID}), encoding="utf-8")

orig_store, orig_port = main.STORE, main._port
orig_post = httpx.post
main.STORE = TMP
# Default: Port unconfigured — the common case; scenarios (c)/(d) swap it.
main._port = PortClient("", "", "https://api.getport.test", log=lambda m: None)

api = TestClient(main.app)
quiet_log = lambda m: None  # noqa: E731

try:
    print("\n▸ (a) round-trip — GET default → POST APPROVED → GET decided")
    r = api.get(f"/api/reports/{REPORT_ID}/review")
    check("GET undecided → 200 AWAITING_REVIEW with null fields",
          r.status_code == 200 and r.json() == {
              "status": "AWAITING_REVIEW", "reviewedBy": None,
              "reviewedAt": None, "rationale": None}, r.text[:200])

    events: list[dict] = []
    trace = Trace(REPORT_ID, sink=events.append)
    main.JOB_TRACES[REPORT_ID] = trace  # job "still in memory" path
    r = api.post(f"/api/reports/{REPORT_ID}/review",
                 json={"decision": "APPROVED", "reviewer": "sam@co.com",
                       "rationale": "gaps acceptable"})
    check("POST APPROVED → 200 with the stored record",
          r.status_code == 200 and r.json()["status"] == "APPROVED"
          and r.json()["reviewedBy"] == "sam@co.com"
          and r.json()["rationale"] == "gaps acceptable"
          and bool(r.json()["reviewedAt"]), r.text[:200])
    check("reviewedAt is ISO8601 UTC",
          bool(re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$",
                        r.json()["reviewedAt"] or "")), r.json().get("reviewedAt"))
    check("review.decided trace event emitted on the job trace",
          any(e["kind"] == "review.decided" and e["level"] == "info"
              and e["data"].get("decision") == "APPROVED"
              and e["data"].get("reviewer") == "sam@co.com"
              and e["data"].get("report_id") == REPORT_ID for e in events),
          str([e["kind"] for e in events]))
    check("sidecar written to review/{jobId}.json (out of the Report glob)",
          (TMP / "review" / f"{REPORT_ID}.json").exists())
    main.JOB_TRACES.pop(REPORT_ID, None)

    r = api.get(f"/api/reports/{REPORT_ID}/review")
    check("GET after POST reflects the decision",
          r.status_code == 200 and r.json()["status"] == "APPROVED"
          and r.json()["reviewedBy"] == "sam@co.com", r.text[:200])

    print("\n▸ (b) guardrails — 404s, 409, explicit override, 422")
    check("GET review of unknown report → 404",
          api.get("/api/reports/nope/review").status_code == 404)
    check("POST review of unknown report → 404",
          api.post("/api/reports/nope/review",
                   json={"decision": "APPROVED", "reviewer": "x"}).status_code == 404)
    r = api.post(f"/api/reports/{REPORT_ID}/review",
                 json={"decision": "REJECTED", "reviewer": "lee@co.com"})
    check("second POST without override → 409 (no silent overwrite)",
          r.status_code == 409, f"got {r.status_code}")
    r = api.get(f"/api/reports/{REPORT_ID}/review")
    check("409 left the original decision untouched",
          r.json()["status"] == "APPROVED" and r.json()["reviewedBy"] == "sam@co.com")
    r = api.post(f"/api/reports/{REPORT_ID}/review",
                 json={"decision": "REJECTED", "reviewer": "lee@co.com",
                       "rationale": "flood risk too high", "override": True})
    check("override:true → 200 and the decision changes",
          r.status_code == 200 and r.json()["status"] == "REJECTED"
          and r.json()["reviewedBy"] == "lee@co.com", r.text[:200])
    check("missing reviewer → 422",
          api.post(f"/api/reports/{REPORT_ID}/review",
                   json={"decision": "APPROVED", "override": True}).status_code == 422)
    check("bad decision value → 422",
          api.post(f"/api/reports/{REPORT_ID}/review",
                   json={"decision": "MAYBE", "reviewer": "x", "override": True}).status_code == 422)
    check("reviewer >80 chars → 422",
          api.post(f"/api/reports/{REPORT_ID}/review",
                   json={"decision": "APPROVED", "reviewer": "x" * 81,
                         "override": True}).status_code == 422)
    check("rationale >500 chars → 422",
          api.post(f"/api/reports/{REPORT_ID}/review",
                   json={"decision": "APPROVED", "reviewer": "x",
                         "rationale": "y" * 501, "override": True}).status_code == 422)

    print("\n▸ (c) Port mirror — factory_run upserted with the decision payload")
    calls, fake = make_recorder()
    httpx.post = fake
    main._port = PortClient("id", "secret", "https://api.getport.test", log=quiet_log)
    rid2 = "reviewjob02"
    (TMP / f"{rid2}.json").write_text("{}", encoding="utf-8")
    main.JOB_TRACES.pop(rid2, None)  # exercise the fresh-Trace path
    r = api.post(f"/api/reports/{rid2}/review",
                 json={"decision": "REJECTED", "reviewer": "pat@co.com",
                       "rationale": "missing interconnection study"})
    main._port.flush()
    check("POST with Port configured → 200", r.status_code == 200, r.text[:200])
    upserts = [c for c in calls if "/entities" in c["url"]]
    check("exactly one entity upsert, to factory_run",
          len(upserts) == 1 and "/blueprints/factory_run/entities" in upserts[0]["url"],
          str([c["url"] for c in calls]))
    if upserts:
        u = upserts[0]
        props = u["json"]["properties"]
        check("upsert identifier is the jobId, merge-upsert params set",
              u["json"]["identifier"] == rid2
              and u["params"] == {"upsert": "true", "merge": "true"})
        check("properties carry status/reviewedBy/reviewedAt/reviewRationale",
              props.get("status") == "REJECTED"
              and props.get("reviewedBy") == "pat@co.com"
              and props.get("reviewRationale") == "missing interconnection study"
              and bool(re.match(r"^\d{4}-\d{2}-\d{2}T", props.get("reviewedAt", ""))),
              json.dumps(props))
        check("reviewedAt matches the sidecar record",
              props.get("reviewedAt") == r.json()["reviewedAt"])
        check("token fetched + Authorization header sent",
              any(c["url"].endswith("/auth/access_token") for c in calls)
              and u["headers"].get("Authorization") == "Bearer fake-token")

    print("\n▸ (d) Port down — POST still 200, decision persisted locally")
    calls_d, fake_d = make_recorder(
        fail_with=httpx.ConnectError("refused", request=httpx.Request("POST", "https://x")))
    httpx.post = fake_d
    main._port = PortClient("id", "secret", "https://api.getport.test", log=quiet_log)
    rid3 = "reviewjob03"
    (TMP / f"{rid3}.json").write_text("{}", encoding="utf-8")
    r = api.post(f"/api/reports/{rid3}/review",
                 json={"decision": "APPROVED", "reviewer": "sam@co.com"})
    main._port.flush()
    check("Port connection error → POST still 200",
          r.status_code == 200 and r.json()["status"] == "APPROVED", r.text[:200])
    check("Port WAS attempted (fire-and-forget, not skipped)",
          len(calls_d) > 0)
    check("sidecar still written; GET returns the decision",
          api.get(f"/api/reports/{rid3}/review").json()["status"] == "APPROVED")

    print("\n▸ (e) no credentials — zero HTTP calls, POST still 200")
    calls_e, fake_e = make_recorder()
    httpx.post = fake_e
    main._port = PortClient("", "", "https://api.getport.test", log=quiet_log)
    rid4 = "reviewjob04"
    (TMP / f"{rid4}.json").write_text("{}", encoding="utf-8")
    r = api.post(f"/api/reports/{rid4}/review",
                 json={"decision": "APPROVED", "reviewer": "sam@co.com"})
    main._port.flush()
    check("disabled client → POST 200",
          r.status_code == 200 and r.json()["status"] == "APPROVED", r.text[:200])
    check("zero HTTP calls without credentials", len(calls_e) == 0,
          f"saw {len(calls_e)} calls")
finally:
    httpx.post = orig_post
    main.STORE, main._port = orig_store, orig_port
    main.JOB_TRACES.pop(REPORT_ID, None)

print("\n" + "─" * 56)
if failures:
    print(f"❌ {failures} check(s) failed")
    sys.exit(1)
print("✅ in-app-review: all offline checks pass (no Port account used)")
