import type { LayerProps } from "react-map-gl/maplibre";

import { apiUrl } from "@/lib/agent/client";

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

// Brand ink — same token the app chrome uses. Contract §7c: data-viz zone
// shading, deliberately NOT the red→green score ramp and NOT brand orange;
// no images/patterns (they would need per-map registration).
const INK = "#0b0829";

/** Fill + hairline outline pair for one tippecanoe source-layer: ~12% ink
 *  fill, 40% ink 1px outline (contract §7c). */
function classLayers(cls: string, fillOpacity: number): LayerProps[] {
  return [
    {
      id: `ovl-offlimits-${cls}-fill`,
      type: "fill",
      "source-layer": cls,
      paint: { "fill-color": INK, "fill-opacity": fillOpacity },
    },
    {
      id: `ovl-offlimits-${cls}-outline`,
      type: "line",
      "source-layer": cls,
      paint: { "line-color": INK, "line-opacity": 0.4, "line-width": 1 },
    },
  ];
}

/**
 * The overlay's vector layers, spread onto <Layer> children of the pmtiles
 * Source in MapLayersControl. Water first (slightly lighter fill, §7c) so
 * the land classes shade over it. Source-layer names are the tippecanoe
 * layer names from contract §7a; a class missing from the archive simply
 * renders nothing.
 */
export const OFFLIMITS_LAYERS: LayerProps[] = [
  ...classLayers("water", 0.08),
  ...classLayers("protected", 0.12),
  ...classLayers("military", 0.12),
  ...classLayers("tribal", 0.12),
];
