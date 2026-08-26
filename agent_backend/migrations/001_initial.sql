-- 001_initial.sql — Phase 2 schema: PostgreSQL as system of record
--
-- Creates tables for reports, reviews, shares, jobs, and chat_answers.
-- The full Pydantic Report model is stored as JSONB in reports.report_body —
-- no migration needed when agent contracts evolve. Hot query fields
-- (readiness, decision, archived) are normalized as columns with indexes.
--
-- Run: psql $DATABASE_URL -f agent_backend/migrations/001_initial.sql

-- Enable crypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── reports ──────────────────────────────────────────────────────────
-- Replaces agent_backend/reports/{job_id}.json flat files.
-- job_id is the existing 12-char hex fragment (uuid.uuid4().hex[:12]).
CREATE TABLE IF NOT EXISTS reports (
    id              TEXT PRIMARY KEY,          -- 12-char hex job id
    name            TEXT NOT NULL,             -- from AnalyzeRequest.name
    location        TEXT NOT NULL,             -- from AnalyzeRequest.location
    county          TEXT,
    state           CHAR(2) DEFAULT 'CA',
    capacity_mw     REAL,
    readiness       SMALLINT NOT NULL,         -- 0-100, indexed for ORDER BY
    decision        TEXT NOT NULL
                    CHECK (decision IN ('Proceed', 'Investigate', 'Hold')),
    archived        BOOLEAN NOT NULL DEFAULT false,
    pipeline_mode   TEXT NOT NULL DEFAULT 'fast'
                    CHECK (pipeline_mode IN ('fast', 'deep')),
    report_body     JSONB NOT NULL,            -- full Pydantic Report.model_dump()
    red_flag_count  INT GENERATED ALWAYS AS
                    (jsonb_array_length(report_body->'red_flags')) STORED,
    contradiction_count INT GENERATED ALWAYS AS
                    (jsonb_array_length(report_body->'contradictions')) STORED,
    user_email      TEXT,                      -- X-Hax-User header (nullable)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_archived_ready
    ON reports(archived, readiness);
CREATE INDEX IF NOT EXISTS idx_reports_created
    ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_body_gin
    ON reports USING gin(report_body);

-- ── reviews ──────────────────────────────────────────────────────────
-- Replaces agent_backend/reports/review/{job_id}.json sidecar files.
CREATE TABLE IF NOT EXISTS reviews (
    report_id       TEXT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'AWAITING_REVIEW'
                    CHECK (status IN ('AWAITING_REVIEW', 'APPROVED', 'REJECTED')),
    reviewed_by     TEXT,
    rationale       TEXT,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── shares ───────────────────────────────────────────────────────────
-- Replaces agent_backend/shares.json flat registry.
CREATE TABLE IF NOT EXISTS shares (
    token           TEXT PRIMARY KEY,          -- secrets.token_urlsafe(8)
    report_id       TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    claims          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_shares_report ON shares(report_id);

-- ── jobs ─────────────────────────────────────────────────────────────
-- Pipeline run metadata — survives restart (in-memory dicts do not).
CREATE TABLE IF NOT EXISTS jobs (
    id              TEXT PRIMARY KEY,          -- 12-char hex job id
    report_id       TEXT REFERENCES reports(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'completed',
                                      'failed', 'timeout')),
    pipeline_mode   TEXT NOT NULL DEFAULT 'fast'
                    CHECK (pipeline_mode IN ('fast', 'deep')),
    error_message   TEXT,
    user_email      TEXT,
    queued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_report ON jobs(report_id);

-- ── chat_answers ─────────────────────────────────────────────────────
-- Replaces the in-memory ANSWERS dict — survives restart.
CREATE TABLE IF NOT EXISTS chat_answers (
    id              TEXT PRIMARY KEY,          -- 12-char hex ask id
    report_id       TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    question        TEXT NOT NULL,
    answer          TEXT NOT NULL,
    sources         JSONB NOT NULL DEFAULT '[]'::jsonb,
    grounded        BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_answers_report
    ON chat_answers(report_id, created_at DESC);
