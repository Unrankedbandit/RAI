"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Map, { Marker, Popup, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import { bandColorVar, statusLabelText } from "@/lib/band";
import { clsx } from "@/lib/clsx";
import { useTheme } from "@/lib/theme";
import type { Project } from "@/lib/types";
import {
  useResearchedParcels,
  verdictColorVar,
  type ResearchedParcel,
} from "@/lib/agent/researched";
import { ProjectIntel } from "@/components/portfolio/ProjectIntel";

/**
 * Real interactive portfolio map: keyless CARTO vector basemap (Positron in
 * light theme, Dark Matter in dark theme), one band-coloured marker per
 * project (true coordinates), and a design-system popup with the activation
 * score, status and per-project intel.
 *
 * On top of the project pins, every researched parcel from the agent backend
 * (GET /api/projects via lib/agent/researched.ts) drops a smaller
 * verdict-coloured dot — green for go/proceed, amber for hold/review, red
 * for no-go — with a hover popup naming the project, its readiness and its
 * decision. When nothing has been researched (or the backend is down) the
 * layer simply renders nothing.
 * Client-only — PortfolioMap loads this via next/dynamic with ssr: false.
 */

// Keyless vector basemaps, no watermark. Attribution stays visible (required).
const MAP_STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MAP_STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Satellite default (user call 2026-08-22): Esri World Imagery — keyless,
// CORS-friendly raster tiles; attribution required and kept.
const MAP_STYLE_SATELLITE = {
  version: 8,
  sources: {
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgis-online.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "satellite", type: "raster", source: "satellite" }],
} as const;

