import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { LayerProps } from "react-map-gl/maplibre";
import type {
  ExpressionSpecification,
  FilterSpecification,
} from "maplibre-gl";

import { apiUrl } from "@/lib/agent/client";

/**
 * Power-grid vector overlay (GRID V1 contract §4): CA transmission lines +
 * substations baked into a single pmtiles archive, served by the agent
 * backend with HTTP Range support (contract §3). Rendered as vector
 * Source/Layers by MapLayersControl, so it appears on every map surface the
 * layers tool serves (ParcelViewer, PortfolioMapView, SiteMapView).
 *
 * The archive URL rides the hackathon gate via apiUrl (token query param —
 * pmtiles' Range requests carry query strings through). pmtiles:// URLs
 * resolve through the Protocol registered below.
 */

export const GRID_PMTILES_URL = `pmtiles://${apiUrl("/api/grid/tiles/grid.pmtiles")}`;

let protocolRegistered = false;

/**
 * Register the pmtiles:// protocol with MapLibre exactly once. Module state
 * survives within a session but HMR re-executes this module with a fresh
 * flag, so addProtocol is also wrapped — maplibre throws on a duplicate
 * protocol name, which just means a previous instance beat us to it.
 */
export function ensurePmtilesProtocol(): void {
  if (protocolRegistered) return;
  protocolRegistered = true;
  try {
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
  } catch {
    // Already registered by a previous (HMR) module instance.
  }
}

// Module scope: registering on import guarantees the protocol exists before
// any grid Source mounts, wherever MapLayersControl is rendered.
ensurePmtilesProtocol();

/** Normalized kv attribute: null/unknown reads as -1 so step/interpolate
 *  treat it as the hairline/base band below every real voltage class. */
const KV = ["coalesce", ["get", "kv"], -1] as unknown as ExpressionSpecification;

/** Zoom gate (contract §4): nothing below z6; only ≥230 kV features draw at
 *  z6–8; everything draws from z9 up. */
const ZOOM_GATE: FilterSpecification = [
  "any",
  [">=", ["zoom"], 9],
  ["all", [">=", ["zoom"], 6], [">=", KV, 230]],
];

// Neutral grey ramp — data-viz zone styling, deliberately NOT the red→green
// score ramp, NOT brand orange, and NOT blue/violet (brand ink #0b0829 is
// navy-leaning and reads blue on canvas — user feedback 2026-08-24).
// Hue-free: darkness alone scales with kv, unknown is a hairline grey.
const LINE_COLOR = [
  "step",
  KV,
  "#b9b9c0", // unknown — hairline grey
  0,
  "#9a9aa2", // <115 kV
  115,
  "#7d7d86", // 115 kV
  230,
  "#5c5c64", // 230 kV
  345,
  "#3d3d44", // 345 kV
  500,
  "#1e1e26", // 500+ kV — near-black (watch token, neutral)
] as unknown as ExpressionSpecification;

const LINE_WIDTH = [
  "step",
  KV,
  0.75, // unknown — hairline
  0,
  1, // <115 kV
  115,
  1.5, // 115 kV
  230,
  2.5, // 230 kV
  345,
  3, // 345 kV
  500,
  3.5, // 500+ kV
] as unknown as ExpressionSpecification;

const CIRCLE_RADIUS = [
  "interpolate",
  ["linear"],
  KV,
  0,
  3, // unknown
  115,
  4,
  230,
  5,
  345,
  6,
  500,
  7,
] as unknown as ExpressionSpecification;

/**
 * The grid overlay's vector layers, spread onto <Layer> children of the
 * pmtiles Source in MapLayersControl. Transmission first so substation dots
 * draw above the lines. Source-layer names are the tippecanoe layer names
 * from contract §1.
 */
export const GRID_LAYERS: LayerProps[] = [
  {
    id: "ovl-grid-transmission",
    type: "line",
    "source-layer": "transmission",
    minzoom: 6,
    filter: ZOOM_GATE,
    paint: {
      "line-color": LINE_COLOR,
      "line-width": LINE_WIDTH,
      "line-opacity": 0.85,
    },
  },
  {
    id: "ovl-grid-substations",
    type: "circle",
    "source-layer": "substations",
    minzoom: 6,
    filter: ZOOM_GATE,
    paint: {
      "circle-radius": CIRCLE_RADIUS,
      "circle-color": "#1e1e26", // neutral near-black, not blue/violet
      "circle-opacity": 0.9,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  },
];
