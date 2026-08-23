// Site-level geocoding + Areas-of-Interest extraction for the project Map tab.
//
// Two jobs:
//   1. geocodeLocation() — the same keyless Nominatim jsonv2 pattern as
//      lib/agent/researched.ts (US-only, module-level promise cache, silent
//      null on failure). Explicit project coordinates always win upstream.
//   2. extractSiteFeatures() — scans a raw AgentReport (red flags, dimension
//      flags, acquired data) for site-locatable features (wetland, easement,
//      flood zone, habitat, transmission, substation, road access…). A
//      feature gets a map marker ONLY when the report text says it is on/at
//      the site ("on site", "within the parcel", "crosses the site", …);
//      otherwise it is returned in `mentioned` for a text-only listing.
//      Marker positions are SYNTHESIZED deterministically inside a ~300m box
//      around the geocoded site point (stable hash of the label) — they are
//      indicative placement for orientation, NOT surveyed coordinates.
//
// Honesty guards: no report → empty extraction; no on-site phrase → no
// marker; geocode failure → null (the view renders an honest empty state,
// never a default-country fake view).

import type { AgentReport, RAG, Severity } from "./report";
import type { RiskBand } from "../types";

/* ---------------------------- geocoding ---------------------------- */

// Nominatim (jsonv2, US-only, no key) — mirrors researched.ts.
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const geocodeCache = new Map<string, Promise<[number, number] | null>>();

/** Geocodes a location string to [lng, lat], or null on any failure. */
export function geocodeLocation(
  location: string,
): Promise<[number, number] | null> {
  const key = location.trim().toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    try {
      const res = await fetch(
        `${NOMINATIM}?format=jsonv2&q=${encodeURIComponent(location)}&countrycodes=us&limit=1`,
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) return null;
      const rows = (await res.json()) as { lat: string; lon: string }[];
      const first = rows[0];
      if (!first) return null;
      const lng = Number.parseFloat(first.lon);
      const lat = Number.parseFloat(first.lat);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lng, lat] as [number, number];
    } catch {
      return null; // Geocoder hiccups are silent — the site just gets no map.
    }
  })();

  geocodeCache.set(key, promise);
  return promise;
}

/* ------------------------ shared id helpers ------------------------ */

/** "Wetland Delineation Pending" -> "wetland-delineation-pending". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Stable anchor id for a finding card, used in BOTH directions:
 * FindingsTab sets `id={findingAnchorId(factor.name)}` on each card and the
 * map links to `/projects/<id>?tab=findings#${findingAnchorId(title)}`.
 * The 90-char slice mirrors the adapter (factor names are truncated at 90).
 */
export function findingAnchorId(findingTitle: string): string {
  return `finding-${slugify(findingTitle.slice(0, 90))}`;
}

/* --------------------- area-of-interest types ---------------------- */

export type AoiKind =
  | "water"
  | "flood"
  | "easement"
  | "habitat"
  | "transmission"
  | "substation"
  | "road";

export interface AoIFeature {
  /** Dedupe key: kind + normalized label. */
  key: string;
  kind: AoiKind;
  /** Short marker label, e.g. "Wetland", "Substation". */
  label: string;
  /** Kind-specific emoji badge. */
  icon: string;
  /** Title of the finding this feature derives from. */
  findingTitle: string;
  /** Anchor id into the Findings tab (`finding-<slug>`). */
  anchorId: string;
  /** Supporting report text snippet shown in the popup. */
  snippet: string;
  /** Severity colour; null = neutral (acquired-data mentions). */
  band: RiskBand | null;
}

export interface SiteFeatures {
  /** Zoning designation string (e.g. "A-1") when the report carries one. */
  zoning: string | null;
  /** Site-locatable features — these get markers. */
  aois: AoIFeature[];
  /** Features mentioned but NOT stated to be on site — listed, never mapped. */
  mentioned: AoIFeature[];
}

/* --------------------- classification patterns --------------------- */

const KIND_PATTERNS: {
  kind: AoiKind;
  re: RegExp;
  label: string;
  icon: string;
}[] = [
  // Substation first — a "substation" mention often co-occurs with
  // "transmission line" and is the more specific feature.
  { kind: "substation", re: /\bsubstations?\b/i, label: "Substation", icon: "🔌" },
  {
    kind: "transmission",
    re: /\btransmission lines?\b|\bpower lines?\b|\bgen[- ]ties\b|\b\d{2,3}\s?kv\b/i,
    label: "Transmission line",
    icon: "⚡",
  },
  {
    kind: "water",
    re: /\b(wetlands?|rivers?|creeks?|streams?|ponds?|lakes?|waterways?|playas?|washes|arroyos?)\b/i,
    label: "Water feature", // refined from the matched word below
    icon: "💧",
  },
  {
    kind: "flood",
    re: /\bflood\s?(zone|plain|way|risk|prone|s)?\b/i,
    label: "Flood zone",
    icon: "🌊",
  },
  {
    kind: "easement",
    re: /\beasements?\b|\bright[- ]of[- ]ways?\b|\brows\b/i,
    label: "Easement / ROW",
    icon: "📜",
  },
  {
    kind: "habitat",
    re: /\bcritical habitat\b|\bhabitat\b|\bprotected (land|area|species)\b|\bendangered\b|\bconservation (area|easement|land)\b/i,
    label: "Habitat / protected land",
    icon: "🦅",
  },
  {
    kind: "road",
    re: /\baccess roads?\b|\broad access\b|\broads?\b|\bhighways?\b/i,
    label: "Road access",
    icon: "🛣️",
  },
];

/**
 * Phrases that assert a feature is physically on/at the site. Anything short
 * of this ("near the site", "within 5 miles", "in the county") does NOT earn
 * a marker — it lands in the mentioned-not-mapped list instead.
 */
