"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MapGL, { Layer, Marker, Source } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import type { Feature } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  analyze,
  getGridNearest,
  gridAccessClosest,
  postGridScan,
  type GridNearest,
} from "@/lib/agent/client";
import { slugify } from "@/lib/agent/liveStore";
import { BASEMAP_STYLES } from "@/components/maps/basemaps";
import {
  MapLayersControl,
  useMapLayers,
} from "@/components/maps/MapLayersControl";
import { ParcelRail } from "@/components/parcels/ParcelRail";
import { recordRecent, type SavedParcel } from "@/lib/parcels/watchlist";
import {
  COUNTIES,
  STATEWIDE_COUNTY_NAME,
  countyNameAtPoint,
  queryParcelAtPoint,
  searchParcels,
  type CountyConfig,
  type ParcelResult,
} from "@/lib/parcels/counties";

/**
 * California Parcel Viewer — full-height MapLibre surface.
 * Keyless CARTO Positron basemap, a Regrid raster tile overlay for parcel
 * boundaries (zoom 13+), click-to-identify + APN/address text search against
 * the county open-GIS endpoints / CA DWR statewide mosaic (lib/parcels), the
 * selected parcel highlighted in brand orange, and the right-side ParcelRail
 * (selected parcel, watchlist, recent searches). Basemap switching (Positron
 * / Esri satellite / dark) plus GIS overlay rasters are owned by the shared
 * layers tool (components/maps/MapLayersControl) rendered inside the map,
 * persisted under the "parcels" storage key; and deep-linkable state:
 * ?lat&lng&zoom (&apn&county) replays on load, the address bar tracks the
 * camera via history.replaceState, and "Copy link" copies a parcel deep link.
 * Client-only — ParcelViewerClient loads this via next/dynamic ssr:false.
 */

// Basemap styles now live in the shared components/maps module (keyless,
// attribution kept). Swapping mapStyle re-mounts the child Sources/Layers
// onto the new style (react-map-gl re-adds them automatically), so the
// Regrid overlay and the selection highlight survive a basemap switch.

// Regrid nationwide parcel boundaries, served as ArcGIS raster tiles.
const REGRID_TILES =
  "https://tiles.arcgis.com/tiles/KzeiCaQsMoeCfoCq/arcgis/rest/services/Regrid_Nationwide_Parcel_Boundaries_v1/MapServer/tile/{z}/{y}/{x}";

const ORANGE = "#ff8400";
// Neutral near-black (--color-watch) — grid distance connector/label, a
// data-viz element that must not read as selection (orange), status
// (red/green), or blue (brand ink #0b0829 is navy-leaning on canvas).
const INK = "#1e1e26";

/** Short mobile-strip labels for path verdict codes (the rail carries the
 *  full verdict copy). */
const VERDICT_LABEL: Record<string, string> = {
  clear_rural: "Clear rural",
  review: "Review",
  constrained_urban: "Constrained",
  municipal_path: "Municipal path",
  protected_conflict: "Protected",
  remote: "Remote",
};

/** Tap-point glyphs for the grid connection diagram: square = existing
 *  substation bus, diamond = new switchyard a line tap requires. Returns
 *  ImageData because MapLibre's addImage types don't accept a canvas. */
function makeNodeImage(kind: "substation" | "line-tap" | "entry"): ImageData {
  const S = 28;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return new ImageData(S, S);
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  if (kind === "substation") {
    ctx.rect(4, 4, S - 8, S - 8); // bus node
  } else if (kind === "line-tap") {
    ctx.moveTo(S / 2, 3); // switchyard diamond
    ctx.lineTo(S - 3, S / 2);
    ctx.lineTo(S / 2, S - 3);
    ctx.lineTo(3, S / 2);
    ctx.closePath();
  } else {
    ctx.moveTo(S / 2, 3); // local-grid entry triangle (points up-corridor)
    ctx.lineTo(S - 3, S - 3);
    ctx.lineTo(3, S - 3);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 3.5, 0, Math.PI * 2); // ink core
  ctx.fillStyle = INK;
  ctx.fill();
  return ctx.getImageData(0, 0, S, S);
}

// Brand-orange crosshair/dot cursor for the map canvas (inline SVG data-uri).
// Passed to MapGL's `cursor` prop (sets it on the canvas) and inherited from
// the map style, with `crosshair` as the browser fallback.
const MAP_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><circle cx='10' cy='10' r='5' fill='none' stroke='%23ff8400' stroke-width='2'/><circle cx='10' cy='10' r='1.5' fill='%23ff8400'/></svg>") 10 10, crosshair`;

// Fit California on load.
const CA_CENTER: [number, number] = [-119.4, 37.2];
const CA_ZOOM = 5.2;

// Nominatim geocoder (jsonv2, US-only, no key) — the statewide text-search
// path: geocode the query to a point, then identify the parcel there.
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

interface GeocodeHit {
  lat: string;
  lon: string;
  display_name?: string;
}

