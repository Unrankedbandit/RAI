# Diligence Output Schema — Design

**Date:** 2026-08-14
**Status:** Revision 2 — extended to the full seven-role agent framework

**Revision 2.** The team's agent architecture (*Project Red Flag — Agent
Framework*) supersedes the three-stage topology revision 1 assumed. Revision 1's
arithmetic, factor weights, and derived-math principle are unchanged and now
independently confirmed — the framework's own dashboard shows exactly the figures
recovered here (readiness 26, dimensions 38 / 18.7 / 18.7 / 24 / 34.7, 7 critical
and 8 high). What changes is breadth: seven roles instead of three, an
eleven-component research axis alongside the five scoring factors, evidence from
the open web, and three new work products — a project profile, an action pack,
and kill criteria.

`@solarhack/schema` **owns** these contracts. The agent framework imports it and
hands the Zod schemas to `zodOutputFormat(...)`, so agent output is typed at the
point of generation rather than validated after the fact.

## Problem

A fan-out of agents performs due diligence on a solar development project by
reading the source documents in `data/` and researching each component against
external sources. Their output has to reach a React frontend in a form that
renders progressively, survives partial agent failure, and never disagrees with
itself about a number.

`frontend/` is a bare Vite scaffold; the agent framework is being built in
parallel. This spec defines the contract between them.

## Ground truth

`data/01_Project_Red_Flag_Risk_Register.xlsx` is not an input to the system —
it is the expected output, hand-authored. Its four sheets define the entire
domain model, and its formulas define the arithmetic. The schema mirrors it and
the test suite asserts against it.

**Factors and weights** (Dashboard sheet):

| Factor | Weight | Readiness (0-100) |
|---|---|---|
| Land | 0.20 | 38.00 |
| Law | 0.20 | 18.67 |
| Finance | 0.25 | 18.67 |
| Materials | 0.20 | 24.00 |
| Demand | 0.15 | 34.67 |
| **Overall** | 1.00 | **26.00** |

**Risk Register columns:** Risk ID, Factor, Subfactor, Risk, Evidence / Trigger,
Likelihood (1-5), Impact (1-5), Severity, Owner, Mitigation, Source Document,
Risk Score.

**Evidence Map** binds each source document to its primary factor(s), the key
fields to extract, and the red flag seeded into it:

| Document | Factor | Seeded red flag |
|---|---|---|
| 01 Land and Site Due Diligence | Land | Unsigned Parcel 14 + heavy-haul easement ambiguity |
| 02 Environmental, Water and Biodiversity | Law / Land | Raptor buffer conflict + 32 acre-feet water gap |
| 03 Legal, Regulatory and Permitting | Law | Early works precede environmental milestone |
| 04 Community and Stakeholder Engagement | Land / Law | Fallback truck route conflicts with community request |
| 05 Demand and Offtake Market Study | Demand | Only 150 MW firm vs 200 MW assumed |
| 06 Materials Supply Chain and Price Index | Materials | Transformer 62 weeks vs 38 weeks schedule |
| 07 Financial Feasibility and Sensitivity | Finance | $186M model conflicts with $199-211M updated cost |

Four of the seven red flags are **contradictions between two documents**, not
facts stated in one. Surfacing them is the point of the product, and it is why
the framework has a dedicated Cross-Examiner role.

**Document 05 is referenced by the Evidence Map but is absent from `data/`.**
This is treated as a permanent condition, not a bug to fix: the Demand extractor
must report `skipped` and the system must still produce a complete report. It is
the built-in test of the partial-failure path.

## Derived arithmetic

Recovered from the workbook and verified against all 16 rows:

```
riskScore(f)        = likelihood × impact                    // 1..25
severity(f)         = riskScore >= 20 ? 'critical'
                    : riskScore >= 12 ? 'high'
                    : riskScore >=  6 ? 'medium'
                    :                   'low'
avgRiskScore(F)     = mean(riskScore) over findings in factor F
readinessScore(F)   = 100 − 4 × avgRiskScore(F)              // 0..96, null if no findings
overallReadiness    = Σ weight(F) × readinessScore(F)  ÷  Σ weight(F)
                      over factors where readinessScore(F) is not null
rag(score)          = score >= 70 ? 'green' : score >= 40 ? 'amber' : 'red'
decision(total)     = total >= 70 ? 'proceed'
                    : total >= 40 ? 'investigate'
                    :               'hold'
```

