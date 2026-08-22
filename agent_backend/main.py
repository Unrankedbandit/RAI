"""Red Flag agent backend — FastAPI surface. The Next.js dashboard calls these
endpoints; the agent pipeline runs as a background task and streams status."""
from __future__ import annotations

import asyncio
import json
import os
import re
import traceback
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .agents.base import Agent
from .agents.roles import ANALYST, ROLE_TOOLS
from .gate import GapGate
from .obs import Trace
from .pipeline import _degrade, run_pipeline
from .port_client import PortReporter, port as _port
from .schemas import ChatAnswer, Report
from .telemetry import init_telemetry
from .tools import DOC_DIR

app = FastAPI(title="Red Flag Agent Backend")
# Explicit origins + credentials: the hackathon gate authenticates via an
# HttpOnly cookie on .josephbissell.com, so browser fetches from the parcel
# viewer arrive credentialed — and browsers reject allow_origins=["*"] for
# credentialed requests. localhost ports cover local dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://parcel.josephbissell.com",
        "https://rai-parcels.josephbissell.com",
        "https://rai-projects.josephbissell.com",
        "https://mockup.josephbissell.com",
        "https://rai.josephbissell.com",
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SigNoz/OpenTelemetry export. No-op unless SIGNOZ_INGESTION_KEY or
# OTEL_EXPORTER_OTLP_ENDPOINT is set — see agent_backend/telemetry.py.
init_telemetry(app)

STORE = Path(__file__).resolve().parent / "reports"
STORE.mkdir(exist_ok=True)
# Ids listed in reports/archived.txt are hidden from the portfolio listing
# (/api/projects) but remain fetchable by id (/api/reports/{id}) — clearing
# the board never breaks an already-shared permalink.
ARCHIVE_LIST = STORE / "archived.txt"


def _archived_ids() -> set[str]:
    try:
        return {
            line.strip()
            for line in ARCHIVE_LIST.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        }
    except FileNotFoundError:
        return set()

JOB_QUEUES: dict[str, asyncio.Queue] = {}
JOB_TRACES: dict[str, Trace] = {}
# Per-job gap-review gate handles (GAP_REVIEW=1). Registered at analyze time,
# popped when the job ends; gate.awaiting marks a run actually parked at the
# gap-review pause point — the resume endpoint's 200/409 contract keys off it.
JOB_GATES: dict[str, GapGate] = {}
# Append-only per-job narration log (status strings + trace events) — the
# reconnect-safe source for /api/jobs/{id}/stream; queues stay for back-compat.
JOB_LOGS: dict[str, list] = {}
# Whole-job watchdog. Every agent is individually capped by pipeline.AGENT_TIMEOUT,
# but a run is many serial phases — on a sick bridge each phase can burn its
# full cap, and before this watchdog the SSE stream simply went quiet forever.
# Bounded here so a job ALWAYS ends in a terminal __DONE__/__ERROR__ frame.
PIPELINE_TIMEOUT = int(os.getenv("PIPELINE_TIMEOUT", "2700"))  # 45 min
# Finished chat answers, keyed by the ask's own job id. In memory because an
# answer is only meaningful while the asking tab is open.
ANSWERS: dict[str, ChatAnswer] = {}


class AnalyzeRequest(BaseModel):
    name: str
    location: str
    docs: list[str]


class AskRequest(BaseModel):
    question: str


class ResumeRequest(BaseModel):
    approved: list[str] = []  # gap ids ("gap-1", ...) the human approved


ALLOWED_UPLOAD = re.compile(r"\.(pdf|xlsx|csv|docx|txt)$", re.IGNORECASE)


@app.post("/api/uploads")
async def uploads(files: list[UploadFile] = File(...)):
    """Receive the actual dossier files (multipart). Saved into the document
    directory the extractors read, so a subsequent /analyze with the returned
    filenames processes the real uploaded bytes."""
    saved = []
    for f in files:
        name = Path(f.filename or "").name  # strip any client-supplied path
        if not name or not ALLOWED_UPLOAD.search(name):
            continue
        (DOC_DIR / name).write_bytes(await f.read())
        saved.append(name)
    return {"files": saved}


