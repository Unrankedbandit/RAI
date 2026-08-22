# RAI

**An AI due-diligence copilot for utility-scale solar projects.**

Upload a location and a pile of project documents. RAI runs a pipeline of
specialist agents over them and returns a scored readiness report: what the
documents contradict, what they never covered, what the public record says
instead, and the exact work product needed to close the gaps.

Live demo: https://youtube.com/shorts/5sNu0m1ZihU?is=LPyxD7nvZHxxeQ-q

---

## The problem

A utility-scale solar project arrives at an investment committee as a dossier —
feasibility study, interconnection correspondence, offtake terms, a financial
model, permitting memos, environmental surveys. Hundreds of pages, assembled
over months by different parties, and internally inconsistent by the time it
lands.

Two things make this expensive:

**1. The red flags live between documents, not inside them.** Every individual
document is self-consistent and professionally produced. The problem is that the
financial model assumes $186M CAPEX while the materials quote says $199–211M;
that the offtake term sheet contracts 200 MW while the executed agreements cover
150; that the grading schedule starts before environmental review closes. No
single reviewer reading one document at a time catches these. Finding them means
holding every quantified claim in the package against every other one.

**2. A thin dossier looks the same as a complete one.** What is *absent* — no
bankable P50 irradiance study, no title evidence for site control, no queue
position — does not announce itself. It has to be audited against what a full
diligence package is supposed to contain, then chased down from public sources
before anyone can tell whether the gap is a paperwork delay or a dead deal.

Done by hand, that is weeks of senior analyst time per project — and deals move
on tax-credit deadlines that do not wait. RAI compresses it to a single run and
shows its work: every finding is cited back to the document or public source it
came from.

---

## Architecture

### The pipeline

One run fans out across specialist agents, each with a narrow prompt, a tool
whitelist, and a typed output contract. `agent_backend/pipeline.py`:

```
  location + documents (PDF / XLSX)
              │
              ▼
      ORCHESTRATOR ──────────────► ProjectProfile
              │                    (tech, MW, county, which components apply,
              │                     which document covers what)
              ▼
   DOC EXTRACTORS  ║ parallel, one per document
              │    ║ every quantified or date-bound claim, with a page citation
              ▼
      GAP ANALYZER ─────────────► what a full package needs that these docs lack
              │
              ▼
      DATA SCOUTS  ║ parallel, one per gap (≤12)
              │    ║ pull the real number from public sources — NREL, county
              │    ║ code, BLM/USFWS, ISO queues, federal registers
              ▼
      RESEARCHERS  ║ parallel, one per diligence component
              │    ║ apply knowledge-base benchmarks, flag violations
              ▼
    CROSS-EXAMINER ─────────────► contradictions BETWEEN documents
              │                   may request follow-up research (one re-entry,
              │  ◄── feedback ──  up to 3 questions)
              ▼
          SCORER ─────────────►   readiness 0–100 + RAG per dimension
              │                   land .20 · law .20 · finance .25 ·
              │                   materials .20 · demand .15
              │                   Proceed ≥70 · Investigate 40–69 · Hold <40
              ▼
         LIAISON ─────────────►   RFIs to the developer, agency action list,
              │                   verification requests, conditions precedent
              ▼
          Report (typed JSON) ──► dashboard
```

Cross-examination is the point of the product. Everything upstream exists to
give it a complete, citable set of facts to reconcile; everything downstream
turns what it finds into work someone can action.

### The agent loop

Every agent — all nine roles — runs the same loop in `agents/base.py`:

> plan → call tool → observe → repeat, until it emits JSON that validates
> against its contract.

- **No free-text handoffs.** Each role declares a Pydantic contract
  (`schemas.py`). Invalid output is fed back with the error and retried, not
  passed downstream. `MAX_STEPS` bounds the loop; failing to converge raises
  rather than returning something plausible.
- **Tools are whitelisted per role** (`agents/roles.py`). The doc extractor
  cannot search the web; the analyst answering questions about a finished report
  cannot execute code. A call outside the whitelist is traced as a warning, not
  silently honored.
- **Arithmetic is executed, not imagined.** The cross-examiner and scorer are
  instructed to write Python and run it for unit conversions and weighted
  scores. A readiness number that disagrees with its own dimension scores is the
  one error the scorer cannot make.
- **Provider is switchable.** `LLM_PROVIDER=anthropic` calls Claude directly
  through the Anthropic SDK (adaptive thinking, configurable effort);
  `LLM_PROVIDER=openai` routes the same loop through any OpenAI-compatible
  endpoint.

### Isolation

Model-generated code runs in a **Daytona** microVM, never on the host. Each
agent run provisions one sandbox up front, reuses it across that agent's tool
calls, and tears it down in a `finally` — so a crashed run cannot leak a box.
Egress is deny-by-default: the sandbox carries model credentials so agents can
call the model from inside it, and the allow-list is what stops generated code
from posting those credentials anywhere else.

With no `DAYTONA_API_KEY`, `sandbox_run` **refuses to execute** rather than
falling back to running generated code on the host.

