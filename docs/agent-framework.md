# Red Flag Agent Framework — Backend Architecture
**Purpose:** the agentic backend that runs when a user uploads a project location + documentation. It performs the research and liaison work to produce initial due-diligence findings — the same pattern as the 4 parallel research agents used to build the knowledge base, formalized into a production loop.

---

## 1. Design Principles

1. **ReAct loop with structured output.** Every agent runs the same loop: *plan → call tool → observe → repeat* until it can emit a validated JSON object (its contract). No free-text final answers — everything downstream is typed.
2. **Small, specialized agents in parallel over one big agent.** One agent per component domain (legal, ecology, grid, finance…). Parallelism = the 4-hour-demo spins fast and each agent gets a narrow, high-quality prompt.
3. **Cross-examination is the product.** Red flags come from *contradictions between documents* ($186M CAPEX vs $199–211M materials; 200 vs 150 MW contracted; grading before environmental review), not from any single doc. A dedicated agent reconciles all extracted facts.
4. **Research is grounded by a knowledge base, refreshed by live search.** The compiled component research (`research/solar-alpha-component-research.md`) is baked in as static rubric context; agents use web search for location-specific/time-sensitive items (zoning of the actual parcels, current queue status, pending listings).
5. **Liaison artifacts are first-class outputs.** The system doesn't just find flags — it drafts the work product to resolve them: RFIs to the developer, agency consultation checklists, offtake verification requests, conditions-precedent lists.
6. **Untrusted code/docs run in a sandbox.** Document parsing, extraction scripts, and any generated analysis execute in a Daytona sandbox, never on the host (also the demo talking point).
7. **Demo-resilient.** Every agent has a deterministic fallback path (cached knowledge base + heuristics) so the demo works with no search API and degraded LLM access.

## 2. System Diagram

```
USER: location + docs (PDFs/XLSX)
        │
        ▼
┌────────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR AGENT                                             │
│ • parse request → project profile (tech, MW, site, county)     │
│ • build Diligence Plan: which components apply, task graph     │
└──────────┬─────────────────────────────────┬───────────────────┘
           │ fan-out (asyncio)               │
           ▼                                 ▼
┌──────────────────────┐         ┌───────────────────────────────┐
│ DOC EXTRACTION       │         │ RESEARCH AGENTS (parallel)    │
│ AGENTS (per doc)     │         │ one per component domain:     │
│ • extract structured │         │ • StateLaw  • FederalLaw      │
│   facts per component│         │ • Permitting/Zoning           │
│   schema + citations │         │ • Ecology/EPA • Community     │
│ • runs in Daytona    │         │ • Financials • Interconnection│
│   sandbox            │         │ • GridIntegration • Demand    │
└──────────┬───────────┘         │ • Resource/SupplyChain        │
           │                     │ tools: web search/fetch + KB  │
           │                     └───────────────┬───────────────┘
           │  facts                             │ findings+benchmarks
           ▼                                    ▼
┌────────────────────────────────────────────────────────────────┐
│ CROSS-EXAMINATION AGENT                                        │
│ • reconciliation matrix: every quantitative claim vs all docs  │
│ • contradictions, stale quotes, impossible dates, coverage gaps│
│ • may REQUEST MORE RESEARCH (feedback loop to step above, max 1│
│   re-entry)                                                    │
└──────────────────────────────┬─────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────┐
│ SCORING AGENT                                                  │
│ • rubric: dimension weights, severity, thresholds from KB      │
│ • readiness score, RAG per dimension, decision                 │
└──────────────────────────────┬─────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────┐
│ LIAISON AGENT                                                  │
│ • RFI list to developer (missing info)                         │
│ • agency consultation action list (CDFW, county, ALUC, USACE…) │
│ • offtake/interconnection verification requests                │
│ • conditions-precedent checklist for investment committee      │
└──────────────────────────────┬─────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────┐
│ REPORT COMPOSER → Project Red Flag report JSON → dashboard     │
└────────────────────────────────────────────────────────────────┘
```

## 3. The Agent Loop (all agents share it)

```python
while steps < MAX_STEPS:
    response = llm(messages, tools=TOOLS, response_schema=agent.contract)
    if response.has_tool_calls:
        for call in response.tool_calls:
            result = execute_tool(call)      # web_search, fetch, extract, kb_lookup, sandbox_run
            messages.append(tool_result(call.id, result))
    else:
        return agent.contract.validate(response.json())
raise AgentDidNotConverge()  # → fallback path
```

- `MAX_STEPS` ~ 6–10. Narrow prompts converge fast.
- Every agent gets: (a) its **role prompt**, (b) the **project profile**, (c) the **knowledge-base slice** for its domain, (d) its **tool whitelist**, (e) its **output contract** (JSON schema).
- Status events stream to the UI over SSE: `{"agent":"EcologyEPA","status":"checking Swainson's hawk survey protocol vs dossier dates…"}` — this powers the demo's "AI is triaging…" spinner with real narration.

## 4. Agent Roster & Contracts

