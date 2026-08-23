"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Map, { Marker, Popup } from "react-map-gl/maplibre";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { bandColorVar } from "@/lib/band";
import { useTheme } from "@/lib/theme";
import type { AgentReport } from "@/lib/agent/report";
import {
  extractSiteFeatures,
  geocodeLocation,
  positionForFeature,
  type AoIFeature,
} from "@/lib/agent/siteGeo";

/**
 * Project site map: a satellite-default MapLibre view (identical basemap
 * approach to portfolio/PortfolioMapView.tsx — keyless Esri World Imagery
 * raster, CARTO vector fallback) zoomed to the report's site at ~14.5.
 *
 * Layers, in increasing order of inference — each one renders only when the
 * underlying report text supports it:
 *   - Site marker: explicit project lat/lng when non-zero, else the project
 *     `location` string geocoded via Nominatim (lib/agent/siteGeo). If
 *     geocoding fails the tab shows an honest empty state — never a
 *     default-country fake view.
 *   - Zoning legend line: only when the report carries a zoning mention.
 *   - Area-of-interest markers: only for features the report says are ON the
 *     site. Their positions are synthesized deterministically inside a ~300m
 *     box around the site point (see siteGeo.positionForFeature) — indicative
 *     placement, not surveyed coordinates — and a note says so under the map.
 *     Features mentioned but not stated to be on site are listed below the
 *     map as "mentioned, not mapped", with no marker.
 *
 * Clicking an AoI marker opens a popup with the supporting report snippet and
 * a "View finding" link into the Findings tab anchor for that finding.
 * Client-only — MapTab loads this via next/dynamic with ssr:false.
 */

// Keyless vector basemaps + satellite style copied verbatim from
// components/portfolio/PortfolioMapView.tsx (satellite is the default).
const MAP_STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MAP_STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const MAP_STYLE_SATELLITE: StyleSpecification = {
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
};

interface PositionedFeature extends AoIFeature {
  longitude: number;
  latitude: number;
}

