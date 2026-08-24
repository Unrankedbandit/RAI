/**
 * Project-parcel auto-select for the project Map tab.
 *
 * A project that ran from the parcel viewer carries its parcel in the
 * report/project strings — e.g. project "Parcel 040016011 — Ventura County"
 * or location "Ventura County, CA — parcel APN 040016011". This module
 * extracts the APN + county from those strings and looks the parcel up with
 * the SAME county GIS search machinery the parcels page uses
 * (lib/parcels/counties.searchParcels + the identify flow's normalize).
 *
 * Honesty guard: no parseable APN/county or no GIS hit → null. Callers fall
 * back to the geocoded county view and say so — never a fake polygon.
 */

import { countyByName, searchParcels, type ParcelResult } from "./counties";

/**
 * "X County" out of a project/location string. Same extraction pattern as
 * the existing parseCounty in components/project/overview/CountyCodesPanel —
 * kept local so this lib has no dependency on a component module.
 */
export function parseCounty(text: string): string | null {
  const match = text.match(
    /([A-Z][A-Za-z.'-]*(?: [A-Z][A-Za-z.'-]*)* County)\b/,
  );
  return match ? match[1] : null;
}

// Labeled forms: "parcel APN 040016011", "Parcel 040016011", "APN: 040-016-011".
const LABELED_APN_RE =
  /\b(?:APN|parcel)\s*[:#]?\s*(?:APN\s*[:#]?\s*)?([0-9][0-9-]{5,})/i;
// Fallback: a bare long digit run ("040016011") or dashed APN ("040-016-011").
const BARE_APN_RE = /\b([0-9]{3}(?:-[0-9]{2,4}){1,3}|[0-9]{8,})\b/;

/** Normalized digits-only APN, or null when the string carries none. */
function extractApn(text: string): string | null {
  const labeled = LABELED_APN_RE.exec(text);
  const raw = labeled?.[1] ?? (labeled ? null : BARE_APN_RE.exec(text)?.[1]);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
}

export interface ProjectParcelQuery {
  /** Normalized digits-only APN, or null when no parcel reference exists. */
  apn: string | null;
  /** Canonical county name from lib/parcels/counties (CA-only machinery). */
  county: string | null;
}

/**
 * Scan the report/project strings (project name, location, …) for the parcel
 * the project ran on. First APN and first known CA county win.
 */
export function extractParcelQuery(
  strings: Array<string | null | undefined>,
): ProjectParcelQuery {
  let apn: string | null = null;
  let county: string | null = null;
  for (const text of strings) {
    if (!text) continue;
    apn ??= extractApn(text);
    if (!county) {
      const named = parseCounty(text);
      const cfg = named
        ? countyByName(named.replace(/\s+County$/, ""))
        : undefined;
      if (cfg) county = cfg.name;
    }
    if (apn && county) break;
  }
  return { apn, county };
}

/**
 * The parcels page's lookup: county GIS APN/address search (counties.ts
 * searchParcels — ArcGIS/Socrata, schema-checked fields, never throws). Only
 * results with real geometry qualify; an exact digit-normalized APN match is
 * preferred over the county LIKE search's looser neighbours.
 */
export async function lookupProjectParcel(
  query: ProjectParcelQuery,
): Promise<ParcelResult | null> {
  if (!query.apn || !query.county) return null;
  const results = await searchParcels(query.county, query.apn);
  const withGeometry = results.filter((r) => r.geometry !== null);
  if (withGeometry.length === 0) return null;
  const exact = withGeometry.find(
    (r) => (r.apn ?? "").replace(/\D/g, "") === query.apn,
  );
  return exact ?? withGeometry[0];
}

/** [west, south, east, north] bounds of any GeoJSON geometry. */
export function geometryBbox(
  geom: GeoJSON.Geometry,
): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const [x, y] = coords as [number, number];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    coords.forEach(walk);
  };
  walk((geom as { coordinates?: unknown }).coordinates);
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

/**
 * Bbox-center of a geometry — the site-dot target when the project carries
 * no explicit coordinates, so the marker sits ON the auto-selected parcel.
 */
export function geometryCenter(geom: GeoJSON.Geometry): [number, number] | null {
  const bbox = geometryBbox(geom);
  if (!bbox) return null;
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}
