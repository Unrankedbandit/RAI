-- 003_documents.sql — Project document storage with extracted text
--
-- Stores uploaded dossier documents (PDFs, XLSXs) alongside their extracted
-- text content and metadata. Documents are tied to the IP-based user who
-- uploaded them and optionally to the job/report they were analyzed for.
--
-- A category field distinguishes positive data (project dossiers being
-- analyzed) from negative data (contrast/comparison documents like the
-- Sloan Canyon no-go site).
--
-- Run: psql $DATABASE_URL -f agent_backend/migrations/003_documents.sql

CREATE TABLE IF NOT EXISTS documents (
    id              SERIAL PRIMARY KEY,
    filename        TEXT NOT NULL,               -- original filename (e.g. 01_Land_...pdf)
    file_type       TEXT NOT NULL                -- pdf, xlsx, csv, docx, txt
                    CHECK (file_type IN ('pdf', 'xlsx', 'csv', 'docx', 'txt')),
    category        TEXT NOT NULL DEFAULT 'positive'
                    CHECK (category IN ('positive', 'negative')),
    file_size       BIGINT,                      -- bytes
    page_count      INT,                         -- PDF pages (null for xlsx)
    sheet_count     INT,                         -- XLSX sheets (null for pdf)
    extracted_text  TEXT,                        -- full extracted text content
    text_chars      INT,                         -- length of extracted_text
    project_name    TEXT,                        -- project the doc belongs to
    location        TEXT,                        -- project location
    -- IP-based user attribution (same pattern as jobs/reports)
    client_ip       INET,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    -- Optional link to the job/report that analyzed this document
    job_id          TEXT REFERENCES jobs(id) ON DELETE SET NULL,
    report_id       TEXT REFERENCES reports(id) ON DELETE SET NULL,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_job ON documents(job_id);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename);
