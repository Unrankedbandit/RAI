"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Map, {
  Layer,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import type { FeatureCollection, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

import { bandColorVar, statusLabelText } from "@/lib/band";
import type { Project } from "@/lib/types";
import {
  useResearchedParcels,
  verdictColorVar,
  type ResearchedParcel,
} from "@/lib/agent/researched";
import { BASEMAP_STYLES } from "@/components/maps/basemaps";
import {
  MapLayersControl,
  useMapLayers,
} from "@/components/maps/MapLayersControl";
import { ProjectIntel } from "@/components/portfolio/ProjectIntel";

// MapLibre paint props are evaluated in the style spec, not in CSS, so they
// can't consume the var() tokens in bandColorVar / verdictColorVar — resolve
// each token against the live stylesheet (client-only component, ssr:false).
function resolveThemeColor(token: string): string {
  const name = /^var\((--[\w-]+)\)$/.exec(token)?.[1];
  if (!name || typeof document === "undefined") return token;
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    token
  );
}

/** Concrete dot colors keyed by the same band / verdict names as the CSS
 *  token maps, so the circle layers track the active theme. */
function readDotColors(): {
  band: Record<Project["band"], string>;
  verdict: Record<ResearchedParcel["verdict"], string>;
} {
  return {
    band: {
      strong: resolveThemeColor(bandColorVar.strong),
      watch: resolveThemeColor(bandColorVar.watch),
      risk: resolveThemeColor(bandColorVar.risk),
    },
    verdict: {
      go: resolveThemeColor(verdictColorVar.go),
      hold: resolveThemeColor(verdictColorVar.hold),
      nogo: resolveThemeColor(verdictColorVar.nogo),
    },
  };
}

/**
 * Real interactive portfolio map: one band-coloured pin per project (true
 * coordinates), rendered as a single GPU circle layer (GeoJSON Source +
 * Layer) rather than per-pin DOM markers, and a design-system popup with
 * the activation score, status and per-project intel. The old
 * satellite/vector toggle pill is replaced by the shared layers tool
 * (components/maps/MapLayersControl) — a basemap radio (satellite default,
 * keyless Esri raster / CARTO Positron / Dark Matter) plus GIS overlay
 * checkboxes, persisted per page under the "portfolio" storage key.
 *
 * On top of the project pins, every researched parcel from the agent backend
 * (GET /api/projects via lib/agent/researched.ts) drops a smaller
 * verdict-coloured dot — green for go/proceed, amber for hold/review, red
 * for no-go — with a hover popup naming the project, its readiness and its
 * decision. When nothing has been researched (or the backend is down) the
 * layer simply renders nothing.
 * Client-only — PortfolioMap loads this via next/dynamic with ssr: false.
 */