| Agent | Inputs | Tools | Output contract (JSON) |
|---|---|---|---|
| **Orchestrator** | user request, doc manifest | doc_manifest, kb | `ProjectProfile{tech, mw, site, county, state, components[], docAssignments}` |
| **DocExtractor** (×N docs) | one doc + profile | pdf_extract, xlsx_extract | `FactSet{facts[{component, claim, value, unit, citation{doc,page}}], gaps[]}` |
| **GapAnalyzer** *(v2)* | all FactSets + KB requirements | kb_lookup | `GapAnalysis{needs[{component, missing, why_it_matters, source_hint}]}` |
| **DataScout** (×N needs, cap 12) *(v2)* | one DataNeed + profile | web_search, web_fetch, kb_lookup | `AcquiredData{component, data_points[], sources[], still_missing[]}` |
| **Researcher** (×11 components, grouped) | profile + acquired data + relevant facts | web_search, web_fetch, kb_lookup | `Findings{component, applicableRules[], benchmarks[], siteSpecifics[], redFlags[{title, severity, evidence, benchmark}], sources[]}` |
| **CrossExaminer** | all FactSets + Findings + acquired | kb_lookup | `ContradictionSet{contradictions[{claims[], sources[], severity, explanation}], coverageGaps[]}` |
| **Scorer** | contradictions + findings + rubric | kb_lookup (rubric) | `Score{readiness, dimensions[{name, rag, score, flags[]}], decision}` |
| **Liaison** | contradictions + gaps + profile | none (drafting) | `ActionPack{rfis[], agencyActions[{agency, action, deadline, why}], verificationRequests[], conditionsPrecedent[]}` |
| **Composer** | everything | none | `Report` (the dashboard payload) |

**v2 — data acquisition stage (thin-dossier mode):** after extraction, the **GapAnalyzer** diffs the uploaded facts against the knowledge base's per-component required-data checklist. Every gap becomes a `DataNeed` with a `source_hint` (e.g., "NREL NSRDB", "county zoning code", "BLM ROD"). **DataScouts** fan out in parallel (capped at 12) to pull the real data from public authoritative sources before scoring begins. What a scout cannot obtain publicly (`still_missing`: executed contracts, title docs, proprietary studies) flows directly to the Liaison as RFIs to the developer. This lets the framework produce full 11-component diligence from a **single uploaded memo** — validated on the Nevada site-comparison run (see `research/nevada-sites-diligence.md`).

**Feedback loop rule:** CrossExaminer may emit `needsMoreResearch[{component, question}]` → Orchestrator re-spawns the targeted Researcher(s) once, then proceeds. Prevents infinite loops.

## 5. Tool Layer

| Tool | Implementation | Notes |
|---|---|---|
| `pdf_extract` / `xlsx_extract` | pypdf / openpyxl | runs inside **Daytona sandbox**; returns text + page markers |
| `web_search` | Tavily / SerpAPI / DuckDuckGo fallback | rate-limited, 5 results/query |
| `web_fetch` | httpx + readability | strips boilerplate, truncates to 8k tokens |
| `kb_lookup` | embedding search over `research/*.md` (or keyword grep for hackathon) | grounds agents in compiled benchmarks |
| `sandbox_run` | Daytona SDK (`daytona.sandboxes.create`, `process.code_run`) | executes generated extraction/analysis code; the "safe execution of AI-generated code" story |
| `report_write` | persists Report JSON to SQLite | dashboard reads via GET |

## 6. API Surface

```
POST /api/projects                 {name, location, docs[]}      → {projectId}
POST /api/projects/:id/analyze     kick off agent pipeline        → {jobId}
GET  /api/jobs/:id/stream          SSE: agent status events       (demo spinner narration)
GET  /api/projects                 portfolio dashboard (all reports)
GET  /api/projects/:id             full Red Flag report JSON
```

## 7. Data Contract Highlights (what the frontend renders)

```json
{
  "project": "Solar Alpha — Solar + Storage, 250 MW",
  "location": "Solano County, CA",
  "readiness": 26,
  "decision": "Hold",
  "dimensions": [
    {"name": "Legal/Permitting", "rag": "red", "score": 19,
     "flags": ["Commercial solar prohibited in all Solano ag zoning districts (2015 ZT 12-04) — local permit path unavailable",
                  "Grading NTP Oct 14 precedes environmental review completion Dec 2026"]},
    {"name": "Financials", "rag": "red", "score": 19,
     "flags": ["$186M CAPEX = $0.74/W vs $1.43–1.56/Wac benchmark (LBNL/NREL)",
                  "COD Jul 2028 requires documented BOC by Jul 4 2026 for any ITC/PTC (OBBBA)"]}
  ],
  "contradictions": ["Model assumes 200 MW firm; only 150 MW under executed term sheet"],
  "actionPack": {
    "rfis": ["Provide executed Parcel 14 option agreement or alternate collector alignment"],
    "agencyActions": [{"agency": "CEC", "action": "Evaluate AB 205 Opt-In eligibility (≥50 MW PV + ≥200 MWh BESS)"}]
  }
}
```

## 8. Forge / Daytona Mapping (judging criteria)

- **Forge** generates: FastAPI service scaffold, agent base class, prompts from this doc's role table, Next.js dashboard reading the Report JSON.
- **Daytona**: the entire service runs in a sandbox; `sandbox_run` tool = nested sandbox for untrusted doc/code execution; agents' web egress controlled; snapshot = reproducible demo. Demo line: *"Every agent you see researching — the ecology agent, the finance agent — is executing inside isolated Daytona sandboxes."*

## 9. Demo-Resilience Fallbacks
1. No search API → `web_search` returns KB-cached excerpts; agents cite knowledge base.
2. LLM degradation → deterministic heuristic scorer (regex the extracted facts for known benchmark violations from the KB).
3. Pre-computed Report JSON for Solar Alpha cached in repo — the "restore from Daytona snapshot" moment if live run fails.
