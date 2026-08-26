"""Ground-truth benchmark store — sqlite, stdlib only.

The curated public benchmarks the rubric is checked against (CAPEX bands,
lead times, statutory timelines, ITC deadlines) live here as ROWS instead of
prompt prose / markdown paragraphs. `kb_lookup` queries this store first and
prepends curated hits to the markdown-grep results; a human APPROVED review
flips the rows the report cited to verified (`review.py` write-back).

Seeded by scripts/seed_benchmarks.py from the LIAISON prompt's benchmark
block, the research/*.md files, and the ITC constants in sentinel_adapter.
All rows start verified_at=NULL — "unverified" is the honest default.
"""
from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "benchmarks.sqlite"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS benchmarks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    geography TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    verified_at TEXT,
    verified_by TEXT,
    created_at TEXT NOT NULL
)
"""

_COLUMNS = ("id", "name", "value", "unit", "geography", "source_url",
            "verified_at", "verified_by", "created_at")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise FileNotFoundError(
            f"benchmark store not seeded: {DB_PATH} (run scripts/seed_benchmarks.py)")
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> Path:
    """Create the DB + schema if absent. Returns the DB path."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.executescript(_SCHEMA)
        conn.commit()
    finally:
        conn.close()
    return DB_PATH


def upsert(record: dict) -> None:
    """Insert or update one benchmark row by id.

    Re-seeding refreshes name/value/unit/geography/source_url but PRESERVES
    verified_at/verified_by — a re-run of the seeder never un-verifies a row
    a human approved."""
    now = _now_iso()
    row = {k: record.get(k) for k in _COLUMNS}
    row["verified_at"] = row.get("verified_at") or None
    row["verified_by"] = row.get("verified_by") or None
    row["created_at"] = row.get("created_at") or now
    conn = _connect()
    try:
        with conn:
            conn.execute(
                f"INSERT INTO benchmarks ({', '.join(_COLUMNS)}) "
                f"VALUES ({', '.join('?' for _ in _COLUMNS)}) "
                "ON CONFLICT(id) DO UPDATE SET "
                "name=excluded.name, value=excluded.value, unit=excluded.unit, "
                "geography=excluded.geography, source_url=excluded.source_url",
                [row[c] for c in _COLUMNS])
    finally:
        conn.close()


def lookup(query: str, limit: int = 5) -> list[dict]:
    """Case-insensitive keyword match over name/value/geography, ranked by
    hit count. Returns full row dicts; [] when nothing matches."""
    terms = [t.lower() for t in re.findall(r"[a-zA-Z0-9$%.-]{3,}", query)]
    if not terms:
        return []
    conn = _connect()
    try:
        rows = conn.execute(
            f"SELECT {', '.join(_COLUMNS)} FROM benchmarks").fetchall()
    finally:
        conn.close()
    scored: list[tuple[int, dict]] = []
    for row in rows:
        rec = dict(row)
        hay = " ".join(str(rec[k] or "")
                       for k in ("name", "value", "geography")).lower()
        hits = sum(hay.count(t) for t in terms)
        if hits:
            scored.append((hits, rec))
    scored.sort(key=lambda s: -s[0])
    return [rec for _, rec in scored[:limit]]


def mark_verified(*, reviewer: str, ids: list[str] | None = None,
                  source_urls: list[str] | None = None) -> int:
    """Stamp verified_at=now / verified_by=reviewer on every row matching a
    given id or source_url. Returns rows touched."""
    ids = ids or []
    source_urls = source_urls or []
    if not ids and not source_urls:
        return 0
    now = _now_iso()
    touched = 0
    conn = _connect()
    try:
        with conn:
            for row_id in ids:
                touched += conn.execute(
                    "UPDATE benchmarks SET verified_at=?, verified_by=? WHERE id=?",
                    (now, reviewer, row_id)).rowcount
            for url in source_urls:
                touched += conn.execute(
                    "UPDATE benchmarks SET verified_at=?, verified_by=? WHERE source_url=?",
                    (now, reviewer, url)).rowcount
    finally:
        conn.close()
    return touched