const ON_SITE_RE =
  /\bon[- ]?site\b|\bon the (site|parcel|property|project site)\b|\bwithin the (parcel|site|property|project|boundary)\b|\bcrosses the (site|parcel|property)\b|\bacross the (site|parcel|property)\b|\bthrough the (site|parcel|property)\b|\bon the subject\b|\bwithin the project footprint\b/i;

function severityBand(sev: Severity): RiskBand {
  return sev === "critical" || sev === "high" ? "risk" : "watch";
}

function ragBand(rag: RAG): RiskBand {
  return rag === "red" ? "risk" : rag === "amber" ? "watch" : "strong";
}

/* ------------------------- zoning mention -------------------------- */

// "zoned A-1", "zoning designation of M-2", "zoning: AG" …
const ZONING_CODE_RE =
  /\bzoned\s+([A-Z]{1,4}(?:-[A-Za-z0-9]+)?)\b|\bzoning\s+(?:designation|classification)?\s*(?:of|is|:)?\s*\b([A-Z]{1,4}(?:-[A-Za-z0-9]+)?)\b/;
const ZONING_ANY_RE = /\bzoning\b/i;

function extractZoning(report: AgentReport): string | null {
  const texts: string[] = [
    ...report.acquired_data.flatMap((d) => d.data_points),
    ...report.red_flags.flatMap((r) => [r.title, r.evidence]),
    ...report.dimensions.flatMap((d) => d.flags),
  ];
  let anyMention: string | null = null;
  for (const text of texts) {
    if (!ZONING_ANY_RE.test(text)) continue;
    const m = ZONING_CODE_RE.exec(text);
    if (m) return m[1] ?? m[2] ?? null;
    // Zoning mentioned without a parseable code — keep the first snippet so
    // the legend can quote it verbatim instead of inventing a designation.
    anyMention ??= text.trim().slice(0, 80);
  }
  return anyMention;
}

/* ------------------------ feature extraction ----------------------- */

function classify(
  text: string,
): { kind: AoiKind; label: string; icon: string } | null {
  for (const p of KIND_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    // For water features the matched word IS the label ("Wetland", "Creek").
    if (p.kind === "water" && m[1]) {
      const word = m[1].toLowerCase().replace(/s$/, "");
      return {
        kind: p.kind,
        label: word.charAt(0).toUpperCase() + word.slice(1),
        icon: p.icon,
      };
    }
    return { kind: p.kind, label: p.label, icon: p.icon };
  }
  return null;
}

/**
 * Scans the report for site-locatable features. Red flags are scanned first
 * (highest-signal findings win the dedupe), then dimension flags, then
 * acquired data points.
 */
export function extractSiteFeatures(report: AgentReport | null): SiteFeatures {
  if (!report) return { zoning: null, aois: [], mentioned: [] };

  interface RawHit {
    text: string;
    findingTitle: string;
    band: RiskBand | null;
  }
  const hits: RawHit[] = [
    ...report.red_flags.map((rf) => ({
      text: `${rf.title}. ${rf.evidence}`,
      findingTitle: rf.title,
      band: severityBand(rf.severity),
    })),
    ...report.dimensions.flatMap((d) =>
      d.flags.map((f) => ({
        text: f,
        findingTitle: f,
        band: ragBand(d.rag),
      })),
    ),
    ...report.acquired_data.flatMap((d) =>
      d.data_points.map((p) => ({
        text: p,
        findingTitle: p.slice(0, 90),
        band: null,
      })),
    ),
  ];

  const seen = new Set<string>();
  const aois: AoIFeature[] = [];
  const mentioned: AoIFeature[] = [];

  for (const hit of hits) {
    const cls = classify(hit.text);
    if (!cls) continue;
    const key = `${cls.kind}:${slugify(cls.label)}`;
    if (seen.has(key)) continue;

    const feature: AoIFeature = {
      key,
      kind: cls.kind,
      label: cls.label,
      icon: cls.icon,
      findingTitle: hit.findingTitle,
      anchorId: findingAnchorId(hit.findingTitle),
      snippet: hit.text.trim().slice(0, 220),
      band: hit.band,
    };

    if (ON_SITE_RE.test(hit.text)) {
      seen.add(key); // one marker per kind+label
      aois.push(feature);
    } else {
      seen.add(key); // still dedupe the list
      mentioned.push(feature);
    }
  }

  return { zoning: extractZoning(report), aois, mentioned };
}

/* --------------------- synthetic marker positions ------------------ */

// FNV-1a — tiny stable string hash, no dependencies.
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic position for a feature inside a small synthetic parcel
 * extent around the geocoded site point: a stable hash of the feature key
 * maps to an offset within roughly a ±300m box.
 *
 * These positions are INDICATIVE, NOT SURVEYED — the report tells us a
 * feature is on the site but not where, so we spread markers deterministically
 * (same report → same layout) purely for orientation on the satellite view.
 */
export function positionForFeature(
  featureKey: string,
  center: [number, number], // [lng, lat]
): [number, number] {
  const h = fnv1a(featureKey);
  const u = (h & 0xffff) / 0xffff; // [0,1)
  const v = ((h >>> 16) & 0xffff) / 0xffff;
  // ~±300m in lng at mid latitudes, ~±270m in lat; cos(lat) keeps the box
  // honest as latitude varies.
  const cosLat = Math.max(Math.cos((center[1] * Math.PI) / 180), 0.2);
  const lngSpan = 0.006 / cosLat;
  const latSpan = 0.005;
  return [center[0] + (u - 0.5) * lngSpan, center[1] + (v - 0.5) * latSpan];
}
