// Folds the raw ScanEvent stream into the data the scanning UI renders.
//
// Progress is MILESTONE-BASED, not time-based: each of the five pillars
// completing advances the bar by a fixed 1/5 share. Document/finding/sub-agent
// events fill in small increments *within* the current pillar's share but can
// never reach the next milestone — five honest jumps, no fabricated smooth 0–100.

import {
  PILLAR_COUNT,
  type AgentStatus,
  type GapItem,
  type ScanEvent,
} from "./scanEvents";

/** One agent instance's live box: name, lifecycle status, latest activity. */
export type AgentBox = {
  name: string;
  status: AgentStatus;
  activity: string;
};

/**
 * One line of an agent's live feed — a trace/status frame the stream
 * attributed to that agent, kept so the tile's pop-up can replay the run.
 */
export type AgentFeedLine = {
  id: number;
  text: string;
  status: AgentStatus;
};

/** Per-agent feeds are capped so a long run can't grow state unbounded. */
const FEED_CAP = 200;

let feedSeq = 0;
function feedLine(text: string, status: AgentStatus): AgentFeedLine {
  feedSeq += 1;
  return { id: feedSeq, text, status };
}

/**
 * A core agent and every one of its instances, grouped for the status grid.
 * The backend names sub-instances "<Core>:<suffix>" ("Extractor:doc1",
 * "DataScout:4"); the core is the name up to the first ":".
 */
export type AgentCoreGroup = {
  /** Core name ("DataScout:4" → "DataScout"). */
  core: string;
  /** Worst-of the instances: any error → error, else any working → working,
   *  else any waiting → waiting, else done. */
  status: AgentStatus;
  /** The core box's line: the status-driving instance's latest narration. */
  activity: string;
  /** Every instance of this core, in first-seen order. */
  instances: AgentBox[];
};

const STATUS_RANK: Record<AgentStatus, number> = {
  error: 0,
  working: 1,
  waiting: 2,
  done: 3,
};

/**
 * Group the flat instance list (every agent instance is kept — no dedupe by
 * core name) into core boxes for the grid. Group order follows first-seen
 * instance order; a core's status is the worst of its instances.
 */
export function groupAgentsByCore(agents: AgentBox[]): AgentCoreGroup[] {
  const groups: AgentCoreGroup[] = [];
  const byCore = new Map<string, AgentCoreGroup>();
  for (const box of agents) {
    const core = box.name.split(":")[0];
    let group = byCore.get(core);
    if (!group) {
      group = { core, status: box.status, activity: "", instances: [] };
      byCore.set(core, group);
      groups.push(group);
    }
    group.instances.push(box);
    if (STATUS_RANK[box.status] < STATUS_RANK[group.status]) {
      group.status = box.status;
    }
  }
  for (const group of groups) {
    const driver =
      group.instances.find((i) => i.status === group.status) ??
      group.instances[group.instances.length - 1];
    group.activity = driver?.activity ?? "";
  }
  return groups;
}

export type TrailKind = "read" | "flag" | "score" | "subagent" | "gate";

/**
 * The pipeline stages the run view tracks, in canonical order — the trace
 * kind "phase" values from agent_backend/pipeline.py (ground truth), with
 * the two phases that have no explicit phase event (scouts, research)
 * inferred from agent activity instead (see AGENT_PHASE below).
 */
export type PipelinePhase =
  | "orchestrate"
  | "extract"
  | "gap"
  | "scouts"
  | "research"
  | "cross_examine"
  | "score"
  | "liaison"
  | "compose";

export type StageStatus = "pending" | "working" | "done";

/** One box in the staging tracker. */
export type StageState = {
  id: PipelinePhase;
  /** Friendly box title. */
  label: string;
  status: StageStatus;
  /**
   * True when the phase started AGAIN after completing (the cross-examine →
   * follow-up research loop). The box flips back to working and its status
   * line reads "re-run due to findings" instead of "working".
   */
  retriggered: boolean;
};

export const PIPELINE_STAGES: ReadonlyArray<{
  id: PipelinePhase;
  label: string;
}> = [
  { id: "orchestrate", label: "Project profile" },
  { id: "extract", label: "Document extraction" },
  { id: "gap", label: "Gap analysis" },
  { id: "scouts", label: "Data scouts" },
  { id: "research", label: "Research" },
  { id: "cross_examine", label: "Cross-examination" },
  { id: "score", label: "Scoring" },
  { id: "liaison", label: "Action pack" },
  { id: "compose", label: "Report" },
];

function initialStages(): StageState[] {
  return PIPELINE_STAGES.map((s) => ({
    ...s,
    status: "pending",
    retriggered: false,
  }));
}

/**
 * Agent core name → the phase its activity belongs to. pipeline.py emits no
 * phase event for the scout/research fan-outs, so a working DataScout:* /
 * Researcher:* box is the honest signal that stage is running (and, after
 * cross-examination, that research re-ran).
 */
