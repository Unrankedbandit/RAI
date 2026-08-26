import type { StyleSpecification } from "maplibre-gl";

/**
 * Switchable basemap styles for the map surfaces. Satellite is the default
 * (user call 2026-08-22): Esri World Imagery as an inline keyless raster
 * style — the same style as PortfolioMapView's MAP_STYLE_SATELLITE. Light
 * and dark are the keyless CARTO vector styles (Positron / Dark Matter),
 * referenced by URL. Attribution is carried by each style and stays visible
 * (required).
 */
export type BasemapId = "satellite" | "light" | "dark";

// Satellite: Esri World Imagery — keyless, CORS-friendly raster tiles;
// attribution required and kept.
// Host note (verified 2026-08-23): server.arcgis-online.com — the host the
// old per-component styles used — no longer resolves (DNS fail, curl 000),
// so those satellite basemaps rendered blank. server.arcgisonline.com and
// services.arcgisonline.com both serve the identical tiles (200, image/jpeg).
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  // Keyless CARTO glyph PBFs — the same host the Positron/Dark Matter styles
  // use. Without a glyphs URL, symbol layers with text-field (e.g. the grid
  // distance label in ParcelViewer) silently render nothing on this basemap.
  // VERIFIED 2026-08-24: Open Sans Regular 0-255.pbf → 200, 40KB.
  glyphs: "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf",
  sources: {
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [
    // Background UNDER the raster: the style has no background layer, so a
    // tile still in flight (or a 404 past Esri's coverage) used to show the
    // app shell straight through — the "white boxes" reported 2026-08-25.
    // Color = measured mean tone of CA farmland tiles at z14–17.
    { id: "background", type: "background", paint: { "background-color": "#6a7057" } },
    { id: "satellite", type: "raster", source: "satellite" },
  ],
};

export const BASEMAP_STYLES: Record<BasemapId, string | StyleSpecification> = {
  satellite: SATELLITE_STYLE,
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};

export const BASEMAP_LABELS: Record<BasemapId, string> = {
  satellite: "Satellite",
  light: "Light",
  dark: "Dark",
};
