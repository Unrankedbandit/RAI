"""Port (port.io) control-plane client — OPTIONAL integration, same pattern as
Bright Data: when PORT_CLIENT_ID/PORT_CLIENT_SECRET are unset every method
is a no-op (one debug line at import) and the pipeline runs end-to-end without
Port ever being contacted.

What Port gets when it IS configured (the "software factory" control plane):

  factory_run         one entity per diligence job — project, stage, status,
                      readiness, decision, report URL. Updated on every phase
                      boundary, finished as AWAITING_REVIEW so a human approves
                      in Port before the result is treated as final.
  factory_agent_run   one entity per agent execution — role, duration, tool
                      calls, status — related back to its factory_run.
  factory_finding     red flags / contradictions / gaps, related to the run, so
                      Port scorecards and dashboards can aggregate across runs.

Every call is fire-and-forget: HTTP happens on a daemon thread pool, failures
are logged and swallowed, and nothing here can block or fail a job.

API facts (docs.port.io, verified 2026-08-22):
  token:  POST {base}/v1/auth/access_token  {"clientId","clientSecret"} → {"accessToken"}
  upsert: POST {base}/v1/blueprints/{bp}/entities?upsert=true&merge=true
          {"identifier","title","properties","relations"}
  bases:  EU https://api.port.io · US https://api.us.port.io
"""
from __future__ import annotations

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

PORT_CLIENT_ID = os.getenv("PORT_CLIENT_ID", "")
PORT_CLIENT_SECRET = os.getenv("PORT_CLIENT_SECRET", "")
PORT_API_BASE = os.getenv("PORT_API_BASE", "https://api.port.io").rstrip("/")

# Tokens are valid for 3h per the docs; refresh well before that.
_TOKEN_TTL = 2.5 * 3600
_HTTP_TIMEOUT = 10

LogFn = Callable[[str], None]


def _default_log(msg: str) -> None:
    print(f"[port] {msg}", flush=True)


class PortClient:
    """Thin httpx wrapper over the two Port endpoints the factory needs.
    A disabled client (no creds) performs zero HTTP calls."""

    def __init__(
        self,
        client_id: str = PORT_CLIENT_ID,
        client_secret: str = PORT_CLIENT_SECRET,
        api_base: str = PORT_API_BASE,
        log: LogFn = _default_log,
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.api_base = api_base.rstrip("/")
        self.log = log
        self._token: str | None = None
        self._token_at = 0.0
        self._lock = threading.Lock()
        # One worker: stage updates must reach Port in submission order, and a
        # hung Port (10s timeout) only delays later mirrors, never the job.
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="port")
        self._inflight: list[Any] = []
        if not self.enabled:
            self.log("PORT_CLIENT_ID/PORT_CLIENT_SECRET unset — Port reporting disabled")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)

    # -- HTTP (sync, always invoked on the pool) ------------------------------

    def _get_token(self) -> str:
        with self._lock:
            if self._token and time.monotonic() - self._token_at < _TOKEN_TTL:
                return self._token
            import httpx

            r = httpx.post(
                f"{self.api_base}/v1/auth/access_token",
                json={"clientId": self.client_id, "clientSecret": self.client_secret},
                timeout=_HTTP_TIMEOUT,
            )
            r.raise_for_status()
            self._token = r.json()["accessToken"]
            self._token_at = time.monotonic()
            return self._token

    def _upsert_sync(self, blueprint: str, identifier: str, title: str,
                     properties: dict, relations: dict) -> None:
        import httpx

        token = self._get_token()
        r = httpx.post(
            f"{self.api_base}/v1/blueprints/{blueprint}/entities",
            params={"upsert": "true", "merge": "true"},
            json={
                "identifier": identifier,
                "title": title,
                "properties": properties,
                "relations": relations,
            },
            headers={"Authorization": f"Bearer {token}"},
            timeout=_HTTP_TIMEOUT,
        )
        r.raise_for_status()

    # -- public: fire-and-forget ----------------------------------------------

    def upsert_entity(self, blueprint: str, identifier: str, title: str = "",
                      properties: dict | None = None, relations: dict | None = None) -> None:
        """Create or merge-update an entity. Returns immediately; the HTTP call
        runs on a background thread and any failure is logged, never raised."""
        if not self.enabled:
            return
        props, rels = properties or {}, relations or {}

        def task() -> None:
            try:
                self._upsert_sync(blueprint, identifier, title or identifier, props, rels)
            except Exception as e:
                self.log(f"upsert {blueprint}/{identifier} failed "
                         f"({type(e).__name__}: {str(e)[:120]}) — job unaffected")

        fut = self._pool.submit(task)
        self._inflight.append(fut)

    def flush(self, timeout: float = 15) -> None:
        """Test/debug hook: wait for all queued Port calls to settle."""
        for fut in list(self._inflight):
            try:
                fut.result(timeout=timeout)
            except Exception:
                pass


# Process-wide singleton, built from env at import. main.py constructs
# job-scoped PortReporters on top of this.
port = PortClient()


# ── job-scoped reporter ───────────────────────────────────────────────────────

# Trace "phase" values (pipeline.py) → factory_run.stage. Phases not listed map
# through unchanged so new stages don't require a client change.
_RUN_BP = "factory_run"
_AGENT_RUN_BP = "factory_agent_run"
_FINDING_BP = "factory_finding"

