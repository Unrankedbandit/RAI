import type { LayerProps } from "react-map-gl/maplibre";
import type { ExpressionSpecification } from "maplibre-gl";

import { apiUrl } from "@/lib/agent/client";
import type { BasemapId } from "@/components/maps/basemaps";

/**
 * Precomputed parcel-scores vector overlay (GRID V1 contract §8): every
 * scoreable parcel pre-scored 0-100 by scripts/score/ and baked into
 * scores.pmtiles (layer `scores`), served by the agent backend with HTTP
 * Range support exactly like the grid/offlimits archives (the pmtiles://
 * protocol is registered by gridOverlay.ts, which every map surface already
 * imports via overlays.ts).
 *
 * This layer IS the data-viz zone the frozen red→green ramp was reserved
 * for: red (0) = no-go / gated, green (100) = promising. Screening aid only.
 */

export const SCORES_PMTILES_URL = `pmtiles://${apiUrl("/api/grid/tiles/scores.pmtiles")}`;

// The frozen research ramp (contract §8c) — do not retune per basemap;
// only the fill opacity adapts (dark basemap gets ~0.75 so the ramp reads
// over the dark canvas without glowing).
const SCORE_COLOR = [
  "interpolate",
  ["linear"],
  ["get", "score"],
  0,
  "#d7191c",
  25,
  "#fdae61",
  50,
  "#ffffbf",
  75,
  "#a6d96a",
  100,
  "#1a9641",
] as unknown as ExpressionSpecification;

/** A darker step into the same ramp so parcel boundaries read without
 *  introducing an off-ramp color. */
const SCORE_OUTLINE = [
  "interpolate",
  ["linear"],
  ["get", "score"],
  0,
  "#a50f15",
  25,
  "#d95f02",
  50,
  "#c7c36a",
  75,
  "#7cad51",
  100,
  "#006d2c",
] as unknown as ExpressionSpecification;

/**
 * The overlay's vector layers for the given basemap, spread onto <Layer>
 * children of the pmtiles Source in MapLayersControl. Fill + hairline
 * outline on the tippecanoe source-layer `scores` (contract §8b). Stable
 * ids across basemaps — a basemap swap only repaints.
 */
export function scoresLayers(basemap: BasemapId): LayerProps[] {
  const dark = basemap === "dark";
  return [
    {
      id: "ovl-scores-fill",
      type: "fill",
      "source-layer": "scores",
      paint: {
        "fill-color": SCORE_COLOR,
        "fill-opacity": dark ? 0.75 : 0.6,
      },
    },
    {
      id: "ovl-scores-outline",
      type: "line",
      "source-layer": "scores",
      paint: {
        "line-color": SCORE_OUTLINE,
        "line-opacity": dark ? 0.8 : 0.65,
        "line-width": 0.75,
      },
    },
  ];
}
