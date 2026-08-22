// Central mapping from risk band → styling and copy.
// Keeping this in one place is what guarantees "color is never decorative":
// every status color in the UI resolves through these helpers.

import type { ProjectStatus, RiskBand, StatusLabel } from "./types";

export const bandLabel: Record<RiskBand, string> = {
  strong: "Cleared",
  watch: "Watch",
  risk: "Flagged",
};

export const statusLabelText: Record<ProjectStatus, string> = {
  "on-track": "On track",
  "needs-review": "Needs review",
  "at-risk": "At risk",
};

export const bandToStatus: Record<RiskBand, ProjectStatus> = {
  strong: "on-track",
  watch: "needs-review",
  risk: "at-risk",
};

/** Solid text/stroke color token per band (for rings, bars, emphasis). */
export const bandColorVar: Record<RiskBand, string> = {
  strong: "var(--color-strong)",
  watch: "var(--color-watch)",
  risk: "var(--color-risk)",
};

/** Pill/chip classes: soft background + readable ink, fully rounded. */
export const bandPillClass: Record<RiskBand, string> = {
  strong: "bg-strong-soft text-strong-ink",
  watch: "bg-watch-soft text-watch-ink",
  risk: "bg-risk-soft text-risk-ink",
};

/** Solid fill class for score bars / ring segments. */
export const bandFillClass: Record<RiskBand, string> = {
  strong: "bg-strong",
  watch: "bg-watch",
  risk: "bg-risk",
};

export const bandTextClass: Record<RiskBand, string> = {
  strong: "text-strong-ink",
  watch: "text-watch-ink",
  risk: "text-risk-ink",
};

export function statusToBand(status: ProjectStatus): RiskBand {
  if (status === "on-track") return "strong";
  if (status === "needs-review") return "watch";
  return "risk";
}

export function statusLabelToBand(label: StatusLabel): RiskBand {
  if (label === "Cleared") return "strong";
  if (label === "Watch") return "watch";
  return "risk";
}
