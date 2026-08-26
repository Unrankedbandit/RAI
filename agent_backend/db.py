"""PostgreSQL persistence layer — asyncpg pool with file-based fallback.

When DATABASE_URL is set, reports/reviews/shares/jobs/chat_answers persist to
PostgreSQL (JSONB for the full Report body, normalized columns for hot query
fields). When unset, the existing file/in-memory behavior is unchanged — tests
and local dev that never configure a database see zero behavior change.

Environment routing (APP_ENV is informational only — surfaced in /api/health):
  APP_ENV=local   -> local dev database
  APP_ENV=test    -> test server database (rai-test.josephbissell.com)
  APP_ENV=prod    -> prod server database (rai-live.josephbissell.com)

DATABASE_URL must be set explicitly in agent_backend/.env for each environment.
It is NEVER committed — the .gitignore blocks .env files. See .env.example for
the template with placeholder values.

Design: every function is async and returns None / False / [] when no pool is
configured, so callers fall through to the legacy path. Dual-write (DB + file)
during migration means either source can serve reads.
"""
from __future__ import annotations

import json
import os
from typing import Any

import asyncpg

# ── database URL ───────────────────────────────────────────────────────
# DATABASE_URL must be set in the environment (agent_backend/.env on each
# server). No defaults are hardcoded — credentials never live in source code.
# APP_ENV is informational only (surfaced in /api/health for observability).

DATABASE_URL = os.getenv("DATABASE_URL", "")
_pool: asyncpg.Pool | None = None


def is_enabled() -> bool:
    return _pool is not None


async def init_pool() -> None:
    global _pool
    if not DATABASE_URL or _pool is not None:
        return
    _pool = await asyncpg.create_pool(
        DATABASE_URL,
        min_size=2,
        max_size=10,
        command_timeout=30,
    )


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def run_migrations() -> None:
    """Execute all migration SQL files in order if the pool is available."""
    if _pool is None:
        return
    migrations_dir = os.path.join(os.path.dirname(__file__), "migrations")
    for fname in sorted(os.listdir(migrations_dir)):
        if not fname.endswith(".sql"):
            continue
        with open(os.path.join(migrations_dir, fname), encoding="utf-8") as f:
            sql = f.read()
        async with _pool.acquire() as conn:
            await conn.execute(sql)


# ── client IP extraction ───────────────────────────────────────────────

def extract_client_ip(request: Any) -> str | None:
    """Extract the caller's IP from a Starlette/FastAPI Request.

    Checks X-Forwarded-For (first hop), then X-Real-IP, then the direct
    client host. Returns None when no IP can be determined.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    client = getattr(request, "client", None)
    if client and client.host:
        return client.host
    return None


# ── users (IP-based identity) ──────────────────────────────────────────

async def resolve_user(
    client_ip: str | None,
    *,
    display_name: str | None = None,
) -> int | None:
    """Upsert a user row keyed by IP address. Returns the user id, or None
    when no pool or no IP.

    The display_name (X-Hax-User when present) is stored on first sighting
    and updated on each subsequent sighting. total_jobs is incremented.
    """
    if _pool is None or not client_ip:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO users (ip_address, display_name, last_seen, total_jobs)
            VALUES ($1::inet, $2, now(), 1)
            ON CONFLICT (ip_address) DO UPDATE SET
                display_name = COALESCE(EXCLUDED.display_name, users.display_name),
                last_seen = now(),
                total_jobs = users.total_jobs + 1
            RETURNING id
            """,
            client_ip,
            display_name,
        )
        return row["id"] if row else None


async def get_user_by_ip(client_ip: str) -> dict[str, Any] | None:
    """Look up a user by IP. Returns None when no pool or not found."""
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, ip_address, display_name, first_seen, last_seen, total_jobs "
            "FROM users WHERE ip_address = $1::inet",
            client_ip,
        )
        if row is None:
            return None
        return {
            "id": row["id"],
            "ip_address": str(row["ip_address"]),
            "display_name": row["display_name"],
            "first_seen": row["first_seen"].isoformat() if row["first_seen"] else None,
            "last_seen": row["last_seen"].isoformat() if row["last_seen"] else None,
            "total_jobs": row["total_jobs"],
        }