@app.post("/api/projects/analyze")
async def analyze(req: AnalyzeRequest, x_hax_user: str | None = Header(None)):
    from .agents.base import PROVIDER
    job_id = uuid.uuid4().hex[:12]
    queue: asyncio.Queue = asyncio.Queue()
    JOB_QUEUES[job_id] = queue
    JOB_LOGS[job_id] = []

    # One trace per job. Its sink pushes structured events onto the same queue
    # the SSE endpoint drains, so the dashboard and the console see identical
    # activity — and JOB_TRACES keeps it replayable after the run ends.
    # The Port reporter rides the same sink: every phase/agent/tool event is
    # mirrored into factory_run / factory_agent_run entities. Fire-and-forget —
    # with no Port credentials configured it is a no-op.
    reporter = PortReporter(job_id, log=lambda m: trace.event("port", m, level="debug"))

    def sink(ev: dict):
        queue.put_nowait(ev)
        JOB_LOGS[job_id].append(ev)
        reporter.handle_event(ev)

    trace = Trace(job_id, sink=sink)
    JOB_TRACES[job_id] = trace
    trace.event(
        "http.request", "POST /api/projects/analyze",
        project=req.name, location=req.location, documents=req.docs,
    )
    trace.event("job.created", f"job {job_id} queued")
    reporter.start(req.name, req.location, req.docs)

    # Missing credential: keep the analyze→jobId contract (the E2E harness and
    # CI depend on it) and surface the cause as the terminal __ERROR__ frame —
    # an HTTP error here breaks the live-feedback pipe the demo runs on.
    _missing = (PROVIDER == "openai" and not os.getenv("LLM_API_KEY")) or (
        PROVIDER != "openai" and not os.getenv("ANTHROPIC_API_KEY"))
    if _missing:
        _which = "LLM_API_KEY" if PROVIDER == "openai" else "ANTHROPIC_API_KEY"
        _msg = f"{_which} not configured — set it in agent_backend/.env (check /api/health)"
        trace.event("job.error", _msg, level="error")
        JOB_LOGS[job_id].append(f"__ERROR__ {_msg}")
        queue.put_nowait(f"__ERROR__ {_msg}")
        return {"jobId": job_id}

    # Gap-review gate handle for this job. Registered even when GAP_REVIEW is
    # off (the pipeline simply never parks on it) so the resume endpoint can
    # answer 409 instead of 404 for a live, non-awaiting job.
    gate = GapGate()
    JOB_GATES[job_id] = gate

    async def work():
        def status(msg: str):
            queue.put_nowait(msg)
            JOB_LOGS[job_id].append(msg)
        try:
            report = await asyncio.wait_for(
                run_pipeline(
                    req.name, req.location, req.docs, on_status=status, trace=trace,
                    gap_gate=gate, user=x_hax_user,
                ),
                timeout=PIPELINE_TIMEOUT,
            )
            path = STORE / f"{job_id}.json"
            path.write_text(report.model_dump_json(indent=2), encoding="utf-8")
            trace.event("job.persisted", f"report written to {path}",
                        bytes=path.stat().st_size)
            # Human-in-the-loop gate: the run is not "done" in Port until a
            # person reviews the report there and flips status to APPROVED.
            reporter.awaiting_review(
                report_url=f"{os.getenv('APP_PUBLIC_URL', 'http://localhost:8000')}/api/reports/{job_id}",
                readiness=report.readiness, decision=report.decision, report=report,
            )
            trace.event("job.done", f"job {job_id} complete")
            trace.print_summary()
            JOB_LOGS[job_id].append("__DONE__")
            queue.put_nowait("__DONE__")
        except asyncio.TimeoutError:
            # Watchdog fired: the pipeline was cancelled mid-phase. This is the
            # terminal frame the SSE stream was missing when a run "hung".
            msg = (f"job exceeded PIPELINE_TIMEOUT={PIPELINE_TIMEOUT}s — "
                   "aborted instead of hanging; check the bridge and retry")
            trace.error("job.timeout", msg)
            reporter.failed("PipelineTimeout", msg)
            trace.print_summary()
            JOB_LOGS[job_id].append(f"__ERROR__ {msg}")
            queue.put_nowait(f"__ERROR__ {msg}")
        except Exception as e:
            # Previously the traceback was swallowed and only str(e) reached the
            # client — which for AgentDidNotConverge was just an agent name.
            trace.error("job.failed", f"{type(e).__name__}: {e}",
                        traceback=traceback.format_exc()[-2000:])
            reporter.failed(type(e).__name__, str(e))
            trace.print_summary()
            JOB_LOGS[job_id].append(f"__ERROR__ {type(e).__name__}: {e}")
            queue.put_nowait(f"__ERROR__ {type(e).__name__}: {e}")
        finally:
            # Job over — the gate handle is dead weight. If the run somehow
            # ended while parked, release any future resume call as a 409.
            gate.awaiting = False
            JOB_GATES.pop(job_id, None)

    asyncio.create_task(work())
    return {"jobId": job_id}


