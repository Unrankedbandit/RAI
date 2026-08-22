"use client";

import { useState } from "react";
import { useProject } from "./ProjectContext";
import type { MapZone } from "@/lib/types";

/**
 * Map tab — faithful port of the reference `#page-map .map-card`.
 * A GIS placeholder: an info column (toggles, parcel stat, distances,
 * selected-zone evidence, legend) beside a visual map shell with shaded
 * organic zones, a site pin, and a grid background.
 */
export function MapTab() {
  const { map } = useProject();
  const [toggles, setToggles] = useState(map.toggles);
  const [selectedZone, setSelectedZone] = useState<MapZone | null>(null);

  const flipToggle = (id: string) =>
    setToggles((prev) =>
      prev.map((t) => (t.id === id ? { ...t, on: !t.on } : t)),
    );

  return (
    <div className="rounded-[11px] border border-hairline bg-canvas p-5 shadow-card">
      <div className="flex flex-wrap items-start gap-[18px]">
        {/* Info column */}
        <div className="min-w-[230px] flex-[1_1_250px]">
          {/* Toggles */}
          <div className="mb-4 flex flex-wrap gap-2">
            {toggles.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => flipToggle(t.id)}
                className={`cursor-pointer rounded-full border px-[13px] py-[7px] text-[12.5px] ${
                  t.on
                    ? "border-watch-soft bg-watch-soft text-watch-ink"
                    : "border-hairline bg-canvas text-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Parcel size */}
          <div className="mb-4 rounded-[1px] border border-hairline p-[10px_12px]">
            <div className="mb-[3px] text-[12.5px] text-faint">Parcel size</div>
            <div className="text-[16px] font-semibold text-ink">{map.parcelSize}</div>
          </div>

          {/* Distance & logistics */}
          <div className="mb-[9px] text-[12.5px] font-semibold text-faint">
            Distance &amp; logistics
          </div>
          <div className="mb-4 rounded-[1px] border border-hairline px-3">
            {map.distances.map((d) => (
              <div
                key={d.label}
                className="flex justify-between border-t border-hairline py-[9px] text-[12.5px] text-muted first:border-t-0"
              >
                <span>{d.label}</span>
                <span className="font-medium text-ink">{d.value}</span>
              </div>
            ))}
          </div>

          {/* Selected zone */}
          <div className="mb-[9px] text-[12.5px] font-semibold text-faint">Selected zone</div>
          <div className="mb-4 min-h-[56px] rounded-[1px] border border-hairline p-[12px_14px]">
            {selectedZone ? (
              <>
                <div className="mb-[5px] text-sm font-semibold text-ink">
                  {selectedZone.title}
                </div>
                <div className="mb-2 text-[12.5px] leading-[1.55] text-muted">
                  {selectedZone.description}
                </div>
                <a
                  href="#"
                  className="text-[12.5px] text-muted underline underline-offset-2 hover:text-ink"
                >
                  View source: {selectedZone.source}
                </a>
              </>
            ) : (
              <div className="text-[12.5px] text-faint">
                Click a shaded zone on the map for details.
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="mb-[9px] text-[12.5px] font-semibold text-faint">Legend</div>
          <div className="flex flex-wrap gap-[18px]">
            <div className="flex items-center gap-[7px] text-[12.5px] text-muted">
              <span className="h-[9px] w-[9px] flex-none rounded-[3px] bg-strong" />
              Suitable for development
            </div>
            <div className="flex items-center gap-[7px] text-[12.5px] text-muted">
              <span className="h-[9px] w-[9px] flex-none rounded-[3px] bg-risk" />
              Restricted — requires review
            </div>
            <div className="flex items-center gap-[7px] text-[12.5px] text-muted">
              <span className="h-[9px] w-[9px] flex-none rounded-[3px] bg-ink" />
              Interconnection point
            </div>
          </div>
        </div>

        {/* Visual column */}
        <div className="min-w-[320px] flex-[2_1_420px]">
          <div className="relative h-[340px] overflow-hidden rounded-[5px] bg-surface-2">
            {/* Grid background */}
            <div
              className="absolute inset-0 opacity-70"
              style={{
                backgroundImage:
                  "linear-gradient(to right,var(--color-hairline) 1px,transparent 1px),linear-gradient(to bottom,var(--color-hairline) 1px,transparent 1px)",
                backgroundSize: "32px 32px",
              }}
            />

            {/* Zones */}
            {map.zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                onClick={() => setSelectedZone(zone)}
                className={`absolute cursor-pointer opacity-40 ${
                  zone.type === "suitable" ? "bg-strong" : "bg-risk"
                }`}
                style={{
                  left: `${zone.bounds.left}%`,
                  top: `${zone.bounds.top}%`,
                  width: `${zone.bounds.width}%`,
                  height: `${zone.bounds.height}%`,
                  borderRadius:
                    zone.type === "suitable"
                      ? "38% 62% 55% 45% / 48% 42% 58% 52%"
                      : "60% 40% 45% 55% / 55% 60% 40% 45%",
                }}
                aria-label={zone.title}
              />
            ))}

            {/* Site pin */}
            <div
              className="absolute h-[12px] w-[12px] rounded-full border-2 border-canvas bg-ink"
              style={{
                left: `${map.pin.left}%`,
                top: `${map.pin.top}%`,
                boxShadow: "0 0 0 1px var(--color-hairline)",
              }}
            />
            <div
              className="absolute whitespace-nowrap rounded-full border border-hairline bg-canvas px-[9px] py-[3px] text-[12.5px] font-semibold text-ink"
              style={{ left: `${map.pin.left + 4}%`, top: `${map.pin.top - 4}%` }}
            >
              {map.pin.label}
            </div>

            {/* Placeholder note */}
            <div className="absolute bottom-[10px] left-[10px] rounded-full bg-canvas/90 px-[9px] py-1 text-[12.5px] text-faint">
              Placeholder — layers not wired to real GIS data yet
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
