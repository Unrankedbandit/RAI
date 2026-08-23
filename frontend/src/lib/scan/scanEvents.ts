// Live scan event contract.
//
// The backend agent pipeline (five primary agents — Land, Law, Finance,
// Materials, Demand — each spawning sub-agents on Bedrock) emits these events
// over SSE/WebSocket as analysis progresses. The frontend renders them; it
// never fabricates progress the backend hasn't reported.

import type { RiskBand } from "@/lib/types";

/** Lifecycle of one agent box in the live run view. */
export type AgentStatus = "working" | "done" | "error" | "waiting";

export type ScanEvent =
  | { type: "reading_document"; filename: string }
  | { type: "finding"; text: string; flag: boolean }
  | { type: "subagent_spawned"; name: string; parentPillar: string }
  /**
   * One agent's latest state, keyed by name. The run view renders these as
   * status boxes that update in place; `activity` is the agent's latest
   * one-line narration (never a model name — sources must strip those).
   */
  | {
      type: "agent_update";
      agent: string;
      status: AgentStatus;
      activity: string;
    }
  | {
      type: "pillar_complete";
      pillar: string;
      score: number;
      band: RiskBand;
    }
  /**
   * Explicit progress (0–100). Used by sources that can't report structured
   * pillar milestones — e.g. the live backend narrates free text, so its source
   * drives the bar with an honest asymptotic estimate instead. Ignored by the
   * milestone path, which computes progress from pillar_complete events.
   */
  | { type: "progress"; percent: number }
  /**
   * Mid-run human-approval gate. The pipeline paused after the first research
   * step and is waiting for a human to pick which gaps the swarm should chase.
   * Purely additive — when the gate is disabled server-side this never arrives.
   */
  | { type: "gate_gap_review"; gaps: GapItem[]; timeoutS: number }
  /**
   * The gate closed: either the human submitted a selection ("approved") or the
   * timeout elapsed server-side ("timeout", in which case the swarm chases all
   * gaps and `approved` is empty).
   */
  | {
      type: "gate_resolved";
      mode: "approved" | "timeout";
      approved: string[];
    }
  | { type: "complete"; projectId: string; activationScore: number }
  | { type: "error"; message: string };

/** One gap the research agents surfaced for human review. */
export type GapItem = {
  id: string;
  title: string;
  detail?: string;
  severity?: string;
};

/** The five primary agents — one milestone each. */
export const PILLARS = ["Land", "Law", "Finance", "Materials", "Demand"] as const;
export const PILLAR_COUNT = PILLARS.length;

/**
 * A source of scan events. Given handlers, it starts streaming and returns a
 * cancel function that tears the connection down. Both the real SSE client and
 * the mock simulator implement this identical shape, so they are swappable
 * without touching the UI or the hook.
 */
export type ScanSourceHandlers = {
  onEvent: (event: ScanEvent) => void;
  /** Connection closed before a terminal (complete/error) event. */
  onClose: () => void;
};

export type ScanSource = (handlers: ScanSourceHandlers) => () => void;
