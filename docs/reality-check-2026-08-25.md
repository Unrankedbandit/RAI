# Reality Check: RAI Data Validation System — 2026-08-25

Swarm audit: 6 read-only explorer agents, every finding carries file:line evidence.
Scope: `/home/bob/hackathons/rai/RAI` (main checkout only) + `rai-slides/` pitch.

## Verdict

**The agent pipeline is real; the validation layer is not.** ~15 genuine end-to-end
LLM runs happened against real parcels. But "validation teams review submittal
checklists" and the "ground truth database" are aspirational: the phrase "validation
team" appears nowhere in repo or pitch, zero human reviews have ever been persisted,
and `ground_truth` has been populated **0 times across all 42 stored reports**.

## Scorecard

| Layer | Claim | Reality |
|---|---|---|
| Goal | "AI due-diligence copilot… evidence-backed decision" (README.md:3-8) | Real pipeline, 9 roles, contract validation in agent loop — works |
| Project flow | Orchestrator → Extractors → GapAnalyzer → Scouts → Researchers → CrossExaminer → Scorer → Liaison (README.md:52-86) | Diagram is **deep mode**. Default `PIPELINE_MODE=fast` (pipeline.py:32) skips gap analysis + scout fan-out entirely (pipeline.py:130-136) |
| Data access | Live web acquisition via Bright Data | Coded but **token-less → silently disabled** (tools.py:60-61,144-148). 19/22 reports have `acquired_data: []`. KB = 2 markdown files scoped to 2 demo geographies |
| Validation teams | (pitch-adjacent: human review gates) | Backend complete (review.py, Port mirror, gap gate) but **ReviewBar UI is dead code** (zero imports), `reports/review/` dir doesn't exist, zero review API calls in 1098-line backend.log, Port disabled every boot |
| Submittal checklists | "REAL submittal documents… every link verified" (types.ts:1-7) | Ventura pack genuinely real (17/20 links HTTP 200 re-checked today), but 1 county only, `verifiedAt` is one blanket hand-written string, zero link-check tooling, check-off is localStorage-only |
| Ground truth DB | per-entry audit trail (schemas.py:113-136) | **Vaporware in practice**: 0/42 reports contain a timeline, let alone ground_truth. Only rendered groundTruth is a hardcoded ITC constant injected by the adapters (sentinel_adapter.py:26-31,244-248) |

## Critical findings

1. **GROUND TRUTH IS PROMPT-ONLY.** `ground_truth: str | None = None` (schemas.py:136),
   no validators, no enforcement, fail-open defaults (`ActionPack.timeline` default [],
   schemas.py:147; liaison degrade → bare `ActionPack()`, pipeline.py:394). Any fabricated
   string would flow adapters → UI and render under a bold "Ground truth:" label
   (TimelineStrip.tsx:329-334) — even alongside the "unverified" tag.
2. **THE FEEDBACK LOOP DOESN'T EXIST.** `kb_lookup` is read-only grep (tools.py:41-51);
   no write path anywhere. Nothing a reviewer could approve/correct ever flows back into
   any store. The only write-back ever was a developer's ad-hoc citation-backfill script
   (backfill/backfill_sources.py, 3 reports, 2026-08-23) — not validation.
3. **HUMAN REVIEW NEVER HAPPENED.** In-app review API + 409/override + tests exist
   (main.py:372-402, review.py:43-80) but the UI is unmounted; Port queue never had
   credentials. Reviewer identity is free-text with no auth (main.py:134-138).
4. **VALIDATION ROLES ARE DATA-BLIND.** cross_examiner/scorer/analyst get `kb_lookup`
   only; **liaison has zero tools** (roles.py:147) yet owns the dated timeline; scorer
   must apply KB benchmarks that only exist for the two demo geographies.
5. **POST-SCHEMA IS HONOR SYSTEM.** Read path `GET /api/reports/{id}` skips
   re-validation (main.py:369); frontend blind-casts `as T` (client.ts:90). Degrade
   fallbacks manufacture schema-valid empty reports that render as real (all-zero
   pillars presented as measured). `Report.decision` is free text → substring status:
   "Do not proceed" maps to **on-track** (sentinel_adapter.py:76-82). Adapters invent
   precision: "Q3 2027" → `2027-07-01` exact date dots, hardcoded scoreDelta 6/3.
6. **LIVE BACKEND IS DOWN-DEGRADED RIGHT NOW.** Running uvicorn (pid 1531072, behind
   rai-api route) was started without LLM env vars → `/api/health` returns `ok:false`;
   new analyses abort instantly. Repo `.env` has the key; the process never sourced it.

## What genuinely works (verified clean)

- LLM→pydantic boundary: retry-with-error, bounded steps, hard raise, traced
  (base.py:294-303, 389-408). Raw LLM output cannot leak downstream.
- Python↔TS adapter parity locked in CI (test-adapter-parity.mjs, ci.yml:55-68).
- Real data assets: 86 MB grid geodata + 237 MB parcel scores, real upload parsing,
  curated KB entries are genuinely sourced (LBNL/NREL/CAISO numbers with citations).
- Honest-degradation UX: "not verified yet" fallbacks, unverified tags, FETCH FAILED
  surfaced, no invented links.
- Mid-run gap-approval gate: real, UI-wired, bounded, tested (gate.py, GapReviewCard).
- Ventura jurisdiction pack: real official links, real form names, honest copy.

## Path to a stronger ground truth database (build order)

**P0 — make the claim true:**
1. **Mount `ReviewBar`** in ProjectWorkspace — one import makes human review real.
2. **Restart the backend with env sourced** (`set -a; . agent_backend/.env; set +a`) —
   the live API currently can't run analyses.
3. **Structured benchmark store at the `kb_lookup` seam** (tools.py:41-51): sqlite/JSON
   records `{id, benchmark, value, unit, geography, source_url, verified_at, verified_by}`.
   Replace paragraph grep with keyed lookup; no agent-code changes needed. Seed it from:
   (a) the LIAISON prompt's curated benchmark block (roles.py:80-120, 12 source URLs,
   currently trapped in a prompt string), (b) the 2 research/*.md files (structured),
   (c) `ITC_GROUND_TRUTH` as the template record.
4. **Review write-back**: on APPROVED, append confirmed/corrected benchmarks to the
   store with `verified_by` — this creates the missing feedback loop. Review API and
   persistence already exist; only the store write is new.

**P1 — make it enforceable:**
5. Schema: require `ground_truth` on timeline entries to reference a store benchmark ID;
   add `@field_validator` (non-empty, ID must exist); bound scores 0-100; narrow
   `Report.decision` to the same Literal as `Score.decision`.
6. Code computes the rollup: move the weights (land .20/law .20/finance .25/materials
   .20/demand .15) from prompt text into code and recompute readiness — implements the
   spec's "agents judge, code computes" guarantee (specs/2026-08-14:126-136).
7. Re-validate reports on the read path (main.py:369) — `/api/projects` already does it.
8. Jurisdiction packs: per-link `verifiedAt` records + a link-check script in CI
   (today 4/24 links 403 to scripted fetch — WAF bot-blocking, needs a browser-agent
   check or documented exemption).

**P2 — make it a team sport:**
9. Checklist-item status model (submitted/approved/rejected + reviewer + timestamp) with
   backend persistence — replaces localStorage booleans (SubmittalsTab.tsx:164-176).
10. Auth on the review endpoint; reviewer identity from the hackathon SSO gate, not
    free text.
