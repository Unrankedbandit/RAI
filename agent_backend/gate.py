"""Mid-run human-approval gate (gap review).

With GAP_REVIEW=1 the deep-mode pipeline parks after gap analysis — before the
data-scout fan-out — so a human can read the extracted gaps and approve which
ones the scouts should chase (POST /api/jobs/{job_id}/resume). The wait is
always bounded (GAP_REVIEW_TIMEOUT_S, default 300): on timeout the run
proceeds with ALL gaps. The factory never blocks forever on a human.

A GapGate is just a per-job mailbox: main.py owns the registry (JOB_GATES),
the pipeline awaits the event, the resume endpoint fills `approved` and sets
it. With GAP_REVIEW unset the pipeline never touches the gate — zero behavior
change, zero new events.
"""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field


def gap_review_enabled() -> bool:
    # Read at call time, not import: CI/e2e flip this per run, and a stale
    # module constant would pause test suites that exported it once.
    return os.getenv("GAP_REVIEW", "0") == "1"


def gap_review_timeout() -> int:
    return int(os.getenv("GAP_REVIEW_TIMEOUT_S", "300"))


@dataclass
class GapGate:
    """Per-job pause handle for the gap-review gate.

    The pipeline sets `awaiting` while parked and blocks on `event`; the
    resume endpoint stores the approved gap ids in `approved` and sets
    `event`. `awaiting` is what separates "job exists" from "job is parked at
    the gate right now" — the resume contract (200 / 409 / 404) keys off it.
    """

    event: asyncio.Event = field(default_factory=asyncio.Event)
    approved: list[str] | None = None
    awaiting: bool = False

    def resolve(self, approved: list[str]) -> None:
        self.approved = list(approved)
        self.event.set()
