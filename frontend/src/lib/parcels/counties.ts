/**
 * California county parcel point-lookup.
 *
 * Endpoint data verified live 2026-08-22.
 * Sources: county ArcGIS open data portals, Socrata (Santa Clara / San Mateo),
 * and the CA DWR i15 statewide assessor-parcel mosaic as fallback.
 */

// Simplified 58-county boundaries (Census cb 500k via the plotly
// geojson-counties extract, STATEFP 06) — routes a click to the clicked
// county's OWN endpoint instead of the statewide DWR mosaic, which was
// observed 500ing after ~60 s on 2026-08-24 and made statewide-mode
// selection unusable. Generalized borders: near a county line the wrong
// county may resolve — callers fall back to the mosaic on a null county hit.
import caCountyBoundariesRaw from './caCountyBoundaries.json';

const caCountyBoundaries =
  caCountyBoundariesRaw as unknown as GeoJSON.FeatureCollection;

export interface CountyConfig {
  name: string;
  status: 'live' | 'partial' | 'mosaic-only';
  api: 'arcgis' | 'socrata';
  /** ArcGIS layer URL (no /query suffix) or Socrata resource URL. */
  endpoint?: string;
  note?: string;
}

export const STATEWIDE_COUNTY_NAME = 'Statewide (DWR mosaic)';

const DWR_MOSAIC_ENDPOINT =
  'https://gis.water.ca.gov/arcgis/rest/services/Planning/i15_Parcels_Assessor_Lightbox/MapServer/0';

