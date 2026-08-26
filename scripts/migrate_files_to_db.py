#!/usr/bin/env python3
"""Migrate existing report JSON files into the PostgreSQL database.

Reads every *.json report file from agent_backend/reports/, parses each into
the reports table, and marks archived IDs from archived.txt. Also migrates
shares.json and review sidecars if they exist.

Run from repo root:
  PATH=".venv/bin:$PATH" \
  DATABASE_URL="postgresql://rai_prod_admin:...@localhost:5432/rai_prod" \
  python scripts/migrate_files_to_db.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncpg

STORE = Path("agent_backend/reports")
ARCHIVE_LIST = STORE / "archived.txt"
SHARES_FILE = Path("agent_backend/shares.json")
REVIEW_DIR = STORE / "review"


def load_archived_ids() -> set[str]:
    try:
        return {
            line.strip()
            for line in ARCHIVE_LIST.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        }
    except FileNotFoundError:
        return set()


async def main() -> None:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    conn = await asyncpg.connect(db_url)
    archived = load_archived_ids()
    print(f"Archived IDs: {len(archived)}")

    # ── migrate reports ──────────────────────────────────────────────
    report_files = sorted(STORE.glob("*.json"))
    # Exclude sidecar files (*.review.json) — they go in the reviews table
    report_files = [p for p in report_files if not p.name.endswith(".review.json")]
    print(f"Report files to migrate: {len(report_files)}")

    inserted = skipped = 0
    for path in report_files:
        job_id = path.stem
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  SKIP {job_id}: {e}")
            skipped += 1
            continue

        is_archived = job_id in archived
        readiness = int(data.get("readiness", 0))
        decision = data.get("decision", "Investigate")
        name = data.get("project", "")
        location = data.get("location", "")
        user_email = data.get("user")

        await conn.execute(
            """
            INSERT INTO reports (id, name, location, readiness, decision,
                                 archived, pipeline_mode, report_body, user_email)
            VALUES ($1, $2, $3, $4, $5, $6, 'fast', $7::jsonb, $8)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                location = EXCLUDED.location,
                readiness = EXCLUDED.readiness,
                decision = EXCLUDED.decision,
                archived = EXCLUDED.archived,
                report_body = EXCLUDED.report_body,
                user_email = EXCLUDED.user_email,
                updated_at = now()
            """,
            job_id, name, location, readiness, decision,
            is_archived, json.dumps(data), user_email,
        )
        inserted += 1
        tag = " [archived]" if is_archived else ""
        print(f"  {job_id}: readiness={readiness} decision={decision}{tag}")

    print(f"\nReports: {inserted} inserted, {skipped} skipped")

    # ── migrate review sidecars ──────────────────────────────────────
    if REVIEW_DIR.exists():
        sidecars = sorted(REVIEW_DIR.glob("*.json"))
        print(f"\nReview sidecars: {len(sidecars)}")
        for path in sidecars:
            report_id = path.stem
            data = json.loads(path.read_text(encoding="utf-8"))
            await conn.execute(
                """
                INSERT INTO reviews (report_id, status, reviewed_by, rationale, reviewed_at)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (report_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    reviewed_by = EXCLUDED.reviewed_by,
                    rationale = EXCLUDED.rationale,
                    reviewed_at = EXCLUDED.reviewed_at
                """,
                report_id,
                data.get("status", "AWAITING_REVIEW"),
                data.get("reviewedBy"),
                data.get("rationale"),
                data.get("reviewedAt"),
            )
            print(f"  {report_id}: {data.get('status')}")
    else:
        print("\nReview sidecars: none")

    # ── migrate shares.json ──────────────────────────────────────────
    if SHARES_FILE.exists():
        registry = json.loads(SHARES_FILE.read_text(encoding="utf-8"))
        print(f"\nShares: {len(registry)}")
        for token, entry in registry.items():
            await conn.execute(
                """
                INSERT INTO shares (token, report_id, claims)
                VALUES ($1, $2, $3::jsonb)
                ON CONFLICT (token) DO UPDATE SET
                    report_id = EXCLUDED.report_id,
                    claims = EXCLUDED.claims
                """,
                token,
                entry.get("jobId"),
                json.dumps(entry.get("claims", {})),
            )
            print(f"  {token}: report={entry.get('jobId')}")
    else:
        print("\nShares: none")

    # ── summary ──────────────────────────────────────────────────────
    counts = await conn.fetch("""
        SELECT
            (SELECT count(*) FROM reports) AS reports,
            (SELECT count(*) FROM reports WHERE archived = true) AS archived,
            (SELECT count(*) FROM reviews) AS reviews,
            (SELECT count(*) FROM shares) AS shares,
            (SELECT count(*) FROM documents) AS documents,
            (SELECT count(*) FROM users) AS users
    """)
    row = counts[0]
    print(f"\n{'='*48}")
    print(f"Database now contains:")
    print(f"  reports:   {row['reports']} ({row['archived']} archived)")
    print(f"  reviews:   {row['reviews']}")
    print(f"  shares:    {row['shares']}")
    print(f"  documents: {row['documents']}")
    print(f"  users:     {row['users']}")
    print(f"\n✅ Migration complete — safe to remove file fallbacks.")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
