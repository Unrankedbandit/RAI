"""Structured tracing for the agent backend.

One `Trace` per job. Every event goes to three places at once:

  * **stdout** — aligned, human-readable, so you can watch a run happen live
  * **the SSE queue** — JSON, so the dashboard renders the same activity
  * **an in-memory buffer** — so `GET /api/jobs/{id}/trace` can replay it after

The point is to make the whole path visible: the HTTP request in, each agent's
loop steps, every LLM call and tool call with its latency, the sandbox
lifecycle, and the response back out. If something hangs or silently retries,
the trace shows exactly where.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator

# ── configuration ────────────────────────────────────────────────────────────

TRACE_LEVEL = os.getenv("TRACE_LEVEL", "info").lower()  # debug | info | warn
TRACE_COLOR = os.getenv("TRACE_COLOR", "auto")          # auto | always | never
TRACE_PAYLOADS = os.getenv("TRACE_PAYLOADS", "0") == "1"  # log full prompts/results

_LEVELS = {"debug": 10, "info": 20, "warn": 30, "error": 40}
_MIN_LEVEL = _LEVELS.get(TRACE_LEVEL, 20)


def _use_color() -> bool:
    if TRACE_COLOR == "always":
        return True
    if TRACE_COLOR == "never":
        return False
    return sys.stdout.isatty()


_C = {
    "dim": "\033[2m", "red": "\033[31m", "yellow": "\033[33m", "green": "\033[32m",
    "cyan": "\033[36m", "blue": "\033[34m", "magenta": "\033[35m", "bold": "\033[1m",
    "reset": "\033[0m",
}


def _c(text: str, color: str) -> str:
    return f"{_C[color]}{text}{_C['reset']}" if _use_color() else text


# ── secret redaction ─────────────────────────────────────────────────────────
#
# Traces get pasted into issues and shared in demos. Anything that looks like a
# credential is masked on the way out — at the sink, so no caller has to
# remember to do it.

_SECRET_PAT = re.compile(
    r"(sk-[A-Za-z0-9_\-]{8,}|dtn_[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._\-]{8,}"
    r"|ghp_[A-Za-z0-9]{8,}|tvly-[A-Za-z0-9]{8,})"
)


def redact(text: str) -> str:
    def mask(m: re.Match) -> str:
        s = m.group(0)
        head = s[:6]
        return f"{head}…{'*' * 6}[redacted]"
    return _SECRET_PAT.sub(mask, text)


# ── events ───────────────────────────────────────────────────────────────────

@dataclass
class Event:
    seq: int
    ts: float
    elapsed_ms: int
    level: str
    kind: str          # e.g. "llm.response", "tool.call", "sandbox.create"
    msg: str
    phase: str | None = None
    agent: str | None = None
    duration_ms: int | None = None
    data: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        d = {
            "seq": self.seq, "ts": self.ts, "elapsedMs": self.elapsed_ms,
            "level": self.level, "kind": self.kind, "msg": self.msg,
        }
        if self.phase:
            d["phase"] = self.phase
        if self.agent:
            d["agent"] = self.agent
        if self.duration_ms is not None:
            d["durationMs"] = self.duration_ms
        if self.data:
            d["data"] = self.data
        return d


_KIND_COLOR = {
    "http": "magenta", "job": "magenta", "phase": "bold", "agent": "cyan",
    "llm": "blue", "tool": "green", "sandbox": "yellow", "contract": "yellow",
}


def _fmt_console(e: Event) -> str:
    secs = e.elapsed_ms / 1000
    stamp = _c(f"{secs:7.2f}s", "dim")
    family = e.kind.split(".")[0]
    kind = _c(f"{e.kind:<18}", _KIND_COLOR.get(family, "dim"))
    who = _c(f"{(e.agent or e.phase or '-'):<16}", "dim")
    dur = _c(f" ({e.duration_ms}ms)", "dim") if e.duration_ms is not None else ""

    line = f"  {stamp} {kind} {who} {e.msg}{dur}"
    if e.level in ("warn", "error"):
        line = _c(line, "red" if e.level == "error" else "yellow")
    if e.data and (TRACE_PAYLOADS or e.level in ("warn", "error")):
        line += "\n" + _c(f"           {json.dumps(e.data, default=str)[:1200]}", "dim")
    return line


# ── trace ────────────────────────────────────────────────────────────────────

class Trace:
    """Job-scoped event emitter. Thread-affine by convention (one asyncio task
    tree per job), so `seq` needs no lock."""

    def __init__(self, job_id: str | None = None, sink: Callable[[dict], None] | None = None):
        self.job_id = job_id or uuid.uuid4().hex[:12]
        self.t0 = time.monotonic()
        self.events: list[Event] = []
        self._seq = 0
        self._sink = sink
        self._phase: str | None = None
        self._agent: str | None = None

    # -- context ------------------------------------------------------------

    def bind(self, *, phase: str | None = None, agent: str | None = None) -> "Trace":
        """Return a view that stamps every event with this phase/agent. Shares
        the parent's buffer and sequence, so ordering stays global."""
        view = Trace.__new__(Trace)
        view.job_id, view.t0, view.events = self.job_id, self.t0, self.events
        view._sink, view._parent = self._sink, self
        view._phase = phase or self._phase
        view._agent = agent or self._agent
        view.__dict__["_seq_owner"] = self
        return view

    def _next_seq(self) -> int:
        owner = self.__dict__.get("_seq_owner", self)
        owner._seq += 1
        return owner._seq

    # -- emit ---------------------------------------------------------------

    def event(self, kind: str, msg: str, *, level: str = "info",
              duration_ms: int | None = None, **data: Any) -> Event:
        e = Event(
            seq=self._next_seq(),
            ts=time.time(),
            elapsed_ms=int((time.monotonic() - self.t0) * 1000),
            level=level,
            kind=kind,
            msg=redact(str(msg)),
            phase=self._phase,
            agent=self._agent,
            duration_ms=duration_ms,
            data=json.loads(redact(json.dumps(data, default=str))) if data else {},
        )
        self.events.append(e)

        if _LEVELS.get(level, 20) >= _MIN_LEVEL:
            print(_fmt_console(e), flush=True)
        if self._sink:
            try:
                self._sink(e.to_json())
            except Exception:
                pass  # a broken sink must never take the pipeline down
        return e

    def warn(self, kind: str, msg: str, **data: Any) -> Event:
        return self.event(kind, msg, level="warn", **data)

    def error(self, kind: str, msg: str, **data: Any) -> Event:
        return self.event(kind, msg, level="error", **data)

    # -- timing -------------------------------------------------------------

    @contextmanager
    def span(self, kind: str, msg: str, **data: Any) -> Iterator[dict]:
        """Time a block. Yields a dict you can mutate; its contents are merged
        into the closing event, so a caller can report what it learned
        (token counts, result size) without a second call."""
        start = time.monotonic()
        self.event(f"{kind}.start", msg, level="debug", **data)
        extra: dict[str, Any] = {}
        try:
            yield extra
        except Exception as exc:
            self.event(
                f"{kind}.error", f"{msg} — {type(exc).__name__}: {exc}", level="error",
                duration_ms=int((time.monotonic() - start) * 1000), **{**data, **extra},
            )
            raise
        else:
            self.event(
                f"{kind}.done", msg,
                duration_ms=int((time.monotonic() - start) * 1000), **{**data, **extra},
            )

    # -- output -------------------------------------------------------------

    def dump(self) -> list[dict]:
        return [e.to_json() for e in self.events]

    def summary(self) -> dict[str, Any]:
        """Roll-up for the end of a run: where the time went, what failed."""
        by_kind: dict[str, dict[str, Any]] = {}
        for e in self.events:
            if e.duration_ms is None:
                continue
            fam = e.kind.rsplit(".", 1)[0]
            slot = by_kind.setdefault(fam, {"count": 0, "totalMs": 0})
            slot["count"] += 1
            slot["totalMs"] += e.duration_ms
        return {
            "jobId": self.job_id,
            "events": len(self.events),
            "wallMs": int((time.monotonic() - self.t0) * 1000),
            "warnings": sum(1 for e in self.events if e.level == "warn"),
            "errors": sum(1 for e in self.events if e.level == "error"),
            "byKind": dict(sorted(by_kind.items(), key=lambda kv: -kv[1]["totalMs"])),
        }

    def print_summary(self) -> None:
        s = self.summary()
        print(_c(f"\n  ── run summary · job {s['jobId']} ──", "bold"), flush=True)
        print(f"  {s['events']} events · {s['wallMs']}ms wall · "
              f"{s['warnings']} warnings · {s['errors']} errors", flush=True)
        for fam, v in s["byKind"].items():
            print(_c(f"    {fam:<22} {v['count']:>3} calls  {v['totalMs']:>7}ms", "dim"), flush=True)
        print(flush=True)


# ── ambient trace ────────────────────────────────────────────────────────────
#
# Tools are invoked as bare callables (`self.tools[name](**args)`), so there is
# no parameter to thread a Trace through without changing every tool signature.
# A context variable carries it instead: the agent sets it around its loop, and
# any tool that wants to trace picks it up. Without this, sandbox events would
# print to stdout but never reach the job's SSE stream or /trace replay.

_CURRENT: ContextVar["Trace | None"] = ContextVar("current_trace", default=None)


def set_current_trace(trace: "Trace") -> None:
    _CURRENT.set(trace)


def current_trace() -> "Trace":
    """The trace for the job in flight, or a throwaway one if called outside a job."""
    return _CURRENT.get() or Trace("orphan")
