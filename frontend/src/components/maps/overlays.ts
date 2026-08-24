import { GRID_PMTILES_URL } from "@/components/maps/gridOverlay";

/**
 * Optional GIS overlays for the map surfaces, drawn as raster Sources above
 * the basemap (MapLayersControl renders one Source/Layer per tile set of
 * every entry that is both enabled here and toggled on by the user).
 * `tiles` holds either an XYZ {z}/{y}/{x} template or a WMS GetMap /
 * ArcGIS export URL template containing {bbox-epsg-3857} — MapLibre expands
 * both for raster sources. Attribution is required credit and is passed
 * through to the raster Source.
 *
 * `enabled` is the verification gate: an endpoint ships as true only after a
 * real image tile was fetched from it (HTTP 200, image/png, non-trivial
 * bytes). Verification round: 2026-08-23, SF Bay Area sample tiles.
 * Failed endpoints are NOT in the panel — they appear here only as comments
 * explaining why.
 *
 * Entries default to raster; `kind: "vector-grid"` is the one discriminant:
 * the entry renders VECTOR layers from a pmtiles archive (styles in
 * maps/gridOverlay.ts) instead of raster tile sets, so `tiles` is unused
 * (pass []) and `pmtiles` carries the pmtiles:// archive URL.
 */
export interface OverlayDef {
  id: string; // stable id: "reference" | "counties" | "jurisdictions" | "wetlands" | "flood" | "fire" | "grid"
  label: string; // panel checkbox label
  attribution: string; // required credit, passed to the raster/vector Source
  tiles: string[]; // primary tile set: XYZ template OR WMS/export template with {bbox-epsg-3857}
  kind?: "vector-grid"; // absent = raster (the default); see header comment
  pmtiles?: string; // pmtiles:// archive URL — required when kind is "vector-grid"
  extraTileSets?: string[][]; // additional stacked tile sets under the same checkbox
  opacity: number; // raster layer opacity 0..1 (vector styles own their paint)
  minzoom?: number; // raster source minzoom — the service draws nothing below it
  maxzoom?: number;
  note?: string; // extra user-facing caveat line in the panel
  enabled: boolean; // ONLY verified endpoints get true
}

