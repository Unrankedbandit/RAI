// Agent-side report contract (mirrors agent_backend/schemas.py 1:1).
// This is the shape the Red Flag agent pipeline emits; the adapter in
// ./adapter.ts converts it into the Solar Sentinel frontend contract
// (src/lib/types.ts) without any Python in the loop.

export type Severity = "critical" | "high" | "medium" | "low";
export type RAG = "red" | "amber" | "green";

export interface AgentRedFlag {
  title: string;
  severity: Severity;
  component: string;
  evidence: string;
  benchmark: string | null;
  sources: string[];
}

export interface AgentContradiction {
  claims: string[];
  sources: string[];
  severity: Severity;
  explanation: string;
}

export interface AgentDimensionScore {
  name: string;
  rag: RAG;
  score: number; // 0-100
  flags: string[];
}

export interface AgentAgencyAction {
  agency: string;
  action: string;
  why: string;
  deadline: string | null;
}

export interface AgentTimelineEntry {
  label: string;
  date: string; // ISO YYYY-MM-DD
  kind: "milestone" | "deadline";
  detail: string;
  severity: "critical" | "high" | "medium" | "low";
  /** External source for the date — a URL a tool actually returned or a
   *  benchmark URL from the liaison prompt. Null => UI marks unverified. */
  source_url?: string | null;
  /** One-line note: the public benchmark this date was checked against. */
  ground_truth?: string | null;
}

export interface AgentActionPack {
  rfis: string[];
  agency_actions: AgentAgencyAction[];
  verification_requests: string[];
  conditions_precedent: string[];
  /** Critical path for the timeline strip. Optional: reports written before
   *  this contract don't carry it — the adapter falls back to deadlines. */
  timeline?: AgentTimelineEntry[];
}

export interface AgentAcquiredData {
  component: string;
  data_points: string[];
  sources: string[];
  still_missing: string[];
}

/** The full report the agent pipeline writes (agent_backend/reports/*.json). */
export interface AgentReport {
  project: string;
  location: string;
  readiness: number;
  decision: string; // "Proceed" | "Investigate" | "Hold"
  dimensions: AgentDimensionScore[];
  red_flags: AgentRedFlag[];
  contradictions: AgentContradiction[];
  missing_info: string[];
  action_pack: AgentActionPack;
  recommended_next_action: string | null;
  acquired_data: AgentAcquiredData[];
}