export default function PortfolioMapView({
  projects,
}: {
  projects: Project[];
}) {
  const [selected, setSelected] = useState<Project | null>(null);
  // Shared layers tool: basemap (satellite default) + GIS overlay toggles,
  // persisted per page under this storage key.
  const mapLayers = useMapLayers("portfolio");
  const [hoveredResearch, setHoveredResearch] =
    useState<ResearchedParcel | null>(null);
  // Canvas cursor: pointer over a dot, grab elsewhere (react-map-gl `cursor`
  // prop pattern, as in ParcelViewer).
  const [cursor, setCursor] = useState("grab");
  const mapRef = useRef<MapRef>(null);
  // Switching the mapStyle prop (via the layers tool) makes react-map-gl
  // call setStyle internally — no remount, camera preserved.

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

  // Resolved after mount so a theme flip re-reads the stylesheet; the two
  // GeoJSON collections below rebuild when the concrete colors land.
  const [dotColors, setDotColors] = useState(readDotColors);
  useEffect(() => {
    setDotColors(readDotColors());
  }, []);

  // One GPU circle layer per dot family replaces the old per-project /
  // per-parcel DOM <Marker> loops: pin color and the selected/at-risk halo
  // ride on feature properties, so paint is data-driven off these.
  const projectPins = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: projects.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
        properties: {
          id: p.id,
          color: dotColors.band[p.band],
          // 1 = draw the halo (selected or at-risk — the old CSS pulse ring).
          pulsing: selected?.id === p.id || p.status === "at-risk" ? 1 : 0,
        },
      })),
    }),
    [projects, dotColors, selected],
  );

  const researchedDots = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: researched.map((r, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.longitude, r.latitude] },
        // i indexes back into `researched` for the hover/click popup.
        properties: { i, color: dotColors.verdict[r.verdict] },
      })),
    }),
    [researched, dotColors],
  );

  // Clicks arrive via the map's onClick (interactiveLayerIds below) with the
  // hit circle's feature in e.features; the popups are unchanged from the
  // DOM-marker version. Researched dots render after the project pins, so
  // they win when the 44px hit areas overlap (as the DOM stacking did).
  const handleDotClick = (e: MapLayerMouseEvent) => {
    const features = e.features ?? [];
    const res = features.find((f) => f.layer.id === "researched-hit");
    if (res) {
      const r = researched[(res.properties as { i: number }).i];
      if (r) setHoveredResearch((cur) => (cur?.id === r.id ? null : r));
      return;
    }
    const pin = features.find((f) => f.layer.id === "portfolio-hit");
    if (!pin) return;
    const p = projects.find(
      (proj) => proj.id === (pin.properties as { id: string }).id,
    );
    if (!p) return;
    setSelected(p);
    // Move the pin away from the container edges so the popup never clips
    // against the map frame (which is overflow-hidden). Offset puts the pin
    // slightly above center, leaving the most room below it; the camera
    // eases, so the map never remounts.
    mapRef.current?.easeTo({
      center: [p.longitude, p.latitude],
      offset: [0, -60],
      duration: 300,
    });
  };

  // Hover tracking for the researched popup: mousemove only fires over the
  // interactive hit layers, so when no researched feature is under the
  // pointer the hover clears (fully off the dots, onMouseLeave clears).
  const handleDotHover = (e: MapLayerMouseEvent) => {
    const res = e.features?.find((f) => f.layer.id === "researched-hit");
    setHoveredResearch(
      res ? (researched[(res.properties as { i: number }).i] ?? null) : null,
    );
  };

  return (
    <div className="relative h-full w-full">
    <Map
      ref={mapRef}
      initialViewState={{
        bounds,
        fitBoundsOptions: { padding: 56, maxZoom: 6.5 },
      }}
      mapStyle={BASEMAP_STYLES[mapLayers.basemap]}
      // touchAction:none on the react-map-gl container (wraps canvas +
      // markers + popups) so mobile pinch/drag on the map drives MapLibre
      // rather than pinch-zooming the page. Desktop is unaffected.
      style={{ width: "100%", height: "100%", touchAction: "none" }}
      attributionControl={{ compact: true }}
      // The transparent 44px hit circles are the interactive surface; they
      // fully cover the visible dots they sit on top of.
      interactiveLayerIds={["portfolio-hit", "researched-hit"]}
      cursor={cursor}
      onClick={handleDotClick}
      onMouseMove={handleDotHover}
      onMouseEnter={() => setCursor("pointer")}
      onMouseLeave={() => {
        setCursor("grab");
        setHoveredResearch(null);
      }}
    >
      <MapLayersControl state={mapLayers} />

      {/* Project pins — one GeoJSON circle layer (a single GPU draw call)
          replaces the old per-project DOM <Marker> loop. */}
      <Source id="portfolio-pins" type="geojson" data={projectPins}>
        {/* Static stand-in for the old CSS pulse keyframe (a GPU layer can't
            run it): a soft ink halo on selected / at-risk pins. */}
        <Layer
          id="portfolio-pulse"
          type="circle"
          filter={["==", ["get", "pulsing"], 1]}
          paint={{
            "circle-radius": 12,
            "circle-color": "rgba(11, 8, 41, 0.18)",
          }}
        />
        <Layer
          id="portfolio-dots"
          type="circle"
          paint={{
            "circle-color": ["get", "color"],
            // 14px dot + 2px white ring, matching .rai-marker-dot.
            "circle-radius": 7,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          }}
        />
        {/* Fully transparent circles are still hit-testable — preserves the
            44×44 WCAG tap target the DOM marker hit area provided. */}
        <Layer
          id="portfolio-hit"
          type="circle"
          paint={{ "circle-radius": 22, "circle-opacity": 0 }}
        />
      </Source>

      {/* Researched parcels — smaller verdict-coloured dots, same
          single-draw conversion. Hover reveals name + readiness + decision,
          and on touch a tap toggles the same popup. No detail page, so the
          map click-through behaviour stays with the project pins. */}
      <Source id="portfolio-researched" type="geojson" data={researchedDots}>
        <Layer
          id="researched-dots"
          type="circle"
          paint={{
            "circle-color": ["get", "color"],
            // 11px dot (the old marker's inline size) + the same white ring.
            "circle-radius": 5.5,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          }}
        />
        <Layer
          id="researched-hit"
          type="circle"
          paint={{ "circle-radius": 22, "circle-opacity": 0 }}
        />
      </Source>

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
          <a
            href={`/projects/${hoveredResearch.id}`}
            className="mt-2 inline-block rounded-full bg-oxford px-3 py-1 text-[11px] font-semibold text-white hover:opacity-90"
          >
            View report →
          </a>
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
    </Map>
    </div>
  );
}
