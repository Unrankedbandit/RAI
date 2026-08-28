"""Hatchet workflow for the RAI diligence pipeline — durable execution.

Each pipeline phase becomes a Hatchet step with retries, timeouts, and
durable state. A backend restart no longer orphans in-flight jobs — Hatchet
resumes from the last completed step.

The agent logic (ReAct loop, tool whitelisting, Pydantic contracts) is
unchanged — Hatchet wraps the orchestration, not the agents.

Requires:
  HATCHET_CLIENT_TOKEN — API token from the Hatchet dashboard
  Hatchet Lite running on localhost:8888 (dashboard) + :7077 (gRPC)
"""
from __future__ import annotations

import asyncio
import os
from datetime import timedelta
from typing import Any

from hatchet_sdk import Context, Hatchet
from pydantic import BaseModel

from . import db, redis_state
from .agents.base import Agent
from .agents.roles import (
    ORCHESTRATOR, DOC_EXTRACTOR, GAP_ANALYZER, DATA_SCOUT, RESEARCHER,
    CROSS_EXAMINER, SCORER, LIAISON, ROLE_TOOLS,
)
from .gate import GapGate, gap_review_enabled, gap_review_timeout
from .obs import Trace
from .schemas import (
    AcquiredData, ActionPack, ContradictionSet, FactSet, Findings, GapAnalysis,
    ProjectProfile, Report, Score,
)

HATCHET_TOKEN = os.getenv("HATCHET_CLIENT_TOKEN", "")

# Lazy client — created on first call to get_hatchet(), not at module import.
# Module-level creation breaks multiprocessing spawn (children re-import this
# module and must not re-initialize the gRPC connection).
_hatchet = None


def get_hatchet():
    """Return the Hatchet client, creating it on first call. Returns None when
    HATCHET_CLIENT_TOKEN is not set."""
    global _hatchet
    if _hatchet is not None or not HATCHET_TOKEN:
        return _hatchet
    from hatchet_sdk import Hatchet
    from hatchet_sdk.config import ClientConfig, ClientTLSConfig
    _hatchet = Hatchet(config=ClientConfig(
        token=HATCHET_TOKEN,
        host_port="127.0.0.1:7077",
        tls_config=ClientTLSConfig(strategy="none"),
    ))
    return _hatchet


def _narrate(job_id: str):
    """Return a narrate function that writes structured SSE events to Redis.
    The frontend reads these from /api/jobs/{job_id}/stream and drives the
    staging tracker (phase events) and sub-agent boxes (agent events).

    The Redis client is initialized lazily on first write — the worker's
    event loop may differ between steps, so we re-init if needed."""
    async def narrate(kind: str, msg: str, agent: str | None = None, phase: str | None = None):
        ev = {"kind": kind, "msg": msg, "level": "info"}
        if agent:
            ev["agent"] = agent
        if phase:
            ev["phase"] = phase
        # Re-init if the client was closed between steps (loop-affine)
        if not redis_state.is_enabled():
            await redis_state.init_client()
        await redis_state.append_log(job_id, ev)
    return narrate


class PipelineInput(BaseModel):
    name: str
    location: str
    docs: list[str]
    mode: str = "fast"
    user: str | None = None
    client_ip: str | None = None
    job_id: str = ""  # API job ID — used for SSE narration and report persistence


class PipelineOutput(BaseModel):
    job_id: str
    readiness: float
    decision: str
    red_flag_count: int
    contradiction_count: int


# ── Workflow definition ──────────────────────────────────────────────
# Only defined when Hatchet is configured — the module imports cleanly
# without a token (tests, CI, local dev without Hatchet). The workflow is
# created lazily by get_workflow() so spawned child processes don't
# re-initialize the gRPC connection at import time.

_pipeline_wf = None


