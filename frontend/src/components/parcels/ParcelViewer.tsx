"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import MapGL, { Layer, Source } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import type { Feature } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

import { clsx } from "@/lib/clsx";
import {
  COUNTIES,
  STATEWIDE_COUNTY_NAME,
  queryParcelAtPoint,
  type CountyConfig,
  type ParcelResult,
} from "@/lib/parcels/counties";

/**
 * California Parcel Viewer — full-height MapLibre surface.
 * Keyless CARTO Positron basemap, a Regrid raster tile overlay for parcel
 * boundaries (zoom 13+), click-to-identify against the county open-GIS
 * endpoints / CA DWR statewide mosaic (lib/parcels), the clicked parcel
 * highlighted in brand orange, and a right-side attribute panel.
 * Client-only — ParcelViewerClient loads this via next/dynamic ssr:false.
 */

// Keyless vector basemap, no watermark. Attribution stays visible (required).
const MAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// Regrid nationwide parcel boundaries, served as ArcGIS raster tiles.
const REGRID_TILES =
  "https://tiles.arcgis.com/tiles/KzeiCaQsMoeCfoCq/arcgis/rest/services/Regrid_Nationwide_Parcel_Boundaries_v1/MapServer/tile/{z}/{y}/{x}";

const ORANGE = "#ff8400";

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

// Data-status badge: grey / near-black / orange only (design-system rule).
const STATUS_BADGE: Record<CountyConfig["status"], string> = {
  live: "bg-strong-soft text-strong-ink",
  partial: "bg-watch-soft text-watch-ink",
  "mosaic-only": "bg-risk-soft text-risk-ink",
};

type PanelState =
  | { status: "idle" }
  | { status: "loading"; county: string }
  | { status: "empty" }
  | { status: "error" }
  | { status: "found"; result: ParcelResult; queriedCounty: string };

function formatRawValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function ParcelViewer() {
  const mapRef = useRef<MapRef | null>(null);
  // Latest-request-wins guard so stale responses never overwrite a newer click.
  const requestRef = useRef(0);

  const [selectedCounty, setSelectedCounty] = useState<string>(
    STATEWIDE_COUNTY_NAME,
  );
  const [panel, setPanel] = useState<PanelState>({ status: "idle" });

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
      try {
        const result = await queryParcelAtPoint(queryCounty, lng, lat);
        if (req !== requestRef.current) return;
        setPanel(
          result
            ? { status: "found", result, queriedCounty: queryCounty }
            : { status: "empty" },
        );
      } catch {
        if (req !== requestRef.current) return;
        setPanel({ status: "error" });
      }
    },
    [selectedCounty, countyByName],
  );

  // GeoJSON for the highlight layers — geometry:null results simply clear it.
  const selectedFeature = useMemo<Feature | null>(() => {
    if (panel.status !== "found" || !panel.result.geometry) return null;
    return { type: "Feature", geometry: panel.result.geometry, properties: {} };
  }, [panel]);

  const foundStatus: CountyConfig["status"] | null =
    panel.status === "found"
      ? panel.queriedCounty === STATEWIDE_COUNTY_NAME
        ? "mosaic-only"
        : (countyByName.get(panel.queriedCounty)?.status ?? "mosaic-only")
      : null;

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
        style={{ width: "100%", height: "100%" }}
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
        <span className="ml-auto text-[12px] text-faint">
          {counts.live} live · {counts.partial} partial · {counts.mosaic} via
          statewide mosaic
        </span>
      </div>

      {/* right-side info panel */}
      {panel.status !== "idle" && (
        <aside className="absolute bottom-14 right-3 top-[76px] flex w-[320px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[11px] border border-hairline bg-surface-2 shadow-card">
          <div className="flex flex-none items-center justify-between border-b border-hairline px-4 py-3">
            <span className="text-[13px] font-semibold text-ink">
              {panel.status === "loading"
                ? "Identifying parcel…"
                : panel.status === "found"
                  ? "Parcel"
                  : panel.status === "empty"
                    ? "No parcel"
                    : "Lookup failed"}
            </span>
            <button
              type="button"
              aria-label="Close panel"
              onClick={() => setPanel({ status: "idle" })}
              className="text-faint hover:text-ink"
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

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {panel.status === "loading" && (
              <div className="animate-pulse">
                <div className="text-[12.5px] text-muted">
                  Querying {panel.county}…
                </div>
                <div className="mt-3 space-y-2">
                  <div className="h-3 w-3/4 rounded bg-hairline" />
                  <div className="h-3 w-1/2 rounded bg-hairline" />
                  <div className="h-3 w-2/3 rounded bg-hairline" />
                </div>
              </div>
            )}

            {panel.status === "empty" && (
              <p className="text-[12.5px] text-muted">
                No parcel found here.{" "}
                <span className="text-faint">
                  Try zooming in or picking another spot.
                </span>
              </p>
            )}

            {panel.status === "error" && (
              <p className="text-[12.5px] text-muted">
                Couldn’t reach the county data endpoint — the parcel lookup
                failed. Try again in a moment.
              </p>
            )}

            {panel.status === "found" && (
              <ParcelDetails
                result={panel.result}
                status={foundStatus ?? "mosaic-only"}
              />
            )}
          </div>
        </aside>
      )}

      {/* data sources footer */}
      <div className="absolute bottom-3 left-3 max-w-[min(600px,calc(100%-120px))] rounded-[8px] border border-hairline bg-canvas/95 px-3 py-2 text-[11.5px] leading-snug text-faint shadow-card backdrop-blur">
        <span className="text-muted">
          Click the map to identify a parcel.
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