async function geocodePlace(text: string): Promise<GeocodeHit | null> {
  // CA-biased and bounded: this viewer's parcel data is California-only, so a
  // geocode outside the state can never identify a parcel.
  const res = await fetch(
    `${NOMINATIM}?format=jsonv2&q=${encodeURIComponent(text)}&countrycodes=us&viewbox=-124.4,42.0,-114.1,32.5&bounded=1&limit=1`,
    { headers: { accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`geocoder ${res.status}`);
  const rows = (await res.json()) as GeocodeHit[];
  return rows[0] ?? null;
}

// Approximate geographic centers for all 58 CA counties — fly-to targets.
const COUNTY_CENTERS: Record<string, [number, number]> = {
  Alameda: [-121.9, 37.65],
  Alpine: [-119.8, 38.6],
  Amador: [-120.7, 38.45],
  Butte: [-121.6, 39.65],
  Calaveras: [-120.55, 38.2],
  Colusa: [-122.25, 39.2],
  "Contra Costa": [-121.95, 37.93],
  "Del Norte": [-123.95, 41.75],
  "El Dorado": [-120.65, 38.75],
  Fresno: [-119.8, 36.75],
  Glenn: [-122.4, 39.6],
  Humboldt: [-123.9, 40.65],
  Imperial: [-115.35, 33.0],
  Inyo: [-117.8, 36.55],
  Kern: [-118.7, 35.35],
  Kings: [-119.8, 36.1],
  Lake: [-122.75, 39.1],
  Lassen: [-120.65, 40.65],
  "Los Angeles": [-118.25, 34.32],
  Madera: [-119.75, 37.2],
  Marin: [-122.75, 38.05],
  Mariposa: [-119.9, 37.55],
  Mendocino: [-123.4, 39.45],
  Merced: [-120.7, 37.2],
  Modoc: [-120.7, 41.55],
  Mono: [-118.9, 37.9],
  Monterey: [-121.3, 36.25],
  Napa: [-122.35, 38.5],
  Nevada: [-120.85, 39.3],
  Orange: [-117.75, 33.7],
  Placer: [-120.85, 39.05],
  Plumas: [-120.8, 40.0],
  Riverside: [-115.95, 33.75],
  Sacramento: [-121.35, 38.45],
  "San Benito": [-121.05, 36.6],
  "San Bernardino": [-116.45, 34.85],
  "San Diego": [-116.75, 33.0],
  "San Francisco": [-122.44, 37.76],
  "San Joaquin": [-121.3, 37.9],
  "San Luis Obispo": [-120.4, 35.4],
  "San Mateo": [-122.35, 37.45],
  "Santa Barbara": [-120.0, 34.65],
  "Santa Clara": [-121.7, 37.25],
  "Santa Cruz": [-122.05, 37.05],
  Shasta: [-122.0, 40.75],
  Sierra: [-120.5, 39.6],
  Siskiyou: [-122.55, 41.6],
  Solano: [-122.0, 38.25],
  Sonoma: [-122.85, 38.5],
  Stanislaus: [-120.95, 37.55],
  Sutter: [-121.7, 39.05],
  Tehama: [-122.3, 40.1],
  Trinity: [-123.1, 40.65],
  Tulare: [-118.8, 36.2],
  Tuolumne: [-119.95, 38.05],
  Ventura: [-119.1, 34.45],
  Yolo: [-121.9, 38.7],
  Yuba: [-121.35, 39.35],
};

// Zoom 10 suits most counties; the compact city-county gets 11.
const COUNTY_ZOOMS: Record<string, number> = { "San Francisco": 11 };

const STATUS_LABEL: Record<CountyConfig["status"], string> = {
  live: "Live",
  partial: "Partial",
  "mosaic-only": "Mosaic",
};

type PanelState =
  | { status: "idle" }
  | { status: "loading"; county: string }
  | { status: "empty" }
  | { status: "error" }
  | { status: "found"; result: ParcelResult; queriedCounty: string };

/** Bbox-center of any GeoJSON geometry — good enough for fly-to targets. */
function geometryCenter(
  geom: GeoJSON.Geometry | null,
): [number, number] | null {
  if (!geom) return null;
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
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** Shape the watchlist's recordRecent expects (fallbackKey = search text / click coords). */
function toSavedParcel(
  result: ParcelResult,
  fallbackKey: string,
  lng?: number,
  lat?: number,
): SavedParcel {
  return {
    key: result.apn ?? result.address ?? fallbackKey,
    county: result.county,
    apn: result.apn,
    address: result.address,
    acres: result.acres,
    landUse: result.landUse,
    lng,
    lat,
    savedAt: Date.now(),
  };
}

export default function ParcelViewer() {
  const router = useRouter();
  const mapRef = useRef<MapRef | null>(null);
  // Latest-request-wins guard so stale responses never overwrite a newer click.
  const requestRef = useRef(0);

  const [selectedCounty, setSelectedCounty] = useState<string>(
    STATEWIDE_COUNTY_NAME,
  );
  const [panel, setPanel] = useState<PanelState>({ status: "idle" });
  // Nearest-grid lookup for the selected parcel (GRID V1 §4). Null until the
  // backend answers — silent degradation: no connector line, no rail chip.
  const [gridNearest, setGridNearest] = useState<GridNearest | null>(null);
  // Movable gen-tie origin (GRID V1 §6b, simplified 2026-08-24): null =
  // the parcel centroid. The backend origin scan (§6a) auto-sites it at
  // the best (usually closest-edge) point on the parcel; the user adjusts
  // by dragging the origin marker (originCustom=true). No candidate dots
  // — the scan result applies silently. Scan failure leaves origin null
  // (centroid) and the feature hides.
  const [origin, setOrigin] = useState<[number, number] | null>(null);
  const [originCustom, setOriginCustom] = useState(false);
  // Mobile bottom-sheet: a selection starts COLLAPSED (title + chips strip)
  // so the map and the parcel stay visible; tap the strip for full details.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  // Why the last search came up empty (no match vs county has no attribute
  // search) — shown as a small caption, since the rail only gets panelStatus.
  const [searchNote, setSearchNote] = useState<string | null>(null);
  // Typeahead: live suggestions under the search box while typing.
  const [suggestions, setSuggestions] = useState<ParcelResult[] | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [activeOption, setActiveOption] = useState(0);
  const suggestSeqRef = useRef(0);
  // Shared layers tool: basemap (satellite default) + GIS overlay toggles,
  // persisted per page under this storage key.
  const mapLayers = useMapLayers("parcels");
  // "Copy link" confirmation — briefly swaps the button label to "Copied".
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce handle for the moveend → URL writer.
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One-shot guards for the deep-link bootstrap (below).
  const deepLinkRef = useRef(false);
  const suggestSuppressRef = useRef(false);

  const sortedCounties = useMemo(
    () => [...COUNTIES].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const countyByName = useMemo(
    () => new Map(sortedCounties.map((c) => [c.name, c])),
    [sortedCounties],
  );
  const counts = useMemo(
    () => ({
      live: COUNTIES.filter((c) => c.status === "live").length,
      partial: COUNTIES.filter((c) => c.status === "partial").length,
      mosaic: COUNTIES.filter((c) => c.status === "mosaic-only").length,
    }),
    [],
  );

  const handleCountyChange = useCallback(
    (name: string) => {
      setSelectedCounty(name);
      setPanel({ status: "idle" });
      setSearchNote(null);
      setSuggestions(null);
      setSuggestOpen(false);
      setSearchText("");
      requestRef.current++; // cancel any in-flight identify
      suggestSeqRef.current++; // cancel any in-flight suggestion fetch
      const statewide = name === STATEWIDE_COUNTY_NAME;
      mapRef.current?.flyTo({
        center: statewide ? CA_CENTER : (COUNTY_CENTERS[name] ?? CA_CENTER),
        zoom: statewide ? CA_ZOOM : (COUNTY_ZOOMS[name] ?? 10),
        duration: 1200,
      });
    },
    [mapRef],
  );

  const handleMapClick = useCallback(
    async (lng: number, lat: number) => {
      const req = ++requestRef.current;
      // Route the click to the county under the cursor (not the dropdown's
      // county): in statewide mode every click used to hit the DWR mosaic,
      // which 500s after ~60 s when sick — selection felt broken. County-
      // direct endpoints answer envelope queries in well under a second.
      const clickedCounty = countyNameAtPoint(lng, lat);
      const cfg = countyByName.get(clickedCounty ?? selectedCounty);
      // Mosaic-only (or endpoint-less) counties resolve via the statewide mosaic.
      const queryCounty =
        !cfg || cfg.status === "mosaic-only" || !cfg.endpoint
          ? STATEWIDE_COUNTY_NAME
          : cfg.name;
      setPanel({ status: "loading", county: queryCounty });
      setSearchNote(null);
      try {
        const result = await queryParcelAtPoint(queryCounty, lng, lat);
        if (req !== requestRef.current) return;
        setPanel(
          result
            ? { status: "found", result, queriedCounty: queryCounty }
            : { status: "empty" },
        );
        if (result) {
          recordRecent(
            toSavedParcel(result, `${lat.toFixed(5)},${lng.toFixed(5)}`, lng, lat),
          );
        }
      } catch {
        if (req !== requestRef.current) return;
        setPanel({ status: "error" });
      }
    },
    [selectedCounty, countyByName],
  );

  // Text search runs against the currently selected county only.
  const countySearchSupported =
    selectedCounty !== STATEWIDE_COUNTY_NAME &&
    !!countyByName.get(selectedCounty)?.endpoint &&
    countyByName.get(selectedCounty)?.status !== "mosaic-only";

  // Shared by handleSearch (submit) and dropdown picks: select the parcel,
  // fly to its centroid, record it in the rail's Recent list.
  const applySearchResult = useCallback(
    (p: ParcelResult, fallbackKey: string) => {
      setPanel({ status: "found", result: p, queriedCounty: p.county });
      setSearchNote(null);
      const center = geometryCenter(p.geometry);
      if (center) {
        mapRef.current?.flyTo({ center, zoom: 16, duration: 1200 });
      }
      recordRecent(toSavedParcel(p, fallbackKey, center?.[0], center?.[1]));
    },
    [],
  );

  // Debounced typeahead: as the user types (3+ chars), query the county and
  // offer the matches as a dropdown — pick one instead of submitting blind.
  // All setState happens inside the timeout (react-hooks/set-state-in-effect).
  useEffect(() => {
    const text = searchText.trim();
    const seq = ++suggestSeqRef.current;
    const t = setTimeout(
      async () => {
        if (seq !== suggestSeqRef.current) return; // stale keystroke
        // One-shot: the deep-link bootstrap sets searchText programmatically —
        // don't pop the suggestion dropdown over the replayed search.
        if (suggestSuppressRef.current) {
          suggestSuppressRef.current = false;
          return;
        }
        if (text.length < 3) {
          setSuggestions(null);
          setSuggestOpen(false);
          setSuggestLoading(false);
          return;
        }
        if (!countySearchSupported) {
          setSuggestions([]);
          setSuggestLoading(false);
          setSuggestOpen(true);
          return;
        }
        setSuggestLoading(true);
        setSuggestOpen(true);
        const results = await searchParcels(selectedCounty, text);
        if (seq !== suggestSeqRef.current) return; // stale keystroke
        setSuggestions(results);
        setActiveOption(0);
        setSuggestLoading(false);
      },
      text.length < 3 ? 0 : 350,
    );
    return () => clearTimeout(t);
  }, [searchText, selectedCounty, countySearchSupported]);

  const pickSuggestion = useCallback(
    (p: ParcelResult) => {
      // A pick supersedes any in-flight map click and pending typeahead fetch.
      requestRef.current++;
      suggestSeqRef.current++;
      applySearchResult(p, p.apn ?? p.address ?? searchText.trim());
      setSuggestOpen(false);
      setSuggestions(null);
    },
    [applySearchResult, searchText],
  );

  // Submit logic, callable from the form (interactive — text from state) and
  // from the deep-link bootstrap (explicit text + county override, because a
  // mount-effect closure can't see the state it just set).
  const runSearch = useCallback(
    async (text: string, countyOverride?: string) => {
      const query = text.trim();
      if (!query) return;
      // Submitting cancels any pending debounced typeahead fetch.
      suggestSeqRef.current++;
      // If the dropdown is open with results, Enter picks the active option.
      // (Deep-link replays pass a countyOverride and skip this.)
      if (
        !countyOverride &&
        suggestOpen &&
        suggestions &&
        suggestions.length > 0
      ) {
        pickSuggestion(
          suggestions[Math.min(activeOption, suggestions.length - 1)],
        );
        return;
      }
      const req = ++requestRef.current;
      setSearchNote(null);
      const county = countyOverride ?? selectedCounty;
      const supported =
        county !== STATEWIDE_COUNTY_NAME &&
        !!countyByName.get(county)?.endpoint &&
        countyByName.get(county)?.status !== "mosaic-only";
      if (!supported) {
        // The statewide mosaic has no attribute search — geocode the text to
        // a point, fly there, and identify the parcel at that point instead.
        setPanel({ status: "loading", county });
        try {
          const hit = await geocodePlace(query);
          if (req !== requestRef.current) return;
          if (!hit) {
            setPanel({ status: "empty" });
            setSearchNote(
              `No place matched “${query}” — try an address or city, or pick a Live county for APN search.`,
            );
            return;
          }
          const lng = parseFloat(hit.lon);
          const lat = parseFloat(hit.lat);
          const result = await queryParcelAtPoint(
            STATEWIDE_COUNTY_NAME,
            lng,
            lat,
          );
          // Fly only after the second stale-guard — a superseded request must
          // not move the map either.
          if (req !== requestRef.current) return;
          mapRef.current?.flyTo({ center: [lng, lat], zoom: 16, duration: 1200 });
          if (!result) {
            setPanel({ status: "empty" });
            setSearchNote(
              `No parcel at “${hit.display_name ?? query}” in the statewide mosaic — try zooming in and clicking the parcel.`,
            );
            return;
          }
          applySearchResult(result, query);
        } catch {
          if (req !== requestRef.current) return;
          setPanel({ status: "error" });
          setSearchNote(
            "Place search failed — check the connection and try again.",
          );
        }
        return;
      }
      setPanel({ status: "loading", county });
      const results = await searchParcels(county, query);
      if (req !== requestRef.current) return;
      const first = results[0];
      if (!first) {
        setPanel({ status: "empty" });
        setSearchNote(`No parcels in ${county} match “${query}”.`);
        return;
      }
      applySearchResult(first, query);
    },
    [
      selectedCounty,
      countyByName,
      suggestOpen,
      suggestions,
      activeOption,
      pickSuggestion,
      applySearchResult,
    ],
  );

  const handleSearch = useCallback(
    () => runSearch(searchText),
    [runSearch, searchText],
  );

  // Kick the selected parcel into the agent pipeline; fall back to the plain
  // scanning page when the backend is down (same pattern as IntakeDropzone).
  const handleResearch = useCallback(
    async (p: ParcelResult) => {
      setPanel({ status: "loading", county: p.county });
      try {
        const { jobId } = await analyze({
          name: `Parcel ${p.apn ?? p.address ?? "unknown"} — ${p.acres ?? "?"} ac${p.landUse ? ` · ${p.landUse}` : ""}`,
          location: `${p.county} County, CA`,
          docs: [],
        });
        router.push(
          `/scanning?job=${jobId}&project=parcel-${slugify(p.apn ?? p.address ?? "unknown")}`,
        );
      } catch {
        setPanel({ status: "found", result: p, queriedCounty: p.county });
        router.push("/scanning");
      }
    },
    [router],
  );

  const handleFlyTo = useCallback(
    (lng: number, lat: number) => {
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 1200 });
      // A pick from the recent/watch list must SELECT the parcel on the map,
      // not just zoom — the same identify path a real click takes, after the
      // flight so the parcel tiles are under the point.
      window.setTimeout(() => void handleMapClick(lng, lat), 1250);
    },
    [handleMapClick],
  );

  const handleCloseSelected = useCallback(() => {
    setPanel({ status: "idle" });
  }, []);

  // --- Deep links ---------------------------------------------------------
  // URL shape: ?lat=..&lng=..&zoom=..[&apn=..&county=..]. All window access
  // lives in effects/handlers, never in render — even though ParcelViewerClient
  // already loads this component with ssr:false.

  // Bootstrap (mount, once): replay the link. `apn` wins when both apn and
  // lat/lng are present (copy-link URLs carry all five params — the APN+county
  // search is the canonical parcel reference and flies to the parcel itself;
  // lat/lng alone is the fallback view+identify replay).
  useEffect(() => {
    if (deepLinkRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const apn = params.get("apn")?.trim() || null;
    const countyParam = params.get("county")?.trim() || null;
    const lat = parseFloat(params.get("lat") ?? "");
    const lng = parseFloat(params.get("lng") ?? "");
    const zoom = parseFloat(params.get("zoom") ?? "");
    const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
    if (!apn && !hasPoint) {
      deepLinkRef.current = true; // nothing to replay — never re-check
      return;
    }
    // Deferred a tick: keeps setState out of the effect body
    // (react-hooks/set-state-in-effect) and lets MapGL's own mount effects
    // create the map first. The ref is consumed inside the callback (not
    // here), so a StrictMode double-invoke — whose cleanup clears the first
    // timeout — still lets the second run's timeout fire the replay.
    const t = setTimeout(() => {
      if (deepLinkRef.current) return;
      deepLinkRef.current = true;
      const county =
        countyParam &&
        (countyParam === STATEWIDE_COUNTY_NAME ||
          countyByName.has(countyParam))
          ? countyParam
          : null;
      if (apn) {
        // Pre-select the county first so the UI matches the replay…
        if (county) handleCountyChange(county);
        // …but runSearch also gets it as an explicit override, because this
        // closure still sees the pre-update selectedCounty. The APN goes into
        // the box for display; its typeahead dropdown is suppressed once.
        suggestSuppressRef.current = true;
        setSearchText(apn);
        void runSearch(apn, county ?? undefined);
        return;
      }
      // lat/lng replay: wait for the style to finish loading before moving
      // the camera, then identify the parcel via the normal click path.
      const go = () => {
        mapRef.current?.flyTo({
          center: [lng, lat],
          zoom: Number.isFinite(zoom) ? zoom : 15,
          duration: 1200,
        });
        void handleMapClick(lng, lat);
      };
      const map = mapRef.current;
      if (map && !map.loaded()) {
        map.once("load", go);
      } else {
        go();
      }
    }, 0);
    return () => clearTimeout(t);
  }, [countyByName, handleCountyChange, handleMapClick, runSearch]);

  // URL writer (debounced moveend): keep ?lat&lng&zoom in the address bar in
  // sync with the map, preserving any apn/county params already there, so the
  // current view is always shareable. Deliberately window.history.replaceState
  // instead of next/router — router.replace runs a React navigation (re-render
  // churn + scroll bookkeeping) on every pan for what is pure shareable state.
  const handleMoveEnd = useCallback(() => {
    if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    moveTimerRef.current = setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;
      const c = map.getCenter();
      const params = new URLSearchParams(window.location.search);
      params.set("lat", c.lat.toFixed(5));
      params.set("lng", c.lng.toFixed(5));
      params.set("zoom", map.getZoom().toFixed(2));
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?${params.toString()}`,
      );
    }, 400);
  }, []);

  // Copy a deep link for the selected parcel: apn + its county + the current
  // camera. Clipboard failure (permissions, insecure context) just logs and
  // keeps the label — the same URL stays in the address bar regardless.
  const handleCopyLink = useCallback(async () => {
    if (panel.status !== "found") return;
    const params = new URLSearchParams();
    const map = mapRef.current;
    if (map) {
      const c = map.getCenter();
      params.set("lat", c.lat.toFixed(5));
      params.set("lng", c.lng.toFixed(5));
      params.set("zoom", map.getZoom().toFixed(2));
    }
    const apn = panel.result.apn ?? panel.result.address;
    if (apn) params.set("apn", apn);
    params.set("county", panel.result.county);
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("Copy link failed:", err);
    }
  }, [panel]);

  // Cancel pending debounce/label-reset timers on unmount.
  useEffect(() => {
    return () => {
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // GeoJSON for the highlight layers — geometry:null results simply clear it.
  const selectedFeature = useMemo<Feature | null>(() => {
    if (panel.status !== "found" || !panel.result.geometry) return null;
    return { type: "Feature", geometry: panel.result.geometry, properties: {} };
  }, [panel]);

  // Effective gen-tie origin (GRID V1 §6b): the user's candidate pick or
  // marker drag, else the parcel centroid. Every grid analysis (nearest,
  // connector, corridor, rail) keys on this point.
  const effectiveOrigin = useMemo<[number, number] | null>(() => {
    if (panel.status !== "found") return null;
    return origin ?? geometryCenter(panel.result.geometry);
  }, [panel, origin]);

  // New selection → mobile sheet back to collapsed (deferred-tick idiom).
  useEffect(() => {
    const t = setTimeout(() => setSheetOpen(false), 0);
    return () => clearTimeout(t);
  }, [panel]);

  // Origin scan (GRID V1 §6a/6b, simplified): every selection change resets
  // the origin state and POSTs the parcel geometry once. The scan's `best`
  // candidate (best verdict, then shortest gen-tie — usually the parcel
  // edge nearest the access point) becomes the default origin, and its
  // ready-made analysis is applied directly (no second nearest round-trip).
  // Abort-guarded like the nearest lookup; a failed scan leaves the origin
  // at the centroid and the rail simply skips the origin line.
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setOrigin(null);
      setOriginCustom(false);
      if (panel.status !== "found" || !panel.result.geometry) return;
      const res = await postGridScan(panel.result.geometry, ctrl.signal);
      if (ctrl.signal.aborted || !res) return;
      const best =
        res.candidates.find((c) => c.id === res.best) ?? res.candidates[0];
      if (!best) return;
      setOrigin([best.point.lng, best.point.lat]);
      setGridNearest(best); // candidate payload IS the nearest-analysis shape
    }, 0);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [panel]);

  // Distance-to-grid lookup (GRID V1 §4/§6b): on every selection — and
  // every origin move (candidate pick or marker drag) — fetch the nearest
  // grid infrastructure for the EFFECTIVE origin. The cleanup aborts
  // any in-flight request on a new selection, and any panel change that
  // isn't "found" (deselect, new search, county switch) clears the result.
  // Deferred a tick so setState stays out of the effect body
  // (react-hooks/set-state-in-effect — the deep-link bootstrap's pattern).
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      if (panel.status !== "found" || !effectiveOrigin) {
        setGridNearest(null);
        return;
      }
      const res = await getGridNearest(
        effectiveOrigin[1],
        effectiveOrigin[0],
        ctrl.signal,
      );
      if (!ctrl.signal.aborted) setGridNearest(res);
    }, 0);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [panel, effectiveOrigin]);

  // Connector GeoJSON: dashed line parcel-centroid → nearest grid asset,
  // a midpoint point carrying the short distance label, and — when the
  // hookup (§2b) is known — a tap-point node glyph distinguishing the two
  // hookup shapes: square bus node (substation gen-tie) vs diamond (new
  // switchyard at a line tap). Null clears the source.
  const gridConnector = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (panel.status !== "found" || !gridNearest?.access) return null;
    const center = effectiveOrigin;
    const closest = gridAccessClosest(gridNearest);
    if (!center || !closest) return null;
    const from: [number, number] = center;
    const to: [number, number] = [closest.lng, closest.lat];
    const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const { distance_m, distance_mi } = gridNearest.access;
    const label =
      distance_mi < 0.1
        ? `${Math.round(distance_m)} m`
        : `${distance_mi.toFixed(1)} mi`;
    const features: GeoJSON.Feature[] = [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [from, to] },
        properties: {},
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: mid },
        properties: { label },
      },
    ];
    const hookup = gridNearest.hookup;
    const method = hookup?.method;
    const tap = hookup?.tap_point;
    if ((method === "substation" || method === "line-tap") && tap) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [tap.lng, tap.lat] },
        properties: {
          method, // icon-image id suffix: grid-node-substation / -line-tap
          methodLabel:
            method === "substation" ? "Substation" : "New switchyard",
        },
      });
    }
    return { type: "FeatureCollection", features };
  }, [panel, gridNearest, effectiveOrigin]);

  // Connection-corridor render (GRID V1 §5b/5c): the backend's path.render
  // FeatureCollection passes through verbatim — blocked subsegments, their
  // label midpoints, the municipal via-segment, and the local-grid entry
  // point. Null on any selection without a path key (older backends,
  // out-of-state), so the corridor Source simply never mounts — the same
  // silent-degradation pattern as the connector.
  const gridCorridor = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (panel.status !== "found") return null;
    return gridNearest?.path?.render ?? null;
  }, [panel, gridNearest]);

  // Rail explainer line (§6b, simplified): which point the grid analysis
  // describes — the scan's auto-sited closest point (the default), or a
  // manually dragged ("custom") origin. Null (renders nothing) before the
  // scan lands or when the scan is unavailable.
  const originLabel = useMemo<string | null>(() => {
    if (panel.status !== "found" || !origin) return null;
    return originCustom
      ? "Origin: custom — drag the dot on the parcel"
      : "Origin: closest point on parcel — drag the dot to adjust";
  }, [panel, origin, originCustom]);

  // Tap-point node glyphs (canvas-drawn, registered on the map): a square
  // "bus" node marks a substation gen-tie connection; a diamond marks the
  // NEW switchyard a line tap requires; a triangle marks the local-grid
  // entry point on a municipal path (§5c). White fill + ink stroke + ink
  // core reads on light and satellite basemaps, matching the
  // connector/label. Re-registered on styledata because a basemap switch
  // wipes map images.
  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const register = () => {
      if (!map.hasImage("grid-node-substation"))
        map.addImage("grid-node-substation", makeNodeImage("substation"));
      if (!map.hasImage("grid-node-line-tap"))
        map.addImage("grid-node-line-tap", makeNodeImage("line-tap"));
      if (!map.hasImage("grid-node-entry"))
        map.addImage("grid-node-entry", makeNodeImage("entry"));
    };
    register();
    map.on("styledata", register);
  }, [mapRef]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      <MapGL
        ref={mapRef}
        initialViewState={{
          longitude: CA_CENTER[0],
          latitude: CA_CENTER[1],
          zoom: CA_ZOOM,
        }}
        mapStyle={BASEMAP_STYLES[mapLayers.basemap]}
        // touchAction:none on the react-map-gl container (wraps the canvas
        // AND the marker/popup children) so mobile pinch/drag anywhere on the
        // map drives MapLibre instead of pinch-zooming the page. Desktop
        // (fine pointer) is unaffected.
        style={{ width: "100%", height: "100%", cursor: MAP_CURSOR, touchAction: "none" }}
        cursor={MAP_CURSOR}
        attributionControl={{ compact: true }}
        // No 3D tilt: right-drag (or Ctrl-drag) still rotates bearing (2D)
        // but no longer pitches; two-finger touch pitch off too.
        pitchWithRotate={false}
        touchPitch={false}
        onClick={(e) => void handleMapClick(e.lngLat.lng, e.lngLat.lat)}
        onMoveEnd={handleMoveEnd}
        onLoad={handleMapLoad}
      >
        {/* Shared layers tool FIRST: its overlay rasters must draw below the
            Regrid parcel boundaries and the selection highlight (react-map-gl
            appends declarative layers in render order). */}
        <MapLayersControl state={mapLayers} />
        {/* Parcel boundary overlay — only meaningful when zoomed in. */}
        <Source id="regrid-parcels" type="raster" tiles={[REGRID_TILES]} tileSize={256}>
          <Layer
            id="regrid-parcel-boundaries"
            type="raster"
            paint={{ "raster-opacity": 0.9 }}
            minzoom={13}
          />
        </Source>

        {/* Clicked parcel highlight (fill for polygons, dot for points). */}
        {selectedFeature && (
          <Source id="selected-parcel" type="geojson" data={selectedFeature}>
            <Layer
              id="selected-parcel-fill"
              type="fill"
              paint={{ "fill-color": ORANGE, "fill-opacity": 0.25 }}
            />
            <Layer
              id="selected-parcel-line"
              type="line"
              paint={{ "line-color": ORANGE, "line-width": 2 }}
            />
            <Layer
              id="selected-parcel-point"
              type="circle"
              filter={["==", ["geometry-type"], "Point"]}
              paint={{
                "circle-color": ORANGE,
                "circle-radius": 7,
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 2,
              }}
            />
          </Source>
        )}

        {/* Parcel→grid distance connector (dashed ink) + midpoint label.
            Draws only while a selection's nearest-grid lookup has a closest
            point; unmounting the Source clears it. The label font is a
            glyph-PBF fontstack (Open Sans Regular, hosted keyless by CARTO —
            now referenced by every basemap, see basemaps.ts), not a CSS
            font, so JetBrains Mono isn't available here. */}
        {gridConnector && (
          <Source id="grid-distance" type="geojson" data={gridConnector}>
            {/* White casing under the dashed ink core — the connector was
                unreadable on satellite basemaps at 1.5px. */}
            <Layer
              id="grid-distance-casing"
              type="line"
              filter={["==", ["geometry-type"], "LineString"]}
              paint={{
                "line-color": "#ffffff",
                "line-width": 5,
                "line-opacity": 0.85,
              }}
            />
            <Layer
              id="grid-distance-line"
              type="line"
              filter={["==", ["geometry-type"], "LineString"]}
              paint={{
                "line-color": INK,
                "line-width": 2.5,
                "line-opacity": 0.95,
                "line-dasharray": [2, 2],
              }}
            />
            <Layer
              id="grid-distance-label"
              type="symbol"
              filter={["has", "label"]}
              layout={{
                "text-field": ["get", "label"],
                "text-font": ["Open Sans Regular"],
                "text-size": 13,
                "text-offset": [0, -0.9],
              }}
              paint={{
                "text-color": INK,
                "text-halo-color": "#ffffff",
                "text-halo-width": 2,
              }}
            />
            {/* Tap-point node: square glyph + "Substation" for a gen-tie,
                diamond + "New switchyard" for a line tap. The icon id is
                built from the feature's method property. */}
            <Layer
              id="grid-tap-node"
              type="symbol"
              filter={["has", "method"]}
              layout={{
                "icon-image": ["concat", "grid-node-", ["get", "method"]],
                "icon-size": 1,
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
                "text-field": ["get", "methodLabel"],
                "text-font": ["Open Sans Regular"],
                "text-size": 11,
                "text-offset": [0, 1.5],
                "text-anchor": "top",
                "text-allow-overlap": true,
              }}
              paint={{
                "text-color": INK,
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.5,
              }}
            />
          </Source>
        )}

        {/* Connection corridor (GRID V1 §5c): blocked subsegments flagged
            in brand risk-orange (a flag, not red/green status) over a white
            casing; the municipal via-segment dotted; ink-halo'd crossing
            labels; the local-grid entry point marked with the triangle
            glyph. Renders only when the backend returned a path — no path
            key, no corridor. */}
        {gridCorridor && (
          <Source id="grid-corridor" type="geojson" data={gridCorridor}>
            {/* White casing under the orange core, only under the blocked
                subsegments (urban/protected/water crossings). */}
            <Layer
              id="grid-corridor-casing"
              type="line"
              filter={[
                "all",
                ["==", ["geometry-type"], "LineString"],
                ["match", ["get", "kind"], ["urban", "protected", "water"], true, false],
              ]}
              paint={{
                "line-color": "#ffffff",
                "line-width": 7,
                "line-opacity": 0.9,
              }}
            />
            <Layer
              id="grid-corridor-blocked"
              type="line"
              filter={[
                "all",
                ["==", ["geometry-type"], "LineString"],
                ["match", ["get", "kind"], ["urban", "protected", "water"], true, false],
              ]}
              paint={{
                "line-color": ORANGE,
                "line-width": 4,
              }}
            />
            {/* Municipal path: entry→access segment rides the local
                utility's distribution grid, which we don't map — dotted,
                and labeled as illustrative. Zero-length dashes with a
                round cap render as dots. */}
            <Layer
              id="grid-corridor-via"
              type="line"
              filter={[
                "all",
                ["==", ["geometry-type"], "LineString"],
                ["==", ["get", "kind"], "via"],
              ]}
              layout={{ "line-cap": "round" }}
              paint={{
                "line-color": ORANGE,
                "line-width": 3,
                "line-dasharray": [0, 2],
              }}
            />
            <Layer
              id="grid-corridor-via-label"
              type="symbol"
              filter={["==", ["get", "kind"], "via"]}
              layout={{
                "symbol-placement": "line",
                "text-field": [
                  "concat",
                  "via ",
                  ["get", "utility"],
                  " local grid — route illustrative",
                ],
                "text-font": ["Open Sans Regular"],
                "text-size": 11,
              }}
              paint={{
                "text-color": INK,
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.5,
              }}
            />
            {/* Crossing label midpoints ("crosses {name} · {mi} mi" —
                text composed by the backend in the label property). */}
            <Layer
              id="grid-corridor-label"
              type="symbol"
              filter={[
                "all",
                ["==", ["geometry-type"], "Point"],
                ["has", "label"],
              ]}
              layout={{
                "text-field": ["get", "label"],
                "text-font": ["Open Sans Regular"],
                "text-size": 12,
                "text-offset": [0, -0.9],
                "text-allow-overlap": true,
              }}
              paint={{
                "text-color": INK,
                "text-halo-color": "#ffffff",
                "text-halo-width": 2,
              }}
            />
            {/* Local-grid entry point: where the corridor meets the
                urbanized area and the connector hands off to the
                utility's (unmapped) distribution grid. Same glyph idiom
                as the tap nodes. */}
            <Layer
              id="grid-corridor-entry"
              type="symbol"
              filter={["==", ["get", "kind"], "entry"]}
              layout={{
                "icon-image": "grid-node-entry",
                "icon-size": 1,
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
                "text-field": "Local grid entry (approx.)",
                "text-font": ["Open Sans Regular"],
                "text-size": 11,
                "text-offset": [0, 1.5],
                "text-anchor": "top",
                "text-allow-overlap": true,
              }}
              paint={{
                "text-color": INK,
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.5,
              }}
            />
          </Source>
        )}

        {/* Draggable gen-tie origin (§6b): the point every grid analysis
            runs from — auto-sited by the origin scan at the best/closest
            point on the parcel, draggable to override. Small ink circle
            with a white outline — not orange, so it never reads as the
            parcel selection. */}
        {panel.status === "found" && effectiveOrigin && (
          <Marker
            longitude={effectiveOrigin[0]}
            latitude={effectiveOrigin[1]}
            draggable
            anchor="center"
            onDragEnd={(e) => {
              setOrigin([e.lngLat.lng, e.lngLat.lat]);
              setOriginCustom(true);
            }}
          >
            <div
              title="Gen-tie origin — drag to re-run the grid analysis from a new point"
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: INK,
                border: "2px solid #ffffff",
                cursor: "grab",
              }}
            />
          </Marker>
        )}
      </MapGL>

      {/* top bar — on phones: one compact row (no title/labels, fluid
          search) so the map + selected parcel stay visible. Desktop
          layout unchanged. */}
      <div className="absolute left-3 right-3 top-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[11px] border border-hairline bg-surface-2 px-4 py-3 shadow-card max-md:flex-nowrap max-md:gap-2 max-md:px-2.5 max-md:py-2">
        <h1 className="text-[15px] font-semibold text-ink max-md:hidden">
          California Parcel Viewer
        </h1>
        <label className="flex items-center gap-2 max-md:flex-none">
          <span className="text-[12px] text-faint max-md:hidden">County</span>
          <select
            value={selectedCounty}
            onChange={(e) => handleCountyChange(e.target.value)}
            className="max-w-[260px] cursor-pointer rounded-full bg-canvas px-3 py-1.5 text-[12.5px] text-ink outline-none ring-1 ring-hairline focus:ring-2 focus:ring-vista max-md:max-w-[118px] max-md:px-2 max-md:text-[11.5px]"
          >
            <option value={STATEWIDE_COUNTY_NAME}>
              {STATEWIDE_COUNTY_NAME} — Mosaic
            </option>
            {sortedCounties.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} — {STATUS_LABEL[c.status]}
              </option>
            ))}
          </select>
        </label>
        <form
          className="relative flex items-center max-md:min-w-0 max-md:flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSearch();
          }}
        >
          <svg
            viewBox="0 0 16 16"
            className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-faint"
            aria-hidden="true"
          >
            <circle
              cx="7"
              cy="7"
              r="4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M10.5 10.5L14 14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="text"
            role="combobox"
            aria-expanded={suggestOpen}
            aria-controls="parcel-search-listbox"
            aria-activedescendant={
              suggestOpen && suggestions && suggestions.length > 0
                ? `parcel-search-option-${activeOption}`
                : undefined
            }
            aria-autocomplete="list"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onFocus={() => {
              if (suggestions !== null) setSuggestOpen(true);
            }}
            onBlur={() => {
              // Delay so option mousedown lands before the dropdown closes.
              setTimeout(() => setSuggestOpen(false), 120);
            }}
            onKeyDown={(e) => {
              if (!suggestOpen) return;
              const n = suggestions?.length ?? 0;
              if (e.key === "ArrowDown" && n > 0) {
                e.preventDefault();
                setActiveOption((i) => (i + 1) % n);
              } else if (e.key === "ArrowUp" && n > 0) {
                e.preventDefault();
                setActiveOption((i) => (i - 1 + n) % n);
              } else if (e.key === "Escape") {
                setSuggestOpen(false);
              }
            }}
            placeholder="Type a few letters — APN or address…"
            aria-label="Search APN or address in the selected county"
            autoComplete="off"
            spellCheck={false}
            className="w-[240px] rounded-full bg-canvas py-1.5 pl-8 pr-3 text-[12.5px] text-ink outline-none ring-1 ring-hairline placeholder:text-faint focus:ring-2 focus:ring-vista max-md:w-full max-md:min-w-0"
          />
          {suggestOpen && searchText.trim().length >= 3 && (
            <ul
              id="parcel-search-listbox"
              role="listbox"
              aria-label="Parcel suggestions"
              className="absolute left-0 top-full z-20 mt-1.5 w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[11px] border border-hairline bg-canvas shadow-pop"
            >
              {suggestLoading && (
                <li className="px-3 py-2.5 text-xs text-faint">
                  Searching {selectedCounty}…
                </li>
              )}
              {!suggestLoading && !countySearchSupported && (
                <li className="px-3 py-2.5 text-xs leading-snug text-faint">
                  Statewide mode — press Enter to fly to a place and identify
                  its parcel. For APN/address text search, pick a Live county
                  above.
                </li>
              )}
              {!suggestLoading &&
                countySearchSupported &&
                suggestions !== null &&
                suggestions.length === 0 && (
                  <li className="px-3 py-2.5 text-xs text-faint">
                    No matches in {selectedCounty} — keep typing or try an APN.
                  </li>
                )}
              {!suggestLoading &&
                suggestions?.map((s, i) => (
                  <li key={`${s.county}:${s.apn ?? s.address ?? i}`} role="presentation">
                    <button
                      type="button"
                      role="option"
                      id={`parcel-search-option-${i}`}
                      aria-selected={i === activeOption}
                      onMouseDown={(e) => {
                        e.preventDefault(); // don't blur the input first
                        pickSuggestion(s);
                      }}
                      onMouseEnter={() => setActiveOption(i)}
                      className={`block w-full px-3 py-2 text-left transition-colors ${
                        i === activeOption ? "bg-surface-2" : ""
                      }`}
                    >
                      <span className="block truncate text-[12.5px] font-medium text-ink">
                        {s.address ?? s.apn ?? "Unnamed parcel"}
                      </span>
                      <span className="block truncate text-xs text-faint">
                        {[
                          s.address ? s.apn : null,
                          s.county,
                          s.acres != null
                            ? `${s.acres.toLocaleString(undefined, { maximumFractionDigits: 2 })} ac`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </form>
        {panel.status === "found" && (
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            className="ml-auto flex items-center gap-1.5 rounded-full bg-canvas px-3 py-1.5 text-[12px] text-muted ring-1 ring-hairline transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-vista"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            {copied ? "Copied" : "Copy link"}
          </button>
        )}
        <span
          className={`${panel.status === "found" ? "" : "ml-auto "}hidden text-[12px] text-faint md:inline`}
        >
          {counts.live} live · {counts.partial} partial · {counts.mosaic} via
          statewide mosaic
        </span>
      </div>

      {/* why a search came up empty (no match vs county has no attribute search) */}
      {searchNote && (
        <div className="absolute left-3 top-[76px] flex max-w-[min(360px,calc(100vw-24px))] items-start gap-2 rounded-[11px] border border-hairline bg-surface-2 px-3 py-2 text-[12px] leading-snug text-muted shadow-card">
          <span className="min-w-0 flex-1">{searchNote}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setSearchNote(null)}
            className="flex-none text-faint hover:text-ink"
          >
            <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
              <path
                d="M2 2l8 8M10 2l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}

      {/* right-side rail: selected parcel, watchlist, recent searches.
          On phones this is a bottom sheet that starts COLLAPSED — a one-row
          strip (parcel name + grid/verdict chips) so the map and the
          selected parcel stay visible; tap to expand the full rail, chevron
          or X to put it away (Watching/Recent are hidden below md anyway).
          Desktop geometry (right column, top 76px) is unchanged. */}
      <div className="absolute flex max-w-[calc(100vw-24px)] flex-col max-md:inset-x-3 max-md:bottom-24 md:bottom-14 md:right-3 md:top-[76px] md:w-[360px]">
        {panel.status === "found" && !sheetOpen && (
          <div className="flex items-center gap-2 rounded-[11px] border border-hairline bg-surface-2 px-3 py-2 shadow-card md:hidden">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              aria-label="Expand parcel details"
            >
              <span className="truncate text-[13px] font-semibold text-ink">
                {panel.result.address ?? panel.result.apn ?? "Unnamed parcel"}
              </span>
              {gridNearest?.access && (
                <span className="flex-none rounded-full bg-canvas px-1.5 py-px text-[10px] font-medium text-muted ring-1 ring-hairline">
                  {gridNearest.access.label.split(" to ")[0]} · {gridNearest.access.bucket}
                </span>
              )}
              {gridNearest?.path?.verdict && (
                <span className="flex-none rounded-full bg-canvas px-1.5 py-px text-[10px] font-medium text-muted ring-1 ring-hairline">
                  {VERDICT_LABEL[gridNearest.path.verdict.code] ?? gridNearest.path.verdict.code}
                </span>
              )}
              <svg viewBox="0 0 12 12" className="h-3 w-3 flex-none text-faint" aria-hidden="true">
                <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Close selected parcel"
              onClick={handleCloseSelected}
              className="flex-none text-faint hover:text-ink"
            >
              <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        {/* Mobile expand handle (only when the sheet is open on phones). */}
        {panel.status === "found" && sheetOpen && (
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            aria-label="Collapse parcel details"
            className="mb-1 flex items-center justify-center gap-1 self-center rounded-full border border-hairline bg-surface-2 px-3 py-1 text-[11px] text-muted shadow-card md:hidden"
          >
            <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Minimize
          </button>
        )}
        {/* Scroll container. Desktop: min-h-0 flex-1 gives the rail's own
            h-full+overflow a definite height to scroll in. Mobile: the 55vh
            cap + this overflow-y-auto do the scrolling (the rail's h-full
            doesn't resolve against a max-height-only parent). */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain max-md:max-h-[55vh] ${
            panel.status === "found" && !sheetOpen ? "max-md:hidden" : ""
          }`}
        >
          <ParcelRail
            selected={panel.status === "found" ? panel.result : null}
            panelStatus={panel.status}
            gridAccess={gridNearest}
            originLabel={originLabel}
            onCloseSelected={handleCloseSelected}
            onResearch={(p) => void handleResearch(p)}
            onFlyTo={handleFlyTo}
          />
        </div>
      </div>

      {/* data sources footer — hidden on phones while a parcel is selected
          (it overlaps the bottom sheet); smaller there otherwise. */}
      <div
        className={`absolute bottom-3 left-16 max-w-[min(600px,calc(100%-160px))] rounded-[8px] border border-hairline bg-canvas/95 px-3 py-2 text-[11.5px] leading-snug text-faint shadow-card backdrop-blur max-md:left-3 max-md:px-2 max-md:py-1 max-md:text-[10.5px] ${
          panel.status === "found" ? "max-md:hidden" : ""
        }`}
      >
        <span className="text-muted">
          Click the map to identify a parcel, or search by APN/address.
        </span>{" "}
        Boundaries: Regrid (Jul 2026) · Attributes: county open GIS endpoints +
        CA DWR statewide mosaic · verified 2026-08-22
      </div>

      {/* parcel tile attribution */}
      <div className="absolute bottom-3 right-3 rounded-[5px] border border-hairline bg-canvas/95 px-2 py-1 text-[11px] text-faint shadow-card backdrop-blur">
        Parcels © Regrid
      </div>
    </div>
  );
}
