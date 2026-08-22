"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Map, { Marker, Popup } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import { bandColorVar, statusLabelText } from "@/lib/band";
import { clsx } from "@/lib/clsx";
import type { Project } from "@/lib/types";
import { ProjectIntel } from "@/components/portfolio/ProjectIntel";

/**
 * Real interactive portfolio map: keyless CARTO vector basemap (Positron in
 * light theme, Dark Matter in dark theme), one band-coloured marker per
 * project (true coordinates), and a design-system popup with the activation
 * score, status and per-project intel.
 * Client-only — PortfolioMap loads this via next/dynamic with ssr: false.
 */

// Keyless vector basemaps, no watermark. Attribution stays visible (required).
const MAP_STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MAP_STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

type Theme = "light" | "dark";

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export default function PortfolioMapView({
  projects,
}: {
  projects: Project[];
}) {
  const [selected, setSelected] = useState<Project | null>(null);
  const [theme, setTheme] = useState<Theme>("light");

  // Track the app theme: initialise from <html data-theme>, then subscribe to
  // the rai-theme-change CustomEvent and (belt-and-braces) attribute mutations
  // on <html> in case the dataset is flipped without dispatching the event.
  useEffect(() => {
    setTheme(readTheme());

    const onThemeChange = (e: Event) => {
      const next = (e as CustomEvent<Theme>).detail;
      setTheme(next === "dark" ? "dark" : "light");
    };
    const observer = new MutationObserver(() => setTheme(readTheme()));

    window.addEventListener("rai-theme-change", onThemeChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      window.removeEventListener("rai-theme-change", onThemeChange);
      observer.disconnect();
    };
  }, []);

  // [west, south, east, north] covering every project, fitted on load.
  const bounds = useMemo<[number, number, number, number]>(() => {
    // Fallback: continental US when there is nothing to fit.
    if (projects.length === 0) return [-125, 25, -66, 50];
    const lngs = projects.map((p) => p.longitude);
    const lats = projects.map((p) => p.latitude);
    return [
      Math.min(...lngs),
      Math.min(...lats),
      Math.max(...lngs),
      Math.max(...lats),
    ];
  }, [projects]);

  return (
    <Map
      initialViewState={{
        bounds,
        fitBoundsOptions: { padding: 56, maxZoom: 6.5 },
      }}
      mapStyle={theme === "dark" ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
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
            }}
          >
            <div
              className={clsx("rai-marker-dot", pulsing && "rai-marker-pulse")}
              style={{ backgroundColor: bandColorVar[p.band] }}
              title={p.name}
            />
          </Marker>
        );
      })}

      {selected && (
        <Popup
          longitude={selected.longitude}
          latitude={selected.latitude}
          anchor="bottom"
          offset={14}
          closeOnClick
          onClose={() => setSelected(null)}
          maxWidth="280px"
        >
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
        </Popup>
      )}
    </Map>
  );
}
