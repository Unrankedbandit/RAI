# Port Factory — RAI's agentic software factory control plane

RAI's diligence pipeline *is* a software factory: a product brief (project name
+ location + dossier) goes in, agents and tools are coordinated across fixed
stages, a verified artifact (the readiness report) comes out, and a human signs
it off. This doc wires that factory into [Port](https://port.io) so Port's five
building blocks line up one-to-one:

| Port building block | RAI factory mapping |
|---|---|
| Context Lake | `factory_run` / `factory_agent_run` / `factory_finding` entities (below) |
| Workflow orchestration | `pipeline.py` phase boundaries, mirrored to Port in real time |
| AI agents | the specialist roles (Orchestrator, Extractors, Researchers, CrossExaminer, Scorer, Liaison) |
| Governance | every run ends `AWAITING_REVIEW` — a human approves in Port before it's final |
| Interface layer | Port catalog/dashboards for operators; the RAI dashboard for the deal team |

**Everything here is optional.** With `PORT_CLIENT_ID`/`PORT_CLIENT_SECRET`
unset, `agent_backend/port_client.py` performs zero HTTP calls and the pipeline
runs end-to-end — same graceful-degradation pattern as `BRIGHTDATA_API_TOKEN`. All Port calls are fire-and-forget on a background thread
pool: Port being down can never block or fail a job.

## Setup

1. Port app → **...** (top right) → **Credentials** → copy Client ID / Secret.
2. `agent_backend/.env`:
   ```
   PORT_CLIENT_ID=...
   PORT_CLIENT_SECRET=...
   PORT_API_BASE=https://api.port.io        # EU; US orgs: https://api.us.port.io
   APP_PUBLIC_URL=https://<your-backend>    # used for the reportUrl on each run
   ```
3. Create the three blueprints (below) — paste each into Port's
   [builder](https://app.port.io/settings/blueprints) or `POST /v1/blueprints`.
4. Run any analysis. `GET /api/health` shows `"port": {"configured": true}`.

## Blueprint model (3 blueprints — deliberately minimal)

Two would suffice for telemetry (`factory_run` + `factory_agent_run`); the
third, `factory_finding`, exists so Port scorecards/dashboards can aggregate
red-flag severity *across* runs without parsing report JSON. Anything more
(report text itself, per-LLM-call spans) stays in the RAI trace — Port gets the
control-plane view, not the payload firehose.

### `factory_run` — one entity per pipeline job

```json
{
  "identifier": "factory_run",
  "title": "Factory Run",
  "icon": "Actions",
  "schema": {
    "properties": {
      "project": { "type": "string", "title": "Project" },
      "location": { "type": "string", "title": "Location" },
      "stage": {
        "type": "string", "title": "Stage",
        "enum": ["queued", "orchestrate", "extract", "gap", "cross_examine", "score", "liaison", "compose", "done"],
        "enumColors": { "queued": "lightGray", "done": "green" }
      },
      "status": {
        "type": "string", "title": "Status",
        "enum": ["RUNNING", "AWAITING_REVIEW", "APPROVED", "REJECTED", "FAILED"],
        "enumColors": { "RUNNING": "blue", "AWAITING_REVIEW": "yellow", "APPROVED": "green", "REJECTED": "red", "FAILED": "red" }
      },
      "readiness": { "type": "number", "title": "Readiness (0–100)" },
      "decision": { "type": "string", "title": "Decision" },
      "reportUrl": { "type": "string", "format": "url", "title": "Report" },
      "pipelineMode": { "type": "string", "title": "Pipeline Mode" },
      "documents": { "type": "array", "title": "Documents" },
      "errorClass": { "type": "string", "title": "Error Class" },
      "errorMessage": { "type": "string", "title": "Error" },
      "startedAt": { "type": "string", "format": "date-time", "title": "Started" },
      "finishedAt": { "type": "string", "format": "date-time", "title": "Finished" }
    },
    "required": []
  },
  "relations": {}
}
```

The entity identifier **is the RAI `jobId`** — rerun the same job and the
entity merge-updates (all writes use `?upsert=true&merge=true`), which is also
what makes "can it run again?" observable: run history is one entity's audit
log in Port.

### `factory_agent_run` — one entity per agent execution

```json
{
  "identifier": "factory_agent_run",
  "title": "Factory Agent Run",
  "icon": "Bots",
  "schema": {
    "properties": {
      "role": { "type": "string", "title": "Role" },
      "status": {
        "type": "string", "title": "Status",
        "enum": ["SUCCEEDED", "FAILED"],
        "enumColors": { "SUCCEEDED": "green", "FAILED": "red" }
      },
      "durationMs": { "type": "number", "title": "Duration (ms)" },
      "toolCalls": { "type": "number", "title": "Tool Calls" }
    },
    "required": []
  },
  "relations": {
    "factory_run": {
      "title": "Factory Run",
      "target": "factory_run",
      "required": false,
      "many": false
    }
  }
}
```

Entity identifier: `{jobId}:{agentName}` (e.g. `a1b2c3:Researcher:core`).

### `factory_finding` — red flags, contradictions, gaps

```json
{
  "identifier": "factory_finding",
  "title": "Factory Finding",
  "icon": "Alert",
  "schema": {
    "properties": {
      "kind": {
        "type": "string", "title": "Kind",
        "enum": ["red_flag", "contradiction", "missing_info"],
        "enumColors": { "red_flag": "red", "contradiction": "orange", "missing_info": "yellow" }
      },
      "severity": { "type": "string", "title": "Severity" },
      "summary": { "type": "string", "title": "Summary" }
    },
    "required": []
  },
  "relations": {
    "factory_run": {
      "title": "Factory Run",
      "target": "factory_run",
      "required": false,
      "many": false
    }
  }
}
```

## How the wiring works (and what a run looks like in Port)

The integration adds **no code to the pipeline itself**. `main.py` attaches a
`PortReporter` as a second sink on the job's existing `Trace` — every phase
transition and agent span the pipeline already emits is replayed into Port:

| Trace event | Port effect |
|---|---|
| job accepted (`POST /api/projects/analyze`) | `factory_run` upserted: `stage=queued, status=RUNNING` |
| each `phase` event (orchestrate → extract → … → compose) | `factory_run.stage` updated live |
| each `agent.done` / `agent.error` span | `factory_agent_run` upserted (role, durationMs, toolCalls, status), related to the run |
| report persisted | `factory_run` → `status=AWAITING_REVIEW` + readiness, decision, `reportUrl`; findings emitted |
| exception | `factory_run` → `status=FAILED` + `errorClass` (e.g. `AgentDidNotConverge`) |

**Operator story (where a judge clicks):** Port → Catalog → **Factory Run**.
A live job's `stage` column advances as agents work; clicking the entity shows
related **Factory Agent Runs** (who ran, how long, how many tool calls) and
**Factory Findings**. When the run finishes, the entity flips to
`AWAITING_REVIEW` with the readiness score and a `reportUrl` back to the full
RAI report. A dashboard on `status = AWAITING_REVIEW` is the review queue.

## The human-in-the-loop gate

The factory never self-approves: a *successful* run ends in `AWAITING_REVIEW`,
not `APPROVED`. To approve, a reviewer:

1. Opens the `factory_run` entity in Port (from the review-queue dashboard).
2. Follows `reportUrl` to read the full RAI report (red flags, contradictions,
   action pack).
3. Edits the entity and sets `status` to `APPROVED` or `REJECTED`
   (Builder → Catalog → entity → Edit), optionally recording rationale in the
   entity's comment/activity feed.

Outbound webhooks back into RAI are deliberately out of scope — Port is the
system of record for the decision, and the entity's audit trail is the proof.
(If automation is wanted later, a Port **self-service action** on
`factory_run` — "Approve run" / "Reject run" with a required reason input —
gives the same gate with RBAC and a native audit log, no RAI changes needed.)

## Connecting coding agents via the Port MCP server

External coding assistants query the same factory context (runs, findings,
scores) through Port's MCP server — e.g. "which factory runs failed this week
and what class of error?"

```bash
# EU org:
claude mcp add --transport http port https://mcp.port.io/v1
# US org:
claude mcp add --transport http port https://mcp.us.port.io/v1
```

Read-only variant (recommended for assistants that should observe, not mutate):

```bash
claude mcp add-json port '{"type":"stdio","command":"npx","args":["-y","mcp-remote","https://mcp.port.io/v1","--header","x-read-only-mode: 1"]}'
```

For CI/agents without a browser, machine authentication exchanges the same
client credentials at `POST https://mcp.port.io/v1/token`
(`grant_type=client_credentials`). Reference:
<https://docs.port.io/agent-management/port-mcp-server/installation/>.

## API facts this integration relies on

Verified against <https://docs.port.io> on 2026-08-22:

- **Auth** — `POST {base}/v1/auth/access_token` with
  `{"clientId", "clientSecret"}` → `{"accessToken"}`; token valid 3h (we cache
  2.5h). <https://docs.port.io/api-reference/create-an-access-token>
- **Upsert entity** — `POST {base}/v1/blueprints/{blueprint}/entities?upsert=true&merge=true`
  with `{"identifier", "title", "properties", "relations"}`; merge updates only
  provided properties. <https://docs.port.io/api-reference/create-an-entity>
  and <https://docs.port.io/context-lake/ingestion/ingest-data-into-port/api/ingest-via-api-overview/>
- **Regions** — EU `https://api.port.io`, US `https://api.us.port.io`
  (`PORT_API_BASE`).
- **Action runs exist but are unused** — `POST /v1/actions/{action}/runs`
  creates a run and `PATCH /v1/actions/runs/{id}` updates it
  (<https://docs.port.io/api-reference/execute-a-self-service-action>). We map
  pipeline state to *entities* instead: the run is the durable object humans
  review and scorecards evaluate; action runs are ephemeral invocations of
  Port-automations RAI doesn't use. This is a defensible mapping, not a gap.

## Verifying without a Port account

```bash
PATH=".venv/bin:$PATH" python scripts/test-port-factory.py
```

Mocks `httpx` and asserts: (a) a full job emits token → run upsert → stage
updates → agent runs → `AWAITING_REVIEW` + findings, (b) Port down/401 never
fails the job flow, (c) no credentials → zero HTTP calls.