export const MAP_OVERLAYS: OverlayDef[] = [
  {
    id: "reference",
    label: "Roads & labels",
    attribution: "Esri, HERE, Garmin, FAO, NOAA, USGS",
    // The standard Esri reference overlays for imagery: transparent PNGs of
    // boundaries/place names (World_Boundaries_and_Places) stacked with the
    // road linework (World_Transportation) — this is what restores roads,
    // city names and line work on the raster-only satellite basemap.
    // VERIFIED 2026-08-23: both 200 image/png RGBA 256×256 at z6 (SF Bay).
    // Host is server.arcgisonline.com — server.arcgis-online.com is dead.
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    ],
    extraTileSets: [
      [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
      ],
    ],
    opacity: 1,
    enabled: true,
  },
  {
    id: "counties",
    label: "County boundaries",
    attribution: "U.S. Census Bureau TIGERweb",
    // VERIFIED 2026-08-23: LAYERS=11 (Counties) → 200 image/png 7.2KB at z8,
    // visible even statewide. NOTE: the TIGERweb/State_County service is a
    // dead end (tile cache 404s, its WMS GetCapabilities 400s) — only the
    // tigerWMS_Current WMS works.
    tiles: [
      "https://tigerweb.geo.census.gov/arcgis/services/TIGERweb/tigerWMS_Current/MapServer/WMSServer?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=11&STYLES=default&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true",
    ],
    opacity: 0.9,
    enabled: true,
  },
  {
    id: "jurisdictions",
    label: "City / jurisdiction limits",
    attribution: "U.S. Census Bureau TIGERweb",
    // VERIFIED 2026-08-23: LAYERS=49,51,48 (Incorporated Places +
    // Consolidated Cities + labels) → 200 image/png 3.7KB at z12. Returns a
    // valid-but-empty 888B PNG at z8 (scale-dependent), hence minzoom 10.
    tiles: [
      "https://tigerweb.geo.census.gov/arcgis/services/TIGERweb/tigerWMS_Current/MapServer/WMSServer?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=49,51,48&STYLES=default&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true",
    ],
    opacity: 0.9,
    minzoom: 10,
    enabled: true,
  },
  {
    id: "wetlands",
    label: "Wetlands (NWI)",
    attribution: "USFWS National Wetlands Inventory",
    // VERIFIED 2026-08-23: LAYERS=0 (the only layer) → 200 image/png 3.1KB
    // at z13. The service's MaxScaleDenominator is 94494 — below z13 it
    // returns valid-but-empty PNGs, hence minzoom 13.
    tiles: [
      "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/services/Wetlands/MapServer/WMSServer?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=0&STYLES=default&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true",
    ],
    opacity: 0.6,
    minzoom: 13,
    enabled: true,
  },
  {
    id: "flood",
    label: "FEMA flood hazard",
    attribution: "FEMA National Flood Hazard Layer",
    // VERIFIED 2026-08-23 via the MapServer EXPORT endpoint (not WMS):
    // 200 image/png with confirmed flood-zone pixels over SF + Sacramento.
    // The mission's WMS URL is dead: /gis/nfhl/... 404s (service moved to
    // /arcgis/rest/...) and NFHL has no WMS capability (/WMSServer returns
    // the HTML services directory). Legacy `layers=28` syntax is required —
    // `layers=show:28` is silently ignored (verified: empty PNGs).
    // Layer 28 = Flood Hazard Zones; minScale ~z14 but empirically draws at
    // z12 — minzoom 11 is the safe floor.
    tiles: [
      "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=28&f=image",
    ],
    opacity: 0.5,
    minzoom: 11,
    enabled: true,
  },
  {
    id: "fire",
    label: "Fire hazard severity",
    attribution: "CAL FIRE / CA Office of the State Fire Marshal",
    // VERIFIED 2026-08-23 via CA Geoportal MapServer export → 200 image/png
    // 10.8KB at z8 (statewide coverage). VINTAGE CAVEAT: layers 0/1 are the
    // 2007 SRA and 2011 LRA severity zones, NOT the current 2025 FHSZ.
    // No keyless raster endpoint exists for the 2025 zones (verified
    // failures: CAL FIRE egis.fire.ca.gov FRAP/FHSZ → 404 service not
    // found; Cal OES hosted tile cache → 404 on every tile despite
    // advertised LODs) — 2025 FHSZ is FeatureServer-only (vector), out of
    // scope for this raster panel.
    tiles: [
      "https://services.gis.ca.gov/arcgis/rest/services/Environment/Fire_Severity_Zones/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:0,1&f=image",
    ],
    opacity: 0.5,
    note: "2007/2011 vintage zones — not the 2025 FHSZ update.",
    enabled: true,
  },
  {
    id: "grid",
    label: "Power grid",
    attribution: "CEC · HIFLD · OpenStreetMap",
    // GRID V1 contract §4: vector layers (transmission lines by kV, substation
    // dots) from the backend-baked pmtiles archive — styles + protocol
    // registration live in maps/gridOverlay.ts.
    kind: "vector-grid",
    pmtiles: GRID_PMTILES_URL,
    tiles: [], // no raster tile sets — vector source via pmtiles
    opacity: 1, // unused for vector layers (their paint owns opacity)
    note: "Screening aid — mapped grid infrastructure, not capacity.",
    // VERIFIED 2026-08-24 against the branch backend (agent_backend/grid.py)
    // serving the real archive: GET /api/grid/tiles/grid.pmtiles with
    // Range: bytes=0-255 → 206 + 256 bytes; /api/grid/status loaded:true
    // (8,973 lines / 3,999 substations). REQUIRES the branch backend to be
    // deployed wherever the frontend points — a backend without the grid
    // routes logs pmtiles fetch errors and renders nothing for this layer.
    enabled: true,
  },
];
