"""Daytona sandbox execution, with the lifecycle made visible.

`sandbox_run` used to fall back to `exec(code)` on the host whenever
`DAYTONA_API_KEY` was unset — which was the default. That runs
model-generated code on the developer's machine with no isolation, so it is
gone. Without a key this module now refuses to execute rather than executing
somewhere unsafe, and says so in the trace.

Every phase of the sandbox lifecycle is timed separately (create, exec,
delete), because "the agent is slow" and "Daytona took 8s to provision" look
identical from the outside otherwise.
"""
from __future__ import annotations

import os
import contextlib
from typing import Any

from .obs import Trace, current_trace

DAYTONA_API_KEY = os.getenv("DAYTONA_API_KEY", "")
DAYTONA_API_URL = os.getenv("DAYTONA_API_URL", "https://app.daytona.io/api")

# Escape hatch for offline work. Must be set deliberately; it is never the
# default, and it is loud in the trace every single time it is used.
ALLOW_HOST_EXEC = os.getenv("DANGEROUSLY_ALLOW_HOST_EXEC", "0") == "1"

# Auto-stop / auto-delete so a crashed run cannot leave a box billing forever.
AUTO_STOP_MINUTES = int(os.getenv("DAYTONA_AUTO_STOP_MIN", "15"))
AUTO_DELETE_MINUTES = int(os.getenv("DAYTONA_AUTO_DELETE_MIN", "60"))

SANDBOX_TIMEOUT = int(os.getenv("SANDBOX_TIMEOUT", "120"))

# Hosts sandboxed code may reach. Everything else is refused at the sandbox
# boundary, which is what makes injecting a live API key tolerable: generated
# code can spend the key against the model endpoint, but cannot POST it to an
# attacker's collector. Widen this list only with that tradeoff in mind.
# Both providers are listed so either LLM_PROVIDER works from inside the box.
SANDBOX_ALLOWED_DOMAINS = [
    d.strip()
    for d in os.getenv(
        "SANDBOX_ALLOWED_DOMAINS", "api.anthropic.com,hackathon.josephbissell.com"
    ).split(",")
    if d.strip()
]


class SandboxUnavailable(RuntimeError):
    pass


def _sandbox_env() -> dict[str, str]:
    """Credentials handed to code running inside the sandbox, so an agent can
    call the model from in there rather than round-tripping through the host.

    Only model credentials travel, for whichever provider is selected. Daytona's
    own key stays on the host — sandboxed code that could read it could spawn
    further sandboxes.
    """
    env = {"ANTHROPIC_MODEL": os.getenv("ANTHROPIC_MODEL", "claude-opus-5")}
    if key := os.getenv("ANTHROPIC_API_KEY"):
        env["ANTHROPIC_API_KEY"] = key
    # OpenAI-compatible bridge credentials (the Daytona bots' model call), so
    # code in the box reaches the same provider the agent outside it is using.
    for var in ("LLM_PROVIDER", "LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"):
        if val := os.getenv(var):
            env[var] = val
    return env


def sandbox_health(trace: Trace) -> dict[str, Any]:
    """Cheap connectivity probe: can we reach Daytona and authenticate?
    Called at startup so a misconfigured key surfaces before a run, not
    eight minutes into one."""
    if not DAYTONA_API_KEY:
        trace.warn("sandbox.health", "DAYTONA_API_KEY not set — sandbox execution disabled")
        return {"configured": False, "reachable": False}

    import httpx
    with trace.span("sandbox.health", "probing Daytona API") as sp:
        try:
            r = httpx.get(
                f"{DAYTONA_API_URL}/sandbox",
                headers={"Authorization": f"Bearer {DAYTONA_API_KEY}"},
                timeout=15,
            )
            ok = r.status_code == 200
            sp["status"] = r.status_code
            sp["existingSandboxes"] = len(r.json().get("items", [])) if ok else None
            return {"configured": True, "reachable": ok, "status": r.status_code}
        except Exception as exc:
            sp["error"] = str(exc)
            return {"configured": True, "reachable": False, "error": str(exc)}


