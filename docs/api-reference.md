# RAI Backend API Reference & Swagger UI Guide

> **Prerequisites:** PostgreSQL and Redis running locally (see
> `docs/database-architecture.md` Phase 2 setup). The backend is FastAPI,
> which ships with interactive Swagger UI and ReDoc out of the box — no
> extra dependencies needed.

---

## Table of Contents

1. [Starting the Backend Locally](#1-starting-the-backend-locally)
2. [Accessing Swagger UI](#2-accessing-swagger-ui)
3. [API Endpoint Reference](#3-api-endpoint-reference)
4. [Testing APIs in Swagger UI](#4-testing-apis-in-swagger-ui)
5. [Request/Response Schemas](#5-requestresponse-schemas)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Starting the Backend Locally

### Prerequisites

```bash
# Ensure PostgreSQL + Redis are running
sudo systemctl start postgresql
sudo systemctl start redis-server

# Verify they respond
PGPASSWORD=rai_dev_pass psql -h localhost -U rai -d rai -c "SELECT 1;"
redis-cli ping
```

### Create `.env` (first time only)

```bash
cp agent_backend/.env.example agent_backend/.env
```

Edit `agent_backend/.env` — at minimum set:

```env
DATABASE_URL=postgresql://rai:rai_dev_pass@localhost:5432/rai
REDIS_URL=redis://localhost:6379/0

# LLM access — required for actual pipeline runs (not needed for API browsing)
LLM_PROVIDER=openai
LLM_BASE_URL=https://hackathon.josephbissell.com/v1
LLM_API_KEY=<your bridge key>
```

### Start the server

```bash
set -a && source agent_backend/.env && set +a
.venv/bin/uvicorn agent_backend.main:app --reload --port 8000
```

You should see:

```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Application startup complete.
```

### Verify DB + Redis connected

```bash
curl -s http://localhost:8000/api/health | python3 -m json.tool
```

Check that `database.configured` and `redis.configured` are both `true`.

---

## 2. Accessing Swagger UI

FastAPI auto-generates two interactive API documentation interfaces:

| Interface | URL | Description |
|---|---|---|
| **Swagger UI** | `http://localhost:8000/docs` | Interactive — click and test endpoints in-browser |
| **ReDoc** | `http://localhost:8000/redoc` | Read-only — cleaner for browsing schemas |
| **OpenAPI JSON** | `http://localhost:8000/openapi.json` | Raw OpenAPI 3.1 spec (import into Postman/Insomnia) |

### How to use Swagger UI

1. Open `http://localhost:8000/docs` in your browser
2. Click any endpoint to expand it
3. Click **"Try it out"** (top-right of the expanded panel)
4. Fill in the parameters / request body
5. Click **"Execute"**
6. View the response (status code, headers, body) below

### Authentication in Swagger UI

Most endpoints accept an optional `X-Hax-User` header (the hackathon gate SSO
identity). In Swagger UI:

1. Click the **"Authorize"** button at the top of the page
2. Add `X-Hax-User` as a header with your username (e.g. `kirandevihosur74`)
3. All subsequent requests will include it automatically

> The `/api/share/{token}` GET endpoint is public (no auth) — the share link
> IS the capability. The `/api/share/{token}/claim` endpoint requires
> `X-Hax-User`.

---

## 3. API Endpoint Reference

### Pipeline & Jobs

| # | Method | Endpoint | Purpose | Request Body | Response |
|---|---|---|---|---|---|
| 1 | POST | `/api/uploads` | Upload dossier files (PDFs, XLSXs) for a pipeline run. Files are saved to the document directory that extractors read. | `multipart/form-data` — list of files | `{"files": ["report.pdf", "model.xlsx"]}` |
| 2 | POST | `/api/projects/analyze` | Start a due-diligence pipeline run. Returns a job ID immediately; the pipeline runs in the background and streams progress via SSE. | `AnalyzeRequest` — `name`, `location`, `docs[]`, `mode` | `{"jobId": "abc123def456"}` |
| 3 | GET | `/api/jobs/{job_id}/stream` | **SSE** stream of agent activity — powers the live "agents working" dashboard narration. Reconnect-safe via `from_idx` query param. | — | `text/event-stream` — `data: {"status": "..."}` or `data: {"event": {...}}` |
| 4 | GET | `/api/jobs/{job_id}/trace` | Full structured trace for a job — every phase, LLM call, and tool call with timings. Available after the run ends (in-memory or Redis). | — | `{"jobId": "...", "summary": {...}, "events": [...]}` |
| 5 | POST | `/api/jobs/{job_id}/resume` | Human decision at the gap-review gate (deep mode, `GAP_REVIEW=1`). Submits which gaps the data scouts should chase. 200 if parked, 409 if not awaiting, 404 if unknown. | `ResumeRequest` — `approved: ["gap-1", "gap-3"]` | `{"ok": true, "mode": "approved"}` |

### Reports

| # | Method | Endpoint | Purpose | Request Body | Response |
|---|---|---|---|---|---|
| 6 | GET | `/api/reports/{job_id}` | Fetch the finished diligence report (full JSON). Reads from PostgreSQL first, falls back to file. | — | `Report` JSON object |
| 7 | GET | `/api/projects` | Portfolio dashboard — all non-archived reports, worst readiness first. Single indexed SQL query when DB is configured. | — | `[{id, project, location, readiness, decision, user, dimensions[]}]` |

### Reviews (Human Sign-Off)

| # | Method | Endpoint | Purpose | Request Body | Response |
|---|---|---|---|---|---|
| 8 | GET | `/api/reports/{report_id}/review` | Current review state for a report. Defaults to `AWAITING_REVIEW` if no decision exists. | — | `{"status": "AWAITING_REVIEW", "reviewedBy": null, ...}` |
| 9 | POST | `/api/reports/{report_id}/review` | Submit human approve/reject decision. 409 if already decided unless `override: true`. | `ReviewDecisionRequest` | `{"status": "APPROVED", "reviewedBy": "...", "reviewedAt": "..."}` |

### Ask Rail (Q&A on Finished Reports)

| # | Method | Endpoint | Purpose | Request Body | Response |
|---|---|---|---|---|---|
| 10 | POST | `/api/reports/{report_id}/ask` | Ask a grounded question about a finished report. Returns its own job ID; the answer is produced by an LLM analyst. | `AskRequest` — `{"question": "What is the CAPEX mismatch?"}` | `{"jobId": "ask123abc456"}` |
| 11 | GET | `/api/asks/{ask_id}` | Fetch the answer from a prior ask. Reads from DB first, then in-memory. | — | `{"answer": "...", "sources": [...], "grounded": true}` |

### Shares (Public Read-Only Links)

| # | Method | Endpoint | Purpose | Request Body | Response |
|---|---|---|---|---|---|
| 12 | POST | `/api/reports/{job_id}/share` | Mint (or reuse) a public share token for a finished report. Idempotent per report. | — | `{"token": "aBcD1234", "url": "/share/aBcD1234"}` |
| 13 | GET | `/api/share/{token}` | **Public** — fetch the shared report JSON. No auth required; the link IS the capability. | — | `Report` JSON object |
| 14 | POST | `/api/share/{token}/claim` | Copy a shared report into the authenticated viewer's portfolio. Idempotent per (token, user). Requires `X-Hax-User` header. | — | `{"ok": true, "reportId": "new123abc456", "user": "..."}` |

### Memos (Investment Memo Export)

| # | Method | Endpoint | Purpose | Request Body | Response |
|---|---|---|---|---|---|
| 15 | POST | `/api/reports/{job_id}/memo` | Generate (or overwrite) an LLM-written HTML investment memo from the report. 502 if the writer can't produce real HTML. | — | `{"ok": true, "jobId": "...", "bytes": 45200}` |
| 16 | GET | `/api/reports/{job_id}/memo` | Serve the generated memo HTML. 404 until a POST has written it. | — | `text/html` file response |

### Grid (Geospatial Infrastructure)

| # | Method | Endpoint | Purpose | Request Body | Response |
|---|---|---|---|---|---|
| 17 | GET | `/api/grid/nearest?lat=&lng=` | Nearest transmission line and substation to a point, with distance, voltage, and corridor verdict. 503 if grid data not loaded. | — | `{"query": {"lat": ..., "lng": ...}, "hookup": {...}, "access": {...}, "path": {...}}` |
| 18 | POST | `/api/grid/scan` | Pre-scan candidate gen-tie origins on a parcel polygon. Analyzes multiple points (centroid, edge-nearest, midpoint) and ranks by verdict. | `{"geometry": <GeoJSON Polygon>}` | `{"candidates": [...], "best": {...}}` |
| 19 | GET | `/api/grid/tiles/{name}.pmtiles` | Serve PMTiles tile archives (grid, offlimits, scores) with HTTP 206 Range support. 503 if data not loaded. | — (uses `Range` header) | `application/octet-stream` (206 Partial Content) |
| 20 | GET | `/api/grid/status` | Grid data layer load status — feature counts, PMTiles byte sizes, loaded flag. Used by frontend to detect readiness. | — | `{"loaded": true/false, "lines": N, "substations": N, "pmtiles_bytes": N, ...}` |

### Health

| # | Method | Endpoint | Purpose | Request Body | Response |
|---|---|---|---|---|---|
| 21 | GET | `/api/health` | Dependency self-test — LLM configured, web search token, DB/Redis status, run admission capacity. | — | `{"ok": true/false, "llm": {...}, "database": {...}, "redis": {...}, "capacity": {...}}` |

---

## 4. Testing APIs in Swagger UI

### Step-by-step: Run a full pipeline

#### 4.1 Upload documents

1. Open `http://localhost:8000/docs`
2. Expand `POST /api/uploads`
3. Click **"Try it out"**
4. Upload a PDF or XLSX file
5. Click **"Execute"**
6. Note the returned filenames

#### 4.2 Start the analysis

1. Expand `POST /api/projects/analyze`
2. Click **"Try it out"**
3. Set the request body:
   ```json
   {
     "name": "Solar Alpha",
     "location": "Boulder City, NV",
     "docs": ["report.pdf", "model.xlsx"],
     "mode": "fast"
   }
   ```
4. Click **"Execute"**
5. Copy the `jobId` from the response

> **Note:** Without `LLM_API_KEY`, the job will immediately surface an error
> in the stream. With a key, the full agent pipeline runs (2–7 min for fast
> mode).

#### 4.3 Watch the live stream

The SSE stream is not directly testable in Swagger UI (it's a streaming
connection). Use `curl` instead:

```bash
curl -N http://localhost:8000/api/jobs/{jobId}/stream
```

Or in Swagger UI, use `GET /api/jobs/{job_id}/trace` after the run to see
the full structured trace.

#### 4.4 Fetch the report

1. Expand `GET /api/reports/{job_id}`
2. Enter the job ID from step 4.2
3. Click **"Execute"**
4. The full `Report` JSON is returned

#### 4.5 Review the report

1. Expand `POST /api/reports/{report_id}/review`
2. Enter the report ID
3. Set the body:
   ```json
   {
     "decision": "APPROVED",
     "reviewer": "kirandevihosur74",
     "rationale": "All critical flags resolved"
   }
   ```
4. Click **"Execute"**

#### 4.6 Ask a question

1. Expand `POST /api/reports/{report_id}/ask`
2. Enter the report ID
3. Set the body:
   ```json
   {
     "question": "What is the CAPEX mismatch between the financial model and materials quote?"
   }
   ```
4. Click **"Execute"**
5. Copy the `jobId` from the response
6. Expand `GET /api/asks/{ask_id}` and enter that ID to fetch the answer

#### 4.7 Create a share link

1. Expand `POST /api/reports/{job_id}/share`
2. Enter the report ID
3. Click **"Execute"**
4. Copy the token from the response
5. Test `GET /api/share/{token}` to fetch the public report

#### 4.8 Generate a memo

1. Expand `POST /api/reports/{job_id}/memo`
2. Enter the report ID
3. Click **"Execute"** (requires `LLM_API_KEY`)
4. Then use `GET /api/reports/{job_id}/memo` to fetch the HTML

### Step-by-step: Test grid endpoints

#### 4.9 Check grid data status

1. Expand `GET /api/grid/status`
2. Click **"Try it out"** → **"Execute"**
3. If `loaded: false`, grid data needs to be generated first:
   ```bash
   PATH="$PWD/.venv/bin:$PATH" python scripts/grid/fetch_grid_data.py
   PATH="$PWD/.venv/bin:$PATH" python scripts/grid/fetch_blockers.py
   PATH="$PWD/.venv/bin:$PATH" python scripts/grid/fetch_offlimits.py
   ```
4. Restart the server — grid data loads in a daemon thread (~25s)

#### 4.10 Nearest grid infrastructure

1. Expand `GET /api/grid/nearest`
2. Enter `lat: 36.74`, `lng: -119.79` (Fresno, CA)
3. Click **"Execute"**

---

## 5. Request/Response Schemas

### AnalyzeRequest

```json
{
  "name": "Solar Alpha",
  "location": "Boulder City, NV",
  "docs": ["feasibility.pdf", "financial_model.xlsx"],
  "mode": "fast"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Project name |
| `location` | string | Yes | Project location (city, county, or lat/lng) |
| `docs` | string[] | Yes | Filenames from `/api/uploads` response |
| `mode` | "fast" \| "deep" \| null | No | Pipeline lane. `null` = use `PIPELINE_MODE` env var |

### ResumeRequest

```json
{
  "approved": ["gap-1", "gap-3"]
}
```

### ReviewDecisionRequest

```json
{
  "decision": "APPROVED",
  "reviewer": "kirandevihosur74",
  "rationale": "All critical flags resolved",
  "override": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `decision` | "APPROVED" \| "REJECTED" | Yes | Human sign-off decision |
| `reviewer` | string (1–80 chars) | Yes | Reviewer name |
| `rationale` | string (max 500) | No | Optional justification |
| `override` | boolean | No | Must be `true` to change an already-decided review |

### AskRequest

```json
{
  "question": "What is the CAPEX mismatch?"
}
```

### Report (response — full shape)

```json
{
  "project": "Solar Alpha",
  "location": "Boulder City, NV",
  "readiness": 72,
  "decision": "Proceed",
  "dimensions": [
    {"name": "Land", "rag": "green", "score": 85, "flags": []},
    {"name": "Finance", "rag": "amber", "score": 62, "flags": ["CAPEX mismatch"]}
  ],
  "red_flags": [
    {"title": "CAPEX mismatch", "severity": "high", "component": "Finance",
     "evidence": "...", "benchmark": "...", "sources": ["model.xlsx", "quote.pdf"]}
  ],
  "contradictions": [
    {"claims": ["$186M CAPEX", "$199-211M materials"],
     "sources": ["model.xlsx", "quote.pdf"],
     "severity": "high", "explanation": "Financial model underestimates materials cost"}
  ],
  "missing_info": ["Bankable P50 irradiance study", "Title evidence"],
  "action_pack": {
    "rfis": ["Request updated CAPEX model with current materials pricing"],
    "agency_actions": [{"agency": "BLM", "action": "File ROW application", "deadline": "2026-12-01"}],
    "verification_requests": ["Verify interconnection queue position"],
    "conditions_precedent": ["Execute offtake agreement before financial close"],
    "timeline": [{"label": "Environmental review close", "date": "2027-03-15", "kind": "deadline"}]
  },
  "recommended_next_action": "Resolve CAPEX mismatch before IC",
  "acquired_data": [
    {"component": "Finance", "data_points": ["NREL Q1 2026 module pricing: $0.28/W"],
     "sources": ["nrel.gov"], "still_missing": ["Updated CAPEX model"]}
  ],
  "user": "kirandevihosur74"
}
```

### Health Response

```json
{
  "ok": true,
  "llm": {
    "provider": "openai",
    "configured": true,
    "model": "kimi-latest",
    "baseUrl": "https://hackathon.josephbissell.com/v1"
  },
  "webSearch": {"configured": true},
  "port": {"configured": false, "apiBase": null},
  "docs": {"dir": null, "knowledgeBase": null},
  "database": {"configured": true, "url": "postgresql://rai:rai…"},
  "redis": {"configured": true},
  "capacity": {"maxRuns": 2, "maxQueue": 4, "active": 0, "queued": 0}
}
```

---

## 6. Troubleshooting

### Swagger UI shows no endpoints

The server may not have started. Check the uvicorn output for errors. Common
causes: missing `.env`, wrong `DATABASE_URL`, or a port conflict.

### `database: {configured: false}` in health

The lifespan handler didn't find `DATABASE_URL`. Ensure:
1. `.env` file exists at `agent_backend/.env`
2. You sourced it: `set -a && source agent_backend/.env && set +a`
3. The URL is correct: `postgresql://rai:rai_dev_pass@localhost:5432/rai`

### `redis: {configured: false}` in health

Same as above but for `REDIS_URL`. Ensure Redis is running: `redis-cli ping`
should return `PONG`.

### Grid endpoints return 503

Grid data is not loaded. Either:
- The data files don't exist in `agent_backend/data/grid/` (run the fetch scripts)
- The server is still warming up (~25s after startup for spatial indexing)

### `POST /api/projects/analyze` returns 200 but job immediately errors

The `LLM_API_KEY` is not set or the bridge is unreachable. Check:
```bash
curl -s http://localhost:8000/api/health | python3 -m json.tool
```
Look at `llm.configured` — if `false`, set `LLM_API_KEY` in `.env`.

### `POST /api/projects/analyze` returns 429

The pipeline is at capacity — all run slots are taken and the queue is full.
Either wait for running jobs to finish or increase `PIPELINE_MAX_RUNS` /
`PIPELINE_MAX_QUEUE` in `.env`.

### `POST /api/reports/{id}/memo` returns 502

The memo writer LLM call failed. Check `LLM_API_KEY` and `MEMO_MODEL` in
`.env`. The bridge must be reachable and the model must exist.

### Importing OpenAPI into Postman/Insomnia

```bash
# Export the spec
curl http://localhost:8000/openapi.json -o rai-openapi.json
```

Then import `rai-openapi.json` into Postman (Import → File) or Insomnia
(Import → From File). All endpoints, schemas, and parameters will be
populated automatically.

### Making the backend publicly accessible

```bash
bash /home/bob/hackathons/bin/puburl 8000 rai-api
```

This maps `https://rai-api.josephbissell.com → 127.0.0.1:8000` through the
hackathon gate. Swagger UI is then at `https://rai-api.josephbissell.com/docs`.
