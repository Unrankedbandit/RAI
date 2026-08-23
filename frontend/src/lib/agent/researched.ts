// Researched-parcel dots for the Current Projects map.
//
// The portfolio map's own pins come from mock project data; this module adds
// what the team has actually researched: every row of GET /api/projects (the
// gate-token client in ./client) geocoded to a point and rendered as a
// verdict-coloured dot. Rows carry no coordinates today, so the `location`
// string is geocoded via Nominatim — the same keyless jsonv2 pattern as the
// parcels search (ParcelViewer.tsx), minus the California viewbox (research
// spans CA and NV). Explicit lat/lng on a row always wins over geocoding.
//
// Caching: geocode results live in a module-level Map keyed by normalized
// location, and the fully-resolved parcel list is cached as a single promise,
// so unmount/remount cycles (the Map/List toggle drops the map component)
// never re-hit the network. A failed load is NOT cached — the next mount
// retries. Empty state is simply "no dots": failures and unresolvable
// locations render nothing, never fake points.

import { useEffect, useState } from "react";

import { listProjects, type PortfolioRow } from "./client";

/** Coarse research verdict derived from the free-text decision string. */
export type Verdict = "go" | "hold" | "nogo";

export interface ResearchedParcel {
  id: string;
  name: string;
  location: string;
  readiness: number;
  /** Raw decision string from the report, e.g. "Hold". */
  decision: string;
  verdict: Verdict;
  longitude: number;
  latitude: number;
}

/** Decision verdict → color token (green / amber / red family). */
export const verdictColorVar: Record<Verdict, string> = {
  go: "var(--color-go)",
  hold: "var(--color-hold)",
  nogo: "var(--color-nogo)",
};

/** Maps a free-text decision to its verdict. "no-go" contains "go", so the
 *  negative form is tested first; anything unrecognized lands on "hold"
 *  (amber) rather than being read as an endorsement. */
export function decisionVerdict(decision: string): Verdict {
  const d = decision.toLowerCase();
  if (/no[- ]?go|reject|stop|kill|abandon/.test(d)) return "nogo";
  if (/\bgo\b|proceed|approve|advance/.test(d)) return "go";
  return "hold";
}

/** The API row shape — PortfolioRow plus the id/coordinate fields the
 *  backend includes (and may one day populate). */
interface ResearchedRow extends PortfolioRow {
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  lon?: number;
}

/** Explicit coordinates on the row beat geocoding, when present and sane. */
function explicitCoords(row: ResearchedRow): [number, number] | null {
  const lat = row.latitude ?? row.lat;
  const lng = row.longitude ?? row.lng ?? row.lon;
  if (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  ) {
    return [lng, lat];
  }
  return null;
}

// Nominatim geocoder (jsonv2, US-only, no key) — same pattern as the parcels
// search. Results are cached in module state, keyed by normalized location,
// so duplicate locations across rows cost one request total.
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const geocodeCache = new Map<string, Promise<[number, number] | null>>();

function geocodeLocation(location: string): Promise<[number, number] | null> {
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
      return null; // Geocoder hiccups are silent — the row simply gets no dot.
    }
  })();

  geocodeCache.set(key, promise);
  return promise;
}

async function resolveAll(): Promise<ResearchedParcel[]> {
  const rows = (await listProjects()) as ResearchedRow[];
  const resolved = await Promise.all(
    rows.map(async (row, i): Promise<ResearchedParcel | null> => {
      const coords =
        explicitCoords(row) ??
        (row.location ? await geocodeLocation(row.location) : null);
      if (!coords) return null;
      return {
        id: row.id ?? `row-${i}`,
        name: row.project,
        location: row.location,
        readiness: row.readiness,
        decision: row.decision,
        verdict: decisionVerdict(row.decision),
        longitude: coords[0],
        latitude: coords[1],
      };
    }),
  );
  return resolved.filter((p): p is ResearchedParcel => p !== null);
}

/** Session-level cache of the full fetch+geocode pipeline (see header). */
let parcelsCache: Promise<ResearchedParcel[]> | null = null;

function loadResearchedParcels(): Promise<ResearchedParcel[]> {
  if (!parcelsCache) {
    parcelsCache = resolveAll().catch(() => {
      parcelsCache = null; // Failures are not sticky — next mount retries.
      return [];
    });
  }
  return parcelsCache;
}

/** Researched parcels with resolved coordinates. Empty until loaded, and
 *  stays empty when the backend or geocoder is unreachable — the map then
 *  shows nothing extra, never fake dots. */
export function useResearchedParcels(): ResearchedParcel[] {
  const [parcels, setParcels] = useState<ResearchedParcel[]>([]);
  useEffect(() => {
    let live = true;
    void loadResearchedParcels().then((rows) => {
      if (live) setParcels(rows);
    });
    return () => {
      live = false;
    };
  }, []);
  return parcels;
}
