import type { JurisdictionPack, PlanningRoot } from "./types";
import { VENTURA } from "./ventura";

export type {
  JurisdictionPack,
  JurisdictionResource,
  PlanningRoot,
  ResourceKind,
  SubmittalPhase,
} from "./types";
export { PHASE_LABELS, PHASE_ORDER } from "./types";

/** Fully curated packs, keyed `${county}|${state}` lowercase. */
const PACKS: Record<string, JurisdictionPack> = {
  "ventura|ca": VENTURA,
};

/**
 * Verified county planning-page roots for counties without a curated pack —
 * the honest fallback landing page. Every URL fetched and returned HTTP 200
 * on 2026-08-23, re-checked 2026-08-25 (per-link records below). Kings County
 * blocks scripted clients with a 403 (WAF bot-blocking) but serves the page
 * to browsers — content verified via browser render.
 */
const PLANNING_ROOTS: Record<string, PlanningRoot> = {
  "clark|nv": {
    url: "https://www.clarkcountynv.gov/government/departments/comprehensive_planning_department/",
    label: "Clark County Comprehensive Planning Department",
    verifiedAt: "2026-08-25",
    verifyStatus: "ok",
  },
  "kings|ca": {
    url: "https://www.countyofkingsca.gov/departments/community-development-agency",
    label: "Kings County Community Development Agency",
    verifiedAt: "2026-08-25",
    verifyStatus: "bot-blocked",
    verifyNote: "403 to scripted fetch (WAF bot-blocking); loads in browsers",
  },
  "sacramento|ca": {
    url: "https://planning.saccounty.gov/",
    label: "Sacramento County Planning & Environmental Review",
    verifiedAt: "2026-08-25",
    verifyStatus: "ok",
  },
  "solano|ca": {
    url: "https://www.solanocounty.gov/government/resource-management/planning-services",
    label: "Solano County Resource Management — Planning Services",
    verifiedAt: "2026-08-25",
    verifyStatus: "ok",
  },
};

export interface JurisdictionLookup {
  /** The curated pack when the county is fully covered. */
  pack: JurisdictionPack | null;
  /** Verified planning-page root when the county is not curated. */
  planningRoot: PlanningRoot | null;
}

function normalizeCounty(county: string): string {
  return county.replace(/\s+County$/i, "").trim().toLowerCase();
}

/**
 * Look up submittal resources for a county ("Ventura County", "Clark County")
 * + state token ("CA", "NV"). Counties without a curated pack fall back to a
 * verified planning-page root (never an invented deep link); when even that
 * is unknown both fields are null and the UI says so.
 */
export function getJurisdiction(
  county: string,
  state: string | null,
): JurisdictionLookup {
  const key = `${normalizeCounty(county)}|${(state ?? "").toLowerCase()}`;
  const pack = PACKS[key] ?? null;
  return { pack, planningRoot: pack ? null : (PLANNING_ROOTS[key] ?? null) };
}
