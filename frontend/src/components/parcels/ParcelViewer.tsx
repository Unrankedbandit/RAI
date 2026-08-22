"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MapGL, { Layer, Source } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import type { Feature } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

import { analyze } from "@/lib/agent/client";
import { slugify } from "@/lib/agent/liveStore";
import { ParcelRail } from "@/components/parcels/ParcelRail";
import { recordRecent, type SavedParcel } from "@/lib/parcels/watchlist";
import {
  COUNTIES,
  STATEWIDE_COUNTY_NAME,
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
 * (selected parcel, watchlist, recent searches).
 * Client-only — ParcelViewerClient loads this via next/dynamic ssr:false.
 */

// Keyless vector basemap, no watermark. Attribution stays visible (required).
const MAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// Regrid nationwide parcel boundaries, served as ArcGIS raster tiles.
const REGRID_TILES =
  "https://tiles.arcgis.com/tiles/KzeiCaQsMoeCfoCq/arcgis/rest/services/Regrid_Nationwide_Parcel_Boundaries_v1/MapServer/tile/{z}/{y}/{x}";

const ORANGE = "#ff8400";

// Brand-orange crosshair/dot cursor for the map canvas (inline SVG data-uri).
// Passed to MapGL's `cursor` prop (sets it on the canvas) and inherited from
// the map style, with `crosshair` as the browser fallback.
const MAP_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><circle cx='10' cy='10' r='5' fill='none' stroke='%23ff8400' stroke-width='2'/><circle cx='10' cy='10' r='1.5' fill='%23ff8400'/></svg>") 10 10, crosshair`;

// Fit California on load.
const CA_CENTER: [number, number] = [-119.4, 37.2];
const CA_ZOOM = 5.2;

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
  const [searchText, setSearchText] = useState("");
  // Why the last search came up empty (no match vs county has no attribute
  // search) — shown as a small caption, since the rail only gets panelStatus.
  const [searchNote, setSearchNote] = useState<string | null>(null);

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
      requestRef.current++; // cancel any in-flight identify
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
      const cfg = countyByName.get(selectedCounty);
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
  const handleSearch = useCallback(async () => {
    const text = searchText.trim();
    if (!text) return;
    const req = ++requestRef.current;
    const cfg = countyByName.get(selectedCounty);
    const supported =
      selectedCounty !== STATEWIDE_COUNTY_NAME &&
      !!cfg &&
      cfg.status !== "mosaic-only" &&
      !!cfg.endpoint;
    setSearchNote(null);
    if (!supported) {
      setPanel({ status: "empty" });
      setSearchNote(
        "Text search needs a live county — the statewide mosaic has no attribute search. Pick a Live or Partial county above.",
      );
      return;
    }
    setPanel({ status: "loading", county: selectedCounty });
    const results = await searchParcels(selectedCounty, text);
    if (req !== requestRef.current) return;
    const first = results[0];
    if (!first) {
      setPanel({ status: "empty" });
      setSearchNote(`No parcels in ${selectedCounty} match “${text}”.`);
      return;
    }
    setPanel({ status: "found", result: first, queriedCounty: first.county });
    const center = geometryCenter(first.geometry);
    if (center) {
      mapRef.current?.flyTo({ center, zoom: 16, duration: 1200 });
    }
    recordRecent(toSavedParcel(first, text, center?.[0], center?.[1]));
  }, [searchText, selectedCounty, countyByName]);

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

  const handleFlyTo = useCallback((lng: number, lat: number) => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 1200 });
  }, []);

  const handleCloseSelected = useCallback(() => {
    setPanel({ status: "idle" });
  }, []);

  // GeoJSON for the highlight layers — geometry:null results simply clear it.
  const selectedFeature = useMemo<Feature | null>(() => {
    if (panel.status !== "found" || !panel.result.geometry) return null;
    return { type: "Feature", geometry: panel.result.geometry, properties: {} };
  }, [panel]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      <MapGL
        ref={mapRef}
        initialViewState={{
          longitude: CA_CENTER[0],
          latitude: CA_CENTER[1],
          zoom: CA_ZOOM,
        }}
        mapStyle={MAP_STYLE}
        style={{ width: "100%", height: "100%", cursor: MAP_CURSOR }}
        cursor={MAP_CURSOR}
        attributionControl={{ compact: false }}
        onClick={(e) => void handleMapClick(e.lngLat.lng, e.lngLat.lat)}
      >
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
      </MapGL>

      {/* top bar */}
      <div className="absolute left-3 right-3 top-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[11px] border border-hairline bg-surface-2 px-4 py-3 shadow-card">
        <h1 className="text-[15px] font-semibold text-ink">
          California Parcel Viewer
        </h1>
        <label className="flex items-center gap-2">
          <span className="text-[12px] text-faint">County</span>
          <select
            value={selectedCounty}
            onChange={(e) => handleCountyChange(e.target.value)}
            className="max-w-[260px] cursor-pointer rounded-full bg-canvas px-3 py-1.5 text-[12.5px] text-ink outline-none ring-1 ring-hairline focus:ring-2 focus:ring-vista"
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
          className="relative flex items-center"
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
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search APN or address…"
            aria-label="Search APN or address in the selected county"
            className="w-[220px] rounded-full bg-canvas py-1.5 pl-8 pr-3 text-[12.5px] text-ink outline-none ring-1 ring-hairline placeholder:text-faint focus:ring-2 focus:ring-vista"
          />
        </form>
        <span className="ml-auto text-[12px] text-faint">
          {counts.live} live · {counts.partial} partial · {counts.mosaic} via
          statewide mosaic
        </span>
      </div>

      {/* why a search came up empty (no match vs county has no attribute search) */}
      {searchNote && (
        <div className="absolute left-3 top-[76px] flex max-w-[360px] items-start gap-2 rounded-[11px] border border-hairline bg-surface-2 px-3 py-2 text-[12px] leading-snug text-muted shadow-card">
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

      {/* right-side rail: selected parcel, watchlist, recent searches */}
      <div className="absolute bottom-14 right-3 top-[76px] flex w-[360px] max-w-[calc(100vw-24px)] flex-col">
        <ParcelRail
          selected={panel.status === "found" ? panel.result : null}
          panelStatus={panel.status}
          onCloseSelected={handleCloseSelected}
          onResearch={(p) => void handleResearch(p)}
          onFlyTo={handleFlyTo}
        />
      </div>

      {/* data sources footer */}
      <div className="absolute bottom-3 left-3 max-w-[min(600px,calc(100%-120px))] rounded-[8px] border border-hairline bg-canvas/95 px-3 py-2 text-[11.5px] leading-snug text-faint shadow-card backdrop-blur">
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
