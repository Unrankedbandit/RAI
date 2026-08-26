-- 004_cited_sources.sql — Cited sources for research findings
--
-- Extracts every source URL/reference from a report's red_flags,
-- contradictions, acquired_data, and timeline into a queryable table.
-- The frontend uses this to show "verified" (has URL) vs "unverified"
-- (no URL) badges on findings and timeline entries.
--
-- Run: psql $DATABASE_URL -f agent_backend/migrations/004_cited_sources.sql

CREATE TABLE IF NOT EXISTS cited_sources (
    id              SERIAL PRIMARY KEY,
    report_id       TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    -- Where in the report this source appears
    finding_type    TEXT NOT NULL
                    CHECK (finding_type IN ('red_flag', 'contradiction',
                                            'acquired_data', 'timeline')),
    finding_index   INT NOT NULL,           -- index within the array
    -- The source itself
    source_text     TEXT NOT NULL,           -- full source string from the agent
    source_url      TEXT,                    -- extracted URL (null if none)
    source_label    TEXT,                    -- short display label
    -- Verification status
    verified        BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cited_sources_report
    ON cited_sources(report_id, finding_type);
CREATE INDEX IF NOT EXISTS idx_cited_sources_url
    ON cited_sources(source_url) WHERE source_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cited_sources_verified
    ON cited_sources(report_id, verified);
