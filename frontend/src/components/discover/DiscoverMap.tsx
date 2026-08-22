"use client";

import { useId } from "react";
import { clsx } from "@/lib/clsx";
import { NO_DATA_COLOR, scoreColor } from "@/lib/discover/scoreRamp";
import type { DiscoverLayerId, Parcel } from "@/lib/discover/types";

/**
 * Discovery map surface (web mode of the shared MapSurface concept — discovery
 * config: score fills + parcel polygons). Mock geometry for now; the production
 * surface swaps the SVG body for MapLibre + PMTiles without changing props.
 */

/** Parse absolute M/L/Z path points for a rough centroid + bbox. */
function pathStats(d: string): { cx: number; cy: number; minDim: number } | null {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!nums || nums.length < 6) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    xs.push(nums[i]);
    ys.push(nums[i + 1]);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    minDim: Math.min(maxX - minX, maxY - minY),
  };
}

const PREVIEW_LAYERS: Record<
  Exclude<DiscoverLayerId, "score">,
  { label: string; chip: string; overlay: string }
> = {
  slope: { label: "Slope", chip: "bg-vista-soft text-vista", overlay: "fill-vista" },
  flood: { label: "Flood", chip: "bg-vista-soft text-vista", overlay: "fill-vista-soft" },
  fire: { label: "Fire", chip: "bg-amande/60 text-risk-ink", overlay: "fill-amande" },
};

export function DiscoverMap({
  parcels,
  activeLayer,
  selectedId,
  onSelect,
}: {
  parcels: Parcel[];
  activeLayer: DiscoverLayerId;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const scoring = activeLayer === "score";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[11px] border border-hairline bg-surface-2 shadow-card">
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        role="application"
        aria-label="Parcel discovery map"
      >
        <defs>
          <filter id={`halo-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="3" stdDeviation="6" floodOpacity="0.25" />
          </filter>
        </defs>

        {/* street grid — hairlines on the recessed surface */}
        <g stroke="var(--color-hairline)" strokeWidth="1">
          {Array.from({ length: 19 }, (_, i) => (i + 1) * 50).map((v) => (
            <line key={`v${v}`} x1={v} y1={0} x2={v} y2={1000} />
          ))}
          {Array.from({ length: 19 }, (_, i) => (i + 1) * 50).map((v) => (
            <line key={`h${v}`} x1={0} y1={v} x2={1000} y2={v} />
          ))}
        </g>

        {/* parcels */}
        {parcels.map((p) => {
          const selected = p.id === selectedId;
          const stats = pathStats(p.path);
          return (
            <g
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="cursor-pointer"
              filter={selected ? `url(#halo-${uid})` : undefined}
            >
              <path
                d={p.path}
                fill={scoring ? scoreColor(p.score) : NO_DATA_COLOR}
                fillOpacity={scoring ? 0.85 : 0.7}
                stroke={selected ? "#ffffff" : "var(--color-muted)"}
                strokeOpacity={selected ? 1 : 0.35}
                strokeWidth={selected ? 14 : 2}
                strokeLinejoin="round"
              />
              {scoring && stats && stats.minDim >= 120 && (
                <text
                  x={stats.cx}
                  y={stats.cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none fill-ink font-jetbrains"
                  fontSize={stats.minDim >= 200 ? 44 : 30}
                  fontWeight={600}
                  opacity={0.75}
                >
                  {p.score}
                </text>
              )}
            </g>
          );
        })}

        {/* non-score layer preview wash */}
        {!scoring && (
          <rect
            width="1000"
            height="1000"
            className={clsx(PREVIEW_LAYERS[activeLayer].overlay, "pointer-events-none")}
            opacity={activeLayer === "flood" ? 0.5 : 0.3}
          />
        )}
      </svg>

      {!scoring && (
        <div
          className={clsx(
            "absolute left-1/2 top-4 max-w-[calc(100%-2rem)] -translate-x-1/2 truncate rounded-full px-3 py-1 text-[12.5px] font-medium",
            PREVIEW_LAYERS[activeLayer].chip,
          )}
        >
          {PREVIEW_LAYERS[activeLayer].label} — preview layer · mock data
        </div>
      )}
    </div>
  );
}