_STATUS_AWAITING = "AWAITING_REVIEW"
# Mid-run gap-review gate (GAP_REVIEW=1): parked waiting on a human's gap
# approval — distinct from the terminal AWAITING_REVIEW report sign-off.
_STATUS_AWAITING_GAP_REVIEW = "AWAITING_GAP_REVIEW"


class PortReporter:
    """Mirrors one job's Trace/phase boundaries into Port entities.

    Wired in main.py as a second sink on the job's Trace: every trace event the
    pipeline already emits (phase transitions, agent spans, tool calls) is
    replayed here, so pipeline.py needs no Port-specific code. Also callable
    standalone (scripts/e2e.py) — a disabled client makes all of it a no-op.
    """

    def __init__(self, job_id: str, client: PortClient | None = None,
                 log: LogFn | None = None):
        self.job_id = job_id
        self.client = client or port
        self.log = log or _default_log
        self._tool_calls: dict[str, int] = {}

    # -- lifecycle (called explicitly from main.py) ----------------------------

    def start(self, project: str, location: str, docs: list[str]) -> None:
        self.client.upsert_entity(
            _RUN_BP, self.job_id, f"{project} — {self.job_id}",
            properties={
                "project": project,
                "location": location,
                "stage": "queued",
                "status": "RUNNING",
                "documents": docs,
                "pipelineMode": os.getenv("PIPELINE_MODE", "fast"),
                "startedAt": _now_iso(),
            },
        )

    def awaiting_review(self, report_url: str, readiness: int | None,
                        decision: str | None, report: Any | None = None) -> None:
        """Terminal state for a successful run: a human must review in Port
        before the result is treated as approved."""
        self.client.upsert_entity(
            _RUN_BP, self.job_id, properties={
                "stage": "done",
                "status": _STATUS_AWAITING,
                "readiness": readiness,
                "decision": decision,
                "reportUrl": report_url,
                "finishedAt": _now_iso(),
            },
        )
        if report is not None:
            self._emit_findings(report)

    def failed(self, error_class: str, message: str) -> None:
        self.client.upsert_entity(
            _RUN_BP, self.job_id, properties={
                "status": "FAILED",
                "errorClass": error_class,
                "errorMessage": message[:300],
                "finishedAt": _now_iso(),
            },
        )

    # -- trace sink (called for every event on the job's Trace) ----------------

    def handle_event(self, ev: dict) -> None:
        """Replays trace events into Port. Never raises — a Port hiccup must
        not reach the SSE queue or the pipeline."""
        try:
            kind = ev.get("kind", "")
            if kind == "phase":
                # Event.to_json() puts `phase` at top level; `data.phase` is
                # the defensive fallback for hand-built events.
                stage = ev.get("phase") or (ev.get("data") or {}).get("phase")
                if stage:
                    self.client.upsert_entity(
                        _RUN_BP, self.job_id,
                        properties={"stage": stage, "status": "RUNNING"},
                    )
            elif kind == "gate.gap_review":
                # Pipeline parked at the human gap-review gate (mid-run).
                self.client.upsert_entity(
                    _RUN_BP, self.job_id,
                    properties={"status": _STATUS_AWAITING_GAP_REVIEW},
                )
            elif kind == "gate.resolved":
                # Human approved (or the timeout fired) — the run is moving
                # again; the next phase event will also refresh the stage.
                self.client.upsert_entity(
                    _RUN_BP, self.job_id,
                    properties={"status": "RUNNING"},
                )
            elif kind == "tool.done" and ev.get("agent"):
                agent = ev["agent"]
                self._tool_calls[agent] = self._tool_calls.get(agent, 0) + 1
            elif kind in ("agent.done", "agent.error") and ev.get("agent"):
                agent = ev["agent"]
                self.client.upsert_entity(
                    _AGENT_RUN_BP, f"{self.job_id}:{agent}", agent,
                    properties={
                        "role": agent.split(":")[0],
                        "status": "SUCCEEDED" if kind == "agent.done" else "FAILED",
                        "durationMs": ev.get("durationMs"),
                        "toolCalls": self._tool_calls.get(agent, 0),
                    },
                    relations={"factory_run": self.job_id},
                )
        except Exception as e:
            self.log(f"event mirror failed ({type(e).__name__}) — ignored")

    # -- internals --------------------------------------------------------------

    def _emit_findings(self, report: Any) -> None:
        """Red flags / contradictions / gaps as first-class catalog entities,
        capped so a pathological report can't burst the thread pool."""
        findings: list[tuple[str, str, str]] = []  # (kind, severity, summary)
        for f in getattr(report, "red_flags", []) or []:
            findings.append(("red_flag", str(getattr(f, "severity", "")),
                             f"{f.title} — {getattr(f, 'evidence', '')}"))
        for c in getattr(report, "contradictions", []) or []:
            summary = getattr(c, "claim_a", "") or getattr(c, "summary", "") or str(c)[:200]
            findings.append(("contradiction", str(getattr(c, "severity", "")), summary))
        for g in (getattr(report, "missing_info", []) or []):
            findings.append(("missing_info", "", str(g)))
        for i, (kind, severity, summary) in enumerate(findings[:25]):
            self.client.upsert_entity(
                _FINDING_BP, f"{self.job_id}:{kind}:{i}", summary[:80] or kind,
                properties={"kind": kind, "severity": severity, "summary": summary[:500]},
                relations={"factory_run": self.job_id},
            )


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
