# RAI Assistant QA Dataset — Handoff

## Contents
- `schema.json` — canonical schema for one QA pair. Validate any new pair against it before merging.
- `rai-faq.jsonl` — 57 QA pairs, one JSON object per line. v2 (battletested).

## Purpose
Fine-tuning + evaluation data for the shipped assistant chat model (~0.6B). Answers are
deliberately short (30–65 words), plain prose (no markdown), and grounded — every answer
must stay within its `grounding` source. The assistant must never assert facts outside
grounding; the redirect category teaches refusal behavior.

## Categories / coverage
product 10 · project 12 · domain 12 · trust 7 · howto 7 · redirect 9

Redirect coverage is deliberate and must not shrink: off-topic, investment advice, prompt
injection, legal advice, competitor comparison, data exfiltration, fabrication of findings,
outcome prediction, out-of-evidence, and unknown-project confabulation.

## Battletest (4-agent swarm, 2026-08-14) — what was attacked and fixed
1. **Fact-check** vs `agent_backend/reports/*` + `research/*`: 2 errors fixed
   (critical-flag count 7→8 per report; EDAM year), 4 unsupported claims removed
   (charter/fiscal-engine narrative, DA contents, BOC work examples, lease duration).
2. **Schema/consistency audit**: PASS (ids sequential, no dupes, no markdown, lengths 30–65 words).
3. **Small-model suitability**: densest answers trimmed (faq-009/012/014/015), naming
   standardized ("blind coordinate mode", "condition precedent"), comma splice fixed,
   5 pairs added (pricing, next-steps, identity, low-score support, compare).
4. **Red-team**: 7 redirect pairs added (faq-051–057), overclaiming softened
   (faq-012/015/017/030: agency decisions are never stated as certain), time-sensitive
   answers pinned to vintages ("as of Q1 2026", "as of IRS Notice 2025-42"),
   question/answer mismatches tightened (faq-024 solar→solar+storage, faq-028 CAISO vs NV Energy).

## Held-out eval set (do NOT train on these 8)
faq-002, faq-007, faq-011, faq-017, faq-020, faq-030, faq-038, faq-045
— covers all categories; faq-045 specifically probes injection-refusal generalization.

## Rules for adding pairs
1. New ids continue from faq-058; never reuse deleted ids.
2. Answers: 2–4 sentences, ≤3 numbers where possible, no markdown, no lists.
3. Every fact must trace to a `grounding` source; time-sensitive facts need an "as of" vintage.
4. Never state agency decisions, tax outcomes, or interconnection feasibility as certain.
5. Redirects follow the skeleton: brief refusal → scope → offer of in-scope help.
6. Re-run the mechanical audit (JSON parse, schema conformance, id uniqueness, answer
   length 10–120 words) before pushing.