def sandbox_run(code: str, trace: Trace | None = None) -> str:
    """Execute model-generated code in an isolated Daytona sandbox.

    The sandbox is created per call and deleted in a `finally`, so a failure
    mid-execution still tears the box down.

    With no explicit trace, the ambient job trace is used — so a sandbox an
    agent spins up shows up in that job's stream and `/trace` replay rather
    than only on stdout.
    """
    t = trace or current_trace()

    session = current_session()
    if session is not None and session.active:
        # Reuse the box this agent already owns.
        return session.run(code)

    if not DAYTONA_API_KEY:
        if not ALLOW_HOST_EXEC:
            t.error(
                "sandbox.refused",
                "no DAYTONA_API_KEY and host execution not permitted — refusing to run "
                "model-generated code on the host",
                codePreview=code[:200],
            )
            raise SandboxUnavailable(
                "DAYTONA_API_KEY is not set. Set it to execute in a sandbox, or set "
                "DANGEROUSLY_ALLOW_HOST_EXEC=1 to run on the host (development only)."
            )
        t.warn(
            "sandbox.host_exec",
            "executing model-generated code ON THE HOST — no isolation "
            "(DANGEROUSLY_ALLOW_HOST_EXEC=1)",
            codePreview=code[:200],
        )
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            exec(code, {"__builtins__": __builtins__}, {})  # noqa: S102 — gated above
        return buf.getvalue()[:4000]

    from daytona import (
        CodeRunParams,
        CreateSandboxFromSnapshotParams,
        Daytona,
        DaytonaConfig,
    )

    client = Daytona(DaytonaConfig(api_key=DAYTONA_API_KEY, api_url=DAYTONA_API_URL))
    env = _sandbox_env()

    sb = None
    try:
        with t.span(
            "sandbox.create", "provisioning Daytona sandbox",
            allowedDomains=SANDBOX_ALLOWED_DOMAINS,
            modelCredential=bool(env.get("ANTHROPIC_API_KEY")),
        ) as sp:
            sb = client.create(
                CreateSandboxFromSnapshotParams(
                    env_vars=env,
                    # Deny-by-default egress; only the model endpoint is reachable.
                    domain_allow_list=SANDBOX_ALLOWED_DOMAINS,
                    # Torn down with the sandbox rather than lingering between runs.
                    ephemeral=True,
                    auto_stop_interval=AUTO_STOP_MINUTES,
                    auto_delete_interval=AUTO_DELETE_MINUTES,
                )
            )
            sp["sandboxId"] = getattr(sb, "id", None)

        with t.span("sandbox.exec", f"running {len(code)} chars of generated code",
                    timeout=SANDBOX_TIMEOUT) as sp:
            res = sb.process.code_run(code, CodeRunParams(env=env), timeout=SANDBOX_TIMEOUT)
            out = (getattr(res, "result", "") or "")[:4000]
            sp["exitCode"] = getattr(res, "exit_code", None)
            sp["outputChars"] = len(out)
        return out

    finally:
        if sb is not None:
            try:
                with t.span("sandbox.delete", "tearing down sandbox",
                            sandboxId=getattr(sb, "id", None)):
                    sb.delete()
            except Exception as exc:
                # A leaked sandbox costs money, so this is a warning, not a shrug.
                t.warn("sandbox.leak", f"failed to delete sandbox: {exc}",
                       sandboxId=getattr(sb, "id", None))


def sandbox_selftest(trace: Trace | None = None) -> dict[str, Any]:
    """End-to-end proof that Daytona works: create, execute, verify, delete.
    Wired to `GET /api/health/sandbox` so the whole path can be checked from
    the dashboard without starting a diligence run."""
    t = trace or Trace()
    health = sandbox_health(t)
    if not health.get("reachable"):
        return {"ok": False, "health": health}

    with t.span("sandbox.selftest", "end-to-end sandbox check") as sp:
        out = sandbox_run("print(6 * 7)", t)
        ok = out.strip() == "42"
        sp["output"] = out.strip()
        sp["ok"] = ok
    return {"ok": ok, "health": health, "output": out.strip()}


# ── per-agent sandbox sessions ───────────────────────────────────────────────
#
# A sandbox per *tool call* means an agent that calls sandbox_run three times
# provisions three boxes. A sandbox per *agent run* is created once, reused for
# every tool call that agent makes, and torn down when it finishes — cheaper,
# and it makes provisioning deterministic rather than dependent on whether the
# model happened to reach for the tool.

