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

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .agents.base import Agent
from .agents.roles import ANALYST, ROLE_TOOLS
from .obs import Trace
from .pipeline import run_pipeline
from .port_client import PortReporter, port as _port
from .schemas import ChatAnswer, Report
from .telemetry import init_telemetry
from .tools import DOC_DIR

app = FastAPI(title="Red Flag Agent Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# SigNoz/OpenTelemetry export. No-op unless SIGNOZ_INGESTION_KEY or
# OTEL_EXPORTER_OTLP_ENDPOINT is set — see agent_backend/telemetry.py.
init_telemetry(app)

STORE = Path(__file__).resolve().parent / "reports"
STORE.mkdir(exist_ok=True)
JOB_QUEUES: dict[str, asyncio.Queue] = {}
JOB_TRACES: dict[str, Trace] = {}
# Finished chat answers, keyed by the ask's own job id. In memory because an
# answer is only meaningful while the asking tab is open.
ANSWERS: dict[str, ChatAnswer] = {}


class AnalyzeRequest(BaseModel):
    name: str
    location: str
    docs: list[str]


class AskRequest(BaseModel):
    question: str


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
async def analyze(req: AnalyzeRequest):
    job_id = uuid.uuid4().hex[:12]
    queue: asyncio.Queue = asyncio.Queue()
    JOB_QUEUES[job_id] = queue

    # One trace per job. Its sink pushes structured events onto the same queue
    # the SSE endpoint drains, so the dashboard and the console see identical
    # activity — and JOB_TRACES keeps it replayable after the run ends.
    # The Port reporter rides the same sink: every phase/agent/tool event is
    # mirrored into factory_run / factory_agent_run entities. Fire-and-forget —
    # with no Port credentials configured it is a no-op.
    reporter = PortReporter(job_id, log=lambda m: trace.event("port", m, level="debug"))

    def sink(ev: dict):
        queue.put_nowait(ev)
        reporter.handle_event(ev)

    trace = Trace(job_id, sink=sink)
    JOB_TRACES[job_id] = trace
    trace.event(
        "http.request", "POST /api/projects/analyze",
        project=req.name, location=req.location, documents=req.docs,
    )
    trace.event("job.created", f"job {job_id} queued")
    reporter.start(req.name, req.location, req.docs)

    async def work():
        def status(msg: str):
            queue.put_nowait(msg)
        try:
            report = await run_pipeline(
                req.name, req.location, req.docs, on_status=status, trace=trace,
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
            queue.put_nowait("__DONE__")
        except Exception as e:
            # Previously the traceback was swallowed and only str(e) reached the
            # client — which for AgentDidNotConverge was just an agent name.
            trace.error("job.failed", f"{type(e).__name__}: {e}",
                        traceback=traceback.format_exc()[-2000:])
            reporter.failed(type(e).__name__, str(e))
            trace.print_summary()
            queue.put_nowait(f"__ERROR__ {type(e).__name__}: {e}")

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
async def stream(job_id: str):
    """SSE feed of agent activity — powers the demo's live 'agents working' narration."""
    async def events():
        queue = JOB_QUEUES[job_id]
        while True:
            msg = await queue.get()
            # The queue carries two shapes: legacy status strings from
            # `on_status`, and structured trace events from the Trace sink.
            # Both go out; the client can render whichever it understands.
            if isinstance(msg, dict):
                yield f"data: {json.dumps({'event': msg})}\n\n"
                continue
            yield f"data: {json.dumps({'status': msg})}\n\n"
            if msg.startswith("__DONE__") or msg.startswith("__ERROR__"):
                break
    return StreamingResponse(events(), media_type="text/event-stream")


@app.get("/api/reports/{job_id}")
async def get_report(job_id: str):
    return json.loads((STORE / f"{job_id}.json").read_text(encoding="utf-8"))


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
            # so it needs no web tools in this path.
            answer = await Agent(
                "Analyst", ANALYST, ChatAnswer, ROLE_TOOLS["analyst"], status, trace=trace,
            ).run(req.question, {"report": report.model_dump()})
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
    """Portfolio dashboard: every completed report, worst first."""
    reports = [Report.model_validate_json(p.read_text(encoding="utf-8")) for p in STORE.glob("*.json")]
    reports.sort(key=lambda r: r.readiness)
    return [
        {"project": r.project, "location": r.location, "readiness": r.readiness,
         "decision": r.decision, "dimensions": [d.model_dump() for d in r.dimensions]}
        for r in reports
    ]
