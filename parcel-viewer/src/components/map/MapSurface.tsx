import { useId } from "react";
import type { LayerId, MapSurfaceProps } from "../../contracts/types";
import { scoreColor } from "../../contracts/colors";

/**
 * Full-viewport mock map. One shared 1000x1000 SVG coordinate space:
 * hairline street grid + surface-2 backdrop for realism, parcels filled by
 * scoreColor() at ~0.85 opacity. Selection is a map-layer treatment (thick
 * white halo + drop shadow) — not UI chrome. Only the "score" layer has real
 * semantics; other layers dim parcels to nodata grey and show a translucent
 * themed preview overlay plus a "PREVIEW — mock layer" chip.
 */

/* ---- path helpers (mock data uses absolute M/L/Z commands only) ---- */

type Pt = [number, number];

function pathPoints(d: string): Pt[] {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}

/** Area-weighted polygon centroid (shoelace) — lands inside concave shapes. */
function centroid(pts: Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-6) {
    const n = Math.max(1, pts.length);
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (6 * a), cy / (6 * a)];
}

function bbox(pts: Pt[]): { w: number; h: number } {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Numeral size (viewBox units) for parcels large enough to hold one; 0 = hide. */
function labelSize(w: number, h: number): number {
  const m = Math.min(w, h);
  if (m >= 200) return 56;
  if (m >= 120) return 44;
  if (m >= 85) return 34;
  return 0;
}

/* ---- static decoration ---- */

const GRID = Array.from({ length: 9 }, (_, i) => (i + 1) * 100);
/** "Street" centerlines drawn in the real gaps between parcel bands. */
const STREETS = [440, 640, 760];

const OVERLAY_FILL: Record<Exclude<LayerId, "score">, string> = {
  slope: "fill-vista",
  flood: "fill-vista-soft",
  fire: "fill-amande",
};
const OVERLAY_OPACITY: Record<Exclude<LayerId, "score">, number> = {
  slope: 0.4,
  flood: 0.85,
  fire: 0.55,
};

export function MapSurface({ parcels, activeLayer, selectedId, onSelect }: MapSurfaceProps) {
  const shadowId = `parcel-shadow-${useId().replaceAll(":", "")}`;
  const isScore = activeLayer === "score";

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="xMidYMid slice"
        className="block h-full w-full"
        role="img"
        aria-label="Parcel map"
      >
        <defs>
          <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="10" floodOpacity="0.3" />
          </filter>
        </defs>

        {/* backdrop + faint street grid */}
        <rect x={0} y={0} width={1000} height={1000} className="fill-surface-2" />
        <g className="stroke-hairline" strokeWidth={3}>
          {GRID.map((v) => (
            <line key={`v${v}`} x1={v} y1={0} x2={v} y2={1000} />
          ))}
          {GRID.map((h) => (
            <line key={`h${h}`} x1={0} y1={h} x2={1000} y2={h} />
          ))}
        </g>
        <g className="stroke-canvas" strokeWidth={14} strokeLinecap="round" opacity={0.85}>
          {STREETS.map((y) => (
            <line key={y} x1={-10} y1={y} x2={1010} y2={y} />
          ))}
        </g>

        {/* parcels */}
        {parcels.map((p) => {
          const pts = pathPoints(p.path);
          const { w, h } = bbox(pts);
          const size = labelSize(w, h);
          const [cx, cy] = centroid(pts);
          const selected = p.id === selectedId;
          return (
            <g
              key={p.id}
              onClick={() => onSelect(p.id)}
              style={{ cursor: "pointer" }}
              filter={selected ? `url(#${shadowId})` : undefined}
            >
              {selected && (
                <path
                  d={p.path}
                  fill="none"
                  className="stroke-canvas"
                  strokeWidth={14}
                  strokeLinejoin="round"
                  strokeOpacity={0.95}
                />
              )}
              <path
                d={p.path}
                fill={isScore ? scoreColor(p.score) : undefined}
                fillOpacity={isScore ? 0.85 : 0.7}
                className={`stroke-muted ${isScore ? "" : "fill-nodata"}`}
                strokeWidth={selected ? 3 : 2}
                strokeOpacity={selected ? 0.6 : 0.35}
                strokeLinejoin="round"
              />
              {isScore && size > 0 && (
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={size}
                  className="fill-ink stroke-canvas font-jetbrains font-semibold select-none"
                  strokeWidth={Math.max(2, size / 8)}
                  strokeOpacity={0.7}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {p.score}
                </text>
              )}
            </g>
          );
        })}

        {/* preview wash for non-score layers (mock semantics) */}
        {!isScore && (
          <g pointerEvents="none">
            <rect
              x={0}
              y={0}
              width={1000}
              height={1000}
              className={OVERLAY_FILL[activeLayer]}
              opacity={OVERLAY_OPACITY[activeLayer]}
            />
            {activeLayer === "flood" && (
              <g className="stroke-vista" strokeWidth={7} fill="none" strokeLinecap="round" opacity={0.8}>
                <path d="M 140 430 q 35 -28 70 0 t 70 0 t 70 0" />
                <path d="M 560 520 q 35 -28 70 0 t 70 0 t 70 0" />
                <path d="M 260 610 q 35 -28 70 0 t 70 0 t 70 0" />
              </g>
            )}
          </g>
        )}
      </svg>

      {!isScore && (
        <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center">
          <span className="rounded-full bg-canvas/90 px-2.5 py-1 text-[10px] font-medium tracking-wide text-muted shadow-sm ring-1 ring-hairline">
            PREVIEW — mock layer
          </span>
        </div>
      )}
    </div>
  );
}
