/**
 * FROZEN CONTRACT — instant viability preview for a selected parcel.
 * Builder B2 implements the internals (data fetchers + formula); the rail UI
 * (B3) builds against these exports. Do not change the signatures.
 *
 * Scoring doctrine (research report 03): the preview is a POINT-SAMPLED
 * first-pass signal, honestly degraded — never presented as the real score.
 * The full pipeline (documents + cross-examination) stays the authority.
 */
import type { ParcelResult } from "./counties";

/** 0..1 driver sub-scores shown as the "why" bars. */
export interface PreviewDrivers {
  /** Open/undeveloped land-cover at the parcel centroid (NLCD classes). */
  openSpace: number;
  /** Parcel size vs utility-scale thresholds (40 acres = full marks). */
  acreageFit: number;
  /** Terrain at the centroid (USGS EPQS-derived slope estimate). */
  slopeOk: number;
}

export interface PreviewScore {
  /** 0..100. */
  score: number;
  /** "No-go" | "Poor" | "Marginal" | "Promising" | "Go" */
  verdict: string;
  drivers: PreviewDrivers;
  /** Data sources that answered, e.g. ["NLCD land cover", "USGS elevation"]. */
  sources: string[];
  /** Signals that failed or are missing — shown honestly in the UI. */
  degraded: string[];
}

// ---------------------------------------------------------------------------
// Internals (B2). Keyless + CORS-open services only; everything fetch-based.
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 8000;

/** USGS EPQS — elevation at a point, keyless, CORS: *. */
const EPQS_URL = (lon: number, lat: number) =>
  `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}` +
  `&units=Meters&wkid=4326&includeHorizontalError=false`;

/**
 * MRLC GeoServer WMS GetFeatureInfo on NLCD 2021 (CONUS), keyless, CORS: *.
 * A ~200 m window around the point, sampled at the center pixel.
 */
const NLCD_WMS_URL = (lon: number, lat: number) => {
  const d = 0.001; // ~100 m half-window in degrees
  const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
  return (
    `https://www.mrlc.gov/geoserver/mrlc_display/wms?SERVICE=WMS&VERSION=1.1.1` +
    `&REQUEST=GetFeatureInfo&LAYERS=NLCD_2021_Land_Cover_L48` +
    `&QUERY_LAYERS=NLCD_2021_Land_Cover_L48&BBOX=${bbox}&FEATURE_COUNT=1` +
    `&HEIGHT=101&WIDTH=101&INFO_FORMAT=application/json&SRS=EPSG:4326&X=50&Y=50`
  );
};

/** NLCD classes treated as open/buildable terrain for the preview. */
const NLCD_OPEN = new Set([31, 52, 71, 81, 82]); // barren, scrub, herbaceous, hay/pasture, cultivated
/** NLCD developed classes (any intensity). */
const NLCD_DEVELOPED = new Set([21, 22, 23, 24]);
/** NLCD classes where utility-scale solar is effectively unbuildable:
 *  open water (11) and wetlands (90 woody / 95 emergent herbaceous) — a
 *  permitting kill-shot, not a "medium". Forest (41–43) stays 0.5: clearing
 *  is expensive but lawful. */
const NLCD_UNBUILDABLE = new Set([11, 90, 95]);

/** ~80 m sampling offsets for the EPQS slope estimate. */
const SLOPE_OFFSET_M = 80;
const METERS_PER_DEG_LAT = 111_320;

/** Per-APN in-memory cache — re-clicking a parcel never refetches. */
const previewCache = new Map<string, Promise<PreviewScore | null>>();

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Elevation (meters) at one point via USGS EPQS. Throws on failure. */
async function epqsElevation(lon: number, lat: number): Promise<number> {
  const res = await fetchWithTimeout(EPQS_URL(lon, lat));
  if (!res.ok) throw new Error(`EPQS HTTP ${res.status}`);
  const data = (await res.json()) as { value?: unknown };
  const v = Number(data?.value);
  // EPQS answers its no-data sentinel (-1000000) with HTTP 200 — without this
  // guard a coverage-edge sample reads as a million-percent "gradient".
  if (!Number.isFinite(v) || Math.abs(v) > 100_000)
    throw new Error("EPQS returned no elevation value");
  return v;
}

/**
 * Max gradient (%) at the centroid: sample the centroid plus 4 offset points
 * (~80 m N/S/E/W) and take the steepest centroid→offset rise. Throws when the
 * centroid or every offset sample fails.
 */
async function epqsMaxSlopePct(lon: number, lat: number): Promise<number> {
  const dLat = SLOPE_OFFSET_M / METERS_PER_DEG_LAT;
  const dLon = SLOPE_OFFSET_M / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  const points: Array<[number, number]> = [
    [lon, lat],
    [lon + dLon, lat],
    [lon - dLon, lat],
    [lon, lat + dLat],
    [lon, lat - dLat],
  ];
  const results = await Promise.allSettled(points.map(([x, y]) => epqsElevation(x, y)));
  const center = results[0];
  if (center.status !== "fulfilled") throw new Error("EPQS centroid sample failed");
  let maxGradient = 0;
  let offsets = 0;
  for (const r of results.slice(1)) {
    if (r.status !== "fulfilled") continue;
    offsets += 1;
    const gradient = (Math.abs(r.value - center.value) / SLOPE_OFFSET_M) * 100;
    if (gradient > maxGradient) maxGradient = gradient;
  }
  if (offsets === 0) throw new Error("EPQS offset samples failed");
  return maxGradient;
}

