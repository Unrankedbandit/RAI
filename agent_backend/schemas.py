"""Typed contracts that flow between agents. Everything downstream of the
agent loop is validated JSON — no free-text handoffs."""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field

Severity = Literal["critical", "high", "medium", "low"]
RAG = Literal["red", "amber", "green"]


class ProjectProfile(BaseModel):
    name: str
    technology: str = "solar+storage"
    capacity_mw: float
    site_acres: float | None = None
    county: str
    state: str = "CA"
    components: list[str] = Field(default_factory=list)
    doc_assignments: dict[str, str] = Field(default_factory=dict)  # doc -> components hint


class Fact(BaseModel):
    component: str
    claim: str
    value: str | float | None = None
    unit: str | None = None
    citation: str  # "doc.pdf p.2"


class FactSet(BaseModel):
    doc: str
    facts: list[Fact]
    gaps: list[str] = Field(default_factory=list)


class RedFlag(BaseModel):
    title: str
    severity: Severity
    component: str
    evidence: str
    benchmark: str | None = None
    sources: list[str] = Field(default_factory=list)


class Findings(BaseModel):
    component: str
    applicable_rules: list[str] = Field(default_factory=list)
    benchmarks: list[str] = Field(default_factory=list)
    site_specifics: list[str] = Field(default_factory=list)
    red_flags: list[RedFlag] = Field(default_factory=list)


class Contradiction(BaseModel):
    claims: list[str]
    sources: list[str]
    severity: Severity
    explanation: str


class ResearchRequest(BaseModel):
    component: str
    question: str


class DataNeed(BaseModel):
    """One piece of diligence data the uploaded docs failed to provide."""
    component: str
    missing: str                # e.g. "bankable GHI/P50 irradiance for the site"
    why_it_matters: str
    source_hint: str | None = None  # e.g. "NREL NSRDB / Global Solar Atlas"


class GapAnalysis(BaseModel):
    needs: list[DataNeed]


class AcquiredData(BaseModel):
    """What a Data Scout pulled from public sources for one DataNeed."""
    component: str
    data_points: list[str] = Field(default_factory=list)  # concrete, sourced facts
    sources: list[str] = Field(default_factory=list)
    still_missing: list[str] = Field(default_factory=list)  # becomes RFIs to developer


class ContradictionSet(BaseModel):
    contradictions: list[Contradiction] = Field(default_factory=list)
    coverage_gaps: list[str] = Field(default_factory=list)
    needs_more_research: list[ResearchRequest] = Field(default_factory=list)


class DimensionScore(BaseModel):
    name: str
    rag: RAG
    score: float  # 0-100
    flags: list[str]


class Score(BaseModel):
    readiness: float
    decision: Literal["Proceed", "Investigate", "Hold"]
    dimensions: list[DimensionScore]
    top_risks: list[str]


class AgencyAction(BaseModel):
    agency: str
    action: str
    why: str
    deadline: str | None = None


class ActionPack(BaseModel):
    rfis: list[str] = Field(default_factory=list)
    agency_actions: list[AgencyAction] = Field(default_factory=list)
    verification_requests: list[str] = Field(default_factory=list)
    conditions_precedent: list[str] = Field(default_factory=list)


class ChatAnswer(BaseModel):
    """One grounded answer from the Ask rail.

    `sources` is what makes the answer checkable — it names the red flags,
    contradictions or dimensions the answer leaned on, so the UI can point the
    reader back at the finding instead of asking them to trust prose.
    """

    answer: str
    sources: list[str] = Field(default_factory=list)
    # False when the report simply does not cover the question. The rail says
    # so plainly rather than letting the model improvise.
    grounded: bool = True


class Report(BaseModel):
    project: str
    location: str
    readiness: float
    decision: str
    dimensions: list[DimensionScore]
    red_flags: list[RedFlag]
    contradictions: list[Contradiction]
    missing_info: list[str]
    action_pack: ActionPack
    recommended_next_action: str | None = None
    acquired_data: list[AcquiredData] = Field(default_factory=list)
    # Which hackathon login started this run (gate header X-Hax-User). Optional
    # and schema-compatible: older reports simply have null.
    user: str | None = None