> **Current gap:** the per-agent sandbox and the tracing below are wired into
> the Anthropic path. The OpenAI-compatible path (`LLM_PROVIDER=openai`, the
> present default) runs its own loop and is not yet instrumented — no spans, no
> sandbox session.

### Observability

Every phase, LLM call, tool call, and sandbox operation is a timed span
(`obs.py`). One `Trace` per job, and its sink pushes structured events onto the
same queue the SSE endpoint drains — so the dashboard's live narration and the
server console show the same activity, and `GET /api/jobs/{id}/trace` replays
the whole run afterwards. "The agent is slow" and "Daytona took 8s to
provision" are meant to be distinguishable. Anything shaped like a credential is
masked at the sink, since traces get pasted into issues and shown in demos.

**SigNoz export.** Set `SIGNOZ_INGESTION_KEY` (+ `SIGNOZ_REGION`) for SigNoz
Cloud, or `OTEL_EXPORTER_OTLP_ENDPOINT` for a self-hosted collector, and every
span above also exports as OpenTelemetry (`telemetry.py`): one trace per job,
rooted at the HTTP request that started it, with token counts, durations, and
failure/repair events as span attributes. FastAPI and httpx are
auto-instrumented on top. Unset, the backend is byte-for-byte as before.
`TELEMETRY_CONSOLE=1` prints spans to stdout for debugging without a backend.

### Control plane (optional Port integration)

With `PORT_CLIENT_ID`/`PORT_CLIENT_SECRET` set, every run is mirrored into a
[Port](https://port.io) catalog as it happens: one `factory_run` entity per job
(updated at each phase boundary), one `factory_agent_run` per agent, findings
as `factory_finding` entities — and each finished run lands in
`AWAITING_REVIEW` so a human approves the result in Port. Unset, it's a no-op.
Setup, blueprint JSON, and the operator walkthrough: **[docs/port-factory.md](docs/port-factory.md)**.

### Frontend contract

The dashboard talks to the backend over plain HTTP plus one SSE stream:

| Endpoint | Purpose |
|---|---|
| `POST /api/uploads` | multipart dossier upload |
| `POST /api/projects/analyze` | start a run, returns `jobId` immediately |
| `GET /api/jobs/{id}/stream` | SSE narration while the pipeline runs |
| `GET /api/reports/{id}` | the finished report |
| `POST /api/reports/{id}/ask` | grounded Q&A against a finished report |
| `GET /api/projects` | portfolio view, worst readiness first |
| `GET /api/health` · `/api/health/sandbox` | dependency and sandbox self-test |

`frontend/src/lib/agent/adapter.ts` converts an `AgentReport` into the UI's
`ProjectDetail` shape. A Python twin (`agent_backend/sentinel_adapter.py`)
produces identical output and is parity-locked in CI. When the backend is
unreachable the UI degrades to mock data rather than crashing.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router) · React 19 · TypeScript 5 · Tailwind CSS 4 · Framer Motion |
| Backend | Python · FastAPI · Uvicorn · Pydantic |
| Agent models | Anthropic SDK (Claude Opus 5), or any OpenAI-compatible endpoint |
| Code execution | Daytona ephemeral sandboxes |
| Document parsing | pypdf · openpyxl |
| Web research | Tavily search + Bright Data Web Unlocker scraping (both optional — fall back to the local knowledge base; see `CLAUDE.md`) |
| Streaming | Server-Sent Events |
| CI | GitHub Actions |

---

## Repo layout

| Path | What it is |
|---|---|
| `agent_backend/agents/` | the shared agent loop (`base.py`) and the nine role prompts (`roles.py`) |
| `agent_backend/pipeline.py` | orchestration, parallel fan-out, the cross-examination feedback loop |
| `agent_backend/schemas.py` | typed contracts between agents |
| `agent_backend/tools.py` · `sandbox.py` | tool layer; Daytona lifecycle and egress policy |
| `agent_backend/obs.py` | tracing — spans, structured events, SSE sink |
| `agent_backend/sentinel_adapter.py` | Python twin of the TS adapter, parity-locked in CI |
| `frontend/src/lib/agent/` | the report contract and adapter — the frontend↔agent boundary |
| `frontend/src/lib/scan/` | live scan stream: event shapes, SSE source, mock source |
| `research/` | compiled diligence knowledge base the agents ground on |
| `project-docs/` | sample dossiers |
| `docs/agent-framework.md` | full architecture doc |
| `scripts/check-all.mjs` | local pre-push gate; green locally = green in CI |

---

## Running it

```bash
# backend
pip install -r agent_backend/requirements.txt
cp agent_backend/.env.example agent_backend/.env    # fill in keys
set -a && source agent_backend/.env && set +a
uvicorn agent_backend.main:app --reload --port 8000

# frontend
cd frontend && npm install && npm run dev
```

The frontend defaults to `http://localhost:8000`; override with
`NEXT_PUBLIC_AGENT_API`. Without a backend it runs on mock data.

Required: a model key (`ANTHROPIC_API_KEY`, or `LLM_API_KEY` for the
OpenAI-compatible bridge). Optional: `DAYTONA_API_KEY` for sandboxed execution,
`TAVILY_API_KEY` for live web research. See `agent_backend/.env.example` for the
full set.