/** All 58 California counties, alphabetical. */
export const COUNTIES: CountyConfig[] = [
  { name: 'Alameda', status: 'live', api: 'arcgis', endpoint: 'https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Parcels/FeatureServer/0' },
  { name: 'Alpine', status: 'live', api: 'arcgis', endpoint: 'https://services.arcgis.com/q3Zg9ERurv23iysr/arcgis/rest/services/Alpine_County/FeatureServer/0', note: 'unofficial consultant mirror' },
  { name: 'Amador', status: 'live', api: 'arcgis', endpoint: 'https://services8.arcgis.com/uzb563eo87NppqyM/arcgis/rest/services/Amador_County_Parcels/FeatureServer/0' },
  { name: 'Butte', status: 'partial', api: 'arcgis', endpoint: 'https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/DR4407_Parcels_Master_Set_for_PFM/FeatureServer/0', note: 'fire-recovery subsets only' },
  { name: 'Calaveras', status: 'mosaic-only', api: 'arcgis', note: 'no open parcel fabric; use statewide mosaic' },
  { name: 'Colusa', status: 'live', api: 'arcgis', endpoint: 'https://services2.arcgis.com/YqPSsZvq2dd1wPP5/arcgis/rest/services/NWFW_Sacramento_River_Property_Boundary/FeatureServer/0' },
  { name: 'Contra Costa', status: 'live', api: 'arcgis', endpoint: 'https://gis.cccounty.us/arcgis/rest/services/CCMAP/Assessment_Parcels_ArcPro/MapServer/0' },
  { name: 'Del Norte', status: 'live', api: 'arcgis', endpoint: 'https://services3.arcgis.com/IkUDY1vRIUWiVvcz/arcgis/rest/services/Parcels_20240628/FeatureServer/0', note: '2024-06-28 snapshot' },
  { name: 'El Dorado', status: 'live', api: 'arcgis', endpoint: 'https://services.arcgis.com/UHg8l1wC48WQyDSO/arcgis/rest/services/ParcelBase/FeatureServer/0' },
  { name: 'Fresno', status: 'live', api: 'arcgis', endpoint: 'https://services3.arcgis.com/ibgDyuD2DLBge82s/arcgis/rest/services/REGIONAL_PARCELS_VW/FeatureServer/11', note: 'geometry + APN only' },
  { name: 'Glenn', status: 'live', api: 'arcgis', endpoint: 'https://services.arcgis.com/q3Zg9ERurv23iysr/arcgis/rest/services/Glenn_County/FeatureServer/0', note: 'unofficial consultant mirror' },
  { name: 'Humboldt', status: 'live', api: 'arcgis', endpoint: 'https://webgis.co.humboldt.ca.us/arcgis/rest/services/Accela_Parcels_Roads/MapServer/2' },
  { name: 'Imperial', status: 'mosaic-only', api: 'arcgis', note: 'no open parcel service; use statewide mosaic' },
  { name: 'Inyo', status: 'live', api: 'arcgis', endpoint: 'https://services.arcgis.com/0jRlQ17Qmni5zEMr/arcgis/rest/services/OpenGov_GIS_Flags/FeatureServer/0' },
  { name: 'Kern', status: 'partial', api: 'arcgis', endpoint: 'https://services5.arcgis.com/Y8jwjGUWbRjuqpG5/arcgis/rest/services/Assessor_Parcels_Mineral_2026_gdb/FeatureServer/0', note: 'mineral-rights subset only' },
  { name: 'Kings', status: 'mosaic-only', api: 'arcgis', note: 'no open parcel service; use statewide mosaic' },
  { name: 'Lake', status: 'live', api: 'arcgis', endpoint: 'https://services.arcgis.com/q3Zg9ERurv23iysr/arcgis/rest/services/Lake_County/FeatureServer/0', note: 'unofficial consultant mirror' },
  { name: 'Lassen', status: 'live', api: 'arcgis', endpoint: 'https://services.arcgis.com/q3Zg9ERurv23iysr/arcgis/rest/services/Lassen_Parcel_Final_Schema1/FeatureServer/0', note: 'unofficial consultant mirror' },
  { name: 'Los Angeles', status: 'live', api: 'arcgis', endpoint: 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0' },
  { name: 'Madera', status: 'live', api: 'arcgis', endpoint: 'https://services.arcgis.com/q3Zg9ERurv23iysr/arcgis/rest/services/Madera_County_Map/FeatureServer/0', note: 'unofficial consultant mirror' },
  { name: 'Marin', status: 'live', api: 'arcgis', endpoint: 'https://services6.arcgis.com/T8eS7sop5hLmgRRH/arcgis/rest/services/Parcels/FeatureServer/0', note: 'geometry + parcel number only' },
  { name: 'Mariposa', status: 'live', api: 'arcgis', endpoint: 'https://services2.arcgis.com/wEula7SYiezXcdRv/arcgis/rest/services/Mariposa_County_GIS_TylerTech_FEATURE_SERVICE/FeatureServer/0' },
  { name: 'Mendocino', status: 'live', api: 'arcgis', endpoint: 'https://services5.arcgis.com/8y4r60VTvWj2wnDH/arcgis/rest/services/Parcels_Public_/FeatureServer/0' },
  { name: 'Merced', status: 'live', api: 'arcgis', endpoint: 'https://gis.countyofmerced.com/server/rest/services/Assessment_Parcels/FeatureServer/42' },
  { name: 'Modoc', status: 'mosaic-only', api: 'arcgis', note: 'no open parcel service; use statewide mosaic' },
  { name: 'Mono', status: 'live', api: 'arcgis', endpoint: 'https://gis.mono.ca.gov/webgis/rest/services/OpenData/Cadastral/MapServer/1' },
  { name: 'Monterey', status: 'live', api: 'arcgis', endpoint: 'https://services2.arcgis.com/nOGTdfb4kF4dZljH/arcgis/rest/services/Parcels/FeatureServer/0' },
  { name: 'Napa', status: 'live', api: 'arcgis', endpoint: 'https://services1.arcgis.com/Ko5rxt00spOfjMqj/arcgis/rest/services/Napa_County_Public_Parcels/FeatureServer/1' },
  { name: 'Nevada', status: 'live', api: 'arcgis', endpoint: 'https://maps.nevadacountyca.gov/arcgis/rest/services/web_public/Open_Data_Layers_Nevada_County/FeatureServer/100' },
  { name: 'Orange', status: 'live', api: 'arcgis', endpoint: 'https://utility.arcgis.com/usrsvcs/servers/a3621f4006e94af8bcfd8861fedda22e/rest/services/OCLandInsights/ParcelsExternal/FeatureServer/999001' },
  { name: 'Placer', status: 'mosaic-only', api: 'arcgis', note: 'county server unreachable; use statewide mosaic' },
  { name: 'Plumas', status: 'live', api: 'arcgis', endpoint: 'https://services1.arcgis.com/SIYkiqjmENweC50g/arcgis/rest/services/Plumas_County_Parcels/FeatureServer/0', note: 'July 2025 snapshot' },
  { name: 'Riverside', status: 'mosaic-only', api: 'arcgis', note: 'county MapServer has no queryable layers; use statewide mosaic' },
  { name: 'Sacramento', status: 'live', api: 'arcgis', endpoint: 'https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Parcels/FeatureServer/0' },
  { name: 'San Benito', status: 'live', api: 'arcgis', endpoint: 'https://services2.arcgis.com/NjMFCzThTMQy3AJa/arcgis/rest/services/San_Benito_County_Parcels_w_Assessors_Data/FeatureServer/0' },
  { name: 'San Bernardino', status: 'live', api: 'arcgis', endpoint: 'https://services.arcgis.com/aA3snZwJfFkVyDuP/arcgis/rest/services/Parcels_for_San_Bernardino_County/FeatureServer/0' },
  { name: 'San Diego', status: 'live', api: 'arcgis', endpoint: 'https://geo.sandag.org/server/rest/services/Hosted/Parcels/FeatureServer/0', note: 'SanGIS/SANDAG regional service' },
  { name: 'San Francisco', status: 'live', api: 'arcgis', endpoint: 'https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/Active_Parcels_from_DataSF_pulled_daily_/FeatureServer/0' },
  { name: 'San Joaquin', status: 'live', api: 'arcgis', endpoint: 'https://services.arcgis.com/q3Zg9ERurv23iysr/arcgis/rest/services/SJ_Cty/FeatureServer/1', note: 'unofficial consultant mirror' },
  { name: 'San Luis Obispo', status: 'live', api: 'arcgis', endpoint: 'https://gis.slocounty.ca.gov/arcgis/rest/services/ACTTC/ACTTCParcels/MapServer/0', note: 'geometry + APN only' },
  { name: 'San Mateo', status: 'live', api: 'socrata', endpoint: 'https://data.smcgov.org/resource/nr6j-72z7.json' },
  { name: 'Santa Barbara', status: 'partial', api: 'arcgis', endpoint: 'https://services9.arcgis.com/ztLwtMXzJMy86yJE/arcgis/rest/services/EvacuationDRAFT_ParcelsAtRisk/FeatureServer/0', note: 'evacuation-risk subset only' },
  { name: 'Santa Clara', status: 'live', api: 'socrata', endpoint: 'https://data.sccgov.org/resource/ubcd-cewv.json' },
  { name: 'Santa Cruz', status: 'partial', api: 'arcgis', endpoint: 'https://services1.arcgis.com/jJfZghspGKh8J9Jm/arcgis/rest/services/Phase_I_Parcels/FeatureServer/0', note: 'Phase I project parcels only' },
  { name: 'Shasta', status: 'live', api: 'arcgis', endpoint: 'https://gis.shastacounty.gov/arcgis/rest/services/Internet/Fall_River_Valley_FPD_Shasta_and_Lassen_Parcels_20260715_public/FeatureServer/8' },
  { name: 'Sierra', status: 'live', api: 'arcgis', endpoint: 'https://services2.arcgis.com/2yQutf5QqkjGa5Rs/arcgis/rest/services/Sierra_County_Parcels2014/FeatureServer/0', note: '2014 snapshot' },
  { name: 'Siskiyou', status: 'partial', api: 'arcgis', endpoint: 'https://services5.arcgis.com/oe3k134aAvdSB7Iw/arcgis/rest/services/Parcels_2020/FeatureServer/0', note: 'Yreka-area 2020 subset only' },
  { name: 'Solano', status: 'live', api: 'arcgis', endpoint: 'https://services2.arcgis.com/SCn6czzcqKAFwdGU/arcgis/rest/services/Parcels_Public_Aumentum/FeatureServer/0' },
  { name: 'Sonoma', status: 'live', api: 'arcgis', endpoint: 'https://socogis.sonomacounty.ca.gov/map/rest/services/CRAPublic/Parcels_Public_WM/FeatureServer/0' },
  { name: 'Stanislaus', status: 'live', api: 'arcgis', endpoint: 'https://services.arcgis.com/EeYBJFxLdUojipYa/arcgis/rest/services/Public_Parcels/FeatureServer/0' },
  { name: 'Sutter', status: 'live', api: 'arcgis', endpoint: 'https://services.arcgis.com/q3Zg9ERurv23iysr/arcgis/rest/services/Sutter_Parcels_Final_Schema/FeatureServer/0', note: 'unofficial consultant mirror' },
  { name: 'Tehama', status: 'partial', api: 'arcgis', endpoint: 'https://services6.arcgis.com/QECOH4AqBRtmcvcJ/arcgis/rest/services/Stringtown_Parcels/FeatureServer/0', note: 'Stringtown area only' },
  { name: 'Trinity', status: 'live', api: 'arcgis', endpoint: 'https://services2.arcgis.com/32siQkg0O6da8zFF/arcgis/rest/services/Parcel_Service_view/FeatureServer/0', note: 'geometry only' },
  { name: 'Tulare', status: 'live', api: 'arcgis', endpoint: 'https://services3.arcgis.com/HLLHUzx8yBgga6a7/arcgis/rest/services/Public_Parcels__Tulare_County/FeatureServer/0', note: 'public subset only' },
  { name: 'Tuolumne', status: 'live', api: 'arcgis', endpoint: 'https://services3.arcgis.com/afQpMaliVrwHS7Ud/arcgis/rest/services/Parcels_WithSiteAddress_view/FeatureServer/2' },
  { name: 'Ventura', status: 'live', api: 'arcgis', endpoint: 'https://services2.arcgis.com/XJ5Tb7dTYtAMoyYT/arcgis/rest/services/Parcels_Quarterly/FeatureServer/0' },
  { name: 'Yolo', status: 'live', api: 'arcgis', endpoint: 'https://services2.arcgis.com/RETsakmE0SJfZXCd/arcgis/rest/services/Yolo_County_Tax_Parcels_Open_Data_/FeatureServer/0' },
  { name: 'Yuba', status: 'live', api: 'arcgis', endpoint: 'https://gis.yuba.org/arcgis/rest/services/Yuba_Parcels_Map_MIL1/MapServer/0' },
];

export interface ParcelResult {
  county: string;
  apn?: string;
  address?: string;
  owner?: string;
  acres?: number;
  landUse?: string;
  geometry: GeoJSON.Geometry | null;
  /** Provenance of the boundary linework (e.g. "Solano County GIS" or
   *  DWR_MOSAIC_SOURCE). The map's gray overlay lines are Regrid's
   *  nationwide fabric — a DIFFERENT dataset with its own vintage — so a
   *  selected shape that doesn't coincide with the overlay lines is a
   *  data mismatch, not a rendering offset. Shown in the rail. */
  source: string;
  raw: Record<string, unknown>;
}

/** ParcelResult.source value when the geometry came from the DWR i15
 *  statewide mosaic (statewide mode or a county-endpoint fallback). */
export const DWR_MOSAIC_SOURCE = 'CA DWR statewide mosaic';

const APN_FIELDS = [
  'APN', 'AIN', 'apn', 'ParcelNumber', 'AssessmentNo', 'mapblklot',
  'asmtnum', 'AsmtNum', 'ASMT_PRCL_INT', 'PARNO', 'Asmt', 'Name', 'PARCEL_APN',
];

const ADDRESS_FIELDS = [
  'SitusFullAddress', 'SitusAddress', 'situs_addr', 'FULL_ADD',
  'FullSitusAddress', 'FullAddress', 'AddressStr', 'SITE_ADDR',
  'ParcAdd1', 'SITUS_ADD', 'SitusAddress1', 'SITUS_1',
];

const OWNER_FIELDS = ['OwnerName', 'OWNERSHIP', 'Owner_1', 'OwnerFull', 'Owner', 'OWNER'];

const ACRES_FIELDS = [
  'Acreage', 'ACREAGE', 'GIS_ACRES', 'GIS_Acres', 'acres', 'ACRES',
  'CalcAcres', 'TOT_ACRES', 'ASMT_Acres', 'AREA_AC', 'landarea',
];

const LAND_USE_FIELDS = [
  'UseCode', 'USE_CODE', 'Land_Use_Code', 'LANDUSE', 'LAND_USE', 'CLASS_CD',
  'Use_Code', 'USE_', 'LUD', 'usecode', 'UseDqLanduse', 'General_Plan', 'GPLU_CODE',
];

interface RawHit {
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry | null;
}

/** Case-insensitive property lookup: returns first non-empty string/number among candidates. */
function pick(props: Record<string, unknown>, candidates: string[]): string | undefined {
  const lower = new Map<string, unknown>();
  for (const [key, value] of Object.entries(props)) {
    const lk = key.toLowerCase();
    if (!lower.has(lk)) lower.set(lk, value);
  }
  for (const name of candidates) {
    const value = lower.get(name.toLowerCase());
    if (value === null || value === undefined) continue;
    const str = String(value).trim();
    if (str !== '') return str;
  }
  return undefined;
}

function pickNumber(props: Record<string, unknown>, candidates: string[]): number | undefined {
  const str = pick(props, candidates);
  if (str === undefined) return undefined;
  const num = Number(str);
  return Number.isFinite(num) ? num : undefined;
}

function pickAddress(props: Record<string, unknown>): string | undefined {
  const direct = pick(props, ADDRESS_FIELDS);
  if (direct) return direct;
  const number = pick(props, ['STREET_NBR', 'situs_num']);
  const street = pick(props, ['STREET_NAM', 'situs_street']);
  if (number && street) return `${number} ${street}`;
  return street;
}

function normalize(county: string, hit: RawHit, source: string): ParcelResult {
  const props = hit.properties;
  return {
    county,
    apn: pick(props, APN_FIELDS),
    address: pickAddress(props),
    owner: pick(props, OWNER_FIELDS),
    acres: pickNumber(props, ACRES_FIELDS),
    landUse: pick(props, LAND_USE_FIELDS),
    geometry: hit.geometry,
    source,
    raw: props,
  };
}

/** Provenance label for a county's own endpoint, with its vintage caveat
 *  when the config carries one ("2014 snapshot", "mineral-rights subset
 *  only"…) — exactly the information that explains overlay mismatches. */
function countySource(county: CountyConfig): string {
  const base = `${county.name} County GIS`;
  return county.note ? `${base} — ${county.note}` : base;
}

/** Ray-cast point-in-ring. */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInGeometry(lon: number, lat: number, geom: GeoJSON.Geometry | null): boolean {
  if (!geom) return false;
  if (geom.type === 'Polygon') {
    const [outer, ...holes] = geom.coordinates;
    return pointInRing(lon, lat, outer) && !holes.some((h) => pointInRing(lon, lat, h));
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some(
      ([outer, ...holes]) =>
        pointInRing(lon, lat, outer) && !holes.some((h) => pointInRing(lon, lat, h)),
    );
  }
  return false;
}

/** Resolve the county containing a click point (generalized borders — see
 *  the import comment above). Null outside California. */
export function countyNameAtPoint(lon: number, lat: number): string | null {
  for (const f of caCountyBoundaries.features) {
    const name = (f.properties as { name?: string } | null)?.name;
    if (name && pointInGeometry(lon, lat, f.geometry)) return name;
  }
  return null;
}

/** Point-identify requests hang when a county server (or the DWR mosaic) is
 *  sick — observed 47–61 s mosaic 500s on 2026-08-24. Cap the wait so a dead
 *  endpoint fails fast to the fallback path instead of freezing the rail. */
const IDENTIFY_TIMEOUT_MS = 8000;

/**
 * Query parcels at a click point. Several ArcGIS servers (SF mirror, OC proxy,
 * DWR mosaic) silently return zero features for raw point-intersect queries,
 * while envelope queries work everywhere — so query a ~30 m bbox around the
 * point, then pick the feature whose polygon actually contains the click.
 *
 * The envelope routinely returns 5–10 features (neighbors, road/rail ROW
 * slivers). If NONE contains the click, the click landed in a gap or on a
 * ROW — returning features[0] here silently highlighted an arbitrary
 * (often corridor-sliver) parcel next to what the user clicked, so this
 * returns null and the viewer shows its honest "no parcel matched" state.
 */
async function queryArcGisPoint(endpoint: string, lon: number, lat: number): Promise<RawHit | null> {
  const d = 0.0003;
  const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
  const url =
    `${endpoint}/query?geometry=${bbox}&geometryType=esriGeometryEnvelope&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
  const res = await fetch(url, { signal: AbortSignal.timeout(IDENTIFY_TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    features?: Array<{ properties?: Record<string, unknown>; geometry?: GeoJSON.Geometry | null }>;
  };
  const features = data.features ?? [];
  if (features.length === 0) return null;
  const feature = features.find((f) => pointInGeometry(lon, lat, f.geometry ?? null));
  if (!feature) return null;
  return { properties: feature.properties ?? {}, geometry: feature.geometry ?? null };
}

const GEOJSON_TYPES = new Set([
  'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection',
]);

/** Socrata geo columns come back as GeoJSON objects; find whichever one the dataset has. */
function extractGeoJsonGeometry(row: Record<string, unknown>): GeoJSON.Geometry | null {
  for (const value of Object.values(row)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const type = (value as { type?: unknown }).type;
      if (typeof type === 'string' && GEOJSON_TYPES.has(type)) {
        return value as GeoJSON.Geometry;
      }
    }
  }
  return null;
}

async function querySocrataRaw(
  endpoint: string,
  lon: number,
  lat: number,
  geomColumn: string,
): Promise<RawHit | null> {
  const where = `intersects(${geomColumn},'POINT (${lon} ${lat})')`;
  const url = `${endpoint}?$where=${encodeURIComponent(where)}&$limit=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(IDENTIFY_TIMEOUT_MS) });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) return null;
  return { properties: row, geometry: extractGeoJsonGeometry(row) };
}