export default function SiteMapView({
  projectId,
  name,
  location,
  capacityMW,
  latitude,
  longitude,
  report,
}: {
  projectId: string;
  name: string;
  location: string;
  capacityMW: number;
  latitude: number;
  longitude: number;
  report: AgentReport | null;
}) {
  // Explicit project coordinates win when sane and non-zero (the adapter
  // zeroes them for live runs); pure props → memoized derivation, no effect.
  const explicit = useMemo(
    () =>
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180 &&
      (latitude !== 0 || longitude !== 0)
        ? ([longitude, latitude] as [number, number])
        : null,
    [latitude, longitude],
  );
  // Geocode fallback. null = still resolving, [lng,lat] = resolved,
  // "failed" = honest empty. setState only ever fires in the promise
  // callback (sync setState in an effect body cascades renders).
  const [geocoded, setGeocoded] = useState<[number, number] | "failed" | null>(
    null,
  );
  useEffect(() => {
    if (explicit || !location.trim()) return; // nothing to resolve
    let live = true;
    void geocodeLocation(location).then((coords) => {
      if (live) setGeocoded(coords ?? "failed");
    });
    return () => {
      live = false;
    };
  }, [explicit, location]);
  const center: [number, number] | "failed" | null =
    explicit ?? (location.trim() ? geocoded : "failed");
  const [selected, setSelected] = useState<PositionedFeature | null>(null);
  const [satellite, setSatellite] = useState(true);
  const theme = useTheme();

  const features = useMemo(() => extractSiteFeatures(report), [report]);

  // Markers positioned inside the synthetic parcel extent (indicative only —
  // see siteGeo.positionForFeature). Recomputed if the center resolves.
  const positioned = useMemo<PositionedFeature[]>(() => {
    if (!Array.isArray(center)) return [];
    return features.aois.map((f) => {
      const [lng, lat] = positionForFeature(f.key, center);
      return { ...f, longitude: lng, latitude: lat };
    });
  }, [features, center]);

  if (center === "failed") {
    return (
      <div className="flex h-[380px] items-center justify-center rounded-[5px] bg-surface-2 px-6 text-center text-[13px] text-faint">
        Location could not be geocoded{location ? ` (“${location}”)` : ""} — no
        site map available.
      </div>
    );
  }

  return (
    <div>
      <div className="relative h-[380px] overflow-hidden rounded-[5px] bg-surface-2">
        {!Array.isArray(center) ? (
          <div className="h-full w-full animate-pulse bg-surface-2" />
        ) : (
          <Map
            initialViewState={{
              longitude: center[0],
              latitude: center[1],
              zoom: 14.5,
            }}
            mapStyle={
              satellite
                ? MAP_STYLE_SATELLITE
                : theme === "dark"
                  ? MAP_STYLE_DARK
                  : MAP_STYLE_LIGHT
            }
            style={{ width: "100%", height: "100%", touchAction: "none" }}
            attributionControl={{ compact: false }}
          >
            {/* Site marker — the geocoded/explicit site point. */}
            <Marker longitude={center[0]} latitude={center[1]} anchor="center">
              <div className="flex items-center gap-2">
                <div
                  className="h-[12px] w-[12px] flex-none rounded-full border-2 border-canvas bg-ink"
                  style={{ boxShadow: "0 0 0 1px var(--color-hairline)" }}
                  title={name}
                />
                <div className="whitespace-nowrap rounded-full border border-hairline bg-canvas px-[9px] py-[3px] text-[12px] font-semibold text-ink shadow-card">
                  {name} · {capacityMW} MW
                </div>
              </div>
            </Marker>

            {/* Area-of-interest markers — positions indicative, not surveyed. */}
            {positioned.map((f) => (
              <Marker
                key={f.key}
                longitude={f.longitude}
                latitude={f.latitude}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setSelected(f);
                }}
              >
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-canvas/95 py-1 pl-1.5 pr-2.5 text-[11px] font-semibold text-ink shadow-card"
                  aria-label={`Area of interest: ${f.label}`}
                >
                  <span
                    className="h-[8px] w-[8px] flex-none rounded-full"
                    style={{
                      backgroundColor: f.band
                        ? bandColorVar[f.band]
                        : "var(--color-muted)",
                    }}
                    aria-hidden
                  />
                  <span aria-hidden>{f.icon}</span>
                  {f.label}
                </button>
              </Marker>
            ))}

            {selected && (
              <Popup
                longitude={selected.longitude}
                latitude={selected.latitude}
                offset={14}
                closeOnClick
                onClose={() => setSelected(null)}
                maxWidth="280px"
              >
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  <div className="text-[13px] font-semibold text-ink">
                    {selected.icon} {selected.label}
                  </div>
                  <div className="mt-[2px] text-[11.5px] text-faint">
                    {selected.findingTitle}
                  </div>
                  <p className="mt-1.5 text-[12px] leading-[1.55] text-muted">
                    {selected.snippet}
                  </p>
                  <p className="mt-1.5 text-[10.5px] italic text-faint">
                    Marker position is indicative, not surveyed.
                  </p>
                  <Link
                    href={`/projects/${projectId}?tab=findings#${selected.anchorId}`}
                    className="mt-2 inline-block text-[12.5px] font-medium text-ink underline decoration-hairline underline-offset-2 hover:decoration-ink"
                  >
                    → View finding
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
        )}
      </div>

      {/* Under-map legend lines — each renders only with report support. */}
      <div className="mt-3 space-y-1.5 text-[12px] text-muted">
        {features.zoning && (
          <div>
            <span className="font-semibold text-ink">Zoning:</span>{" "}
            {features.zoning}{" "}
            <span className="text-faint">(per report)</span>
          </div>
        )}
        {positioned.length > 0 && (
          <div className="text-faint">
            {positioned.length} area{positioned.length > 1 ? "s" : ""} of
            interest from the report — marker positions are indicative, not
            surveyed.
          </div>
        )}
        {features.mentioned.length > 0 && (
          <div className="text-faint">
            Mentioned in the report, not mapped (no on-site location given):{" "}
            {features.mentioned
              .map((f) => `${f.icon} ${f.label}`)
              .join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}