export default function PortfolioMapView({
  projects,
}: {
  projects: Project[];
}) {
  const [selected, setSelected] = useState<Project | null>(null);
  // Satellite is the default basemap (user call); the pill toggles vector.
  const [satellite, setSatellite] = useState(true);
  const [hoveredResearch, setHoveredResearch] =
    useState<ResearchedParcel | null>(null);
  const mapRef = useRef<MapRef>(null);
  // Reactive theme (lib/theme.ts): switching the mapStyle prop makes
  // react-map-gl call setStyle internally — no remount, camera preserved.
  const theme = useTheme();

  // Researched parcels from the agent backend (geocoded, verdict-coloured).
  const researched = useResearchedParcels();

  // [west, south, east, north] covering every project AND every researched
  // parcel — researched dots (CA/NV) sit west of the mock pins, so fitting
  // projects alone would crop them out.
  const bounds = useMemo<[number, number, number, number]>(() => {
    // Fallback: continental US when there is nothing to fit.
    if (projects.length === 0 && researched.length === 0)
      return [-125, 25, -66, 50];
    const lngs = [
      ...projects.map((p) => p.longitude),
      ...researched.map((r) => r.longitude),
    ];
    const lats = [
      ...projects.map((p) => p.latitude),
      ...researched.map((r) => r.latitude),
    ];
    return [
      Math.min(...lngs),
      Math.min(...lats),
      Math.max(...lngs),
      Math.max(...lats),
    ];
  }, [projects, researched]);

  // initialViewState fits only on mount; when researched parcels resolve
  // afterwards, ease the camera to the widened bounds instead of remounting.
  useEffect(() => {
    mapRef.current?.fitBounds(bounds, {
      padding: 56,
      maxZoom: 6.5,
      duration: 400,
    });
  }, [bounds]);

  return (
    <div className="relative h-full w-full">
    <Map
      ref={mapRef}
      initialViewState={{
        bounds,
        fitBoundsOptions: { padding: 56, maxZoom: 6.5 },
      }}
      mapStyle={
        satellite
          ? MAP_STYLE_SATELLITE
          : theme === "dark"
            ? MAP_STYLE_DARK
            : MAP_STYLE_LIGHT
      }
      style={{ width: "100%", height: "100%" }}
      attributionControl={{ compact: false }}
    >
      {projects.map((p) => {
        const pulsing = selected?.id === p.id || p.status === "at-risk";
        return (
          <Marker
            key={p.id}
            longitude={p.longitude}
            latitude={p.latitude}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setSelected(p);
              // Move the pin away from the container edges so the popup
              // never clips against the map frame (which is overflow-hidden).
              // Offset puts the pin slightly above center, leaving the most
              // room below it; the camera eases, so the map never remounts.
              mapRef.current?.easeTo({
                center: [p.longitude, p.latitude],
                offset: [0, -60],
                duration: 300,
              });
            }}
          >
            {/* 44×44 hit area (WCAG target size) around the 14px visual dot —
                a tap registers the same selection as a mouse click; desktop
                appearance is unchanged because the padding is transparent. */}
            <div
              className="flex h-11 w-11 cursor-pointer items-center justify-center"
              role="button"
              aria-label={`Select project ${p.name}`}
            >
              <div
                className={clsx("rai-marker-dot", pulsing && "rai-marker-pulse")}
                style={{ backgroundColor: bandColorVar[p.band] }}
                title={p.name}
              />
            </div>
          </Marker>
        );
      })}

      {/* Researched parcels — smaller verdict-coloured dots; hover reveals
          name + readiness + decision, and on touch the same 44px hit area
          toggles the popup on tap. No detail page, so the map click-through
          behaviour stays with the project pins. */}
      {researched.map((r) => (
        <Marker
          key={`res-${r.id}`}
          longitude={r.longitude}
          latitude={r.latitude}
          anchor="center"
        >
          <div
            className="flex h-11 w-11 cursor-pointer items-center justify-center"
            role="button"
            aria-label={`Researched parcel ${r.name}: ${r.decision}`}
            title={r.name}
            onMouseEnter={() => setHoveredResearch(r)}
            onMouseLeave={() => setHoveredResearch(null)}
            onClick={(e) => {
              e.stopPropagation();
              setHoveredResearch((cur) => (cur?.id === r.id ? null : r));
            }}
          >
            <div
              className="rai-marker-dot"
              style={{
                backgroundColor: verdictColorVar[r.verdict],
                width: 11,
                height: 11,
              }}
            />
          </div>
        </Marker>
      ))}

      {hoveredResearch && (
        <Popup
          longitude={hoveredResearch.longitude}
          latitude={hoveredResearch.latitude}
          offset={12}
          closeButton={false}
          closeOnClick={false}
          maxWidth="260px"
        >
          <div className="text-[13px] font-semibold text-ink">
            {hoveredResearch.name}
          </div>
          <div className="mt-[3px] flex items-center gap-1.5 text-[12px]">
            <span
              className="font-semibold"
              style={{ color: verdictColorVar[hoveredResearch.verdict] }}
            >
              {hoveredResearch.decision}
            </span>
            <span className="text-faint">·</span>
            <span className="text-muted tabular-nums">
              Readiness {hoveredResearch.readiness}
            </span>
          </div>
          <div className="mt-[2px] text-[11.5px] text-faint">
            {hoveredResearch.location}
          </div>
        </Popup>
      )}

      {selected && (
        <Popup
          longitude={selected.longitude}
          latitude={selected.latitude}
          // No fixed anchor: MapLibre re-picks the anchor on every map move
          // to keep the popup inside the map container (prefers bottom).
          offset={14}
          closeOnClick
          onClose={() => setSelected(null)}
          maxWidth="280px"
        >
          {/* Height-capped + self-scrolling so even a full intel strip keeps
              the popup inside the 360px map frame. */}
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            <div className="text-[14px] font-semibold text-ink">
              {selected.name}
            </div>
            <div className="mt-[3px] text-[12.5px] text-faint">
              {selected.tech ?? "Solar"} · {selected.capacityMW} MW ·{" "}
              {selected.location}
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              <div className="h-[5px] flex-1 rounded-full bg-hairline">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${selected.activationScore}%`,
                    backgroundColor: bandColorVar[selected.band],
                  }}
                />
              </div>
              <span className="text-[12.5px] font-semibold text-ink">
                {selected.activationScore}
              </span>
            </div>
            <div
              className="mt-1.5 text-[12.5px] font-medium"
              style={{ color: bandColorVar[selected.band] }}
            >
              {statusLabelText[selected.status]}
            </div>

            {/* Frozen contract with the intel agent — may render null. */}
            <div className="mt-3">
              <ProjectIntel project={selected} />
            </div>

            <Link
              href={`/projects/${selected.id}`}
              className="mt-2.5 inline-block text-[12.5px] font-medium text-ink underline decoration-hairline underline-offset-2 hover:decoration-ink"
            >
              → View project
            </Link>
          </div>
        </Popup>
      )}
      <button
        type="button"
        onClick={() => setSatellite((s) => !s)}
        aria-pressed={satellite}
        className="absolute right-3 top-3 z-10 rounded-full border border-hairline bg-canvas/90 px-3 py-1 text-[11px] font-semibold text-ink shadow-card backdrop-blur transition-colors hover:bg-surface-2"
      >
        {satellite ? "Map view" : "Satellite view"}
      </button>
    </Map>
    </div>
  );
}