function ParcelDetails({
  result,
  status,
}: {
  result: ParcelResult;
  status: CountyConfig["status"];
}) {
  const rawEntries = Object.entries(result.raw ?? {});
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words font-mono text-[13px] font-medium text-ink">
            {result.apn ?? "—"}
          </div>
          <div className="mt-0.5 text-[11.5px] text-faint">
            APN · {result.county}
          </div>
        </div>
        <span
          className={clsx(
            "flex-none rounded-full px-2 py-0.5 text-[11px] font-medium",
            STATUS_BADGE[status],
          )}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      <dl className="mt-3 divide-y divide-hairline border-y border-hairline">
        <Field label="Address">{result.address ?? "—"}</Field>
        <Field label="Owner">{result.owner ?? "—"}</Field>
        <Field label="Acreage" mono>
          {result.acres != null
            ? `${result.acres.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })} ac`
            : "—"}
        </Field>
        <Field label="Land use">{result.landUse ?? "—"}</Field>
        <Field label="County">{result.county}</Field>
      </dl>

      {!result.geometry && (
        <p className="mt-2 text-[11.5px] text-faint">
          Attributes only — no boundary geometry returned for this parcel.
        </p>
      )}

      {rawEntries.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[12px] font-medium text-muted hover:text-ink">
            All attributes ({rawEntries.length})
          </summary>
          <dl className="mt-2 space-y-1.5">
            {rawEntries.map(([k, v]) => (
              <div key={k} className="flex gap-2 text-[11.5px]">
                <dt
                  className="w-[38%] flex-none truncate text-faint"
                  title={k}
                >
                  {k}
                </dt>
                <dd className="min-w-0 flex-1 break-words font-mono text-ink">
                  {formatRawValue(v)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

function Field({
  label,
  mono = false,
  children,
}: {
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="flex-none text-[11.5px] uppercase tracking-wide text-faint">
        {label}
      </dt>
      <dd
        className={clsx(
          "min-w-0 text-right text-[12.5px]",
          mono ? "font-mono text-ink" : "text-ink",
        )}
      >
        {children}
      </dd>
    </div>
  );
}