The divisor renormalises the weights across the factors that actually scored.
With all five present it is 1.0 and the expression reduces to the workbook's
plain weighted sum. With a factor unscored, the remaining factors keep their
relative proportions instead of the missing one silently contributing zero —
which would read as "Demand is maximally risky" when the truth is "Demand is
unknown". `RunReport` carries the list of unscored factors so the UI can say so.

Verification against the workbook:

| Factor | Risk scores | avg | 100−4·avg | Sheet |
|---|---|---|---|---|
| Land | 25, 16, 9, 12 | 15.500 | 38.00 | 38.00 |
| Law | 25, 20, 16 | 20.333 | 18.67 | 18.67 |
| Finance | 25, 20, 16 | 20.333 | 18.67 | 18.67 |
| Materials | 25, 16, 16 | 19.000 | 24.00 | 24.00 |
| Demand | 25, 12, 12 | 16.333 | 34.67 | 34.67 |

Weighted total = 7.60 + 3.733 + 4.667 + 4.80 + 5.20 = **26.00**, matching the
Dashboard. The severity bands yield 7 critical and 8 high, also matching. That
total lands in the `hold` band and every factor lands `red`, matching the
framework dashboard's `26 / 100 · HOLD`.

Two thresholds are **chosen defaults**, stated here so they are decisions rather
than accidents. The `medium`/`low` severity cut at 6 is unconstrained — the
dataset contains no row below 9. The RAG and decision band edges (40 / 70) are
constrained by a single observed project, which cannot pin two thresholds; they
live beside the severity thresholds as named constants so all three retune in one
place.

A triggered `KillCriterion` forces `decision: 'hold'` regardless of score.

### Consequence: agents judge, code computes

Agents emit only judgments — likelihood, impact, evidence, a verbatim quote.
Every number in the UI is derived by shared pure functions. The workbook itself
works this way (`Risk Score` is the formula `=F2*G2`, not a typed value).

This kills two failure modes at once: an agent inventing a severity that
contradicts its own likelihood/impact, and the backend and frontend computing a
rollup differently. It also means `FindingDraft` (what an agent returns) and
`Finding` (what the wire carries) are two distinct schemas, related by a
widening function.

## Architecture

### The seven-role framework

Every role runs the identical loop — `plan → tool call → observe → validate
contract`, repeating until its JSON contract validates, capped at **8 steps**.
Only the role prompt, the tool whitelist, and the output schema differ. That
uniformity is why this spec defines one contract per role and nothing else: the
loop needs no schema, and the schema needs no loop.

| # | Role | Fan-out | Tools | Emits |
|---|---|---|---|---|
| 1 | Orchestrator | 1 | `kb_lookup` | `ProjectProfile` + `DiligencePlan` |
| 2 | Doc Extractor | one per document | `pdf_extract`, `xlsx_extract` | `FactSet` (claims + coverage gaps) |
| 3 | Researcher | one per component (11) | `kb_lookup`, `web_search`, `web_fetch` | `ResearchFindingSet` |
| 4 | Cross-Examiner | 1 | `kb_lookup` | `ContradictionSet` — may request **one** research re-entry |
| 5 | Scorer | 1 | `kb_lookup` | `Score` |
| 6 | Liaison | 1 | drafting only | `ActionPack` |
| 7 | Composer | 1 | — | `Report` |

The Cross-Examiner is the product's centre of gravity: no per-document or
per-component agent can see `$186M` in doc 07 and `$199-211M` in doc 06 at the
same time. Cross-document contradiction requires an agent whose context spans
documents.

### Two axes: 5 factors, 11 components

Scoring happens per **factor**; research happens per **component**. They are
different granularities of the same domain and the schema carries both — a
`ResearchFinding` belongs to a component, and its contribution to readiness
arrives through that component's factor.

| # | Component | Factor |
|---|---|---|
| 1 | State law | law |
| 2 | Federal law | law |
| 3 | Land permitting | law |
| 4 | Land use & zoning | land |
| 5 | Ecology & EPA | law |
| 6 | Community stakeholders | land |
| 7 | Financials | finance |
| 8 | Interconnectivity | demand |
| 9 | Grid integration | demand |
| 10 | Buyers & demand | demand |
| 11 | Resource & supply chain | materials |