@app.get("/api/jobs/{job_id}/trace")
async def job_trace(job_id: str):
    """Full structured trace for a job — every phase, LLM call, and tool call
    with timings. This is the end-to-end view."""
    t = JOB_TRACES.get(job_id)
    if t is None:
        return {"error": "unknown job", "jobId": job_id}
    return {"jobId": job_id, "summary": t.summary(), "events": t.dump()}


@app.get("/api/health")
async def health():
    """Is every external dependency this backend needs actually reachable?"""
    from .agents.base import LLM_BASE_URL, LLM_OPENAI_MODEL, PROVIDER

    t = Trace("health")
    if PROVIDER == "openai":
        llm_configured = bool(os.getenv("LLM_API_KEY"))
        llm_info = {
            "provider": "openai",
            "configured": llm_configured,
            "model": LLM_OPENAI_MODEL,
            "baseUrl": LLM_BASE_URL,
        }
        if not llm_configured:
            t.warn("health.llm", "LLM_API_KEY not set — bridge calls will 401")
    else:
        llm_configured = bool(os.getenv("ANTHROPIC_API_KEY"))
        llm_info = {
            "provider": "anthropic",
            "configured": llm_configured,
            "model": os.getenv("ANTHROPIC_MODEL", "claude-opus-5"),
            "effort": os.getenv("AGENT_EFFORT", "high"),
        }
        if not llm_configured:
            t.warn("health.llm", "ANTHROPIC_API_KEY not set — the agent loop cannot run")
    result = {
        "ok": llm_configured,
        "llm": llm_info,
        "webSearch": {"configured": bool(os.getenv("BRIGHTDATA_API_TOKEN"))},
        "port": {"configured": _port.enabled, "apiBase": _port.api_base if _port.enabled else None},
        "docs": {"dir": os.getenv("DOC_DIR"), "knowledgeBase": os.getenv("KB_DIR")},
    }
    t.end()
    return result


@app.get("/api/jobs/{job_id}/stream")
async def stream(job_id: str, from_idx: int = 0):
    """SSE feed of agent activity — powers the demo's live 'agents working' narration.

    Reconnect-safe: the stream is a replay of the append-only JOB_LOGS, not a
    consumed queue, so a client that drops mid-research re-opens with
    ?from_idx=<items already seen> and loses nothing. Multiple viewers OK.
    """
    async def events():
        idx = max(0, from_idx)
        terminal = False
        while not terminal:
            log = JOB_LOGS.get(job_id)
            if log is None:
                yield f"data: {json.dumps({'status': '__ERROR__ unknown job'})}\n\n"
                return
            while idx < len(log):
                msg = log[idx]
                idx += 1
                if isinstance(msg, dict):
                    yield f"data: {json.dumps({'event': msg})}\n\n"
                    continue
                yield f"data: {json.dumps({'status': msg})}\n\n"
                if msg.startswith("__DONE__") or msg.startswith("__ERROR__"):
                    terminal = True
            if not terminal:
                await asyncio.sleep(0.25)
    return StreamingResponse(events(), media_type="text/event-stream")