# ── reports ────────────────────────────────────────────────────────────

async def save_report(
    job_id: str,
    report_dict: dict[str, Any],
    *,
    name: str = "",
    location: str = "",
    pipeline_mode: str = "fast",
    user_email: str | None = None,
    client_ip: str | None = None,
    user_id: int | None = None,
) -> None:
    """INSERT or UPDATE a report. No-op when no pool."""
    if _pool is None:
        return
    readiness = int(report_dict.get("readiness", 0))
    decision = report_dict.get("decision", "Investigate")
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO reports (id, name, location, readiness, decision,
                                 pipeline_mode, report_body, user_email,
                                 client_ip, user_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::inet, $10)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                location = EXCLUDED.location,
                readiness = EXCLUDED.readiness,
                decision = EXCLUDED.decision,
                pipeline_mode = EXCLUDED.pipeline_mode,
                report_body = EXCLUDED.report_body,
                user_email = EXCLUDED.user_email,
                client_ip = EXCLUDED.client_ip,
                user_id = EXCLUDED.user_id,
                updated_at = now()
            """,
            job_id,
            name or report_dict.get("project", ""),
            location or report_dict.get("location", ""),
            readiness,
            decision,
            pipeline_mode,
            json.dumps(report_dict),
            user_email,
            client_ip,
            user_id,
        )


async def get_report(job_id: str) -> dict[str, Any] | None:
    """SELECT a report's JSON body. Returns None when no pool or not found."""
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT report_body FROM reports WHERE id = $1", job_id
        )
        if row is None:
            return None
        return json.loads(row["report_body"])


async def list_reports() -> list[dict[str, Any]] | None:
    """SELECT all non-archived reports sorted by readiness ASC.
    Returns None when no pool (caller falls back to file glob)."""
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, location, readiness, decision, report_body,
                   user_email
            FROM reports
            WHERE archived = false
            ORDER BY readiness ASC
            """
        )
        return [
            {
                "id": row["id"],
                "project": row["name"],
                "location": row["location"],
                "readiness": row["readiness"],
                "decision": row["decision"],
                "user": row["user_email"],
                "dimensions": json.loads(row["report_body"]).get("dimensions", []),
            }
            for row in rows
        ]


async def set_archived(job_id: str, archived: bool) -> None:
    """Mark a report as archived. No-op when no pool."""
    if _pool is None:
        return
    async with _pool.acquire() as conn:
        await conn.execute(
            "UPDATE reports SET archived = $1, updated_at = now() WHERE id = $2",
            archived,
            job_id,
        )


async def report_exists(job_id: str) -> bool | None:
    """Check if a report exists. Returns None when no pool (caller falls
    back to file check)."""
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM reports WHERE id = $1)", job_id
        )


# ── reviews ────────────────────────────────────────────────────────────

async def save_review(
    report_id: str,
    *,
    status: str,
    reviewed_by: str | None = None,
    rationale: str | None = None,
    client_ip: str | None = None,
) -> None:
    """INSERT or UPDATE a review decision. No-op when no pool."""
    if _pool is None:
        return
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO reviews (report_id, status, reviewed_by, rationale,
                                 reviewed_at, client_ip)
            VALUES ($1, $2, $3, $4,
                    CASE WHEN $2 IN ('APPROVED','REJECTED') THEN now()
                         ELSE NULL END, $5::inet)
            ON CONFLICT (report_id) DO UPDATE SET
                status = EXCLUDED.status,
                reviewed_by = EXCLUDED.reviewed_by,
                rationale = EXCLUDED.rationale,
                reviewed_at = EXCLUDED.reviewed_at,
                client_ip = EXCLUDED.client_ip
            """,
            report_id,
            status,
            reviewed_by,
            rationale,
            client_ip,
        )