The mapping is a stated decision, not a derivation — the architecture names the
components and the workbook names the factors, but nothing connects them. Two
assignments are genuinely arguable: *Land permitting* goes to `law` because the
workbook files "Permitting Sequence" under Law, and *Ecology & EPA* goes to `law`
because the Evidence Map routes the environmental assessment to Law/Land.
`COMPONENT_FACTOR` is exported as data so either can change in one place.

### Evidence can come from the open web

Researchers cite external benchmarks, so a citation is no longer always a
document locator. `Citation.source` is a discriminated union of a document source
and a web source. Every citation still carries a verbatim `quote` — the property
that makes a claim checkable is unchanged.

### Claim.field is the hinge

Contradiction detection is only tractable because extractors normalise what they
found onto a shared key. Two claims carrying the same `field` with different
`value.number` are a conflict candidate; the Cross-Examiner then judges whether
the difference is real and material.

`field` is typed as `string`, with an exported `COMPARABLE_FIELDS` constant
(`capex_usd_total`, `contracted_mw`, `assumed_mw`, `transformer_lead_weeks`,
`schedule_lead_weeks`, `water_demand_af`, `water_allocation_af`, …) that
extractor prompts must prefer when a value fits one. Open string rather than a
closed enum: an unanticipated extraction should degrade to "not comparable",
never to a schema rejection that discards the finding entirely.

### Package layout

npm workspaces at the repository root; `frontend/` is currently standalone and
gets absorbed.

```
package.json                    workspaces: ["shared", "frontend", "backend"]
shared/                         @solarhack/schema — the contract
  src/
    factors.ts                  Factor, FACTOR_WEIGHTS, EVIDENCE_MAP
    components.ts               Component, COMPONENTS, COMPONENT_FACTOR
    citation.ts                 Citation, CitationSource, Locator
    claim.ts                    Claim, COMPARABLE_FIELDS
    gap.ts                      CoverageGap
    research.ts                 ResearchFinding, ResearchFindingSet
    finding.ts                  FindingDraft, Finding, widenFinding
    conflict.ts                 Conflict, ContradictionSet
    kill.ts                     KillCriterion
    actions.ts                  ActionPack, RFI, AgencyAction, …
    profile.ts                  ProjectProfile, DiligencePlan
    agent.ts                    AgentState, AgentRole, AGENT_TOOLS
    report.ts                   RunMeta, RunReport (alias Report), emptyReport
    events.ts                   RunEvent
    scoring.ts                  pure math, no Zod — incl. rag(), decision()
    reduce.ts                   reduceRunEvent(state, event) -> RunReport
    roles.ts                    per-role output schemas for zodOutputFormat
    jsonschema.ts               z.toJSONSchema exports (provider-agnostic)
  fixtures/
    solar-alpha.events.ts       the workbook replayed as an event stream
frontend/src/lib/
  useRunStream.ts               EventSource + useReducer over reduceRunEvent
  mockRunStream.ts              replays the fixture with timing, no backend
```

Zod is the single source of truth, and `roles.ts` is the file the agent framework
imports: one exported schema per role — `OrchestratorOutputSchema`,
`FactSetSchema`, `ResearchFindingSetSchema`, `ContradictionSetSchema`,
`ScoreSchema`, `ActionPackSchema`, `ReportSchema` — each ready to hand to
`zodOutputFormat(...)`. `z.infer` gives the frontend its types from the same
definitions. One definition, three consumers, no codegen step to forget.

`reduce.ts` is imported by both the frontend hook and the server's
`GET /runs/:id` replay, so the REST snapshot cannot drift from the live stream.

## Entities

`Locator` — a discriminated union so the UI can deep-link into evidence:

```ts
| { kind: 'pdf_page';    page: number }
| { kind: 'sheet_cell';  sheet: string; cell: string }
| { kind: 'sheet_range'; sheet: string; range: string }
```

`Citation` — `{ source, quote }`, quote 1–600 chars, verbatim, where

```ts
source =
  | { kind: 'document'; docId: string; locator: Locator }
  | { kind: 'web'; url: string; title?: string; retrievedAt?: string }
```

A quote that cannot be found in its source is a hallucination the UI can expose.
Document citations carry a verified page or cell (see Failure handling); web
citations carry the URL the researcher actually fetched.

`ProjectProfile` — `{ name, location, capacityMw?, technology?, stage?, summary }`.
The Orchestrator's read of what is being diligenced, before any finding exists.

`DiligencePlan` — `{ components: Component[], docAssignments: { docId,
components: Component[] }[] }`. Which components are in scope and which document
feeds which. Drives the Researcher fan-out.

