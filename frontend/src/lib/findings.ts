// Single source of truth for finding status/severity → styling, mirroring
// lib/band.ts. Keeping this here is what guarantees finding colors are never
// decorative or hardcoded: every lozenge/flag resolves through these helpers.

import type { FindingSeverity, FindingStatus } from "./types";

/**
 * Lozenge (pill) classes per status. Blocked is the one SOLID lozenge —
 * the loudest state in the queue. Open is soft orange (flagged), In review
 * is near-black, Resolved is grey.
 */
export const statusToLozengeClass: Record<FindingStatus, string> = {
  Open: "bg-brand-soft text-risk-ink",
  "In review": "bg-watch-soft text-watch-ink",
  Resolved: "bg-strong-soft text-strong-ink",
  Blocked: "bg-risk text-white",
};

/** Solid marker color per status (dots, timeline markers) — CSS vars. */
export const statusToColor: Record<FindingStatus, string> = {
  Open: "var(--color-risk)",
  "In review": "var(--color-watch)",
  Resolved: "var(--color-strong)",
  Blocked: "var(--color-risk)",
};

/** Small flag/marker color per severity — CSS vars, like bandColorVar. */
export const severityToFlagColor: Record<FindingSeverity, string> = {
  High: "var(--color-risk)",
  Medium: "var(--color-watch)",
  Low: "var(--color-faint)",
};

/** Queue ordering: most urgent workflow state first. */
export const statusOrder: Record<FindingStatus, number> = {
  Open: 0,
  Blocked: 1,
  "In review": 2,
  Resolved: 3,
};

export const severityOrder: Record<FindingSeverity, number> = {
  High: 0,
  Medium: 1,
  Low: 2,
};
