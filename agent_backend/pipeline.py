"""Pipeline: orchestrator -> parallel doc extraction + parallel research ->
cross-examination (with one feedback re-entry) -> scoring -> liaison -> report.

PIPELINE_MODE:
  fast — demo-reliable lane: Orchestrator -> Extractors -> one consolidated
         Researcher -> CrossExaminer -> Scorer -> Liaison (~7 agents). The full
         swarm is ~25 agents; on a slow/flaky bridge every agent is another
         chance to die, so fast is the default.
  deep — the full swarm: gap analysis, data scouts, and one researcher per
         component. Set PIPELINE_MODE=deep when the endpoint is healthy.
"""
from __future__ import annotations

import asyncio
import os
from collections.abc import Callable

from .agents.base import Agent, AgentDidNotConverge
from .obs import Trace
from .agents.roles import (
    ORCHESTRATOR, DOC_EXTRACTOR, GAP_ANALYZER, DATA_SCOUT, RESEARCHER,
    CROSS_EXAMINER, SCORER, LIAISON, ROLE_TOOLS,
)
from .schemas import (
    AcquiredData, ActionPack, ContradictionSet, FactSet, Findings, GapAnalysis,
    ProjectProfile, Report, Score,
)

StatusFn = Callable[[str], None]

PIPELINE_MODE = os.getenv("PIPELINE_MODE", "fast")
# Hard wall per agent: a stalled turn on a slow bridge must fail fast into the
# degrade path, not burn 6 minutes of retries before anyone notices.
AGENT_TIMEOUT = int(os.getenv("AGENT_TIMEOUT", "300"))


async def _degrade(coro, fallback, on_status: StatusFn, label: str):
    """Run an agent with a hard wall-clock cap, but on failure continue with an
    empty result instead of killing the whole run. The bridge is slow/flaky and
    the model is small — one flailing agent must not sink the others."""
    try:
        return await asyncio.wait_for(coro, timeout=AGENT_TIMEOUT)
    except Exception as e:
        on_status(f"[{label}] degraded ({type(e).__name__}: {str(e)[:60]}) — continuing with empty result")
        return fallback


def _agent(name: str, prompt: str, contract, role: str, on_status: StatusFn,
           trace: Trace | None = None) -> Agent:
    return Agent(name, prompt, contract, ROLE_TOOLS.get(role, {}), on_status, trace)