`Claim` — `{ id, docId, agentId, factor, subfactor?, field, value: { raw,
number?, unit? }, asOf?, citation }`.

`CoverageGap` — `{ id, docId?, component?, factor?, description, severity }`.
Emitted by extractors ("the title file is referenced but absent") and by the
Cross-Examiner ("nothing addresses interconnection queue position"). A gap is the
*absence* of evidence, which is distinct from a risk and must never be scored as
one.

`ResearchFinding` — `{ id, component, factor, title, statement, benchmark?,
citations: Citation[] (min 1), confidence: 'high' | 'medium' | 'low' }`. What a
Researcher learned about one component from external sources.

`FindingDraft` (agent output) — `{ factor, subfactor, title, evidence,
likelihood: 1..5, impact: 1..5, owner, mitigation, citations: Citation[] (min 1),
claimIds: string[] }`.

`Finding` (wire) — `FindingDraft` plus code-derived `{ id: 'RF-001', riskScore,
severity }`.

`Conflict` — `{ id: 'CF-001', field, factors: Factor[], title, statement,
sides: [{ claimId, docId, value, citation }] (min 2), materiality:
'blocking' | 'material' | 'minor', impliedDelta?: { unit, from, to },
linkedFindingIds: string[] }`.

`FactorScore` — entirely derived: `{ factor, weight, riskCount, avgRiskScore,
maxRiskScore, criticalCount, highCount, readinessScore: number | null,
rag: 'red' | 'amber' | 'green' | null, confidence: 'ok' | 'low' }`.
`readinessScore` is `null` when `riskCount` is 0 (see Failure handling);
`confidence` is `'low'` when the factor's evidence is incomplete because an
extractor was skipped or failed.

`KillCriterion` — `{ id, title, statement, status: 'triggered' | 'cleared' |
'unknown', citations: Citation[], remedy? }`. A condition that ends the project
rather than lowering its score. The demo's example: *ag-zoned parcels, local
permit prohibited (2015 ZT 12-04) → CEC Opt-In path required*. Kill criteria are
reported alongside readiness and never folded into it — a project can score well
and still be dead.

`ActionPack` — the Liaison's work product, the thing a developer acts on:
`{ rfis, agencyActions, verificationRequests, conditionsPrecedent }`. Every item
carries `{ id, title, detail, priority: 'urgent' | 'high' | 'normal',
linkedFindingIds, linkedConflictIds, linkedGapIds }` plus its own fields —
`addressee` on an RFI, `agency` and `deadline?` on an agency action. Each item
must link to at least one finding, conflict, or gap: an action with no evidence
behind it is one the model invented.

`AgentState` — `{ id, role: AgentRole, label, docId?, factor?, component?,
status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped', startedAt?,
finishedAt?, error?, steps?, maxSteps, stats? }`, where `AgentRole` is one of the
seven roles above. `steps` carries the loop's step count so the UI can show an
agent approaching its budget, and so a run that ended at the cap is
distinguishable from one that finished.

`RunReport` — the Composer's output and the document the dashboard renders,
exported additionally as `Report` to match the framework's vocabulary:

```ts
{
  meta, status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed',
  profile, plan,
  agents, documents,
  claims, researchFindings, findings, conflicts, gaps,
  scores, overallReadiness: number | null, rag, decision, unscoredFactors,
  killCriteria, actionPack,
  counts: { critical, high, medium, low },
  startedAt, finishedAt?, errors: { agentId, message, at }[]
}
```

## Wire protocol

Server-Sent Events. Every event carries a **complete entity**, never a fragment,
so no schema needs a partial variant and the reducer never merges half-objects.

```ts
type RunEvent = { seq: number; ts: string } & (
  | { type: 'run.started';    run: RunMeta }
  | { type: 'profile.ready';  profile: ProjectProfile; plan: DiligencePlan }
  | { type: 'agent.updated';  agent: AgentState }
  | { type: 'claim.found';    claim: Claim }
  | { type: 'research.found'; finding: ResearchFinding }
  | { type: 'finding.found';  finding: Finding }
  | { type: 'conflict.found'; conflict: Conflict }
  | { type: 'gap.found';      gap: CoverageGap }
  | { type: 'kill.found';     criterion: KillCriterion }
  | { type: 'actions.ready';  actionPack: ActionPack }
  | { type: 'run.finished';   status: 'succeeded' | 'partial' | 'failed' }
)
```