const AGENT_PHASE: Record<string, PipelinePhase> = {
  orchestrator: "orchestrate",
  extractor: "extract",
  gapanalyzer: "gap",
  datascout: "scouts",
  researcher: "research",
  crossexaminer: "cross_examine",
  "cross-examiner": "cross_examine",
  scorer: "score",
  liaison: "liaison",
  composer: "compose",
};

/**
 * Phase state machine: the named phase goes to working (a done phase goes
 * BACK to working and is flagged retriggered), and every earlier stage the
 * pipeline has moved past snaps to done. Unknown phase names pass through
 * unchanged so new backend stages never break the UI.
 */
function touchStage(stages: StageState[], id: PipelinePhase): StageState[] {
  const idx = stages.findIndex((s) => s.id === id);
  if (idx < 0) return stages;
  return stages.map((s, i) => {
    if (i < idx) {
      return s.status === "done" ? s : { ...s, status: "done" };
    }
    if (i === idx) {
      if (s.status === "done") {
        return { ...s, status: "working", retriggered: true };
      }
      return s.status === "working" ? s : { ...s, status: "working" };
    }
    return s;
  });
}

/** How the review gate closed — human selection or server-side timeout. */
export type GateResolution = {
  mode: "approved" | "timeout";
  approved: string[];
};

/** State of the mid-run gap-review gate, when the pipeline raises one. */
export type GapGateState = {
  gaps: GapItem[];
  timeoutS: number;
  resolved: GateResolution | null;
};

export type TrailLine = {
  id: number;
  text: string;
  kind: TrailKind;
};

export type SourceRow = {
  url: string;
  status: "fetching" | "fetched" | "repaired" | "failed" | "skipped";
  agent?: string;
  chars?: number;
};

export type ScanResult = {
  projectId: string;
  activationScore: number;
};

/** The accumulated data (phase is derived separately, in the hook). */
export type ScanData = {
  sources: SourceRow[];
  percent: number;
  currentFile: string | null;
  trail: TrailLine[];
  subAgents: string[];
  pillarsComplete: number;
  flagCount: number;
  /** Sub-events (reads/findings/spawns) since the last pillar milestone. */
  sinceMilestone: number;
  result: ScanResult | null;
  error: string | null;
  /** Gap-review gate while open, and after resolution. Null = gate disabled. */
  gate: GapGateState | null;
  /** Agent boxes in first-seen order — the hero of the live run view. */
  agents: AgentBox[];
  /** Per-agent live feed lines (agent_update history), keyed by agent name. */
  feeds: Record<string, AgentFeedLine[]>;
  /** The staging tracker: one box per pipeline phase, in canonical order. */
  stages: StageState[];
  /** Total events folded so far (0 = nothing has arrived yet). */
  eventCount: number;
};

export const initialScanData: ScanData = {
  sources: [],
  percent: 0,
  currentFile: null,
  trail: [],
  subAgents: [],
  pillarsComplete: 0,
  flagCount: 0,
  sinceMilestone: 0,
  result: null,
  error: null,
  gate: null,
  agents: [],
  feeds: {},
  stages: initialStages(),
  eventCount: 0,
};

const SHARE = 100 / PILLAR_COUNT; // 20% per pillar
// Within a pillar, sub-events fill up to (but never reach) the next milestone.
const WITHIN_STEP = 4;
const WITHIN_CAP = SHARE * 0.8; // 16% — always short of the next 20% jump

function computePercent(pillarsComplete: number, sinceMilestone: number): number {
  const base = pillarsComplete * SHARE;
  const within = Math.min(WITHIN_CAP, sinceMilestone * WITHIN_STEP);
  return Math.min(96, base + within);
}

let trailSeq = 0;
function line(text: string, kind: TrailKind): TrailLine {
  trailSeq += 1;
  return { id: trailSeq, text, kind };
}

