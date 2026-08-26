"""Typed contracts that flow between agents. Everything downstream of the
agent loop is validated JSON — no free-text handoffs."""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field, field_validator

Severity = Literal["critical", "high", "medium", "low"]
RAG = Literal["red", "amber", "green"]

Decision = Literal["Proceed", "Investigate", "Hold"]

# Legacy free-text decision variants seen in stored reports / older scorer
# output, normalized onto the canonical Decision literals. The stored corpus
# today is already canonical ("Hold" x21, "Proceed" x1) — this validator keeps
# pre-contract and case-variant values validating.
_DECISION_ALIASES = {
    "proceed": "Proceed",
    "investigate": "Investigate",
    "hold": "Hold",
    "do not proceed": "Hold",
    "do-not-proceed": "Hold",
    "no-go": "Hold",
    "no go": "Hold",
    "proceed with conditions": "Investigate",
    "conditional proceed": "Investigate",
    "conditional": "Investigate",
}


def _normalize_decision(v: object) -> object:
    """before-validator for decision fields: map legacy/case variants onto the
    canonical Proceed/Investigate/Hold literals. Unknown strings pass through
    unchanged so the Literal check rejects them with a clear error."""
    if isinstance(v, str):
        return _DECISION_ALIASES.get(v.strip().lower(), v.strip())
    return v


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
    score: float = Field(ge=0, le=100)  # 0-100
    flags: list[str]


class Score(BaseModel):
    readiness: float = Field(ge=0, le=100)
    decision: Decision
    dimensions: list[DimensionScore]
    top_risks: list[str]

    _normalize = field_validator("decision", mode="before")(_normalize_decision)


class AgencyAction(BaseModel):
    agency: str
    action: str
    why: str
    deadline: str | None = None


class TimelineEntry(BaseModel):
    """One critical-path element for the UI timeline strip.

    The frontend renders these verbatim as milestone dots / deadline markers,
    so dates must be ISO YYYY-MM-DD — estimate from the record when an exact
    date is absent (an undated element is useless to the strip).

    source_url / ground_truth are the audit trail for the date: which public
    benchmark the duration was grounded in, and a link to it. Both optional —
    reports written before this contract still validate; the UI marks entries
    without a source_url as unverified rather than showing a fake link.
    """
    label: str
    date: str  # ISO YYYY-MM-DD
    kind: Literal["milestone", "deadline"] = "milestone"
    detail: str = ""
    severity: Severity = "medium"
    # External source for the date/duration — a URL a tool actually returned
    # or a benchmark URL from the LIAISON prompt. Never an invented URL.
    source_url: str | None = None
    # One-line note: the public benchmark this date was checked against
    # (e.g. "CEC Opt-In statutory 270-day decision") and how this entry sits
    # against it ("at benchmark", "aggressive vs ~2.5-yr empirical EIR").
    ground_truth: str | None = None
    # Row id in the ground-truth benchmark store (agent_backend/benchmarks.py,
    # surfaced via kb_lookup CURATED BENCHMARKS hits). When set it MUST
    # reference a benchmarks-store row id — validated against the store when
    # it is available.
    benchmark_id: str | None = None

    @field_validator("benchmark_id")
    @classmethod
    def _benchmark_id_must_exist(cls, v: str | None) -> str | None:
        """Check benchmark_id against the benchmark store IF the store file
        exists and is readable; no-op (pass) when the store is missing or
        broken — degrade paths must never become invalid."""
        if v is None:
            return v
        try:
            from . import benchmarks  # local import: store is optional
            conn = benchmarks._connect()
            try:
                row = conn.execute(
                    "SELECT 1 FROM benchmarks WHERE id = ?", (v,)
                ).fetchone()
            finally:
                conn.close()
        except Exception:
            return v  # store missing/broken/unreadable -> never reject
        if row is None:
            raise ValueError(
                f"benchmark_id {v!r} not found in benchmark store")
        return v


class ActionPack(BaseModel):
    rfis: list[str] = Field(default_factory=list)
    agency_actions: list[AgencyAction] = Field(default_factory=list)
    verification_requests: list[str] = Field(default_factory=list)
    conditions_precedent: list[str] = Field(default_factory=list)
    # The critical path the UI timeline strip renders. Optional so reports
    # written before this contract still validate; empty -> adapter falls back
    # to parsing agency-action deadlines.
    timeline: list[TimelineEntry] = Field(default_factory=list)


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
    readiness: float = Field(ge=0, le=100)
    decision: Decision
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

    _normalize = field_validator("decision", mode="before")(_normalize_decision)