async def get_review(report_id: str) -> dict[str, Any] | None:
    """SELECT review state. Returns None when no pool or not found (caller
    defaults to AWAITING_REVIEW)."""
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, reviewed_by, rationale, reviewed_at FROM reviews WHERE report_id = $1",
            report_id,
        )
        if row is None:
            return None
        return {
            "status": row["status"],
            "reviewedBy": row["reviewed_by"],
            "rationale": row["rationale"],
            "reviewedAt": row["reviewed_at"].isoformat() if row["reviewed_at"] else None,
        }


# ── shares ─────────────────────────────────────────────────────────────

async def create_share(token: str, job_id: str) -> dict[str, Any] | None:
    """INSERT a share token. Returns the entry dict, or None when no pool."""
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT token FROM shares WHERE report_id = $1 LIMIT 1", job_id
        )
        if existing:
            return {"token": existing["token"]}
        await conn.execute(
            "INSERT INTO shares (token, report_id) VALUES ($1, $2)",
            token,
            job_id,
        )
        return {"token": token}


async def get_share(token: str) -> dict[str, Any] | None:
    """SELECT a share by token. Returns None when no pool or not found."""
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT report_id, claims FROM shares WHERE token = $1", token
        )
        if row is None:
            return None
        return {
            "jobId": row["report_id"],
            "claims": json.loads(row["claims"]) if row["claims"] else {},
        }


async def claim_share(token: str, user: str, new_report_id: str) -> bool:
    """Add a claim to a share. Returns True on success, False when no pool."""
    if _pool is None:
        return False
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT claims FROM shares WHERE token = $1", token
        )
        if row is None:
            return False
        claims = json.loads(row["claims"]) if row["claims"] else {}
        if user in claims:
            return True
        claims[user] = new_report_id
        await conn.execute(
            "UPDATE shares SET claims = $1::jsonb WHERE token = $2",
            json.dumps(claims),
            token,
        )
        return True


# ── jobs ───────────────────────────────────────────────────────────────

async def save_job(
    job_id: str,
    *,
    pipeline_mode: str = "fast",
    user_email: str | None = None,
    client_ip: str | None = None,
    user_id: int | None = None,
) -> None:
    """INSERT a job row. No-op when no pool."""
    if _pool is None:
        return
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO jobs (id, status, pipeline_mode, user_email,
                              client_ip, user_id)
            VALUES ($1, 'queued', $2, $3, $4::inet, $5)
            ON CONFLICT (id) DO NOTHING
            """,
            job_id,
            pipeline_mode,
            user_email,
            client_ip,
            user_id,
        )


async def update_job(
    job_id: str,
    *,
    status: str,
    report_id: str | None = None,
    error_message: str | None = None,
) -> None:
    """UPDATE job status. No-op when no pool."""
    if _pool is None:
        return
    async with _pool.acquire() as conn:
        if status == "running":
            await conn.execute(
                "UPDATE jobs SET status = $1, started_at = now() WHERE id = $2",
                status,
                job_id,
            )
        elif status in ("completed", "failed", "timeout"):
            await conn.execute(
                """UPDATE jobs
                   SET status = $1, report_id = $2, error_message = $3,
                       completed_at = now()
                   WHERE id = $4""",
                status,
                report_id,
                error_message,
                job_id,
            )
        else:
            await conn.execute(
                "UPDATE jobs SET status = $1 WHERE id = $2",
                status,
                job_id,
            )


# ── chat_answers ───────────────────────────────────────────────────────

async def save_chat_answer(
    ask_id: str,
    *,
    report_id: str,
    question: str,
    answer: str,
    sources: list[str],
    grounded: bool = True,
    client_ip: str | None = None,
) -> None:
    """INSERT a chat answer. No-op when no pool."""
    if _pool is None:
        return
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO chat_answers (id, report_id, question, answer,
                                      sources, grounded, client_ip)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::inet)
            ON CONFLICT (id) DO UPDATE SET
                answer = EXCLUDED.answer,
                sources = EXCLUDED.sources,
                grounded = EXCLUDED.grounded
            """,
            ask_id,
            report_id,
            question,
            answer,
            json.dumps(sources),
            grounded,
            client_ip,
        )