export function reduceScan(state: ScanData, event: ScanEvent): ScanData {
  const next = { ...state, eventCount: state.eventCount + 1 };

  switch (event.type) {
    case "reading_document": {
      const sinceMilestone = state.sinceMilestone + 1;
      return {
        ...next,
        currentFile: event.filename,
        sinceMilestone,
        trail: [...state.trail, line(`Reading ${event.filename}`, "read")],
        percent: computePercent(state.pillarsComplete, sinceMilestone),
      };
    }
    case "finding": {
      const sinceMilestone = state.sinceMilestone + 1;
      return {
        ...next,
        sinceMilestone,
        flagCount: state.flagCount + (event.flag ? 1 : 0),
        trail: [...state.trail, line(event.text, event.flag ? "flag" : "read")],
        percent: computePercent(state.pillarsComplete, sinceMilestone),
      };
    }
    case "subagent_spawned": {
      const sinceMilestone = state.sinceMilestone + 1;
      const subAgents = state.subAgents.includes(event.name)
        ? state.subAgents
        : [...state.subAgents, event.name];
      return {
        ...next,
        sinceMilestone,
        subAgents,
        trail: [
          ...state.trail,
          line(`Sub-agent ${event.name} · ${event.parentPillar}`, "subagent"),
        ],
        percent: computePercent(state.pillarsComplete, sinceMilestone),
      };
    }
    case "agent_update": {
      const idx = state.agents.findIndex((a) => a.name === event.agent);
      const prev = idx >= 0 ? state.agents[idx] : undefined;
      let status = event.status;
      // done/error are terminal for a box — later ambient activity for the
      // same name must not reopen it.
      if (
        prev &&
        (prev.status === "done" || prev.status === "error") &&
        status === "working"
      ) {
        status = prev.status;
      }
      const box: AgentBox = {
        name: event.agent,
        status,
        activity: event.activity,
      };
      const agents = prev
        ? state.agents.map((a, i) => (i === idx ? box : a))
        : [...state.agents, box];
      // Every attributed frame also lands in that agent's feed — the tile
      // pop-up replays this history live while it stays open.
      const prevFeed = state.feeds[event.agent] ?? [];
      const feed = [
        ...(prevFeed.length >= FEED_CAP ? prevFeed.slice(1) : prevFeed),
        feedLine(event.activity, event.status),
      ];
      // A working agent whose core maps to a pipeline phase is also the
      // tracker's signal for the phases that have no explicit phase event
      // (scouts, research) — and for research re-running after cross-examine.
      const mapped = AGENT_PHASE[event.agent.split(":")[0].toLowerCase()];
      const stages =
        mapped && status === "working"
          ? touchStage(state.stages, mapped)
          : state.stages;
      return {
        ...next,
        agents,
        feeds: { ...state.feeds, [event.agent]: feed },
        stages,
      };
    }
    case "pillar_complete": {
      const pillarsComplete = Math.min(PILLAR_COUNT, state.pillarsComplete + 1);
      return {
        ...next,
        pillarsComplete,
        sinceMilestone: 0,
        trail: [
          ...state.trail,
          line(`${event.pillar} scored ${event.score}`, "score"),
        ],
        percent: pillarsComplete * SHARE, // snap to the honest milestone
      };
    }
    case "progress": {
      // Explicit progress from a source that can't report milestones. Monotonic
      // and capped below 100 until the terminal complete event.
      return {
        ...next,
        percent: Math.max(state.percent, Math.min(96, event.percent)),
      };
    }
    case "phase": {
      // Pipeline phase boundary (trace kind "phase"). A phase event naming an
      // already-done phase is the cross-examine → follow-up research loop:
      // touchStage flips it back to working and flags the re-run.
      return { ...next, stages: touchStage(state.stages, event.phase as PipelinePhase) };
    }
    case "gate_gap_review": {
      // The pipeline is paused awaiting a human decision; the bar must not
      // advance while the gate is open.
      return {
        ...next,
        gate: { gaps: event.gaps, timeoutS: event.timeoutS, resolved: null },
        // The pipeline is parked awaiting a human: active agents go dim.
        agents: state.agents.map((a) =>
          a.status === "working" ? { ...a, status: "waiting" } : a,
        ),
        trail: [
          ...state.trail,
          line(
            `Review gate: ${event.gaps.length} gap${event.gaps.length === 1 ? "" : "s"} need a decision`,
            "gate",
          ),
        ],
      };
    }
    case "gate_resolved": {
      const resolved: GateResolution = {
        mode: event.mode,
        approved: event.approved,
      };
      const gate: GapGateState = state.gate
        ? { ...state.gate, resolved }
        : { gaps: [], timeoutS: 0, resolved };
      const total = state.gate?.gaps.length ?? event.approved.length;
      const text =
        event.mode === "timeout"
          ? "Gap review timed out — chasing all gaps"
          : `Gap review approved — chasing ${event.approved.length} of ${total}`;
      return {
        ...next,
        gate,
        // The pipeline woke up: parked agents are working again.
        agents: state.agents.map((a) =>
          a.status === "waiting" ? { ...a, status: "working" } : a,
        ),
        trail: [...state.trail, line(text, "gate")],
      };
    }
    case "complete": {
      return {
        ...next,
        percent: 100,
        // Terminal frame closes everything still open — boxes freeze done.
        agents: state.agents.map((a) =>
          a.status === "working" || a.status === "waiting"
            ? { ...a, status: "done" }
            : a,
        ),
        // Every stage box fills green, including any still mid re-run.
        stages: state.stages.map((s) =>
          s.status === "done" ? s : { ...s, status: "done" },
        ),
        result: {
          projectId: event.projectId,
          activationScore: event.activationScore,
        },
      };
    }
    case "error": {
      return {
        ...next,
        error: event.message,
        // Terminal frame closes everything still open — boxes freeze on error.
        agents: state.agents.map((a) =>
          a.status === "working" || a.status === "waiting"
            ? { ...a, status: "error" }
            : a,
        ),
      };
    }
    default:
      return state;
  }
}
