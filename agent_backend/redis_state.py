"""Redis-backed ephemeral state — job logs, traces, and run admission counters.

When REDIS_URL is set, job narration logs and structured traces are mirrored to
Redis Streams (reconnect-safe, survivable across restarts) and run admission
counters use Redis atomic INCR/DECR (cross-process safe). When unset, the
existing in-memory dicts are the sole source — tests and local dev see zero
behavior change.

Dual-write pattern: callers always write to in-memory AND Redis (when enabled).
Reads prefer in-memory for same-process SSE (lowest latency); the Redis stream
exists for restart recovery and cross-process visibility in Phase 2.
"""
from __future__ import annotations

import json
import os
from typing import Any

try:
    import redis.asyncio as aioredis
except ImportError:
    aioredis = None  # type: ignore[assignment]

REDIS_URL = os.getenv("REDIS_URL", "")
_client: Any = None  # redis.asyncio.Redis | None


def is_enabled() -> bool:
    return _client is not None


async def init_client() -> None:
    global _client
    if not REDIS_URL or _client is not None or aioredis is None:
        return
    _client = aioredis.from_url(REDIS_URL, decode_responses=True)
    await _client.ping()


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# ── job logs (SSE narration) ───────────────────────────────────────────

async def append_log(job_id: str, msg: str | dict[str, Any]) -> None:
    """XADD to the job's log stream. No-op when no Redis."""
    if _client is None:
        return
    field = "event" if isinstance(msg, dict) else "status"
    payload = json.dumps(msg) if isinstance(msg, dict) else msg
    await _client.xadd(
        f"rai:jobs:{job_id}:logs",
        {field: payload},
        maxlen=10000,
        approximate=True,
    )
    await _client.expire(f"rai:jobs:{job_id}:logs", 86400)


async def get_logs(job_id: str, from_idx: int = 0) -> list[str | dict] | None:
    """XRANGE from the job's log stream. Returns None when no Redis (caller
    falls back to in-memory JOB_LOGS)."""
    if _client is None:
        return None
    entries = await _client.xrange(f"rai:jobs:{job_id}:logs")
    results: list[str | dict] = []
    for _id, fields in entries:
        if "event" in fields:
            results.append(json.loads(fields["event"]))
        elif "status" in fields:
            results.append(fields["status"])
    return results[from_idx:]


# ── job traces (structured events) ─────────────────────────────────────

async def append_trace(job_id: str, event: dict[str, Any]) -> None:
    """XADD to the job's trace stream. No-op when no Redis."""
    if _client is None:
        return
    await _client.xadd(
        f"rai:jobs:{job_id}:trace",
        {"event": json.dumps(event)},
        maxlen=10000,
        approximate=True,
    )
    await _client.expire(f"rai:jobs:{job_id}:trace", 86400)


async def get_trace(job_id: str) -> list[dict[str, Any]] | None:
    """XRANGE from the job's trace stream. Returns None when no Redis."""
    if _client is None:
        return None
    entries = await _client.xrange(f"rai:jobs:{job_id}:trace")
    return [json.loads(fields["event"]) for _id, fields in entries]


# ── run admission control ──────────────────────────────────────────────

async def incr_active() -> int | None:
    """INCR rai:run:active. Returns new value, or None when no Redis."""
    if _client is None:
        return None
    return await _client.incr("rai:run:active")


async def decr_active() -> int | None:
    """DECR rai:run:active. Returns new value, or None when no Redis."""
    if _client is None:
        return None
    return await _client.decr("rai:run:active")


async def incr_queued() -> int | None:
    """INCR rai:run:queued. Returns new value, or None when no Redis."""
    if _client is None:
        return None
    return await _client.incr("rai:run:queued")


async def decr_queued() -> int | None:
    """DECR rai:run:queued. Returns new value, or None when no Redis."""
    if _client is None:
        return None
    return await _client.decr("rai:run:queued")


async def get_run_state() -> dict[str, int] | None:
    """GET both run counters. Returns None when no Redis (caller uses
    in-memory RUN_STATE)."""
    if _client is None:
        return None
    active = int(await _client.get("rai:run:active") or 0)
    queued = int(await _client.get("rai:run:queued") or 0)
    return {"active": active, "queued": queued}
