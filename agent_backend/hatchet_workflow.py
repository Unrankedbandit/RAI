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
hatchet = None
if HATCHET_TOKEN:
    from hatchet_sdk import Hatchet
    from hatchet_sdk.config import ClientConfig, ClientTLSConfig
    hatchet = Hatchet(config=ClientConfig(
        token=HATCHET_TOKEN,
        host_port="127.0.0.1:7077",
        tls_config=ClientTLSConfig(strategy="none"),
    ))


class PipelineInput(BaseModel):
    name: str
    location: str
    docs: list[str]
    mode: str = "fast"
    user: str | None = None
    client_ip: str | None = None


class PipelineOutput(BaseModel):
    job_id: str
    readiness: float
    decision: str
    red_flag_count: int
    contradiction_count: int


# ── Workflow definition ──────────────────────────────────────────────
# Only defined when Hatchet is configured — the module imports cleanly
# without a token (tests, CI, local dev without Hatchet).

if hatchet:
    pipeline_wf = hatchet.workflow(name="rai-pipeline", input_validator=PipelineInput)

    @pipeline_wf.task(
        retries=2,
        backoff_factor=2.0,
        backoff_max_seconds=30,
        execution_timeout=timedelta(seconds=300),
    )
    async def orchestrate(input: PipelineInput, ctx: Context) -> dict:
        """Build the project profile + diligence plan."""
        trace = Trace(ctx.workflow_run_id)
        from .pipeline import _degrade, _agent
        from .agents.base import AgentDidNotConverge

        profile = await _degrade(
            _agent("Orchestrator", ORCHESTRATOR, ProjectProfile, "orchestrator", print, trace).run(
                "Build the diligence plan for this project.",
                {"request": {"name": input.name, "location": input.location, "documents": input.docs}},
            ),
            ProjectProfile(name=input.name, capacity_mw=0, county=input.location),
            print, "Orchestrator",
        )
        profile.name = input.name
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

        fact_sets = []
        for doc in input.docs:
            fs = await _degrade(
                _agent(f"Extractor:{doc}", DOC_EXTRACTOR, FactSet, "doc_extractor", print, trace).run(
                    f"Extract all structured facts from '{doc}' ({'PDF' if doc.endswith('.pdf') else 'XLSX'}).",
                    {"project": profile.model_dump()},
                ),
                FactSet(doc=doc, facts=[], gaps=[f"extraction failed for {doc}"]),
                print, f"Extractor:{doc}",
            )
            fact_sets.append(fs.model_dump())

        return {"fact_sets": fact_sets, "profile": profile.model_dump()}

    @pipeline_wf.task(
        parents=[extract_documents],
        retries=2,
        backoff_factor=2.0,
        backoff_max_seconds=30,
        execution_timeout=timedelta(seconds=600),
    )
    async def research(input: PipelineInput, ctx: Context) -> dict:
        """Research the project against diligence components."""
        trace = Trace(ctx.workflow_run_id)
        from .pipeline import _degrade, _agent
        data = ctx.task_output(extract_documents)
        profile = ProjectProfile(**data["profile"])
        fact_sets = [FactSet(**f) for f in data["fact_sets"]]

        if input.mode == "fast":
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
            return {"findings": [findings.model_dump()], "fact_sets": data["fact_sets"], "profile": data["profile"]}

        # Deep mode: one researcher per component
        _components = profile.components or ["financials"]
        findings_list = []
        for comp in _components:
            f = await _degrade(
                _agent(f"Researcher:{comp}", RESEARCHER, Findings, "researcher", print, trace).run(
                    f"Research the {comp} component for this project using the knowledge base and web.",
                    {"project": profile.model_dump(), "facts": [f.model_dump() for f in fact_sets]},
                ),
                Findings(component=comp),
                print, f"Researcher:{comp}",
            )
            findings_list.append(f.model_dump())

        return {"findings": findings_list, "fact_sets": data["fact_sets"], "profile": data["profile"]}

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
        profile = ProjectProfile(**data["profile"])
        fact_sets = [FactSet(**f) for f in data["fact_sets"]]
        findings = [Findings(**f) for f in data["findings"]]

        contradictions = await _degrade(
            _agent("CrossExaminer", CROSS_EXAMINER, ContradictionSet, "cross_examiner", print, trace).run(
                "Cross-examine all extracted facts against each other and against research findings.",
                {
                    "facts": [f.model_dump() for f in fact_sets],
                    "findings": [f.model_dump() for f in findings],
                    "acquired": [],
                },
            ),
            ContradictionSet(),
            print, "CrossExaminer",
        )
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
        profile = ProjectProfile(**data["profile"])
        contradictions = ContradictionSet(**data["contradictions"])
        score_obj = Score(**data["score"])
        findings = [Findings(**f) for f in data["findings"]]
        fact_sets = [FactSet(**f) for f in data["fact_sets"]]

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
                    "acquired": [],
                },
            ),
            ActionPack(),
            print, "Liaison",
        )
        return {**data, "action_pack": action_pack.model_dump()}

    @pipeline_wf.task(
        parents=[liaison],
        retries=1,
        execution_timeout=timedelta(seconds=60),
    )
    async def compose_report(input: PipelineInput, ctx: Context) -> dict:
        """Compose the final report and persist to DB."""
        data = ctx.task_output(liaison)
        profile = ProjectProfile(**data["profile"])
        score_obj = Score(**data["score"])
        contradictions = ContradictionSet(**data["contradictions"])
        action_pack = ActionPack(**data["action_pack"])
        findings = [Findings(**f) for f in data["findings"]]
        fact_sets = [FactSet(**f) for f in data["fact_sets"]]

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
            acquired_data=[],
            user=input.user,
        )

        # Persist to DB
        if db.is_enabled():
            await db.save_report(
                ctx.workflow_run_id, report.model_dump(),
                name=input.name, location=input.location,
                pipeline_mode=input.mode, user_email=input.user,
                client_ip=input.client_ip,
            )
            await db.save_cited_sources(ctx.workflow_run_id, report.model_dump())

        return {
            "job_id": ctx.workflow_run_id,
            "readiness": score_obj.readiness,
            "decision": score_obj.decision,
            "red_flag_count": len(all_flags),
            "contradiction_count": len(contradictions.contradictions),
        }


def is_enabled() -> bool:
    return hatchet is not None