@app.post("/api/jobs/{job_id}/resume")
async def resume(job_id: str, req: ResumeRequest):
    """Human decision at the gap-review gate (GAP_REVIEW=1): the approved gap
    ids the data scouts should chase. 200 while the job is parked at the gate,
    409 when the job exists but isn't awaiting gap review, 404 for unknown
    jobs. The pipeline emits `gate.resolved` itself when it wakes."""
    gate = JOB_GATES.get(job_id)
    if gate is None or not gate.awaiting:
        if job_id not in JOB_TRACES:
            raise HTTPException(status_code=404, detail=f"unknown job {job_id}")
        raise HTTPException(status_code=409, detail=f"job {job_id} is not awaiting gap review")
    gate.resolve(req.approved)
    return {"ok": True, "mode": "approved"}


@app.get("/api/reports/{job_id}")
async def get_report(job_id: str):
    path = STORE / f"{job_id}.json"
    if not path.exists():
        # A missing job report means the run failed before persisting — say so
        # instead of crashing with a 500 FileNotFoundError.
        raise HTTPException(
            status_code=404,
            detail=f"no report for job {job_id} — the run may have failed; check /api/jobs/{job_id}/trace",
        )
    return json.loads(path.read_text(encoding="utf-8"))


@app.post("/api/reports/{report_id}/ask")
async def ask(report_id: str, req: AskRequest):
    """Ask a question about a finished report.

    Returns its own job id immediately and narrates on the existing
    /api/jobs/{id}/stream endpoint, so the Ask rail reuses the transport the
    scan already uses rather than introducing a second streaming shape.
    """
    path = STORE / f"{report_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"unknown report {report_id}")

    report = Report.model_validate_json(path.read_text(encoding="utf-8"))

    ask_id = uuid.uuid4().hex[:12]
    queue: asyncio.Queue = asyncio.Queue()
    JOB_QUEUES[ask_id] = queue

    # Same one-trace-per-job pattern as analyze: the analyst's steps stream to
    # the Ask rail and export to SigNoz under the same job id.
    trace = Trace(ask_id, sink=lambda ev: queue.put_nowait(ev))
    JOB_TRACES[ask_id] = trace

    async def work():
        def status(msg: str):
            queue.put_nowait(msg)
        try:
            # kb_lookup only — the analyst answers from the finished report,
            # so it needs no web tools in this path. Capped by AGENT_TIMEOUT via
            # _degrade: an uncapped analyst on a sick bridge hung the Ask rail
            # the same way bare pipeline agents hung a run.
            answer = await _degrade(
                Agent(
                    "Analyst", ANALYST, ChatAnswer, ROLE_TOOLS["analyst"], status, trace=trace,
                ).run(req.question, {"report": report.model_dump()}),
                ChatAnswer(
                    answer="The analyst timed out before answering — please try again.",
                    grounded=False,
                ),
                status, "Analyst",
            )
            ANSWERS[ask_id] = answer
            trace.event("job.done", f"ask {ask_id} complete")
            queue.put_nowait("__DONE__")
        except Exception as e:
            trace.error("job.failed", f"{type(e).__name__}: {e}")
            queue.put_nowait(f"__ERROR__ {e}")
        finally:
            trace.end()

    asyncio.create_task(work())
    return {"jobId": ask_id}


@app.get("/api/asks/{ask_id}")
async def get_answer(ask_id: str):
    if ask_id not in ANSWERS:
        raise HTTPException(status_code=404, detail=f"no answer for {ask_id}")
    return ANSWERS[ask_id].model_dump()


@app.get("/api/projects")
async def portfolio():
    """Portfolio dashboard: every completed report, worst first.

    Archived ids (reports/archived.txt) are hidden from the listing only —
    their reports stay fetchable by id so permalinks keep working."""
    archived = _archived_ids()
    pairs = [(p.stem, Report.model_validate_json(p.read_text(encoding="utf-8")))
             for p in STORE.glob("*.json") if p.stem not in archived]
    pairs.sort(key=lambda t: t[1].readiness)
    return [
        {"id": pid, "project": r.project, "location": r.location, "readiness": r.readiness,
         "decision": r.decision, "user": r.user,
         "dimensions": [d.model_dump() for d in r.dimensions]}
        for pid, r in pairs
    ]
