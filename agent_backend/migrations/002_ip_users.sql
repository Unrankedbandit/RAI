-- 002_ip_users.sql — IP-based user tracking
--
-- Every job run is tied to the caller's IP address. When the hackathon gate
-- SSO header (X-Hax-User) is present, it takes precedence and is stored as
-- the display name. When absent, the IP itself is the user identity.
--
-- Run: psql $DATABASE_URL -f agent_backend/migrations/002_ip_users.sql

-- ── users ─────────────────────────────────────────────────────────────
-- One row per unique client IP. The gate SSO name (X-Hax-User) is captured
-- when available and updated on each sighting.
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    ip_address      INET NOT NULL UNIQUE,
    display_name    TEXT,                     -- X-Hax-User header when present
    first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
    total_jobs      INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_ip ON users(ip_address);

-- ── jobs: add client_ip + user_id FK ──────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_ip INET;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id INTEGER
    REFERENCES users(id) ON DELETE SET NULL;

-- ── reports: add client_ip + user_id FK ───────────────────────────────
ALTER TABLE reports ADD COLUMN IF NOT EXISTS client_ip INET;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS user_id INTEGER
    REFERENCES users(id) ON DELETE SET NULL;

-- ── reviews: add client_ip ────────────────────────────────────────────
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS client_ip INET;

-- ── chat_answers: add client_ip ───────────────────────────────────────
ALTER TABLE chat_answers ADD COLUMN IF NOT EXISTS client_ip INET;
