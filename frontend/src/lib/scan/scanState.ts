// Folds the raw ScanEvent stream into the data the scanning UI renders.
//
// Progress is MILESTONE-BASED, not time-based: each of the five pillars
// completing advances the bar by a fixed 1/5 share. Document/finding/sub-agent
// events fill in small increments *within* the current pillar's share but can
// never reach the next milestone — five honest jumps, no fabricated smooth 0–100.

import { PILLAR_COUNT, type ScanEvent } from "./scanEvents";

export type TrailKind = "read" | "flag" | "score" | "subagent";

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
    case "complete": {
      return {
        ...next,
        percent: 100,
        result: {
          projectId: event.projectId,
          activationScore: event.activationScore,
        },
      };
    }
    case "error": {
      return { ...next, error: event.message };
    }
    default:
      return state;
  }
}
