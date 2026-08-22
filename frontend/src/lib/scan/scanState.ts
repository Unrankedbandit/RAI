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

/** One agent's live box: name, lifecycle status, latest one-line activity. */
export type AgentBox = {
  name: string;
  status: AgentStatus;
  activity: string;
};

export type TrailKind = "read" | "flag" | "score" | "subagent" | "gate";

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

export type ScanResult = {
  projectId: string;
  activationScore: number;
};

/** The accumulated data (phase is derived separately, in the hook). */
export type ScanData = {
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
  /** Total events folded so far (0 = nothing has arrived yet). */
  eventCount: number;
};

export const initialScanData: ScanData = {
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
      return { ...next, agents };
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