async function querySocrataPoint(endpoint: string, lon: number, lat: number): Promise<RawHit | null> {
  // Geometry column name varies by dataset (San Mateo: `shape`, Santa Clara: `the_geom`).
  return (
    (await querySocrataRaw(endpoint, lon, lat, 'shape').catch(() => null)) ??
    (await querySocrataRaw(endpoint, lon, lat, 'the_geom').catch(() => null))
  );
}

async function queryMosaic(countyName: string, lon: number, lat: number): Promise<ParcelResult | null> {
  const hit = await queryArcGisPoint(DWR_MOSAIC_ENDPOINT, lon, lat);
  if (!hit) return null;
  const sourceCounty = pick(hit.properties, ['COUNTYNAME']);
  const label = countyName === STATEWIDE_COUNTY_NAME ? (sourceCounty ?? countyName) : countyName;
  // The linework is the DWR mosaic's even when labeled with the county's
  // name (fallback path) — source must say where the geometry came from.
  return normalize(label, hit, DWR_MOSAIC_SOURCE);
}

/** Escape a user string for a SQL string literal (ArcGIS + Socrata both use ''). */
function sqlEscape(text: string): string {
  return text.replace(/'/g, "''");
}

/** Match candidate names against the fields a dataset actually has (case-insensitive). */
function matchFields(actual: string[], candidates: string[]): string[] {
  const lower = new Map(actual.map((a) => [a.toLowerCase(), a]));
  const out: string[] = [];
  for (const c of candidates) {
    const hit = lower.get(c.toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

// Field-name lookups are cached per endpoint so repeat searches cost one query.
const arcGisFieldsCache = new Map<string, Promise<string[]>>();

function arcGisFieldNames(endpoint: string): Promise<string[]> {
  let cached = arcGisFieldsCache.get(endpoint);
  if (!cached) {
    cached = (async () => {
      try {
        const res = await fetch(`${endpoint}?f=json`);
        if (!res.ok) return [];
        const data = (await res.json()) as { fields?: Array<{ name?: unknown }> };
        return (data.fields ?? [])
          .map((f) => f.name)
          .filter((n): n is string => typeof n === 'string');
      } catch {
        return [];
      }
    })();
    arcGisFieldsCache.set(endpoint, cached);
  }
  return cached;
}

const socrataFieldsCache = new Map<string, Promise<string[]>>();

function socrataFieldNames(endpoint: string): Promise<string[]> {
  let cached = socrataFieldsCache.get(endpoint);
  if (!cached) {
    cached = (async () => {
      try {
        // Cheapest schema probe: one row's keys are the column names.
        const res = await fetch(`${endpoint}?$limit=1`);
        if (!res.ok) return [];
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        const row = Array.isArray(rows) ? rows[0] : undefined;
        return row ? Object.keys(row) : [];
      } catch {
        return [];
      }
    })();
    socrataFieldsCache.set(endpoint, cached);
  }
  return cached;
}

/**
 * Text search over APN/address columns. A WHERE clause naming a field the
 * layer doesn't have makes the whole query 400, so the clause is built only
 * from fields confirmed present in the layer schema.
 */
async function searchArcGis(endpoint: string, text: string): Promise<RawHit[]> {
  const names = await arcGisFieldNames(endpoint);
  const targets = matchFields(names, [...APN_FIELDS, ...ADDRESS_FIELDS]);
  if (targets.length === 0) return [];
  const like = `'%${sqlEscape(text.toUpperCase())}%'`;
  const where = targets.map((f) => `UPPER(${f}) LIKE ${like}`).join(' OR ');
  const url =
    `${endpoint}/query?where=${encodeURIComponent(where)}` +
    `&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=5&f=geojson`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    features?: Array<{ properties?: Record<string, unknown>; geometry?: GeoJSON.Geometry | null }>;
  };
  return (data.features ?? []).map((f) => ({
    properties: f.properties ?? {},
    geometry: f.geometry ?? null,
  }));
}

async function searchSocrata(endpoint: string, text: string): Promise<RawHit[]> {
  const names = await socrataFieldNames(endpoint);
  const targets = matchFields(names, [...APN_FIELDS, ...ADDRESS_FIELDS]);
  if (targets.length === 0) return [];
  const like = `'%${sqlEscape(text.toUpperCase())}%'`;
  const where = targets.map((f) => `upper(${f}) like ${like}`).join(' OR ');
  const url = `${endpoint}?$where=${encodeURIComponent(where)}&$limit=5`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({ properties: row, geometry: extractGeoJsonGeometry(row) }));
}

/**
 * APN/address text search within one county, best 5 matches.
 * The statewide mosaic is a raster-style aggregation with no reliable
 * attribute query, so mosaic-only selections return [] — the viewer surfaces
 * a "text search needs a live county" empty state for those. Never throws.
 */
export async function searchParcels(countyName: string, text: string): Promise<ParcelResult[]> {
  try {
    const query = text.trim();
    if (!query || countyName === STATEWIDE_COUNTY_NAME) return [];
    const county = countyByName(countyName);
    if (!county || county.status === 'mosaic-only' || !county.endpoint) return [];
    const hits =
      county.api === 'socrata'
        ? await searchSocrata(county.endpoint, query)
        : await searchArcGis(county.endpoint, query);
    return hits.map((hit) => normalize(county.name, hit, countySource(county)));
  } catch {
    return [];
  }
}

export function countyByName(name: string): CountyConfig | undefined {
  return (
    COUNTIES.find((c) => c.name === name) ??
    COUNTIES.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
  );
}

// Identify results are cached per county+point (the promise itself, so
// concurrent identical clicks share one in-flight request). The DWR mosaic
// is slow when sick (observed 47–90 s on 2026-08-24/25, vs the 8 s identify
// timeout) — without this cache every repeat click burns the full timeout
// again. queryParcelAtPointInner never rejects (catch → null), so cached
// promises are safe to keep for the session. FIFO-capped.
// Key precision: 5 decimals ≈ 1 m — 4 decimals (~11 m cells) could return
// a NEIGHBORING parcel for clicks near a boundary (audit 2026-08-25).
const identifyCache = new Map<string, Promise<ParcelResult | null>>();
const IDENTIFY_CACHE_MAX = 200;

export function queryParcelAtPoint(
  countyName: string,
  lon: number,
  lat: number,
): Promise<ParcelResult | null> {
  const key = `${countyName}|${lon.toFixed(5)}|${lat.toFixed(5)}`;
  const cached = identifyCache.get(key);
  if (cached) return cached;
  const pending = queryParcelAtPointInner(countyName, lon, lat);
  if (identifyCache.size >= IDENTIFY_CACHE_MAX) {
    const oldest = identifyCache.keys().next().value;
    if (oldest !== undefined) identifyCache.delete(oldest);
  }
  identifyCache.set(key, pending);
  return pending;
}

async function queryParcelAtPointInner(
  countyName: string,
  lon: number,
  lat: number,
): Promise<ParcelResult | null> {
  try {
    if (countyName === STATEWIDE_COUNTY_NAME) {
      return await queryMosaic(countyName, lon, lat);
    }
    const county = countyByName(countyName);
    if (!county || county.status === 'mosaic-only' || !county.endpoint) {
      return await queryMosaic(countyName, lon, lat);
    }
    const hit =
      county.api === 'socrata'
        ? await querySocrataPoint(county.endpoint, lon, lat)
        : await queryArcGisPoint(county.endpoint, lon, lat);
    if (!hit) {
      // County endpoint missed (Socrata WKT columns can't be spatially
      // queried server-side; a border click may also resolve to the wrong
      // county; or the county server is down) — fall back to the mosaic.
      return await queryMosaic(county.name, lon, lat);
    }
    return normalize(county.name, hit, countySource(county));
  } catch {
    return null;
  }
}
