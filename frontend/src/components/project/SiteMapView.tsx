"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Map, {
  Layer,
  Marker,
  Popup,
  Source,
  type MapRef,
} from "react-map-gl/maplibre";
import type { Feature } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

import { bandColorVar } from "@/lib/band";
import type { AgentReport } from "@/lib/agent/report";
import {
  extractSiteFeatures,
  geocodeLocation,
  positionForFeature,
  type AoIFeature,
} from "@/lib/agent/siteGeo";
import {
  extractParcelQuery,
  geometryBbox,
  geometryCenter,
  lookupProjectParcel,
} from "@/lib/parcels/projectParcel";
import type { ParcelResult } from "@/lib/parcels/counties";
import { BASEMAP_STYLES } from "@/components/maps/basemaps";
import {
  MapLayersControl,
  useMapLayers,
} from "@/components/maps/MapLayersControl";

/**
 * Project site map: a satellite-default MapLibre view zoomed to the report's
 * site at ~14.5. The basemap (keyless Esri World Imagery raster default,
 * CARTO Positron/Dark Matter vector) and GIS overlay rasters are owned by
 * the shared layers tool (components/maps/MapLayersControl) — basemap radio
 * + overlay checkboxes, persisted per page under the "project-site" key.
 *
 * Layers, in increasing order of inference — each one renders only when the
 * underlying report text supports it:
 *   - Project parcel: the report/project strings carry the parcel the
 *     project ran on ("Parcel 040016011 — Ventura County" / location
 *     "Ventura County, CA — parcel APN 040016011"). The APN + county are
 *     extracted and looked up with the SAME county GIS search the parcels
 *     page uses (lib/parcels/projectParcel → counties.searchParcels); the
 *     returned polygon is drawn in the parcels page's selected-parcel
 *     orange (fill + line) and the camera fitBounds it with padding. No
 *     APN or no hit → the geocoded county view stays and a note under the
 *     map says so — never a fake polygon.
 *   - Site marker: explicit project lat/lng when non-zero, else the
 *     auto-selected parcel's centroid, else the project `location` string
 *     geocoded via Nominatim (lib/agent/siteGeo). If geocoding fails and
 *     no parcel was found the tab shows an honest empty state — never a
 *     default-country fake view. The 12px dot is its OWN center-anchored
 *     Marker; the name/capacity label is a SEPARATE left-anchored, offset
 *     Marker, so the label's width can never drag the dot off the point.
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

interface PositionedFeature extends AoIFeature {
  longitude: number;
  latitude: number;
}

// The parcels page's selected-parcel colour (ParcelViewer's ORANGE).
const PARCEL_ORANGE = "#ff8400";

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
  // --- Parcel auto-select -------------------------------------------------
  // The project ran on a parcel: the report/project strings carry its APN +
  // county ("Parcel 040016011 — Ventura County" / "… — parcel APN
  // 040016011"). Same lookup the parcels page uses (county GIS search via
  // lib/parcels). null = resolving, "not-found" = no APN or no GIS hit.
  const parcelQuery = useMemo(
    () =>
      extractParcelQuery([report?.project, report?.location, name, location]),
    [report, name, location],
  );
  const [parcel, setParcel] = useState<ParcelResult | "not-found" | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    if (!parcelQuery.apn || !parcelQuery.county) {
      // Nothing to look up — resolve via a microtask so setState stays out
      // of the effect body (react-hooks/set-state-in-effect).
      void Promise.resolve().then(() => {
        if (live) setParcel("not-found");
      });
      return () => {
        live = false;
      };
    }
    void lookupProjectParcel(parcelQuery).then((p) => {
      if (live) setParcel(p ?? "not-found");
    });
    return () => {
      live = false;
    };
  }, [parcelQuery]);

  const parcelGeometry =
    parcel !== null && parcel !== "not-found" ? parcel.geometry : null;
  const parcelCenter = useMemo(
    () => (parcelGeometry ? geometryCenter(parcelGeometry) : null),
    [parcelGeometry],
  );
  const parcelFeature = useMemo<Feature | null>(() => {
    if (!parcelGeometry) return null;
    return { type: "Feature", geometry: parcelGeometry, properties: {} };
  }, [parcelGeometry]);

  // Site point: explicit project coordinates win; else the auto-selected
  // parcel's centroid (the dot must sit ON the parcel); else the geocoded
  // location string (the county view fallback).
  const sitePoint: [number, number] | "failed" | null =
    explicit ?? parcelCenter ?? (location.trim() ? geocoded : "failed");
  const [selected, setSelected] = useState<PositionedFeature | null>(null);
  // Shared layers tool: basemap (satellite default) + GIS overlay toggles,
  // persisted per page under this storage key.
  const mapLayers = useMapLayers("project-site");
  const mapRef = useRef<MapRef | null>(null);

  const features = useMemo(() => extractSiteFeatures(report), [report]);

  // Camera: when the parcel resolves, frame it with padding instead of
  // leaving the geocoded county-level zoom (initialViewState only applies
  // at mount, so the parcel always arrives after it).
  useEffect(() => {
    if (!parcelGeometry || !Array.isArray(sitePoint)) return;
    const bbox = geometryBbox(parcelGeometry);
    if (!bbox) return;
    mapRef.current?.fitBounds(bbox, {
      padding: 56,
      maxZoom: 16,
      duration: 800,
    });
  }, [parcelGeometry, sitePoint]);

  // Markers positioned inside the site extent (indicative only — see
  // siteGeo.positionForFeature). Recomputed if the site point resolves.
  const positioned = useMemo<PositionedFeature[]>(() => {
    if (!Array.isArray(sitePoint)) return [];
    return features.aois.map((f) => {
      const [lng, lat] = positionForFeature(f.key, sitePoint);
      return { ...f, longitude: lng, latitude: lat };
    });
  }, [features, sitePoint]);

  // While a parcel lookup is in flight, a failed geocode is not the final
  // word — the parcel can still place the map. Hold the loading pulse.
  const parcelResolving =
    parcel === null && !!parcelQuery.apn && !!parcelQuery.county;

  if (sitePoint === "failed" && !parcelResolving) {
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
        {!Array.isArray(sitePoint) ? (
          <div className="h-full w-full animate-pulse bg-surface-2" />
        ) : (
          <Map
            ref={mapRef}
            initialViewState={{
              longitude: sitePoint[0],
              latitude: sitePoint[1],
              zoom: 14.5,
            }}
            mapStyle={BASEMAP_STYLES[mapLayers.basemap]}
            style={{ width: "100%", height: "100%", touchAction: "none" }}
            attributionControl={{ compact: true }}
            // No 3D tilt (right-drag/Ctrl-drag keeps 2D bearing rotation only).
            pitchWithRotate={false}
            touchPitch={false}
          >
            <MapLayersControl state={mapLayers} />

            {/* The parcel the project ran on — real county GIS geometry,
                fill + line like the parcels page's selected-parcel layers.
                Rendered after the layers tool so it draws above its rasters. */}
            {parcelFeature && (
              <Source id="project-parcel" type="geojson" data={parcelFeature}>
                <Layer
                  id="project-parcel-fill"
                  type="fill"
                  paint={{
                    "fill-color": PARCEL_ORANGE,
                    "fill-opacity": 0.25,
                  }}
                />
                <Layer
                  id="project-parcel-line"
                  type="line"
                  paint={{ "line-color": PARCEL_ORANGE, "line-width": 2 }}
                />
              </Source>
            )}

            {/* Site marker — TWO Markers so the label can never drag the dot
                off the point: the dot is its own center-anchored Marker; the
                label is a separate left-anchored, 12px-offset Marker whose
                width is irrelevant to where the dot sits (zoom-proof). */}
            <Marker
              longitude={sitePoint[0]}
              latitude={sitePoint[1]}
              anchor="center"
            >
              <div
                className="h-[12px] w-[12px] rounded-full border-2 border-canvas bg-ink"
                style={{ boxShadow: "0 0 0 1px var(--color-hairline)" }}
                title={name}
              />
            </Marker>
            <Marker
              longitude={sitePoint[0]}
              latitude={sitePoint[1]}
              anchor="left"
              offset={[12, 0]}
              style={{ pointerEvents: "none" }}
            >
              <div className="whitespace-nowrap rounded-full border border-hairline bg-canvas px-[9px] py-[3px] text-[12px] font-semibold text-ink shadow-card">
                {name} · {capacityMW} MW
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
          </Map>
        )}
      </div>

      {/* Under-map legend lines — each renders only with report support. */}
      <div className="mt-3 space-y-1.5 text-[12px] text-muted">
        {parcel !== null && parcel !== "not-found" && (
          <div>
            <span className="font-semibold text-ink">Parcel:</span>{" "}
            {parcel.apn ?? parcelQuery.apn} · {parcel.county} County
            {parcel.acres != null &&
              ` · ${parcel.acres.toLocaleString(undefined, { maximumFractionDigits: 2 })} ac`}{" "}
            <span className="text-faint">(county GIS boundary)</span>
          </div>
        )}
        {parcel === "not-found" && (
          <div className="text-faint">
            {parcelQuery.apn
              ? `parcel geometry not found for ${parcelQuery.apn} — showing county view`
              : "no parcel APN in the project data — showing county view"}
          </div>
        )}
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
