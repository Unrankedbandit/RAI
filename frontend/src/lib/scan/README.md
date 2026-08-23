# Live scan stream — frontend ↔ backend contract

The scanning screen renders a **live** agent run. It no longer fakes progress on
a timer; it folds real events from the backend pipeline (Land · Law · Finance ·
Materials · Demand, each spawning sub-agents on Bedrock).

## Wiring it up

Set one env var and the frontend switches from the built-in mock to your stream:

```
NEXT_PUBLIC_SCAN_STREAM_URL=https://<backend>/scans/<scanId>/stream
```

- **Unset** → the mock source (`createMockScanSource`) drives a realistic demo
  run, including a deliberate long gap so the indeterminate/pulse state shows.
- **Set** → the SSE client (`createSseScanSource`) connects to your endpoint.

Transport is **Server-Sent Events** by default (`text/event-stream`, one JSON
`ScanEvent` per `data:` message). A WebSocket adapter can implement the same
`ScanSource` shape if you prefer — the UI and hook don't care which.

## Event shape (`src/lib/scan/scanEvents.ts`)

```ts
type ScanEvent =
  | { type: "reading_document"; filename: string }
  | { type: "finding"; text: string; flag: boolean }
  | { type: "subagent_spawned"; name: string; parentPillar: string }
  | { type: "pillar_complete"; pillar: string; score: number; band: "strong"|"watch"|"risk" }
  | { type: "phase"; phase: string; detail: string }
  | { type: "complete"; projectId: string; activationScore: number }
  | { type: "error"; message: string };
```

Emit one `data:` line per event, e.g.:

```
data: {"type":"reading_document","filename":"feasibility_study.pdf"}

data: {"type":"finding","text":"CAPEX $42.0M assumed vs $51.2M quoted.","flag":true}

data: {"type":"pillar_complete","pillar":"Finance","score":61,"band":"watch"}

data: {"type":"complete","projectId":"proj_abc123","activationScore":62}
```

## What the frontend does with them

- `reading_document` / `finding` → a new trail line (`flag:true` renders orange).
- `subagent_spawned` → a trail line + a sub-agent pill.
- `pillar_complete` → a trail line with the pillar's score.
- `phase` → drives the staging tracker at the top of the run view: one box per
  pipeline phase (orchestrate → compose) going waiting → working → done. A
  phase event naming an already-done phase means the pipeline looped back
  (cross-examine → follow-up research) — the box re-opens with "re-run due to
  findings". Phases with no explicit backend event (scouts, research) are
  inferred from working DataScout:*/Researcher:* agent activity.
- `complete` → the terminal signal. The UI navigates to `/projects/{projectId}`
  with the real `activationScore`. **Send a real projectId** — nothing is hardcoded.
- `error` → stops the run and shows `message` plainly with retry/back.

## Failure handling (no backend cooperation required)

- **No event for ~3s** → the bar switches to an indeterminate pulse (still moving,
  no implied percentage), and resumes on the next event.
- **No event for 60s** with no terminal event → a "taking longer than expected"
  state with keep-waiting / cancel.
- **Connection closes** before `complete`/`error` → treated as a timeout, never
  as silent success. Send an explicit `error` event if the run genuinely failed.
