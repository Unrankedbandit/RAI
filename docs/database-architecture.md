# RAI Database Architecture — Schema Design & Production Migration Path

> **Status:** Design document — the current codebase has no database; this is the
> target architecture for evolving RAI from a hackathon demo into a production-grade
> platform serving millions of users.

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Why Not NoSQL](#2-why-not-nosql)
3. [Target Architecture Overview](#3-target-architecture-overview)
4. [PostgreSQL Schema — System of Record](#4-postgresql-schema--system-of-record)
5. [Redis Schema — Ephemeral State & Queuing](#5-redis-schema--ephemeral-state--queuing)
6. [S3 / Object Storage Schema](#6-s3--object-storage-schema)
7. [Search Engine Schema](#7-search-engine-schema)
8. [TimescaleDB Schema — Traces & Audit](#8-timescaledb-schema--traces--audit)
9. [PostGIS Schema — Geospatial](#9-postgis-schema--geospatial)
10. [Data Flow After Migration](#10-data-flow-after-migration)
11. [Migration Path (Phase 1–5)](#11-migration-path-phase-15)
12. [Technology Choices Summary](#12-technology-choices-summary)

---

## 1. Current State

RAI currently has **no database**. All persistence is flat files and in-memory dicts:

| Data | Current storage | Location | Lost on restart? |
|---|---|---|---|
| Reports (terminal pipeline output) | JSON files | `agent_backend/reports/{job_id}.json` | No |
| Review decisions (human sign-off) | JSON sidecar files | `agent_backend/reports/review/{job_id}.json` | No |
| Archived report IDs | Plain text | `agent_backend/reports/archived.txt` | No |
| Share tokens + claims | Single JSON dict | `agent_backend/shares.json` | No |
| Investment memos | HTML files | `agent_backend/memos/{job_id}.html` | No |
| Grid spatial data | GeoJSON + PMTiles | `agent_backend/data/grid/` | No |
| Uploaded documents | Raw files | `project-docs/` | No |
| Knowledge base | Markdown files | `research/*.md` | No |
| Model tier config | JSON | `agent_backend/model_tiers.json` | No |
| **Job logs (SSE narration)** | **In-memory dict** | `JOB_LOGS: dict[str, list]` | **Yes** |
| **Job traces (structured events)** | **In-memory dict** | `JOB_TRACES: dict[str, Trace]` | **Yes** |
| **Gap-review gates** | **In-memory dict** | `JOB_GATES: dict[str, GapGate]` | **Yes** |
| **Run admission state** | **In-memory dict** | `RUN_STATE: {"active": 0, "queued": 0}` | **Yes** |
| **Chat answers (Ask rail)** | **In-memory dict** | `ANSWERS: dict[str, ChatAnswer]` | **Yes** |
| **Grid spatial index** | **In-memory STRtree** | `grid._state` | **Yes** (rebuilt on startup) |

### Current data shapes (Pydantic models in `schemas.py`)

These are the typed contracts that flow between agents and serialize to JSON:

```
Report
├── project: str
├── location: str
├── readiness: float (0-100)
├── decision: "Proceed" | "Investigate" | "Hold"
├── dimensions: [DimensionScore]
│   └── {name, rag, score, flags[]}
├── red_flags: [RedFlag]
│   └── {title, severity, component, evidence, benchmark, sources[]}
├── contradictions: [Contradiction]
│   └── {claims[], sources[], severity, explanation}
├── missing_info: [str]
├── action_pack: ActionPack
│   ├── rfis: [str]
│   ├── agency_actions: [AgencyAction]
│   │   └── {agency, action, why, deadline}
│   ├── verification_requests: [str]
│   ├── conditions_precedent: [str]
│   └── timeline: [TimelineEntry]
│       └── {label, date, kind, detail, severity, source_url, ground_truth}
├── recommended_next_action: str | None
├── acquired_data: [AcquiredData]
│   └── {component, data_points[], sources[], still_missing[]}
└── user: str | None
```

### Current scaling walls

1. **Portfolio listing is O(N)** — `main.py:portfolio()` globs every JSON file, parses each into a `Report`, filters archived, sorts by readiness. At thousands of reports this is seconds of latency.
2. **Backend restart orphans all in-flight jobs** — `JOB_LOGS`, `JOB_TRACES`, `JOB_GATES` are process-local dicts. A restart kills every running pipeline with no recovery.
3. **Share registry is a single JSON file** — concurrent writes to `shares.json` are not atomic; at scale this corrupts.
4. **Grid data loads ~25s into RAM** — 100k+ features parsed into STRtree on every startup. No spatial database means every worker pays this cost independently.
5. **No cross-project queries** — the `/findings` page needs to scan every report JSON to find contradictions across projects. There's no index for this.

---

## 2. Why Not NoSQL

The data is document-like (reports are nested JSON blobs), which initially suggests MongoDB. But three factors rule it out:

### 2.1 Geospatial is a first-class workload

`grid.py` (891 lines) performs STRtree nearest-neighbor, corridor buffering (150m buffer + intersection), point-in-polygon, and CRS reprojection (EPSG:3310 ↔ EPSG:4326) on 100k+ features.

- **PostGIS** is the industry standard — `ST_Distance`, `ST_Intersects`, `ST_Buffer`, `ST_DWithin` all run in SQL with GIST spatial indexes.
- **MongoDB `2dsphere`** supports basic `near` and `geoWithin` but cannot do corridor analysis, CRS reprojection, or complex polygon intersection. It would require keeping the in-memory STRtree approach.

### 2.2 Financial due-diligence requires ACID

A report's score, review state, and share state must be transactionally consistent. A reviewer approving a report while another user claims a share copy must not produce a partial state.

- **PostgreSQL** provides full ACID across all tables.
- **MongoDB** has multi-document transactions since v4.0, but they are slower and less commonly used in production.

### 2.3 Cross-project queries are relational

The `/findings` page shows a cross-project findings queue — contradictions and gaps drawn from many reports, filtered by severity and status. This is a relational pattern.

- **PostgreSQL**: `SELECT * FROM findings WHERE severity = 'critical' AND status = 'open' ORDER BY created_at` — one indexed query.
- **MongoDB**: requires scanning every report document and filtering embedded arrays, or denormalizing findings into a separate collection (which is just reinventing relational tables).

### 2.4 JSONB neutralizes the only NoSQL advantage

PostgreSQL's `JSONB` columns store the full `Report` Pydantic model as-is — no forced normalization, no schema migration when agent contracts evolve. This was MongoDB's only real advantage, and it's eliminated.

---

## 3. Target Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        API LAYER (FastAPI)                            │
├───────────────┬──────────────┬───────────────┬──────────┬────────────┤
│  PostgreSQL   │    Redis     │  S3 / R2      │  Search  │ TimescaleDB│
│  (OLTP +      │  (cache +    │  (object      │ (Meili-  │ (traces +  │
│   PostGIS +   │   queue +    │   storage +   │  search /│  audit     │
│   TimescaleDB)│   pubsub)    │   CDN)        │  ES)     │  log)      │
│               │              │               │          │            │
│  System of    │  Ephemeral   │  Blobs that   │  Full-   │  Append-   │
│  record:      │  state that  │  don't need   │  text &  │  only      │
│  reports,     │  survives    │  querying:    │  faceted │  time-     │
│  reviews,     │  restart but │  uploads,     │  search  │  series    │
│  shares,      │  not forever │  memos, tiles │  across  │  event     │
│  findings,    │              │               │  reports │  store     │
│  users, orgs, │              │               │          │            │
│  parcels,     │              │               │          │            │
│  grid infra   │              │               │          │            │
└───────────────┴──────────────┴───────────────┴──────────┴────────────┘
```

### Why polyglot (not one database)

| Workload | Wrong tool | Right tool | Why |
|---|---|---|---|
| Report CRUD, portfolio listing | Redis (no persistence guarantees) | PostgreSQL | ACID, indexed queries, JSONB |
| Job logs, SSE fan-out, queue | PostgreSQL (too slow for pub/sub) | Redis Streams | Sub-ms push, pub/sub, TTL |
| Uploaded PDFs, PMTiles, memos | PostgreSQL BLOB (bloats table) | S3 + CDN | Infinite scale, edge caching |
| Search "critical findings in NV" | PostgreSQL LIKE (no ranking) | Meilisearch | Inverted index, ranking, facets |
| 10M+ agent events with retention | PostgreSQL (bloats OLTP tables) | TimescaleDB | Auto-chunking, retention policies |
| Nearest substation to a parcel | In-memory STRtree (per-process) | PostGIS | SQL spatial queries, shared index |

---

## 4. PostgreSQL Schema — System of Record

### 4.1 Organizations & Users (multi-tenancy)

```sql
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free', 'pro', 'enterprise')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email       TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'analyst'
                CHECK (role IN ('analyst', 'reviewer', 'admin')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (org_id) REFERENCES organizations(id)
);

CREATE INDEX idx_users_org ON users(org_id);
```

### 4.2 Reports (hybrid: normalized hot fields + JSONB body)

```sql
CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,           -- from AnalyzeRequest.name
    location        TEXT NOT NULL,           -- from AnalyzeRequest.location
    county          TEXT,
    state           CHAR(2) DEFAULT 'CA',
    capacity_mw     REAL,
    readiness       SMALLINT NOT NULL,       -- 0-100, indexed for ORDER BY
    decision        TEXT NOT NULL
                    CHECK (decision IN ('Proceed', 'Investigate', 'Hold')),
    archived        BOOLEAN NOT NULL DEFAULT false,
    pipeline_mode   TEXT NOT NULL DEFAULT 'fast'
                    CHECK (pipeline_mode IN ('fast', 'deep')),
    -- Full Pydantic Report model — no migration needed when contracts evolve
    report_body     JSONB NOT NULL,
    -- Generated columns extract hot fields from JSONB without app changes
    red_flag_count  INT GENERATED ALWAYS AS
                    (jsonb_array_length(report_body->'red_flags')) STORED,
    contradiction_count INT GENERATED ALWAYS AS
                    (jsonb_array_length(report_body->'contradictions')) STORED,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Portfolio listing: WHERE org_id=? AND archived=false ORDER BY readiness
CREATE INDEX idx_reports_org_ready
    ON reports(org_id, archived, readiness);
CREATE INDEX idx_reports_org_created
    ON reports(org_id, created_at DESC);
-- JSONB GIN for ad-hoc key/path queries
CREATE INDEX idx_reports_body_gin ON reports USING gin(report_body);
```

### 4.3 Reviews (human sign-off on finished reports)

```sql
CREATE TABLE reviews (
    report_id       UUID PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'AWAITING_REVIEW'
                    CHECK (status IN ('AWAITING_REVIEW', 'APPROVED', 'REJECTED')),
    reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewer_name   TEXT,                     -- denormalized for display
    rationale       TEXT,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.4 Shares (public read-only links)

```sql
CREATE TABLE shares (
    token           TEXT PRIMARY KEY,         -- secrets.token_urlsafe(8)
    report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,              -- nullable; null = never expires
    -- Claims: {user_id: copied_report_id} — idempotent per (token, user)
    claims          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_shares_report ON shares(report_id);
```

### 4.5 Findings (cross-project findings queue)

Extracted from report_body JSONB into a normalized table for the `/findings` page:

```sql
CREATE TABLE findings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL
                    CHECK (kind IN ('red_flag', 'contradiction', 'gap')),
    title           TEXT NOT NULL,
    severity        TEXT NOT NULL
                    CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    component       TEXT,                     -- Land, Law, Finance, Materials, Demand
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'investigating', 'resolved', 'ignored')),
    evidence        JSONB NOT NULL,           -- the full flag/contradiction object
    sources         JSONB NOT NULL DEFAULT '[]'::jsonb,
    linked_finding_ids UUID[] DEFAULT '{}',   -- cross-references
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_findings_org_severity
    ON findings(org_id, severity, status);
CREATE INDEX idx_findings_report ON findings(report_id);
CREATE INDEX idx_findings_component ON findings(org_id, component);
```

### 4.6 Jobs (pipeline run metadata — survives restart)

```sql
CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    report_id       UUID REFERENCES reports(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'completed',
                                      'failed', 'timeout', 'awaiting_review')),
    pipeline_mode   TEXT NOT NULL DEFAULT 'fast',
    -- Trace summary stored as JSONB (full events go to TimescaleDB)
    trace_summary   JSONB,
    error_message   TEXT,
    queued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    -- Admission control: which slot this job occupied
    run_slot        SMALLINT
);

CREATE INDEX idx_jobs_org_status ON jobs(org_id, status);
CREATE INDEX idx_jobs_report ON jobs(report_id);
```

### 4.7 Chat Answers (Ask rail)

```sql
CREATE TABLE chat_answers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    question        TEXT NOT NULL,
    answer          TEXT NOT NULL,
    sources         JSONB NOT NULL DEFAULT '[]'::jsonb,
    grounded        BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_answers_report ON chat_answers(report_id, created_at DESC);
```

### 4.8 Model Tier Config

```sql
CREATE TABLE model_tiers (
    role            TEXT PRIMARY KEY,         -- orchestrator, researcher, etc.
    tier            TEXT NOT NULL
                    CHECK (tier IN ('main', 'flash')),
    model           TEXT NOT NULL,            -- kimi-latest, deepseek-v4-flash-0731
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 5. Redis Schema — Ephemeral State & Queuing

Redis solves the "lost on restart" problem and enables horizontal scaling.

### 5.1 Job logs (SSE narration — reconnect-safe)

Replaces `JOB_LOGS: dict[str, list]`:

```
Stream:  rai:jobs:{job_id}:logs
Type:    Redis Stream (XADD/XRANGE)
TTL:     24h (EXPIRE after job completes)

XADD rai:jobs:{job_id}:logs * type "status" msg "[capacity] run slot acquired"
XADD rai:jobs:{job_id}:logs * type "event" kind "agent.start" agent "Orchestrator" ...
```

- Reconnect-safe: client sends `XREAD FROM <last_id>` to resume.
- Multiple viewers: each tracks its own `last_id`.
- Cap: `XTRIM MAXLEN 10000` to bound memory.

### 5.2 Job traces (structured events)

Replaces `JOB_TRACES: dict[str, Trace]`:

```
Stream:  rai:jobs:{job_id}:trace
Type:    Redis Stream
TTL:     24h

XADD rai:jobs:{job_id}:trace * seq 1 kind "http.request" msg "POST /analyze" ...
```

Full events also written to TimescaleDB for long-term storage (see section 8).

### 5.3 Gap-review gates

Replaces `JOB_GATES: dict[str, GapGate]`:

```
Key:     rai:gate:{job_id}
Type:    Hash {awaiting: "true", approved: "[]", timeout_at: "2026-..."}
TTL:     GAP_REVIEW_TIMEOUT_S (default 300s)

Pub/Sub: rai:gate:{job_id}:resume  (resume signal)
```

The pipeline subscribes to the pub/sub channel; the resume endpoint publishes to it.

### 5.4 Run admission control (distributed semaphore)

Replaces `RUN_STATE` + `_RUN_GATE`:

```
Key:     rai:run:active      -- atomic counter
Key:     rai:run:queued      -- atomic counter
Key:     rai:run:gate        -- distributed semaphore (Lua script)

INCR rai:run:active   (on slot acquire)
DECR rai:run:active   (on slot release)
```

Enables multiple worker processes / machines to share a global concurrency cap.

### 5.5 Chat answers (Ask rail)

Replaces `ANSWERS: dict[str, ChatAnswer]`:

```
Key:     rai:ask:{ask_id}
Type:    Hash {answer, sources, grounded}
TTL:     1h (answers are only meaningful while the tab is open)
```

Also persisted to PostgreSQL for history (see section 4.7).

### 5.6 SSE fan-out (multiple viewers)

```
Channel: rai:jobs:{job_id}:events   (pub/sub)
```

One writer (the pipeline worker), N subscribers (viewer SSE connections).
Each subscriber also reads from the Stream for reconnect backfill.

### 5.7 LLM concurrency semaphore (cross-process)

Replaces `_LLM_SEMAPHORE`:

```
Key:     rai:llm:semaphore    -- distributed semaphore (Lua script)
```

Caps concurrent LLM calls across all worker processes on all machines.

### 5.8 Cache (portfolio, grid status, intel)

```
Key:     rai:cache:portfolio:{org_id}     -- 60s TTL
Key:     rai:cache:grid:status             -- 30s TTL
Key:     rai:cache:intel:{project}:{q}     -- 15min TTL (mirrors frontend)
```

---

## 6. S3 / Object Storage Schema

All file-based persistence moves to object storage with CDN delivery:

```
s3://rai-uploads/{org_id}/{job_id}/{filename}        -- PDFs, XLSXs
s3://rai-memos/{org_id}/{report_id}.html              -- generated investment memos
s3://rai-grid/geojson/{layer}.geojson                 -- lines, substations, blockers
s3://rai-tiles/{layer}.pmtiles                        -- served via CDN (no backend load)
s3://rai-reports-archive/{org_id}/{report_id}.json    -- cold storage of old reports
```

### PMTiles via CDN

The current custom FastAPI Range handler (`grid.py`) is replaced by a CDN:

```
https://cdn.rai.com/tiles/grid.pmtiles     -> CloudFront/Cloudflare
https://cdn.rai.com/tiles/offlimits.pmtiles
https://cdn.rai.com/tiles/scores.pmtiles
```

MapLibre reads PMTiles directly from the CDN — zero backend load for tile requests.

---

## 7. Search Engine Schema

At millions of reports, `LIKE '%critical%'` on JSONB is too slow. Use **Meilisearch** (simpler) or **Elasticsearch** (more features):

### Meilisearch index: `findings`

```json
{
    "id": "uuid",
    "reportId": "uuid",
    "orgId": "uuid",
    "projectName": "Solar Alpha",
    "location": "Boulder City, NV",
    "kind": "red_flag",
    "title": "CAPEX mismatch: $186M vs $199-211M",
    "severity": "critical",
    "component": "Finance",
    "status": "open",
    "evidence": "...",
    "sources": ["materials_quote.pdf p.4", "financial_model.xlsx"],
    "createdAt": "2026-08-25T20:23:00Z"
}
```

**Searchable attributes:** `title`, `evidence`, `projectName`, `location`
**Filterable attributes:** `orgId`, `severity`, `component`, `status`, `kind`
**Sortable attributes:** `createdAt`, `severity`

### Meilisearch index: `reports`

For full-text search across report summaries:

```json
{
    "id": "uuid",
    "orgId": "uuid",
    "name": "Solar Alpha",
    "location": "Boulder City, NV",
    "readiness": 72,
    "decision": "Proceed",
    "redFlagCount": 3,
    "createdAt": "2026-08-25T20:23:00Z"
}
```

### Sync pattern

PostgreSQL → Meilisearch via **change data capture** (CDC):
- Use `pg_notify` + a listener process, or
- Use Debezium → Kafka → Meilisearch for high-throughput environments
- Fallback: batch sync every 60s for the simple case

---

## 8. TimescaleDB Schema — Traces & Audit

TimescaleDB is a PostgreSQL extension — runs in the same database, no separate cluster.

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE agent_events (
    time        TIMESTAMPTZ NOT NULL,
    job_id      UUID NOT NULL,
    org_id      UUID NOT NULL,
    seq         INT NOT NULL,
    level       TEXT NOT NULL,              -- debug, info, warn, error
    kind        TEXT NOT NULL,              -- llm.response, tool.call, etc.
    msg         TEXT NOT NULL,
    phase       TEXT,
    agent       TEXT,
    duration_ms INT,
    data        JSONB
);

-- Convert to hypertable (auto-partitions by time)
SELECT create_hypertable('agent_events', 'time');

-- Retention: drop events older than 90 days automatically
SELECT add_retention_policy('agent_events', INTERVAL '90 days');

-- Continuous aggregate: per-job summary refreshed every 5 min
CREATE MATERIALIZED VIEW job_summaries
WITH (timescaledb.continuous) AS
SELECT
    job_id,
    org_id,
    count(*) AS event_count,
    sum(duration_ms) AS total_duration_ms,
    count(*) FILTER (WHERE level = 'error') AS error_count,
    count(*) FILTER (WHERE level = 'warn') AS warning_count,
    max(time) AS last_event_time
FROM agent_events
GROUP BY job_id, org_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('job_summaries',
    start_offset => INTERVAL '1 hour',
    end_offset   => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes');

-- Indexes for common queries
CREATE INDEX idx_events_job ON agent_events(job_id, seq);
CREATE INDEX idx_events_org_time ON agent_events(org_id, time DESC);
CREATE INDEX idx_events_kind ON agent_events(kind, time DESC);
```

This replaces both the in-memory `JOB_TRACES` and provides long-term observability
alongside SigNoz (which handles real-time dashboards).

---

## 9. PostGIS Schema — Geospatial

Replaces the in-memory STRtree in `grid.py` with SQL spatial queries.

### 9.1 Extension

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### 9.2 Grid infrastructure tables

```sql
CREATE TABLE grid_lines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geom        GEOGRAPHY(LINESTRING, 4326) NOT NULL,
    kv          INT,
    volt_class  TEXT,
    owner       TEXT,
    status      TEXT,
    source      TEXT NOT NULL DEFAULT 'CEC'  -- CEC, HIFLD
);

CREATE TABLE substations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geom        GEOGRAPHY(POINT, 4326) NOT NULL,
    name        TEXT,
    kv          INT,
    source      TEXT NOT NULL DEFAULT 'OSM'
);

CREATE INDEX idx_grid_lines_geom ON grid_lines USING gist(geom);
CREATE INDEX idx_substations_geom ON substations USING gist(geom);
CREATE INDEX idx_grid_lines_kv ON grid_lines(kv);
```

### 9.3 Blocker / off-limits layers

```sql
CREATE TABLE blockers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geom        GEOGRAPHY(POLYGON, 4326) NOT NULL,
    kind        TEXT NOT NULL
                CHECK (kind IN ('urban', 'protected', 'water',
                                'tribal', 'military', 'utility')),
    name        TEXT,
    source      TEXT
);

CREATE INDEX idx_blockers_geom ON blockers USING gist(geom);
CREATE INDEX idx_blockers_kind ON blockers(kind);
```

### 9.4 Parcels (scored)

```sql
CREATE TABLE parcels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    county      TEXT NOT NULL,
    geom        GEOGRAPHY(POLYGON, 4326) NOT NULL,
    score       SMALLINT NOT NULL DEFAULT 0,    -- 0-100
    gated       BOOLEAN NOT NULL DEFAULT false, -- hard-gated (protected/water/military)
    dist_mi     REAL,                            -- distance to nearest grid access
    kv          INT,                             -- voltage of nearest line
    acres       REAL,
    state       CHAR(2) DEFAULT 'CA'
);

CREATE INDEX idx_parcels_geom ON parcels USING gist(geom);
CREATE INDEX idx_parcels_county ON parcels(county);
CREATE INDEX idx_parcels_score ON parcels(score DESC);
```

### 9.5 Spatial queries (replacing in-memory STRtree)

```sql
-- Nearest substation to a point (replaces grid.py:_nearest)
SELECT id, name, kv,
       ST_Distance(geom, ST_Point($lng, $lat)::geography) AS dist_meters
FROM substations
ORDER BY geom <-> ST_Point($lng, $lat)::geography
LIMIT 1;

-- Corridor analysis: 150m buffer around a gen-tie centerline (replaces grid.py:_path)
WITH corridor AS (
    SELECT ST_Buffer(
        ST_GeomFromText($centerline_wkt, 4326)::geography,
        150, 'endcap=flat'
    ) AS geom
)
SELECT b.kind, b.name,
       ST_Intersection(b.geom, c.geom) AS crossing
FROM blockers b, corridor c
WHERE ST_Intersects(b.geom, c.geom);

-- Point-in-polygon: is this point inside a protected area? (replaces grid.py:_siting)
SELECT EXISTS(
    SELECT 1 FROM blockers
    WHERE kind = 'protected'
      AND ST_Contains(geom, ST_Point($lng, $lat)::geography)
) AS is_off_limits;

-- Municipal utility lookup: smallest-area polygon containing the point
SELECT name, ST_Area(geom) AS area
FROM blockers
WHERE kind = 'utility'
  AND ST_Contains(geom, ST_Point($lng, $lat)::geography)
ORDER BY area ASC
LIMIT 1;
```

### 9.6 Loading data

The existing `scripts/grid/fetch_*.py` scripts are extended to INSERT into PostGIS
instead of (or in addition to) writing GeoJSON files. The PMTiles baking pipeline
(`build_tiles.sh`, `bake_scores.sh`) continues to run for CDN-served map overlays,
but spatial queries hit PostGIS instead of in-memory STRtree.

---

## 10. Data Flow After Migration

```
User uploads documents + location
  -> POST /api/uploads  (files -> S3: rai-uploads/{org}/{job}/{filename})
  -> POST /api/projects/analyze
     -> INSERT INTO jobs (id, org_id, status='queued')
     -> XADD rai:jobs:{id}:logs * "queued"
     -> Enqueue job (Redis/Dramatiq -> worker process)
     -> Worker acquires run slot (Redis distributed semaphore)
     -> UPDATE jobs SET status='running', started_at=now()
     -> Pipeline runs (agents, tools, LLM calls)
        -> Every event: XADD rai:jobs:{id}:trace + INSERT into agent_events
        -> SSE narration: XADD rai:jobs:{id}:logs + PUBLISH rai:jobs:{id}:events
     -> On completion:
        -> INSERT INTO reports (id, report_body, readiness, decision, ...)
        -> Extract findings: INSERT INTO findings (per red_flag, contradiction, gap)
        -> UPDATE jobs SET status='completed', report_id=..., completed_at=now()
        -> XADD rai:jobs:{id}:logs * "__DONE__"
        -> Memo generation: POST /api/reports/{id}/memo -> S3: rai-memos/{org}/{id}.html
  -> SSE stream: SUBSCRIBE rai:jobs:{id}:events + XRANGE for backfill
  -> Portfolio: SELECT from reports WHERE org_id=? AND archived=false ORDER BY readiness
  -> Findings queue: SELECT from findings WHERE org_id=? AND severity=? AND status=?
  -> Review: INSERT/UPDATE reviews SET status='APPROVED'
  -> Share: INSERT INTO shares (token, report_id) -> public URL
  -> Ask: INSERT INTO chat_answers -> answer via LLM -> UPDATE
```

---

## 11. Migration Path (Phase 1–5)

Each phase is incremental — no rewrite, no big-bang. One subsystem migrates at a time,
and the system stays fully functional at every step.

### Phase 1: PostgreSQL + Redis (solves the two biggest walls)

**Goal:** Persist reports and job state; survive restarts; fix O(N) portfolio scan.

**Changes:**
1. Add `asyncpg` to `requirements.txt`
2. Create `agent_backend/db.py` — async connection pool + query helpers
3. Create `agent_backend/migrations/` — Alembic or plain SQL files
4. Migrate `STORE` (report file reads/writes) → `reports` table + JSONB
5. Migrate `JOB_LOGS` → Redis Streams
6. Migrate `JOB_TRACES` → Redis Streams (events also go to `agent_events` table)
7. Migrate `JOB_GATES` → Redis Hash + pub/sub
8. Migrate `RUN_STATE` + `_RUN_GATE` → Redis atomic counters
9. Migrate `ANSWERS` → Redis Hash (with PostgreSQL fallback)
10. Migrate `shares.json` → `shares` table
11. Migrate `reports/review/` sidecars → `reviews` table
12. Migrate `reports/archived.txt` → `reports.archived` column
13. Portfolio endpoint: `SELECT ... FROM reports WHERE org_id=? AND archived=false ORDER BY readiness`

**Backward compat:** Keep JSON file writes as a fallback during migration (dual-write
to both DB and file, read from DB first, fall back to file). Remove file fallback
once DB is proven stable.

**New env vars:**
```
DATABASE_URL=postgresql://rai:password@localhost:5432/rai
REDIS_URL=redis://localhost:6379/0
```

**Estimated effort:** 2–3 weeks

---

### Phase 2: Worker decoupling + S3 (enables horizontal scaling)

**Goal:** Pipeline runs as separate workers; files move to S3.

**Changes:**
1. Add `dramatiq` (or Celery) to `requirements.txt` — job queue backed by Redis
2. Create `agent_backend/worker.py` — Dramatiq worker entry point
3. `POST /api/projects/analyze` → enqueue to Dramatiq instead of `asyncio.create_task`
4. Workers are independently scalable: `dramatiq-redis --processes 4 --threads 2`
5. Add `boto3` (or `aioboto3`) to `requirements.txt`
6. Migrate file uploads → S3 (`rai-uploads/{org}/{job}/`)
7. Migrate memo storage → S3 (`rai-memos/{org}/{id}.html`)
8. Migrate grid GeoJSON → S3 (`rai-grid/geojson/`)
9. PMTiles: upload to S3, serve via CloudFront/Cloudflare CDN
10. Remove custom FastAPI PMTiles Range handler — CDN handles it

**New env vars:**
```
S3_BUCKET=rai-uploads
S3_REGION=us-east-1
CDN_BASE_URL=https://cdn.rai.com
```

**Estimated effort:** 2–3 weeks

---

### Phase 3: Read replicas + PgBouncer (read scaling)

**Goal:** Scale reads for portfolio listing, report views, and findings queries.

**Changes:**
1. Deploy PostgreSQL read replica
2. Add PgBouncer for connection pooling
3. `agent_backend/db.py` routes reads to replica, writes to primary
4. Portfolio, report fetch, findings, reviews → read replica
5. Analyze, review submit, share create → primary
6. Configure `asyncpg` with PgBouncer in transaction mode

**New env vars:**
```
DATABASE_URL_PRIMARY=postgresql://rai:password@pg-primary:5432/rai
DATABASE_URL_REPLICA=postgresql://rai:password@pg-replica:5432/rai
PGBOUNCER_URL=postgresql://rai:password@pgbouncer:6432/rai
```

**Estimated effort:** 1 week

---

### Phase 4: PostGIS + Meilisearch + TimescaleDB (feature scaling)

**Goal:** Spatial queries in SQL; full-text search; long-term trace storage.

**Changes:**
1. Enable PostGIS extension on the primary
2. Create spatial tables (grid_lines, substations, blockers, parcels)
3. Extend `scripts/grid/fetch_*.py` to INSERT into PostGIS (in addition to GeoJSON)
4. Refactor `grid.py` spatial queries to SQL (replace STRtree, nearest, corridor, siting)
5. Remove in-memory `_state` dict and `grid.preload()`
6. Enable TimescaleDB extension
7. Create `agent_events` hypertable
8. Worker writes trace events to `agent_events` (in addition to Redis Stream)
9. `/api/jobs/{id}/trace` reads from `agent_events` instead of in-memory `JOB_TRACES`
10. Deploy Meilisearch
11. Create `findings` and `reports` search indexes
12. Add CDC listener: PostgreSQL `pg_notify` → Meilisearch document upsert
13. `/findings` page queries Meilisearch instead of scanning report JSONs
14. Full-text search on report content via Meilisearch

**New env vars:**
```
MEILISEARCH_URL=http://meilisearch:7700
MEILISEARCH_KEY=...
```

**Estimated effort:** 3–4 weeks

---

### Phase 5: Partitioning + multi-region (global scale)

**Goal:** Scale to millions of users across regions.

**Changes:**
1. Partition `reports` by `org_id` (hash partitioning) or `created_at` (monthly)
2. Partition `agent_events` by time (automatic via TimescaleDB)
3. Partition `findings` by `org_id`
4. Multi-region read replicas:
   - US-East: primary + replica
   - US-West: replica
   - EU: replica (with GDPR compliance)
5. Application-layer routing: route requests to nearest replica by latency
6. Write-through caching: Redis in each region, invalidation via Redis pub/sub
7. Consider CockroachDB or Citus for multi-region writes if single-primary
   write latency becomes a bottleneck
8. CDN edge caching for PMTiles, memos, and static assets in every region

**Estimated effort:** 4–6 weeks

---

### Migration timeline summary

```
Phase 1 (2-3 weeks)    PostgreSQL + Redis          -- persistence, restart survival
Phase 2 (2-3 weeks)    Workers + S3                -- horizontal scaling, CDN
Phase 3 (1 week)       Read replicas + PgBouncer    -- read scaling
Phase 4 (3-4 weeks)    PostGIS + Meilisearch + TS   -- spatial SQL, search, traces
Phase 5 (4-6 weeks)    Partitioning + multi-region  -- global scale

Total: ~12-17 weeks of focused work
```

### What stays the same through every phase

- **Pydantic schemas** (`schemas.py`) — the agent contracts don't change. The `Report`
  model serializes to JSONB with zero modifications.
- **Agent pipeline** (`pipeline.py`, `agents/`) — the ReAct loop, parallel fan-out,
  graceful degradation, and tool whitelisting are database-agnostic.
- **Frontend** — the API contract (`/api/reports/{id}`, `/api/projects`, etc.) stays
  the same. The frontend doesn't know or care that the backend switched from files to
  PostgreSQL.
- **Adapter parity** — `sentinel_adapter.py` and `adapter.ts` remain byte-identical.
  The adapter reads from `report_body` JSONB, which is the same JSON the file contained.
- **Model tiers** — `model_tiers.json` → `model_tiers` table, but the live-read
  pattern stays the same (one query per agent call).

---

## 12. Technology Choices Summary

| Component | Technology | Why this and not the alternative |
|---|---|---|
| **Primary database** | PostgreSQL 16+ | ACID, JSONB, extensions ecosystem (PostGIS, TimescaleDB), proven at scale |
| ~~Alternative~~ | ~~MongoDB~~ | ~~Weaker geospatial, weaker transactions, JSONB neutralizes its only advantage~~ |
| ~~Alternative~~ | ~~SQLite~~ | ~~Single-writer conflicts with admission control; no PostGIS equivalent~~ |
| **Geospatial** | PostGIS 3.4+ | Gold standard for spatial SQL; replaces in-memory STRtree |
| **Cache / queue / pubsub** | Redis 7+ | Streams for reconnect-safe logs, pub/sub for SSE fan-out, atomic counters for admission control |
| **Object storage** | S3 (or Cloudflare R2) | Infinite scale, lifecycle policies, cheap; PMTiles served via CDN |
| **Full-text search** | Meilisearch | Simple deployment, typo-tolerance, faceted search; Elasticsearch if more features needed |
| **Time-series / traces** | TimescaleDB | PostgreSQL extension — same cluster, auto-chunking, retention policies |
| **Connection pooling** | PgBouncer | Transaction-mode pooling for asyncpg; prevents connection exhaustion |
| **Job queue** | Dramatiq (Redis broker) | Lightweight, async-native, decouples pipeline from API process |
| **ORM / query layer** | asyncpg (raw SQL) or SQLAlchemy 2.0 async | asyncpg is fastest; SQLAlchemy if ORM is preferred |
| **Migrations** | Alembic | Standard for SQLAlchemy; plain SQL files also work |

### New Python dependencies

```
# Phase 1
asyncpg>=0.29
redis>=5.0

# Phase 2
dramatiq[redis]>=1.16
boto3>=1.34            # or aioboto3 for async

# Phase 4
# (PostGIS and TimescaleDB are server-side extensions — no Python deps needed)
# (Meilisearch client is optional — HTTP calls via httpx suffice)

# Optional
sqlalchemy[asyncio]>=2.0  # if ORM is preferred over raw asyncpg
alembic>=1.13             # if using SQLAlchemy
```

### New infrastructure

| Phase | What to deploy |
|---|---|
| 1 | PostgreSQL 16, Redis 7 |
| 2 | S3 bucket, CDN distribution, Dramatiq worker process |
| 3 | PostgreSQL read replica, PgBouncer |
| 4 | Meilisearch instance, enable PostGIS + TimescaleDB extensions |
| 5 | Multi-region replicas, regional Redis, CDN edge locations |
