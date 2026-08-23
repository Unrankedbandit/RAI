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
from .gate import GapGate, gap_review_enabled, gap_review_timeout
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
# EVERY agent call in this module must go through _degrade — an unwrapped call
# has no cap at all, and on a sick bridge (the exact moment a timeout fires
# elsewhere) one bare agent grinds retry×backoff per step and the run reads
# as a hang. main.py additionally caps the whole job with PIPELINE_TIMEOUT.
AGENT_TIMEOUT = int(os.getenv("AGENT_TIMEOUT", "300"))


async def _degrade(coro, fallback, on_status: StatusFn, label: str):
    """Run an agent with a hard wall-clock cap, but on failure continue with an
    empty result instead of killing the whole run. The bridge is slow/flaky and
    the model is small — one flailing agent must not sink the others.

    Exception: auth/config errors (401/404 from the model endpoint) are
    deterministic — every agent will hit them — so they abort the run instead
    of degrading each agent into an empty, plausible-looking report."""
    try:
        return await asyncio.wait_for(coro, timeout=AGENT_TIMEOUT)
    except Exception as e:
        # Duck-typed status extraction: the OpenAI bridge raises
        # httpx.HTTPStatusError (status on e.response.status_code) while the
        # anthropic SDK raises anthropic.APIStatusError (status directly on
        # e.status_code). Catching only httpx let anthropic 401/404s fall into
        # the generic degrade — an auth outage became an empty, plausible
        # report instead of an abort.
        status = getattr(e, "status_code", None) or getattr(
            getattr(e, "response", None), "status_code", None
        )
        if status in (401, 404):
            raise
        on_status(f"[{label}] degraded ({type(e).__name__}: {str(e)[:60]}) — continuing with empty result")
        return fallback


def _agent(name: str, prompt: str, contract, role: str, on_status: StatusFn,
           trace: Trace | None = None, max_steps: int | None = None) -> Agent:
    return Agent(name, prompt, contract, ROLE_TOOLS.get(role, {}), on_status, trace,
                 max_steps=max_steps)


