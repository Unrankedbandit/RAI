import type { LayerProps } from "react-map-gl/maplibre";

import { apiUrl } from "@/lib/agent/client";
import type { BasemapId } from "@/components/maps/basemaps";

/**
 * Off-limits land vector overlay (GRID V1 contract §7): protected holdings
 * (CPAD 2026a), water (TIGER AREAWATER), military + tribal (Census TIGER)
 * baked into a single pmtiles archive by the data pipeline, served by the
 * agent backend with HTTP Range support exactly like the grid archive
 * (the pmtiles:// protocol is registered by gridOverlay.ts, which every
 * map surface already imports via overlays.ts).
 *
 * Rendered as vector Source/Layers by MapLayersControl — the OverlayDef in
 * overlays.ts carries OFFLIMITS_LAYERS, so this appears on every map
 * surface the layers tool serves.
 */

export const OFFLIMITS_PMTILES_URL = `pmtiles://${apiUrl("/api/grid/tiles/offlimits.pmtiles")}`;

// Contract §7c: data-viz zone shading, deliberately NOT the red→green score
// ramp and NOT brand orange; no images/patterns (they would need per-map
// registration). Palette is basemap-adaptive (2026-08-24 user feedback):
// light keeps the liked ink wash; satellite needs ~2.5x the alpha to read
// over imagery; dark inverts to a light wash — ink on dark is invisible.
const INK = "#0b0829";
const LIGHT_WASH = "#e8e8f0";

interface Wash {
  color: string;
  fill: number; // land-class fill opacity
  waterFill: number;
  outline: number; // outline opacity
  width: number;
}

const WASH: Record<BasemapId, Wash> = {
  light: { color: INK, fill: 0.12, waterFill: 0.08, outline: 0.4, width: 1 },
  satellite: { color: INK, fill: 0.32, waterFill: 0.24, outline: 0.65, width: 1.25 },
  dark: { color: LIGHT_WASH, fill: 0.17, waterFill: 0.12, outline: 0.55, width: 1.25 },
};

/** Fill + hairline outline pair for one tippecanoe source-layer. Stable ids
 *  across basemaps so a basemap swap only repaints. */
function classLayers(cls: string, w: Wash, fillOpacity: number): LayerProps[] {
  return [
    {
      id: `ovl-offlimits-${cls}-fill`,
      type: "fill",
      "source-layer": cls,
      paint: { "fill-color": w.color, "fill-opacity": fillOpacity },
    },
    {
      id: `ovl-offlimits-${cls}-outline`,
      type: "line",
      "source-layer": cls,
      paint: {
        "line-color": w.color,
        "line-opacity": w.outline,
        "line-width": w.width,
      },
    },
  ];
}

/**
 * The overlay's vector layers for the given basemap, spread onto <Layer>
 * children of the pmtiles Source in MapLayersControl. Water first (lighter
 * fill, §7c) so the land classes shade over it. Source-layer names are the
 * tippecanoe layer names from contract §7a; a class missing from the archive
 * simply renders nothing.
 */
export function offlimitsLayers(basemap: BasemapId): LayerProps[] {
  const w = WASH[basemap];
  return [
    ...classLayers("water", w, w.waterFill),
    ...classLayers("protected", w, w.fill),
    ...classLayers("military", w, w.fill),
    ...classLayers("tribal", w, w.fill),
  ];
}