async def get_chat_answer(ask_id: str) -> dict[str, Any] | None:
    """SELECT a chat answer. Returns None when no pool or not found."""
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT answer, sources, grounded FROM chat_answers WHERE id = $1",
            ask_id,
        )
        if row is None:
            return None
        return {
            "answer": row["answer"],
            "sources": json.loads(row["sources"]) if row["sources"] else [],
            "grounded": row["grounded"],
        }


# ── documents ─────────────────────────────────────────────────────────

async def save_document(
    filename: str,
    *,
    file_type: str,
    category: str = "positive",
    file_size: int | None = None,
    page_count: int | None = None,
    sheet_count: int | None = None,
    extracted_text: str | None = None,
    project_name: str | None = None,
    location: str | None = None,
    client_ip: str | None = None,
    user_id: int | None = None,
    job_id: str | None = None,
    report_id: str | None = None,
) -> int | None:
    """INSERT a document row. Returns the document id, or None when no pool."""
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO documents (filename, file_type, category, file_size,
                                   page_count, sheet_count, extracted_text,
                                   text_chars, project_name, location,
                                   client_ip, user_id, job_id, report_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11::inet, $12, $13, $14)
            RETURNING id
            """,
            filename,
            file_type,
            category,
            file_size,
            page_count,
            sheet_count,
            extracted_text,
            len(extracted_text) if extracted_text else 0,
            project_name,
            location,
            client_ip,
            user_id,
            job_id,
            report_id,
        )
        return row["id"] if row else None


async def get_document(doc_id: int) -> dict[str, Any] | None:
    """SELECT a document by id. Returns None when no pool or not found."""
    if _pool is None:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM documents WHERE id = $1",
            doc_id,
        )
        if row is None:
            return None
        return dict(row)


async def list_documents(
    *,
    category: str | None = None,
    user_id: int | None = None,
    job_id: str | None = None,
    report_id: str | None = None,
) -> list[dict[str, Any]] | None:
    """SELECT documents with optional filters. Returns None when no pool."""
    if _pool is None:
        return None
    conditions = []
    params: list[Any] = []
    idx = 1
    if category:
        conditions.append(f"category = ${idx}")
        params.append(category)
        idx += 1
    if user_id is not None:
        conditions.append(f"user_id = ${idx}")
        params.append(user_id)
        idx += 1
    if job_id:
        conditions.append(f"job_id = ${idx}")
        params.append(job_id)
        idx += 1
    if report_id:
        conditions.append(f"report_id = ${idx}")
        params.append(report_id)
        idx += 1
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT id, filename, file_type, category, file_size, page_count, "
            f"sheet_count, text_chars, project_name, location, client_ip, "
            f"user_id, job_id, report_id, uploaded_at "
            f"FROM documents{where} ORDER BY uploaded_at DESC",
            *params,
        )
        return [dict(row) for row in rows]


async def link_document_to_job(doc_id: int, job_id: str) -> None:
    """Link a document to a job after analysis starts. No-op when no pool."""
    if _pool is None:
        return
    async with _pool.acquire() as conn:
        await conn.execute(
            "UPDATE documents SET job_id = $1 WHERE id = $2",
            job_id,
            doc_id,
        )


async def link_document_to_report(doc_id: int, report_id: str) -> None:
    """Link a document to a report after analysis completes. No-op when no pool."""
    if _pool is None:
        return
    async with _pool.acquire() as conn:
        await conn.execute(
            "UPDATE documents SET report_id = $1 WHERE id = $2",
            report_id,
            doc_id,
        )
