/**
 * Curated jurisdiction submittal resources — the REAL permit applications,
 * submittal checklists, and filing portals an applicant must file with each
 * authority for a solar/storage project. Every URL in this module was fetched
 * and verified to resolve (see verifiedAt on each pack); we never emit an
 * invented or unverified link.
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

export interface JurisdictionResource {
  title: string;
  url: string;
  phase: SubmittalPhase;
  kind: ResourceKind;
  /** Issuing authority, e.g. "Ventura County RMA Planning Division". */
  authority: string;
  /** One sentence: what the applicant files/uses it for. */
  whatFor: string;
}

export interface PlanningRoot {
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
  /** Date every URL in this pack was fetched and returned HTTP 200. */
  verifiedAt: string;
}
