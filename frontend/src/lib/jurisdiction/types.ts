/**
 * Curated jurisdiction submittal resources — the REAL permit applications,
 * submittal checklists, and filing portals an applicant must file with each
 * authority for a solar/storage project. Every URL in this module was fetched
 * and verified to resolve; each resource can carry its own verification
 * record (verifiedAt/verifyStatus/verifyNote), with the pack-level verifiedAt
 * as the fallback. We never emit an invented or unverified link.
 * Re-check with: node scripts/check-jurisdiction-links.mjs
 */

/** The filing phases a utility-scale solar/BESS submittal package moves through. */
export type SubmittalPhase =
  | "entitlement"
  | "environmental"
  | "building"
  | "fire"
  | "interconnection";

export const PHASE_ORDER: SubmittalPhase[] = [
  "entitlement",
  "environmental",
  "building",
  "fire",
  "interconnection",
];

export const PHASE_LABELS: Record<SubmittalPhase, string> = {
  entitlement: "Entitlement — Planning",
  environmental: "Environmental review (CEQA)",
  building: "Building & Safety",
  fire: "Fire",
  interconnection: "Utility interconnection",
};

export type ResourceKind = "form" | "checklist" | "portal" | "guidelines" | "page";

/** Observed liveness of a single link at `verifiedAt` (scripted fetch). */
export type VerifyStatus = "ok" | "bot-blocked" | "dead";

/** Per-link verification record — overrides the pack-level fallback. */
export interface LinkVerification {
  /** ISO date this URL was last probed (scripts/check-jurisdiction-links.mjs). */
  verifiedAt?: string;
  /**
   * "ok" = HTTP 2xx/3xx to a scripted fetch; "bot-blocked" = 403 to scripted
   * fetch (WAF bot-blocking) but loads in a real browser; "dead" = does not
   * resolve.
   */
  verifyStatus?: VerifyStatus;
  /** Short human note, e.g. why a bot-blocked link is still trusted. */
  verifyNote?: string;
}

export interface JurisdictionResource extends LinkVerification {
  title: string;
  url: string;
  phase: SubmittalPhase;
  kind: ResourceKind;
  /** Issuing authority, e.g. "Ventura County RMA Planning Division". */
  authority: string;
  /** One sentence: what the applicant files/uses it for. */
  whatFor: string;
}

export interface PlanningRoot extends LinkVerification {
  /** Verified county planning page root — the honest fallback landing page. */
  url: string;
  label: string;
}

export interface JurisdictionPack {
  /** County name without the " County" suffix, e.g. "Ventura". */
  county: string;
  state: string;
  /** Verified filing portal (used across phases), when one exists. */
  portal: JurisdictionResource | null;
  resources: JurisdictionResource[];
  /** Honest per-phase gaps, e.g. "VCFD publishes no BESS-specific standard". */
  notes: Partial<Record<SubmittalPhase, string>>;
  /**
   * Fallback verification date for the pack — resources without their own
   * `verifiedAt` inherit this. Per-link records win when present.
   */
  verifiedAt: string;
}
