"""Public read-only share links for finished reports.

A share token makes ONE report fetchable by anyone holding the link — no
auth check on GET /api/share/{token} (the user explicitly wants
link-accessible shares; this overrides the auth default for THESE endpoints
only). Claiming is the only write path: an authenticated viewer (gate header
X-Hax-User) gets their own COPY of the report under a fresh id, tagged with
their login, so it appears in their portfolio — the original is never
modified.

When DATABASE_URL is set, shares live in the PostgreSQL shares table. When
unset, the legacy shares.json file is used (tests/dev only).
"""
from __future__ import annotations

import json
import re
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Request

from . import db

router = APIRouter()

# File-based store — ONLY used when DATABASE_URL is unset (tests/dev).
STORE = Path(__file__).resolve().parent / "reports"
SHARES = Path(__file__).resolve().parent / "shares.json"

_SAFE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


def _check_safe(value: str) -> None:
    """Path segments that end up in filenames must be boring."""
    if not _SAFE.match(value):
        raise HTTPException(400, "invalid id")


def _load_registry() -> dict:
    if not SHARES.exists():
        return {}
    try:
        return json.loads(SHARES.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _save_registry(registry: dict) -> None:
    SHARES.write_text(json.dumps(registry, indent=2), encoding="utf-8")


def _report_path(job_id: str) -> Path:
    return STORE / f"{job_id}.json"


async def _report_exists(job_id: str) -> bool:
    """Check report existence — DB when configured, file fallback otherwise."""
    if db.is_enabled():
        return await db.report_exists(job_id) or False
    return _report_path(job_id).exists()


async def _get_report_json(job_id: str) -> dict | None:
    """Fetch report JSON — DB when configured, file fallback otherwise."""
    if db.is_enabled():
        return await db.get_report(job_id)
    path = _report_path(job_id)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


@router.post("/api/reports/{job_id}/share")
async def create_share(job_id: str):
    """Mint (or reuse) a public share token for a finished report."""
    _check_safe(job_id)
    if not await _report_exists(job_id):
        raise HTTPException(404, f"no report {job_id}")

    if db.is_enabled():
        db_entry = await db.create_share(secrets.token_urlsafe(8), job_id)
        if db_entry is not None:
            return {"token": db_entry["token"], "url": f"/share/{db_entry['token']}"}

    # File-based fallback (tests/dev).
    registry = _load_registry()
    for token, entry in registry.items():
        if entry.get("jobId") == job_id:
            return {"token": token, "url": f"/share/{token}"}
    token = secrets.token_urlsafe(8)
    registry[token] = {
        "jobId": job_id,
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "claims": {},
    }
    _save_registry(registry)
    return {"token": token, "url": f"/share/{token}"}


@router.get("/api/share/{token}")
async def get_shared_report(token: str):
    """PUBLIC: the shared report JSON. No auth — the link IS the capability."""
    _check_safe(token)

    if db.is_enabled():
        db_entry = await db.get_share(token)
        if db_entry is not None:
            report = await db.get_report(db_entry["jobId"])
            if report is not None:
                return report
            raise HTTPException(404, "shared report no longer exists")
        raise HTTPException(404, "unknown share token")

    # File-based fallback (tests/dev).
    entry = _load_registry().get(token)
    if entry is None:
        raise HTTPException(404, "unknown share token")
    path = _report_path(entry["jobId"])
    if not path.exists():
        raise HTTPException(404, "shared report no longer exists")
    return json.loads(path.read_text(encoding="utf-8"))


@router.post("/api/share/{token}/claim")
async def claim_share(token: str, request: Request,
                      x_hax_user: str | None = Header(None)):
    """Copy the shared report into the viewer's portfolio.

    Requires the gate's X-Hax-User header (unauthenticated public viewers
    get 401 — the share page treats that as "view only"). Idempotent per
    (token, user): a repeat claim returns the existing copy id. Never
    overwrites the original report.
    """
    _check_safe(token)
    sso_user = (x_hax_user or "").strip()
    client_ip = db.extract_client_ip(request)
    user = sso_user or client_ip
    if not user:
        raise HTTPException(
            401, "no authenticated user (X-Hax-User) and no client IP — "
                  "open through the gate")

    if db.is_enabled():
        db_entry = await db.get_share(token)
        if db_entry is None:
            raise HTTPException(404, "unknown share token")
        claims = db_entry.get("claims", {})
        if user in claims:
            return {"ok": True, "reportId": claims[user], "user": user}
        report = await db.get_report(db_entry["jobId"])
        if report is None:
            raise HTTPException(404, "shared report no longer exists")
        report["user"] = user
        new_id = uuid.uuid4().hex[:12]
        while await db.report_exists(new_id):
            new_id = uuid.uuid4().hex[:12]
        await db.save_report(new_id, report, name=report.get("project", ""),
                             location=report.get("location", ""),
                             user_email=user)
        await db.claim_share(token, user, new_id)
        return {"ok": True, "reportId": new_id, "user": user}

    # File-based fallback (tests/dev).
    registry = _load_registry()
    entry = registry.get(token)
    if entry is None:
        raise HTTPException(404, "unknown share token")
    claims = entry.setdefault("claims", {})
    if user in claims:
        return {"ok": True, "reportId": claims[user], "user": user}

    src = _report_path(entry["jobId"])
    if not src.exists():
        raise HTTPException(404, "shared report no longer exists")
    report = json.loads(src.read_text(encoding="utf-8"))
    report["user"] = user

    new_id = uuid.uuid4().hex[:12]
    while _report_path(new_id).exists():
        new_id = uuid.uuid4().hex[:12]
    _report_path(new_id).write_text(
        json.dumps(report, indent=2), encoding="utf-8")

    claims[user] = new_id
    _save_registry(registry)
    return {"ok": True, "reportId": new_id, "user": user}