def get_workflow():
    """Return the Hatchet workflow, creating it on first call. Returns None
    when HATCHET_CLIENT_TOKEN is not set."""
    global _pipeline_wf
    if _pipeline_wf is not None:
        return _pipeline_wf
    client = get_hatchet()
    if client is None:
        return None

    pipeline_wf = client.workflow(name="rai-pipeline", input_validator=PipelineInput)

    @pipeline_wf.task(
        retries=2,
        backoff_factor=2.0,
        backoff_max_seconds=30,
        execution_timeout=timedelta(seconds=300),
    )
    async def orchestrate(input: PipelineInput, ctx: Context) -> dict:
        """Build the project profile + diligence plan."""
        # Initialize DB/Redis on the task runner's event loop (loop-affine —
        # asyncpg/Redis connections can't cross event loops).
        await db.init_pool()
        await redis_state.init_client()
        print(f"[hatchet] redis enabled: {redis_state.is_enabled()}, db enabled: {db.is_enabled()}")

        trace = Trace(ctx.workflow_run_id)
        from .pipeline import _degrade, _agent
        from .agents.base import AgentDidNotConverge

        narrate = _narrate(input.job_id)
        await narrate("phase", "building project profile + diligence plan", phase="orchestrate")
        await narrate("agent.start", "Orchestrator starting", agent="Orchestrator", phase="orchestrate")

        profile = await _degrade(
            _agent("Orchestrator", ORCHESTRATOR, ProjectProfile, "orchestrator", print, trace).run(
                "Build the diligence plan for this project.",
                {"request": {"name": input.name, "location": input.location, "documents": input.docs}},
            ),
            ProjectProfile(name=input.name, capacity_mw=0, county=input.location),
            print, "Orchestrator",
        )
        profile.name = input.name

        await narrate("agent.done", f"Orchestrator done — {profile.technology}, {profile.capacity_mw} MW", agent="Orchestrator", phase="orchestrate")
        return profile.model_dump()

    @pipeline_wf.task(
        parents=[orchestrate],
        retries=2,
        backoff_factor=2.0,
        backoff_max_seconds=30,
        execution_timeout=timedelta(seconds=300),
    )
    async def extract_documents(input: PipelineInput, ctx: Context) -> dict:
        """Extract facts from each uploaded document in parallel."""
        trace = Trace(ctx.workflow_run_id)
        from .pipeline import _degrade, _agent
        profile_data = ctx.task_output(orchestrate)
        profile = ProjectProfile(**profile_data)

        narrate = _narrate(input.job_id)
        await narrate("phase", "parallel document extraction", phase="extract")

        fact_sets = []
        for doc in input.docs:
            await narrate("agent.start", f"Extractor:{doc}", agent=f"Extractor:{doc}", phase="extract")
            fs = await _degrade(
                _agent(f"Extractor:{doc}", DOC_EXTRACTOR, FactSet, "doc_extractor", print, trace).run(
                    f"Extract all structured facts from '{doc}' ({'PDF' if doc.endswith('.pdf') else 'XLSX'}).",
                    {"project": profile.model_dump()},
                ),
                FactSet(doc=doc, facts=[], gaps=[f"extraction failed for {doc}"]),
                print, f"Extractor:{doc}",
            )
            await narrate("agent.done", f"Extractor:{doc} done", agent=f"Extractor:{doc}", phase="extract")
            fact_sets.append(fs.model_dump())

        return {"fact_sets": fact_sets, "profile": profile.model_dump()}

    @pipeline_wf.task(
        parents=[extract_documents],
        retries=2,
        backoff_factor=2.0,
        backoff_max_seconds=30,
        execution_timeout=timedelta(seconds=300),
    )
    async def gap_analysis(input: PipelineInput, ctx: Context) -> dict:
        """Gap analysis — what does a full diligence package need that the docs lack?"""
        trace = Trace(ctx.workflow_run_id)
        from .pipeline import _degrade, _agent
        data = ctx.task_output(extract_documents)
        profile = ProjectProfile(**data["profile"])
        fact_sets = [FactSet(**f) for f in data["fact_sets"]]

        narrate = _narrate(input.job_id)
        await narrate("phase", "auditing package completeness", phase="gap")

        _gap_components = profile.components or ["financials"]
        await narrate("phase", f"gap analysis — {len(_gap_components)} analyzers in parallel", phase="gap")

        gap_parts = []
        for c in _gap_components:
            await narrate("agent.start", f"GapAnalyzer:{c} starting", agent=f"GapAnalyzer:{c}", phase="gap")
            g = await _degrade(
                _agent(f"GapAnalyzer:{c}", GAP_ANALYZER, GapAnalysis, "gap_analyzer", print, trace).run(
                    f"For the '{c}' component only: compare the extracted facts "
                    "against full diligence data requirements. List every missing "
                    "data need for this component.",
                    {"project": profile.model_dump(), "facts": [f.model_dump() for f in fact_sets]},
                ),
                GapAnalysis(needs=[]),
                print, f"GapAnalyzer:{c}",
            )
            await narrate("agent.done", f"GapAnalyzer:{c} done", agent=f"GapAnalyzer:{c}", phase="gap")
            gap_parts.append(g)

        # Merge + dedupe on (component, missing[:80])
        _seen: set[str] = set()
        _merged: list[DataNeed] = []
        for g in gap_parts:
            for n in g.needs:
                k = f"{n.component}::{n.missing[:80]}".lower()
                if k not in _seen:
                    _seen.add(k)
                    _merged.append(n)
        gap = GapAnalysis(needs=_merged)
        return {**data, "gap": gap.model_dump()}

    @pipeline_wf.task(
        parents=[gap_analysis],
        retries=2,
        backoff_factor=2.0,
        backoff_max_seconds=30,
        execution_timeout=timedelta(seconds=600),
    )
    async def data_scouts(input: PipelineInput, ctx: Context) -> dict:
        """Data acquisition — one scout per gap, pulling real data from public sources."""
        trace = Trace(ctx.workflow_run_id)
        from .pipeline import _degrade, _agent
        data = ctx.task_output(gap_analysis)
        gap = GapAnalysis(**data["gap"])

        narrate = _narrate(input.job_id)
        needs = gap.needs[:6]  # cap parallel scouts
        await narrate("phase", f"{len(needs)} data gaps found — dispatching data scouts", phase="scouts")

        acquired = []
        for n in needs:
            await narrate("agent.start", f"DataScout:{n.component} starting", agent=f"DataScout:{n.component}", phase="scouts")
            a = await _degrade(
                _agent(f"DataScout:{n.component}", DATA_SCOUT, AcquiredData, "data_scout", print, trace).run(
                    f"Acquire this missing diligence data: {n.missing}\nWhy it matters: {n.why_it_matters}",
                    {"project": data["profile"], "source_hint": n.source_hint},
                ),
                AcquiredData(component=n.component, still_missing=[n.missing]),
                print, f"DataScout:{n.component}",
            )
            await narrate("agent.done", f"DataScout:{n.component} done", agent=f"DataScout:{n.component}", phase="scouts")
            acquired.append(a)

        return {**data, "acquired": [a.model_dump() for a in acquired]}

    @pipeline_wf.task(
        parents=[data_scouts],
        retries=2,
        backoff_factor=2.0,
        backoff_max_seconds=30,
        execution_timeout=timedelta(seconds=600),
    )
    async def research(input: PipelineInput, ctx: Context) -> dict:
        """Research the project against diligence components."""
        trace = Trace(ctx.workflow_run_id)
        from .pipeline import _degrade, _agent
        data = ctx.task_output(data_scouts)
        profile = ProjectProfile(**data["profile"])
        fact_sets = [FactSet(**f) for f in data["fact_sets"]]
        acquired = [AcquiredData(**a) for a in data.get("acquired", [])]

        narrate = _narrate(input.job_id)
        await narrate("phase", "researching every diligence component", phase="research")

        if input.mode == "fast":
            await narrate("agent.start", "Researcher starting", agent="Researcher", phase="research")
            findings = await _degrade(
                _agent(
                    "Researcher:core", RESEARCHER, Findings, "researcher", print, trace,
                    max_steps=int(os.getenv("AGENT_RESEARCH_STEPS", "12")),
                ).run(
                    "Research this project against every diligence component "
                    "(state/federal law, permitting, zoning, ecology, community, financials, "
                    "interconnection, grid, demand, resource/supply chain) using the knowledge "
                    "base and web. Flag benchmark violations with severity.",
                    {"project": profile.model_dump(), "facts": [f.model_dump() for f in fact_sets]},
                ),
                Findings(component="core"),
                print, "Researcher:core",
            )
            await narrate("agent.done", "Researcher done", agent="Researcher", phase="research")
            return {"findings": [findings.model_dump()], "fact_sets": data["fact_sets"],
                    "profile": data["profile"], "acquired": data.get("acquired", [])}

        # Deep mode: one researcher per component, with acquired data as context
        _components = profile.components or ["financials"]
        findings_list = []
        for comp in _components:
            await narrate("agent.start", f"Researcher:{comp} starting", agent=f"Researcher:{comp}", phase="research")
            f = await _degrade(
                _agent(f"Researcher:{comp}", RESEARCHER, Findings, "researcher", print, trace).run(
                    f"Research the '{comp}' component for this project and flag benchmark violations.",
                    {"project": profile.model_dump(), "facts": [f.model_dump() for f in fact_sets],
                     "acquired": [a.model_dump() for a in acquired if a.component == comp]},
                ),
                Findings(component=comp),
                print, f"Researcher:{comp}",
            )
            await narrate("agent.done", f"Researcher:{comp} done", agent=f"Researcher:{comp}", phase="research")
            findings_list.append(f.model_dump())

        return {"findings": findings_list, "fact_sets": data["fact_sets"],
                "profile": data["profile"], "acquired": data.get("acquired", [])}

    @pipeline_wf.task(
        parents=[research],
        retries=2,
        backoff_factor=2.0,
        backoff_max_seconds=30,
        execution_timeout=timedelta(seconds=300),
    )
    async def cross_examine(input: PipelineInput, ctx: Context) -> dict:
        """Cross-examine all extracted facts and research findings."""
        trace = Trace(ctx.workflow_run_id)
        from .pipeline import _degrade, _agent
        data = ctx.task_output(research)

        narrate = _narrate(input.job_id)
        await narrate("phase", "finding contradictions between documents", phase="cross_examine")
        await narrate("agent.start", "CrossExaminer starting", agent="CrossExaminer", phase="cross_examine")
        profile = ProjectProfile(**data["profile"])
        fact_sets = [FactSet(**f) for f in data["fact_sets"]]
        findings = [Findings(**f) for f in data["findings"]]
        acquired = [AcquiredData(**a) for a in data.get("acquired", [])]

        contradictions = await _degrade(
            _agent("CrossExaminer", CROSS_EXAMINER, ContradictionSet, "cross_examiner", print, trace).run(
                "Cross-examine all extracted facts against each other and against research findings.",
                {
                    "facts": [f.model_dump() for f in fact_sets],
                    "findings": [f.model_dump() for f in findings],
                    "acquired": [a.model_dump() for a in acquired],
                },
            ),
            ContradictionSet(),
            print, "CrossExaminer",
        )
        await narrate("agent.done", "CrossExaminer done", agent="CrossExaminer", phase="cross_examine")
        return {**data, "contradictions": contradictions.model_dump()}

    @pipeline_wf.task(
        parents=[cross_examine],
        retries=2,
        backoff_factor=2.0,
        backoff_max_seconds=30,
        execution_timeout=timedelta(seconds=300),
    )
    async def score(input: PipelineInput, ctx: Context) -> dict:
        """Score the project readiness."""
        trace = Trace(ctx.workflow_run_id)
        from .pipeline import _degrade, _agent, apply_readiness_rollup
        data = ctx.task_output(cross_examine)

        narrate = _narrate(input.job_id)
        await narrate("phase", "weighted rubric → readiness + decision", phase="score")
        await narrate("agent.start", "Scorer starting", agent="Scorer", phase="score")
        profile = ProjectProfile(**data["profile"])
        findings = [Findings(**f) for f in data["findings"]]
        contradictions = ContradictionSet(**data["contradictions"])

        all_flags = [flag for f in findings for flag in f.red_flags]
        score_obj = await _degrade(
            _agent("Scorer", SCORER, Score, "scorer", print, trace).run(
                "Score this project on the five diligence pillars using the weighted rubric.",
                {
                    "project": profile.model_dump(),
                    "red_flags": [f.model_dump() for f in all_flags],
                    "contradictions": contradictions.model_dump(),
                },
            ),
            Score(readiness=0, decision="Hold", dimensions=[], top_risks=["Scoring agent unavailable"]),
            print, "Scorer",
        )
        score_obj = apply_readiness_rollup(score_obj, trace)
        await narrate("agent.done", f"Scorer done — readiness {score_obj.readiness}, decision {score_obj.decision}", agent="Scorer", phase="score")
        return {**data, "score": score_obj.model_dump()}

    @pipeline_wf.task(
        parents=[score],
        retries=2,
        backoff_factor=2.0,
        backoff_max_seconds=30,
        execution_timeout=timedelta(seconds=300),
    )
    async def liaison(input: PipelineInput, ctx: Context) -> dict:
        """Generate the action pack (RFIs, agency actions, timeline)."""
        trace = Trace(ctx.workflow_run_id)
        from .pipeline import _degrade, _agent
        data = ctx.task_output(score)

        narrate = _narrate(input.job_id)
        await narrate("phase", "drafting RFIs and agency actions", phase="liaison")
        await narrate("agent.start", "Liaison starting", agent="Liaison", phase="liaison")
        profile = ProjectProfile(**data["profile"])
        contradictions = ContradictionSet(**data["contradictions"])
        score_obj = Score(**data["score"])
        findings = [Findings(**f) for f in data["findings"]]
        fact_sets = [FactSet(**f) for f in data["fact_sets"]]
        acquired = [AcquiredData(**a) for a in data.get("acquired", [])]

        all_flags = [flag for f in findings for flag in f.red_flags]
        action_pack = await _degrade(
            _agent("Liaison", LIAISON, ActionPack, "liaison", print, trace).run(
                "Produce the liaison action pack for the deal team.",
                {
                    "project": profile.model_dump(),
                    "contradictions": contradictions.model_dump(),
                    "gaps": [g for f in fact_sets for g in f.gaps] + contradictions.coverage_gaps,
                    "score": score_obj.model_dump(),
                    "findings": [f.model_dump() for f in findings],
                    "acquired": [a.model_dump() for a in acquired],
                },
            ),
            ActionPack(),
            print, "Liaison",
        )
        await narrate("agent.done", "Liaison done", agent="Liaison", phase="liaison")
        return {**data, "action_pack": action_pack.model_dump()}

    @pipeline_wf.task(
        parents=[liaison],
        retries=1,
        execution_timeout=timedelta(seconds=60),
    )
    async def compose_report(input: PipelineInput, ctx: Context) -> dict:
        """Compose the final report and persist to DB."""
        # Initialize DB pool on the worker's event loop (the pool is loop-affine —
        # asyncpg connections can't cross event loops). No-op if already enabled.
        await db.init_pool()
        await db.run_migrations()

        data = ctx.task_output(liaison)
        profile = ProjectProfile(**data["profile"])
        score_obj = Score(**data["score"])
        contradictions = ContradictionSet(**data["contradictions"])
        action_pack = ActionPack(**data["action_pack"])
        findings = [Findings(**f) for f in data["findings"]]
        fact_sets = [FactSet(**f) for f in data["fact_sets"]]
        acquired = [AcquiredData(**a) for a in data.get("acquired", [])]

        narrate = _narrate(input.job_id)
        await narrate("phase", "assembling the typed report", phase="compose")

        all_flags = [flag for f in findings for flag in f.red_flags]
        report = Report(
            project=profile.name,
            location=input.location,
            readiness=score_obj.readiness,
            decision=score_obj.decision,
            dimensions=score_obj.dimensions,
            red_flags=all_flags,
            contradictions=contradictions.contradictions,
            missing_info=[g for f in fact_sets for g in f.gaps] + contradictions.coverage_gaps,
            action_pack=action_pack,
            recommended_next_action=None,
            acquired_data=acquired,
            user=input.user,
        )

        # Persist to DB — use the API's job_id (not the Hatchet run ID) so the
        # frontend's /api/reports/{job_id} and /api/jobs/{job_id}/stream work.
        report_id = input.job_id or ctx.workflow_run_id
        if db.is_enabled():
            await db.save_report(
                report_id, report.model_dump(),
                name=input.name, location=input.location,
                pipeline_mode=input.mode, user_email=input.user,
                client_ip=input.client_ip,
            )
            await db.save_cited_sources(report_id, report.model_dump())

        # Narrate completion — the SSE stream's terminal frame
        await narrate("agent.done", f"Report composed — readiness {score_obj.readiness}, decision {score_obj.decision}", phase="compose")
        await redis_state.append_log(report_id, "__DONE__")

        return {
            "job_id": ctx.workflow_run_id,
            "readiness": score_obj.readiness,
            "decision": score_obj.decision,
            "red_flag_count": len(all_flags),
            "contradiction_count": len(contradictions.contradictions),
        }

    _pipeline_wf = pipeline_wf
    return pipeline_wf


def is_enabled() -> bool:
    return get_hatchet() is not None
