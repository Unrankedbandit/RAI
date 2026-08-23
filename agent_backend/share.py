"""Public read-only share links for finished reports.

A share token makes ONE report fetchable by anyone holding the link — no
auth check on GET /api/share/{token} (the user explicitly wants
link-accessible shares; this overrides the auth default for THESE endpoints
only). Claiming is the only write path: an authenticated viewer (gate header
X-Hax-User) gets their own COPY of the report under a fresh id, tagged with
their login, so it appears in their portfolio — the original file is never
modified.

Registry lives in shares.json next to the reports store:
    { "<token>": {"jobId": str, "createdAt": iso,
                  "claims": {"<user>": "<newReportId>"}} }
Claims are idempotent per (token, user): a repeat claim returns the same
copy id instead of duplicating the report.
"""
from __future__ import annotations

import json
import re
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException

router = APIRouter()

# Same store main.py uses — duplicated rather than imported to avoid a
# circular import (main includes this router).
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
        # A corrupt registry must not take the share endpoints down — treat
        # it as empty (existing tokens 404 rather than 500).
        return {}


def _save_registry(registry: dict) -> None:
    SHARES.write_text(json.dumps(registry, indent=2), encoding="utf-8")


def _report_path(job_id: str) -> Path:
    return STORE / f"{job_id}.json"


@router.post("/api/reports/{job_id}/share")
async def create_share(job_id: str):
    """Mint (or reuse) a public share token for a finished report."""
    _check_safe(job_id)
    if not _report_path(job_id).exists():
        raise HTTPException(404, f"no report {job_id}")
    registry = _load_registry()
    # Idempotent per job: an existing token for this report wins (first
    # match), so re-clicking Share never proliferates links.
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
    entry = _load_registry().get(token)
    if entry is None:
        raise HTTPException(404, "unknown share token")
    path = _report_path(entry["jobId"])
    if not path.exists():
        raise HTTPException(404, "shared report no longer exists")
    return json.loads(path.read_text(encoding="utf-8"))


@router.post("/api/share/{token}/claim")
async def claim_share(token: str, x_hax_user: str | None = Header(None)):
    """Copy the shared report into the viewer's portfolio.

    Requires the gate's X-Hax-User header (unauthenticated public viewers
    get 401 — the share page treats that as "view only"). Idempotent per
    (token, user): a repeat claim returns the existing copy id. Never
    overwrites the original report file.
    """
    _check_safe(token)
    user = (x_hax_user or "").strip()
    if not user:
        raise HTTPException(
            401, "no authenticated user (X-Hax-User) — open through the gate")
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

    # Fresh id for the copy; collision-checked against the store (a plain
    # <id>.json in STORE is picked up by the /api/projects portfolio listing
    # automatically).
    new_id = uuid.uuid4().hex[:12]
    while _report_path(new_id).exists():
        new_id = uuid.uuid4().hex[:12]
    _report_path(new_id).write_text(
        json.dumps(report, indent=2), encoding="utf-8")

    claims[user] = new_id
    _save_registry(registry)
    return {"ok": True, "reportId": new_id, "user": user}