/** NLCD 2021 land-cover class at a point (PALETTE_INDEX). Throws on failure. */
async function nlcdClassAt(lon: number, lat: number): Promise<number> {
  const res = await fetchWithTimeout(NLCD_WMS_URL(lon, lat));
  if (!res.ok) throw new Error(`NLCD WMS HTTP ${res.status}`);
  const data = (await res.json()) as {
    features?: Array<{ properties?: { PALETTE_INDEX?: unknown } }>;
  };
  const cls = Number(data?.features?.[0]?.properties?.PALETTE_INDEX);
  if (!Number.isFinite(cls)) throw new Error("NLCD WMS returned no class");
  return cls;
}

/**
 * Coarse open-space proxy from county land-use text, used only when the NLCD
 * lookup cannot answer (no centroid or service failure).
 */
function landUseOpenSpaceProxy(landUse: string): number {
  const t = landUse.toLowerCase();
  if (/ag|farm|crop|range|pasture|grazing|open/.test(t)) return 0.8;
  if (/vacant/.test(t)) return 0.7;
  if (/residential|commercial|industrial/.test(t)) return 0.1;
  return 0.4;
}

// NOTE: duplicated in scoreRamp.ts (scoreVerdict) for chips/legend — the two
// MUST stay identical. (Not imported: this file is executed directly by Node
// test harnesses, which need explicit extensions on value imports.)
function verdictFor(score: number): string {
  if (score <= 0) return "No-go";
  if (score < 25) return "Poor";
  if (score < 50) return "Marginal";
  if (score < 75) return "Promising";
  return "Go";
}

function cacheKey(parcel: ParcelResult, centroid: [number, number] | null): string {
  if (parcel.apn) return `${parcel.county}:${parcel.apn}`;
  if (centroid) return `${parcel.county}:${centroid[0].toFixed(6)},${centroid[1].toFixed(6)}`;
  return `${parcel.county}:${parcel.address ?? "unknown"}`;
}

async function computePreview(
  parcel: ParcelResult,
  centroid: [number, number] | null,
): Promise<PreviewScore | null> {
  const sources: string[] = [];
  const degraded: string[] = [];
  // Tracks which drivers came from real data vs pure defaults.
  let usableSignals = 0;

  // --- Acreage fit (local attribute, no fetch) ----------------------------
  let acreageFit: number;
  if (typeof parcel.acres === "number" && Number.isFinite(parcel.acres) && parcel.acres > 0) {
    acreageFit = Math.min(parcel.acres / 40, 1);
    usableSignals += 1;
  } else {
    acreageFit = 0.3;
    degraded.push("Parcel acreage missing — acreage fit assumed 0.3");
  }

  // --- Remote drivers, bounded in parallel --------------------------------
  const [nlcd, slope] = await Promise.allSettled([
    centroid ? nlcdClassAt(centroid[0], centroid[1]) : Promise.reject(new Error("no centroid")),
    centroid
      ? epqsMaxSlopePct(centroid[0], centroid[1])
      : Promise.reject(new Error("no centroid")),
  ]);

  // --- Open space (NLCD at centroid; land-use text proxy as fallback) -----
  let openSpace: number;
  if (nlcd.status === "fulfilled") {
    const cls = nlcd.value;
    openSpace = NLCD_OPEN.has(cls)
      ? 1
      : NLCD_DEVELOPED.has(cls) || NLCD_UNBUILDABLE.has(cls)
        ? 0
        : 0.5;
    sources.push("NLCD land cover");
    usableSignals += 1;
  } else if (parcel.landUse) {
    openSpace = landUseOpenSpaceProxy(parcel.landUse);
    degraded.push(
      centroid
        ? `NLCD land-cover lookup failed — open space inferred from land-use text ("${parcel.landUse}")`
        : `No parcel centroid — open space inferred from land-use text ("${parcel.landUse}")`,
    );
    usableSignals += 1;
  } else {
    openSpace = 0.4;
    degraded.push(
      centroid
        ? "NLCD land-cover lookup failed and no land-use text — open space assumed 0.4"
        : "No parcel centroid and no land-use text — open space assumed 0.4",
    );
  }

  // --- Slope (USGS EPQS point samples) ------------------------------------
  let slopeOk: number;
  if (slope.status === "fulfilled") {
    slopeOk = clamp01(1 - slope.value / 10);
    sources.push("USGS elevation (EPQS)");
    usableSignals += 1;
  } else {
    slopeOk = 0.5;
    degraded.push(
      centroid
        ? "USGS elevation lookup failed — slope assumed flat-ish (0.5)"
        : "No parcel centroid — slope assumed flat-ish (0.5)",
    );
  }

  if (usableSignals === 0) return null;

  const score = Math.round(100 * (0.5 * openSpace + 0.3 * acreageFit + 0.2 * slopeOk));
  return {
    score,
    verdict: verdictFor(score),
    drivers: { openSpace, acreageFit, slopeOk },
    sources,
    degraded,
  };
}

/**
 * Compute the instant preview for a parcel. Returns null only when nothing
 * usable answered at all. Never throws — failures land in `degraded`.
 */
export async function previewScore(
  parcel: ParcelResult,
  centroid: [number, number] | null,
): Promise<PreviewScore | null> {
  const key = cacheKey(parcel, centroid);
  const cached = previewCache.get(key);
  if (cached) return cached;
  const pending = computePreview(parcel, centroid).catch(() => null);
  // A null (one bad network moment) must not poison the cache — evict it so
  // re-selecting the parcel retries instead of showing "unavailable" forever.
  const guarded = pending.then((result) => {
    if (result === null) previewCache.delete(key);
    return result;
  });
  previewCache.set(key, guarded);
  return guarded;
}