import asyncio
import threading
from contextvars import ContextVar

# Daytona is rate-limited and a run fans out wide (a dozen scouts at once), so
# concurrent creates are bounded rather than unbounded.
MAX_CONCURRENT_SANDBOXES = int(os.getenv("DAYTONA_MAX_CONCURRENT", "8"))
SANDBOX_PER_AGENT = os.getenv("SANDBOX_PER_AGENT", "1") == "1"

_create_sem = threading.Semaphore(MAX_CONCURRENT_SANDBOXES)
_SESSION: ContextVar["SandboxSession | None"] = ContextVar("sandbox_session", default=None)


class SandboxSession:
    """One Daytona sandbox, owned by one agent run.

    Used as a context manager. Failure to provision is not fatal — the agent
    keeps working without a sandbox and the trace records why, because losing a
    whole diligence run to a sandbox hiccup is worse than losing isolation for
    one agent.
    """

    def __init__(self, label: str, trace: Trace):
        self.label = label
        self.trace = trace
        self.sb: Any = None
        self.calls = 0

    def _provision(self) -> "SandboxSession":
        if not DAYTONA_API_KEY:
            self.trace.warn("sandbox.skip", f"{self.label}: no DAYTONA_API_KEY — running without a sandbox")
            return self
        try:
            from daytona import Daytona, DaytonaConfig
            with _create_sem:
                with self.trace.span("sandbox.create", f"{self.label}: provisioning") as sp:
                    client = Daytona(DaytonaConfig(api_key=DAYTONA_API_KEY, api_url=DAYTONA_API_URL))
                    self.sb = client.create()
                    sp["sandboxId"] = getattr(self.sb, "id", None)
        except Exception as exc:
            self.trace.warn("sandbox.unavailable", f"{self.label}: provisioning failed — {exc}")
            self.sb = None
        return self

    def __enter__(self) -> "SandboxSession":
        self._provision()
        self._token = _SESSION.set(self)
        return self

    def __exit__(self, *exc_info) -> None:
        try:
            _SESSION.reset(self._token)
        except Exception:
            pass
        self._teardown()

    def _teardown(self) -> None:
        if self.sb is None:
            return
        try:
            with self.trace.span("sandbox.delete", f"{self.label}: teardown",
                                 sandboxId=getattr(self.sb, "id", None), codeRuns=self.calls):
                self.sb.delete()
        except Exception as exc:
            self.trace.warn("sandbox.leak", f"{self.label}: delete failed — {exc}",
                            sandboxId=getattr(self.sb, "id", None))

    @property
    def active(self) -> bool:
        return self.sb is not None

    def run(self, code: str) -> str:
        if self.sb is None:
            raise SandboxUnavailable(f"{self.label}: no sandbox available")
        self.calls += 1
        with self.trace.span("sandbox.exec", f"{self.label}: run #{self.calls}",
                             codeChars=len(code)) as sp:
            res = self.sb.process.code_run(code)
            out = (getattr(res, "result", "") or "")[:4000]
            sp["exitCode"] = getattr(res, "exit_code", None)
            sp["outputChars"] = len(out)
            return out


def current_session() -> "SandboxSession | None":
    return _SESSION.get()


@contextlib.contextmanager
def agent_sandbox(label: str, trace: Trace):
    """Wrap an agent run so it owns a sandbox for its lifetime."""
    if not SANDBOX_PER_AGENT:
        yield None
        return
    with SandboxSession(label, trace) as s:
        yield s


async def agent_sandbox_async(label: str, trace: Trace):
    """Async wrapper: provisioning blocks for a few hundred ms, and with a dozen
    agents starting at once that would stall the event loop. Enter and exit run
    in worker threads; the ContextVar is set on the loop's context by hand so
    tools running in *other* threads still see the session."""
    session = SandboxSession(label, trace)
    if not SANDBOX_PER_AGENT:
        return None
    await asyncio.to_thread(session._provision)
    _SESSION.set(session)
    return session


async def close_agent_sandbox(session: "SandboxSession | None") -> None:
    if session is not None:
        await asyncio.to_thread(session._teardown)