async def run_pipeline(
    project_name: str,
    location: str,
    docs: list[str],
    on_status: StatusFn = print,
    trace: Trace | None = None,
) -> Report:
    trace = trace or Trace()
    trace.event(
        "job.input", f"{project_name} @ {location}",
        documents=docs, documentCount=len(docs),
    )
    trace.event("phase", "building project profile + diligence plan", phase="orchestrate")
    # 1. Orchestrate: build the project profile + diligence plan
    profile: ProjectProfile = await _agent(
        "Orchestrator", ORCHESTRATOR, ProjectProfile, "orchestrator", on_status, trace
    ).run(
        "Build the diligence plan for this project.",
        {"request": {"name": project_name, "location": location, "documents": docs}},
    )

    trace.event("phase", "parallel document extraction", phase="extract")
    # 2. Extract: one extractor per doc, parallel — then gap analysis needs the facts
    fact_sets: list[FactSet] = list(await asyncio.gather(*[
        _degrade(
            _agent(f"Extractor:{d}", DOC_EXTRACTOR, FactSet, "doc_extractor", on_status, trace).run(
                f"Extract all structured facts from '{d}' ({'PDF' if d.endswith('.pdf') else 'XLSX'}).",
                {"project": profile.model_dump()},
            ),
            FactSet(doc=d, facts=[], gaps=[f"extraction failed for {d}"]),
            on_status, f"Extractor:{d}",
        )
        for d in docs
    ]))
    if PIPELINE_MODE == "fast":
        # Fast lane: skip gap analysis and the scout fan-out entirely. The
        # consolidated researcher and the cross-examiner only need the extracted
        # facts, so they run CONCURRENTLY (the cross-examiner does its own
        # kb_lookup research) — this alone cuts ~5 min of serial waiting.
        on_status("[pipeline] fast lane — research + cross-examination in parallel")
        acquired: list[AcquiredData] = []
        acquired_ctx: list[dict] = []
        core_findings, contradictions = await asyncio.gather(
            _degrade(
                _agent("Researcher:core", RESEARCHER, Findings, "researcher", on_status, trace).run(
                    "Research this project against every diligence component "
                    "(state/federal law, permitting, zoning, ecology, community, financials, "
                    "interconnection, grid, demand, resource/supply chain) using the knowledge "
                    "base and web. Flag benchmark violations with severity.",
                    {"project": profile.model_dump(), "facts": [f.model_dump() for f in fact_sets]},
                ),
                Findings(component="core"),
                on_status, "Researcher:core",
            ),
            _agent(
                "CrossExaminer", CROSS_EXAMINER, ContradictionSet, "cross_examiner", on_status, trace
            ).run(
                "Cross-examine all extracted facts against each other and against research findings.",
                {
                    "facts": [f.model_dump() for f in fact_sets],
                    "findings": [],
                    "acquired": [],
                },
            ),
        )
        findings = [core_findings]
    else:
        trace.event("phase", "auditing package completeness", phase="gap")
        # 2b. Gap analysis: what does a full diligence package need that the docs lack?
        gap: GapAnalysis = await _degrade(
            _agent("GapAnalyzer", GAP_ANALYZER, GapAnalysis, "gap_analyzer", on_status, trace).run(
                "Compare the extracted facts against full diligence data requirements. List every missing data need.",
                {"project": profile.model_dump(), "facts": [f.model_dump() for f in fact_sets]},
            ),
            GapAnalysis(needs=[]),
            on_status, "GapAnalyzer",
        )

        # 2c. Data acquisition: one scout per need, pulling real data from public sources
        on_status(f"[pipeline] {len(gap.needs)} data gaps found — dispatching data scouts")
        acquired: list[AcquiredData] = list(await asyncio.gather(*[
            _degrade(
                _agent(f"DataScout:{n.component}", DATA_SCOUT, AcquiredData, "data_scout", on_status, trace).run(
                    f"Acquire this missing diligence data: {n.missing}\nWhy it matters: {n.why_it_matters}",
                    {"project": profile.model_dump(), "source_hint": n.source_hint},
                ),
                AcquiredData(component=n.component, still_missing=[n.missing]),
                on_status, f"DataScout:{n.component}",
            )
            for n in gap.needs[:6]  # cap parallel scouts (burst limits on the bridge)
        ]))
        acquired_ctx = [a.model_dump() for a in acquired]

        researchers = [
            _degrade(
                _agent(f"Researcher:{c}", RESEARCHER, Findings, "researcher", on_status, trace).run(
                    f"Research the '{c}' component for this project and flag benchmark violations. "
                    "Acquired data from scouts is included in context — use it.",
                    {"project": profile.model_dump(), "acquired": acquired_ctx},
                ),
                Findings(component=c),
                on_status, f"Researcher:{c}",
            )
            for c in (profile.components or ["financials"])
        ]
        findings = await asyncio.gather(*researchers)

        trace.event("phase", "finding contradictions between documents", phase="cross_examine")
        # Deep mode: cross-examine after research, then one feedback loop of
        # follow-up researchers before scoring.
        contradictions: ContradictionSet = await _agent(
            "CrossExaminer", CROSS_EXAMINER, ContradictionSet, "cross_examiner", on_status, trace
        ).run(
            "Cross-examine all extracted facts against each other and against research findings.",
            {
                "facts": [f.model_dump() for f in fact_sets],
                "findings": [f.model_dump() for f in findings],
                "acquired": acquired_ctx,
            },
        )
        if contradictions.needs_more_research:
            followups = await asyncio.gather(*[
                _degrade(
                    _agent(f"Researcher:{r.component}:followup", RESEARCHER, Findings, "researcher", on_status, trace).run(
                        f"Follow-up question: {r.question}",
                        {"project": profile.model_dump(), "component": r.component},
                    ),
                    Findings(component=r.component),
                    on_status, f"Researcher:{r.component}:followup",
                )
                for r in contradictions.needs_more_research[:3]
            ])
            findings = list(findings) + list(followups)

    trace.event("phase", "weighted rubric → readiness + decision", phase="score")
    # 4. Score
    score: Score = await _agent("Scorer", SCORER, Score, "scorer", on_status, trace).run(
        "Score the project and issue a decision.",
        {
            "project": profile.model_dump(),
            "contradictions": contradictions.model_dump(),
            "findings": [f.model_dump() for f in findings],
        },
    )

    trace.event("phase", "drafting RFIs and agency actions", phase="liaison")
    # 5. Liaison artifacts
    actions: ActionPack = await _agent("Liaison", LIAISON, ActionPack, "liaison", on_status, trace).run(
        "Produce the liaison action pack for the deal team.",
        {
            "project": profile.model_dump(),
            "contradictions": contradictions.model_dump(),
            "gaps": [g for f in fact_sets for g in f.gaps] + contradictions.coverage_gaps,
            "score": score.model_dump(),
        },
    )

    trace.event("phase", "assembling the typed report", phase="compose")
    # 6. Compose report
    all_flags = [flag for f in findings for flag in f.red_flags]
    trace.event(
        "job.output", f"readiness={score.readiness} decision={score.decision}",
        readiness=score.readiness, decision=score.decision,
        redFlags=len(all_flags), contradictions=len(contradictions.contradictions),
        dimensions={d.name: d.score for d in score.dimensions},
    )
    return Report(
        project=profile.name,
        location=f"{profile.county} County, {profile.state}",
        readiness=score.readiness,
        decision=score.decision,
        dimensions=score.dimensions,
        red_flags=all_flags,
        contradictions=contradictions.contradictions,
        missing_info=[g for f in fact_sets for g in f.gaps] + contradictions.coverage_gaps,
        action_pack=actions,
        recommended_next_action=score.top_risks[0] if score.top_risks else None,
        acquired_data=acquired,
    )