`seq` provides ordering and `Last-Event-ID` resume. `agent.updated` carries the
whole `AgentState`, so it serves as started, progressed, and finished — and it
doubles as the UI's live narration, since an agent's `label`, `status`, and
`steps` are what the spinner renders. The framework's "SSE stream narrates live
agent activity" therefore needs no separate log-line event type.

Scores, RAG, and decision are **not** transmitted. The reducer derives them from
`findings` plus `killCriteria` using the same functions the Scorer role calls, so
a transmitted score could only agree with the derived one or corrupt it.

Rejected alternatives: full-snapshot-per-tick (payload regrows quadratically and
loses "what changed", so no entrance animations or toasts) and JSON Patch
(untyped string paths that Zod validates only after application, making a bad
path a silent state corruption).

## Failure handling

Partial results are the normal case, not an edge case.

- **Agent fails** — `agent.updated` with `status: 'failed'` and an error string.
  The run continues. Final run status is `partial`.
- **Agent exhausts its 8-step budget** — reported as `failed` with `steps ===
  maxSteps`, which the UI distinguishes from a crash.
- **Document 05 missing** — its extractor reports `skipped`. Demand scores from
  whatever claims exist and its `FactorScore` is flagged low-confidence. A
  skipped extractor never blocks the rollup.
- **Malformed event** — the frontend validates every message with Zod, logs and
  drops the ones that fail, and keeps rendering. A single bad event must not
  blank the dashboard.
- **Factor with zero findings** — `readinessScore` is `null`, not 100 and not 0,
  and `rag` is `null` with it. Absence of evidence is neither readiness nor risk.
  The factor is listed in `unscoredFactors` and its weight is renormalised out of
  `overallReadiness`.

## Testing

Test-driven, vitest in `shared/`. The workbook supplies the golden expectations,
which makes these real assertions rather than change-detectors.

1. **Scoring** — fed the 16 real Risk Register rows, `scoring.ts` reproduces the
   Dashboard exactly: per-factor readiness `38 / 18.67 / 18.67 / 24 / 34.67`,
   overall `26.00`, counts `7 critical / 8 high / 1 medium`.
2. **Severity bands** — every one of the 16 rows maps to the severity the
   workbook assigns it.
3. **Reducer** — replaying the fixture event stream through `reduceRunEvent`
   yields the golden `RunReport`.
4. **Reducer robustness** — out-of-order `seq`, a duplicated event, and a
   malformed event each leave the report in the correct state.
5. **Round-trip** — every fixture entity parses against its Zod schema, and
   every `z.toJSONSchema` export is valid JSON Schema 2020-12.
6. **Renormalisation** — dropping Demand's findings leaves the other four
   factors' readiness unchanged and yields
   `(7.60 + 3.733 + 4.667 + 4.80) ÷ 0.85 = 24.47`, with `unscoredFactors:
   ['demand']`. Asserts a missing document does not masquerade as risk.
7. **Decision and RAG** — the golden fixture yields `decision: 'hold'` and all
   five factors `red`, matching the framework's dashboard. A synthetic all-green
   factor set yields `'proceed'`, and a triggered `KillCriterion` forces
   `'hold'` from a `proceed`-range score.
8. **Component mapping** — `COMPONENT_FACTOR` covers all 11 components, maps
   only to the 5 known factors, and every factor is reachable from at least one
   component.
9. **Role schemas** — every schema `roles.ts` exports parses its fixture payload
   and survives `zodOutputFormat`, so the agent framework cannot be handed a
   schema the SDK rejects.

Floating-point comparisons use a tolerance; the workbook itself stores
`26.000000000000004`.

## Scope

**In:** the `shared/` schema package — all seven role contracts, both taxonomies,
derived-math helpers (scoring, RAG, decision), the reducer, `roles.ts` for
`zodOutputFormat`, JSON Schema exports, fixtures, and typed frontend consumption
(`useRunStream`, `mockRunStream`).

**Out:** the agent loop and its implementations (owned by the agent framework),
the backend server, document parsing, and the dashboard UI.

**Interface with the agent framework.** The framework owns the loop — `plan →
tool call → observe → validate contract`, 8 steps, the tool whitelist, and the
agent backend. This package owns every JSON contract that loop validates
against. The seam is exactly `roles.ts`: if a role's output parses against its
schema, the framework's obligation is met and the reducer can render it.