async def run_pipeline(
    project_name: str,
    location: str,
    docs: list[str],
    on_status: StatusFn = print,
    trace: Trace | None = None,
    gap_gate: GapGate | None = None,
    user: str | None = None,
    mode: str | None = None,
) -> Report:
    # Read the module global at call time, not import time, so a monkeypatched
    # PIPELINE_MODE (scripts/test-gap-gate.py) still drives the lane branch.
    mode = mode or PIPELINE_MODE
    trace = trace or Trace()
    # The request's `name` (address / APN / lot id) IS the project identity,
    # end to end. Normalize it once here: trim whitespace; fall back to the
    # location, then a placeholder, only when the caller sent nothing.
    project_name = (project_name or "").strip() or (location or "").strip() or "Untitled parcel"
    trace.event(
        "job.input", f"{project_name} @ {location}",
        documents=docs, documentCount=len(docs),
    )
    trace.event("phase", "building project profile + diligence plan", phase="orchestrate")
    # 1. Orchestrate: build the project profile + diligence plan. Degrades to a
    # bare-minimum profile (the request itself) — a blind plan still lets the
    # extractors run, while a hang here used to stall the run before it began.
    profile: ProjectProfile = await _degrade(
        _agent(
            "Orchestrator", ORCHESTRATOR, ProjectProfile, "orchestrator", on_status, trace
        ).run(
            "Build the diligence plan for this project.",
            {"request": {"name": project_name, "location": location, "documents": docs}},
        ),
        ProjectProfile(name=project_name, capacity_mw=0, county=location),
        on_status, "Orchestrator",
    )
    # Pin the profile name to the request: the Orchestrator may describe the
    # project (technology, capacity, county) but must never rename it —
    # Report.project and every downstream agent context carry the caller's
    # parcel/APN verbatim. Without this, the LLM's invented profile name
    # (e.g. "RAI Solar A — 180 MWac …") replaced the submitted lot id.
    profile.name = project_name

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
    if mode == "fast":
        # Fast lane: skip gap analysis and the scout fan-out entirely. The
        # consolidated researcher and the cross-examiner only need the extracted
        # facts, so they run CONCURRENTLY (the cross-examiner does its own
        # kb_lookup research) — this alone cuts ~5 min of serial waiting.
        on_status("[pipeline] fast lane — research + cross-examination in parallel")
        acquired: list[AcquiredData] = []
        acquired_ctx: list[dict] = []
        core_findings, contradictions = await asyncio.gather(
            _degrade(
                _agent(
                    "Researcher:core", RESEARCHER, Findings, "researcher", on_status, trace,
                    # One agent covers ~10 diligence components here (deep mode
                    # fans out one researcher per component instead) — the
                    # module default of 8 steps truncated it mid-coverage.
                    max_steps=int(os.getenv("AGENT_RESEARCH_STEPS", "12")),
                ).run(
                    "Research this project against every diligence component "
                    "(state/federal law, permitting, zoning, ecology, community, financials, "
                    "interconnection, grid, demand, resource/supply chain) using the knowledge "
                    "base and web. Flag benchmark violations with severity.",
                    {"project": profile.model_dump(), "facts": [f.model_dump() for f in fact_sets]},
                ),
                Findings(component="core"),
                on_status, "Researcher:core",
            ),
            _degrade(
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
                ContradictionSet(),
                on_status, "CrossExaminer",
            ),
        )
        findings = [core_findings]
        if contradictions.needs_more_research:
            # Fast lane follow-up fan-out (2026-08-23): the old "record as
            # coverage gaps" path dated from the public-bridge burst-budget era
            # — the bridge is local now with transport retries, and flash-tier
            # scouts (deepseek-flash) are fast and cheap. Chase the top 5
            # follow-up questions in parallel; only questions a scout could NOT
            # answer stay on the report as coverage gaps.
            follow_ups = contradictions.needs_more_research[:5]
            on_status(
                f"[pipeline] fast lane — {len(follow_ups)} follow-up question(s) → flash scouts"
            )
            chased: list[AcquiredData] = list(await asyncio.gather(*[
                _degrade(
                    _agent(
                        f"DataScout:followup-{i + 1}", DATA_SCOUT, AcquiredData,
                        "data_scout", on_status, trace,
                    ).run(
                        f"Acquire this missing diligence data: {r.question}"
                        + (f"\nWhy it matters: {r.why_it_matters}" if getattr(r, "why_it_matters", None) else ""),
                        {"project": profile.model_dump(),
                         "source_hint": getattr(r, "source_hint", None)},
                    ),
                    AcquiredData(component=f"followup-{i + 1}", still_missing=[r.question]),
                    on_status, f"DataScout:followup-{i + 1}",
                )
                for i, r in enumerate(follow_ups)
            ]))
            acquired.extend(chased)
            still = [q for a in chased for q in a.still_missing]
            contradictions.coverage_gaps.extend(still)
            trace.event(
                "phase",
                f"fast lane: scouts chased {len(follow_ups)} follow-ups "
                f"({len(follow_ups) - len(still)} answered, {len(still)} still missing)",
                phase="cross_examine",
            )
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

        # 2c. Human gap-review gate (opt-in via GAP_REVIEW=1): park the run
        # here so a person can read the gaps and approve which ones the data
        # scouts chase (POST /api/jobs/{id}/resume). The wait is bounded — on
        # timeout the run proceeds with ALL gaps. The factory never blocks
        # forever on a human. With no gate object or GAP_REVIEW unset this is
        # skipped entirely: zero behavior change, zero new events.
        needs = gap.needs
        if gap_gate is not None and gap_review_enabled() and needs:
            timeout_s = gap_review_timeout()
            # DataNeed carries no stable id or severity — synthesize gap-1..n
            # (index-stable within this run) so the resume call can name the
            # approved subset; severity defaults to "medium" for every gap.
            review = [
                {
                    "id": f"gap-{i + 1}",
                    "title": n.component,
                    "detail": n.missing + (f" — {n.why_it_matters}" if n.why_it_matters else ""),
                    "severity": "medium",
                }
                for i, n in enumerate(needs)
            ]
            trace.event(
                "gate.gap_review",
                f"awaiting human gap review — {len(review)} gaps, timeout {timeout_s}s",
                gaps=review, timeoutS=timeout_s,
            )
            gap_gate.awaiting = True
            approved: list[str] | None = None  # None = timeout → chase ALL gaps
            try:
                await asyncio.wait_for(gap_gate.event.wait(), timeout=timeout_s)
            except asyncio.TimeoutError:
                trace.warn(
                    "gate.resolved",
                    f"gap review timed out after {timeout_s}s — proceeding with all {len(review)} gaps",
                    mode="timeout", approved=[g["id"] for g in review],
                )
            else:
                approved = gap_gate.approved or []
                trace.event(
                    "gate.resolved",
                    f"gap review approved {len(approved)}/{len(review)} gaps",
                    mode="approved", approved=approved,
                )
            finally:
                gap_gate.awaiting = False
            if approved is not None:
                # Filter in original gap order; ids the human sent that don't
                # match a real gap are dropped silently.
                wanted = set(approved)
                needs = [n for i, n in enumerate(needs) if f"gap-{i + 1}" in wanted]
                if not needs:
                    trace.event("gate.scouts_skipped",
                                "approved gap list is empty — skipping data scouts")
                    on_status("[pipeline] gap review approved zero gaps — data scouts skipped")

        # 2d. Data acquisition: one scout per (approved) need, pulling real data from public sources
        on_status(f"[pipeline] {len(needs)} data gaps found — dispatching data scouts")
        acquired: list[AcquiredData] = list(await asyncio.gather(*[
            _degrade(
                _agent(f"DataScout:{n.component}", DATA_SCOUT, AcquiredData, "data_scout", on_status, trace).run(
                    f"Acquire this missing diligence data: {n.missing}\nWhy it matters: {n.why_it_matters}",
                    {"project": profile.model_dump(), "source_hint": n.source_hint},
                ),
                AcquiredData(component=n.component, still_missing=[n.missing]),
                on_status, f"DataScout:{n.component}",
            )
            for n in needs[:6]  # cap parallel scouts (burst limits on the bridge)
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
        contradictions: ContradictionSet = await _degrade(
            _agent(
                "CrossExaminer", CROSS_EXAMINER, ContradictionSet, "cross_examiner", on_status, trace
            ).run(
                "Cross-examine all extracted facts against each other and against research findings.",
                {
                    "facts": [f.model_dump() for f in fact_sets],
                    "findings": [f.model_dump() for f in findings],
                    "acquired": acquired_ctx,
                },
            ),
            ContradictionSet(),
            on_status, "CrossExaminer",
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
    # 4. Score. The fallback is an explicit 0/Hold — a crashed scorer must read
    # as "incomplete", never as a plausible mid-range grade.
    score: Score = await _degrade(
        _agent("Scorer", SCORER, Score, "scorer", on_status, trace).run(
            "Score the project and issue a decision.",
            {
                "project": profile.model_dump(),
                "contradictions": contradictions.model_dump(),
                "findings": [f.model_dump() for f in findings],
            },
        ),
        Score(
            readiness=0,
            decision="Hold",
            dimensions=[],
            top_risks=["Scoring agent unavailable — treat this report as incomplete"],
        ),
        on_status, "Scorer",
    )

    trace.event("phase", "drafting RFIs and agency actions", phase="liaison")
    # 5. Liaison artifacts. The liaison now carries the sourced evidence too
    # (red-flag sources + acquired research URLs): its timeline entries must
    # cite a real source_url when one exists, and it cannot cite URLs it
    # never saw — so it has to see them.
    actions: ActionPack = await _degrade(
        _agent("Liaison", LIAISON, ActionPack, "liaison", on_status, trace).run(
            "Produce the liaison action pack for the deal team.",
            {
                "project": profile.model_dump(),
                "contradictions": contradictions.model_dump(),
                "gaps": [g for f in fact_sets for g in f.gaps] + contradictions.coverage_gaps,
                "score": score.model_dump(),
                "findings": [f.model_dump() for f in findings],
                "acquired": acquired_ctx,
            },
        ),
        ActionPack(),
        on_status, "Liaison",
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
        user=user,
    )
