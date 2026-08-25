#!/usr/bin/env python3
"""Fetch + normalize CA connection-path blocker layers -> agent_backend/data/grid/

Products (contract: parcel-research/reports/10-grid-v1-contract.md section 5a):
  urban.geojson      Census 2020 Urban Areas (corrected), CA-clipped, props: name
  protected.geojson  CPAD 2026a Holdings simplified ~100 m, props: name (nullable)
  water.geojson      TIGER 2025 AREAWATER, 58 CA counties merged, >=100k m^2 only
  utilities.geojson  CEC Electric Load Serving Entities (IOU/POU), props: utility, kind, url

Sources (all verified live 2026-08-24; see parcel-research/reports/11-connection-path-blockers.md):
  1. TIGERweb "Urban" MapServer layer 6 ("2020 Urban Areas - Corrected"), geojson query
     filtered by CA bbox envelope intersect. Public domain (U.S. Gov work; attribution requested).
     https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Urban/MapServer/6
  2. CPAD 2026a Holdings (ArcGIS item f04ab55056744f09a2154ff1615e462f -> FeatureServer below).
     License: CC-BY per data.ca.gov — cite "California Protected Areas Database (CPAD -
     www.calands.org), June 2026". Paginated geojson queries (resultOffset/orderBy FID) with
     server-side generalization      maxAllowableOffset=0.001 deg (~100 m at CA latitudes) +
     geometryPrecision=4, so the ~847 MiB raw export is never downloaded whole.
     https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/CPAD_Holdings_wm/FeatureServer/0
  3. TIGER/Line 2025 AREAWATER per-county zips (58 CA counties, FIPS 06001..06115 odd).
     https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/tl_2025_06XXX_areawater.zip
     Public domain. Shapefiles parsed with a minimal stdlib reader (no geopandas/pyshp in env).
  4. CEC "ElectricLoadServingEntities_IOU_POU" FeatureServer layer 0 (53 polys).
     https://services3.arcgis.com/bWPjFyq029ChCGur/arcgis/rest/services/ElectricLoadServingEntities_IOU_POU/FeatureServer/0
     License: free for public use with CEC attribution (https://www.energy.ca.gov/conditions-of-use)

Fetch date: 2026-08-24. Re-runnable (fetches are stdlib urllib; shapely/pyproj from repo .venv
for clip/simplify/measure):
  ~/hackathons/rai/RAI/.venv/bin/python3 scripts/grid/fetch_blockers.py [urban|protected|water|utilities ...]

NOTES / HONEST OMISSIONS:
  * CA clip for protected/water/utilities = intersect the CA BBOX rectangle
    (-124.48,32.53,-114.13,42.01), NOT the exact state boundary: overhang beyond the state
    line inside the bbox is included (border slivers of water just across the line).
    Acceptable for corridor screening per contract.
  * Urban IS exact-state clipped (review 14): bbox filter, then intersect with the union of
    the 58 county polygons from frontend/src/lib/parcels/caCountyBoundaries.json, and any UA
    whose Census BASENAME carries no CA state token ("Lake Havasu City, AZ") is dropped
    outright — its in-bbox geometry is river-line overhang, not CA urban land.
  * Urban `name` uses TIGERweb BASENAME ("Modesto, CA"); the corrected layer's NAME field
    carries a " Urban Area" suffix. 2020 UA definition is a single urban-area type
    (post-2020 redefinition, report 11). 217 polys intersect the bbox.
  * Protected: geometry generalized server-side at ~100 m (maxAllowableOffset=0.001 deg in
    outSR=4326; ~88-111 m in CA). Output measured ~39 MB, at the <=40 MB target. CPAD excludes
    military/tribal lands and includes urban parks (report 11). Holdings of ALL access types
    kept (no LAYER/ACCESS_TYP filter) — screening layer, not an access map.
  * Water: source CRS is NAD83 (EPSG:4269); treated as WGS84/4326 output (datum shift < ~2 m,
    irrelevant at screening scale). Areas measured in EPSG:3310 (CA Albers); features
    < 100,000 m^2 dropped BEFORE simplification. Simplified 50 m RDP in EPSG:3310
    (preserve_topology=True), snapped to ~1 m grid, to meet the <=20 MB target.
  * Utilities: simplified 100 m RDP in EPSG:3310 + ~1 m snap — point-in-polygon territory
    lookup only; full-precision boundaries were 7.4 MB, not "tiny" per contract.
"""

import io
import json
import re
import struct
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from pyproj import Transformer
from shapely import make_valid, set_precision, unary_union
from shapely.geometry import MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import transform as shp_transform

OUT_DIR = Path(__file__).resolve().parent.parent.parent / "agent_backend" / "data" / "grid"
# Exact CA boundary for the urban clip: union of the 58 county polygons kept
# in the frontend parcel lib (reading it here avoids a second source).
CA_COUNTIES_JSON = (Path(__file__).resolve().parent.parent.parent
                    / "frontend" / "src" / "lib" / "parcels"
                    / "caCountyBoundaries.json")

URBAN_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/"
    "TIGERweb/Urban/MapServer/6/query"
)
CPAD_URL = (
    "https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/"
    "CPAD_Holdings_wm/FeatureServer/0/query"
)
WATER_ZIP = "https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/tl_2025_{fips}_areawater.zip"
UTIL_URL = (
    "https://services3.arcgis.com/bWPjFyq029ChCGur/arcgis/rest/services/"
    "ElectricLoadServingEntities_IOU_POU/FeatureServer/0/query"
)

CA_BBOX = (-124.48, 32.53, -114.13, 42.01)  # xmin, ymin, xmax, ymax (EPSG:4326)
CA_RECT = box(*CA_BBOX)
PAGE = 2000  # maxRecordCount on both ArcGIS Online services
WATER_MIN_M2 = 100_000.0  # drop tiny areal hydro features
WATER_SIMPLIFY_M = 50.0  # Ramer-Douglas-Peucker tolerance in EPSG:3310 meters
UTIL_SIMPLIFY_M = 100.0  # screening-grade PIP only; keeps file "tiny" per contract
CA_COUNTY_FIPS = [f"06{c:03d}" for c in range(1, 116, 2)]  # 58 CA counties

UA = {"User-Agent": "rai-grid-pipeline/1.0 (hackathon; contact: team)"}

# 4326 <-> EPSG:3310 (CA Albers, meters) for honest area measurement / simplification
TO_3310 = Transformer.from_crs("EPSG:4326", "EPSG:3310", always_xy=True)
FROM_3310 = Transformer.from_crs("EPSG:3310", "EPSG:4326", always_xy=True)


def http_open(url, retries=3, timeout=180):
    """GET with retries -> response bytes. stdlib only."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - simple retry wrapper
            print(f"  ! attempt {attempt + 1}/{retries} failed: {e}", file=sys.stderr)
            if attempt == retries - 1:
                raise
            time.sleep(3 * (attempt + 1))


def http_json(url, **kw):
    return json.loads(http_open(url, **kw).decode("utf-8"))


def arcgis_pages(base, extra_params):
    """Yield GeoJSON feature lists from an ArcGIS query endpoint, paginating resultOffset."""
    offset = 0
    while True:
        params = {
            "where": "1=1",
            "outSR": "4326",
            "f": "geojson",
            "resultRecordCount": PAGE,
            "resultOffset": offset,
            **extra_params,
        }
        url = base + "?" + urllib.parse.urlencode(params)
        page = http_json(url)
        if "error" in page:
            raise RuntimeError(f"ArcGIS error: {page['error']}")
        feats = page.get("features", [])
        yield feats
        if len(feats) < PAGE:
            break
        offset += PAGE


def polys_only(geom):
    """Reduce any shapely geom to Polygon/MultiPolygon (clip byproducts), else None."""
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    if geom.geom_type == "GeometryCollection":
        ps = []
        for g in geom.geoms:
            if g.geom_type == "Polygon":
                ps.append(g)
            elif g.geom_type == "MultiPolygon":
                ps.extend(g.geoms)
        if not ps:
            return None
        return ps[0] if len(ps) == 1 else MultiPolygon(ps)
    return None


def clip_ca(geom):
    """Intersect with CA bbox rect (overhang acceptable per contract); None if no overlap.
    Repairs invalid polygons (server-generalized sources ship some); drops the
    pathological few that defeat both make_valid and buffer(0)."""
    try:
        if geom.within(CA_RECT):
            out = polys_only(geom)
        else:
            out = polys_only(geom.intersection(CA_RECT))
        if out is not None and not out.is_valid:
            out = polys_only(make_valid(out))
        return out
    except Exception:  # noqa: BLE001 - degenerate GEOS cases
        try:
            return polys_only(make_valid(geom.buffer(0)))
        except Exception:  # noqa: BLE001
            return None


def ca_state_polygon():
    """Exact CA state polygon = unary_union of the 58 county boundaries."""
    fc = json.loads(CA_COUNTIES_JSON.read_text(encoding="utf-8"))
    return unary_union([shape(f["geometry"]) for f in fc["features"]])


def clip_state(geom, state):
    """Intersect with the exact CA state polygon; None if no overlap."""
    try:
        out = polys_only(geom.intersection(state))
        if out is not None and not out.is_valid:
            out = polys_only(make_valid(out))
        return out
    except Exception:  # noqa: BLE001 - degenerate GEOS cases
        return None


def simplify_m(geom, tol_m):
    """Simplify in EPSG:3310 (meters), back to 4326, snap to ~1 m grid (5 dp)."""
    g = shp_transform(TO_3310.transform, geom).simplify(tol_m, preserve_topology=True)
    g = shp_transform(FROM_3310.transform, g)
    if not g.is_valid:
        g = make_valid(g)  # set_precision raises TopologyException on invalid input
    return set_precision(g, 1e-5)


def write_fc(path, features):
    fc = {"type": "FeatureCollection", "features": features}
    with open(path, "w") as f:
        json.dump(fc, f, separators=(",", ":"))
    print(f"wrote {path} ({len(features)} features, {path.stat().st_size / 1e6:.1f} MB)")


# ---------------------------------------------------------------- urban (TIGERweb UAC20)


def fetch_urban():
    print("== Census 2020 Urban Areas (corrected) via TIGERweb Urban/MapServer/6 ==", flush=True)
    xmin, ymin, xmax, ymax = CA_BBOX
    env = {
        "geometry": f"{xmin},{ymin},{xmax},{ymax}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "BASENAME",
        "geometryPrecision": "6",
    }
    state = ca_state_polygon()
    out, dropped, dropped_oos = [], 0, 0
    for feats in arcgis_pages(URBAN_URL, env):
        for f in feats:
            g = f.get("geometry")
            if not g:
                continue
            geom = clip_ca(shape(g))
            if geom is None:
                dropped += 1
                continue
            name = (f.get("properties", {}).get("BASENAME") or "").strip() or None
            # Exact-state clip (contract §5a says "CA-clipped"). Census
            # BASENAME lists every state the UA spans ("Reno, NV--CA"); a
            # name with no CA token is an out-of-state UA whose in-bbox
            # geometry is river-line overhang (Lake Havasu City, AZ) — drop
            # it outright, else intersect and drop the non-intersecting.
            if name and not re.search(r"\bCA\b", name):
                dropped_oos += 1
                continue
            geom = clip_state(geom, state)
            if geom is None:
                dropped_oos += 1
                continue
            out.append({
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {"name": name},
            })
    print(f"  urban: {len(out)} kept, {dropped} dropped outside bbox, "
          f"{dropped_oos} dropped outside the state line")
    return out


# ------------------------------------------------------------- protected (CPAD 2026a)


def fetch_protected(path):
    print("== CPAD 2026a Holdings (paginated, generalized ~100 m server-side) ==", flush=True)
    params = {
        "outFields": "SITE_NAME",
        "orderByFields": "FID",
        "maxAllowableOffset": "0.001",  # degrees of outSR=4326 ~ 100 m in CA
        "geometryPrecision": "4",  # 11 m quantization, well under the 100 m tolerance
    }
    n = 0
    # stream-write: 160k+ features never all in memory
    with open(path, "w") as fh:
        fh.write('{"type":"FeatureCollection","features":[')
        for feats in arcgis_pages(CPAD_URL, params):
            for f in feats:
                g = f.get("geometry")
                if not g:
                    continue
                geom = clip_ca(shape(g))
                if geom is None:
                    continue
                name = (f.get("properties", {}).get("SITE_NAME") or "").strip() or None
                feat = {
                    "type": "Feature",
                    "geometry": mapping(geom),
                    "properties": {"name": name},
                }
                if n:
                    fh.write(",")
                json.dump(feat, fh, separators=(",", ":"))
                n += 1
            print(f"  cpad: {n} written so far", flush=True)
        fh.write("]}")
    print(f"wrote {path} ({n} features, {path.stat().st_size / 1e6:.1f} MB)")
    return n


# ------------------------------------------------------------ water (TIGER AREAWATER)


def parse_shp_polygons(buf):
    """Minimal stdlib .shp reader: yields ring-lists for Polygon (5) / PolygonZ (15) records."""
    if len(buf) < 100 or struct.unpack(">i", buf[0:4])[0] != 9994:
        raise ValueError("not a shapefile")
    pos = 100
    while pos + 8 <= len(buf):
        _recno, clen = struct.unpack(">2i", buf[pos : pos + 8])
        pos += 8
        content = buf[pos : pos + clen * 2]
        pos += clen * 2
        if len(content) < 4:
            continue
        stype = struct.unpack("<i", content[0:4])[0]
        if stype == 0:  # null shape
            continue
        if stype not in (5, 15):
            raise ValueError(f"unexpected shape type {stype} (expected polygon)")
        nparts, npts = struct.unpack("<2i", content[36:44])
        parts = list(struct.unpack(f"<{nparts}i", content[44 : 44 + 4 * nparts]))
        pts = [
            (round(x, 5), round(y, 5))
            for x, y in struct.iter_unpack("<2d", content[44 + 4 * nparts : 44 + 4 * nparts + 16 * npts])
        ]
        rings = []
        for i, start in enumerate(parts):
            end = parts[i + 1] if i + 1 < nparts else npts
            rings.append(pts[start:end])
        yield rings


def parse_dbf_names(buf):
    """Minimal stdlib .dbf reader: list of NAME field values (stripped, '' -> None)."""
    nrec = struct.unpack("<I", buf[4:8])[0]
    hlen, rlen = struct.unpack("<2H", buf[8:12])
    fields = []
    off = 32
    while buf[off] != 0x0D:
        fields.append(buf[off : off + 11].split(b"\x00")[0].decode("ascii", "replace").upper())
        off += 32
    try:
        idx = fields.index("NAME")
    except ValueError:
        return [None] * nrec
    starts = []
    p = 1
    pos = 32
    while buf[pos] != 0x0D:
        starts.append(p)
        p += buf[pos + 16]
        pos += 32
    names = []
    roff = hlen
    start = starts[idx]
    flen = buf[32 + 32 * idx + 16]
    for _ in range(nrec):
        rec = buf[roff : roff + rlen]
        roff += rlen
        if rec[0:1] == b"*":  # deleted record
            names.append(None)
            continue
        names.append(rec[start : start + flen].decode("latin-1").strip() or None)
    return names


def rings_to_geom(rings):
    """Assemble one shapely Polygon/MultiPolygon from shapefile rings (even-odd nesting)."""
    polys = []
    for r in rings:
        if len(r) < 4:
            continue
        if r[0] != r[-1]:
            r = r + [r[0]]
        try:
            p = Polygon(r)
        except Exception:  # noqa: BLE001 - skip degenerate rings
            continue
        if not p.is_empty and p.area > 0:
            polys.append(p)
    if not polys:
        return None
    if len(polys) == 1:
        return polys[0]
    polys.sort(key=lambda p: p.area, reverse=True)
    reps = [p.representative_point() for p in polys]
    parent, depth = [-1] * len(polys), [0] * len(polys)
    for i in range(1, len(polys)):
        for j in range(i - 1, -1, -1):  # smallest containing ring = nearest larger
            try:
                if polys[j].covers(reps[i]):
                    parent[i], depth[i] = j, depth[j] + 1
                    break
            except Exception:  # noqa: BLE001
                continue
    holes = {}
    for i in range(len(polys)):
        if depth[i] % 2 == 1 and parent[i] >= 0:
            holes.setdefault(parent[i], []).append(i)
    out = []
    for s in range(len(polys)):
        if depth[s] % 2 == 0:
            out.append(Polygon(
                polys[s].exterior.coords,
                [polys[h].exterior.coords for h in holes.get(s, [])],
            ))
    if not out:
        return None
    return out[0] if len(out) == 1 else MultiPolygon(out)


def fetch_water():
    print("== TIGER 2025 AREAWATER, 58 CA counties ==", flush=True)
    out, dropped_area, dropped_clip = [], 0, 0
    for fips in CA_COUNTY_FIPS:
        url = WATER_ZIP.format(fips=fips)
        data = http_open(url, timeout=120)
        zf = zipfile.ZipFile(io.BytesIO(data))
        names = zf.namelist()
        shp = zf.read(next(n for n in names if n.endswith(".shp")))
        dbf = zf.read(next(n for n in names if n.endswith(".dbf")))
        rec_names = parse_dbf_names(dbf)
        kept = total = 0
        for i, rings in enumerate(parse_shp_polygons(shp)):
            total += 1
            geom = rings_to_geom(rings)
            if geom is None:
                continue
            area_m2 = shp_transform(TO_3310.transform, geom).area
            if area_m2 < WATER_MIN_M2:
                dropped_area += 1
                continue
            geom = clip_ca(simplify_m(geom, WATER_SIMPLIFY_M))
            if geom is None:
                dropped_clip += 1
                continue
            name = rec_names[i] if i < len(rec_names) else None
            out.append({
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {"name": name},
            })
            kept += 1
        print(f"  {fips}: {kept}/{total} kept", flush=True)
    print(f"  water: {len(out)} kept, {dropped_area} dropped <100k m^2, {dropped_clip} outside bbox")
    return out


# ------------------------------------------------------------ utilities (CEC LSE)


def fetch_utilities():
    print("== CEC ElectricLoadServingEntities_IOU_POU layer 0 ==", flush=True)
    out = []
    for feats in arcgis_pages(UTIL_URL, {"outFields": "Utility,Type,URL"}):
        for f in feats:
            g = f.get("geometry")
            if not g:
                continue
            geom = clip_ca(simplify_m(shape(g), UTIL_SIMPLIFY_M))
            if geom is None:
                continue
            p = f.get("properties", {})
            out.append({
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {
                    "utility": (p.get("Utility") or "").strip() or None,
                    "kind": (p.get("Type") or "").strip() or None,
                    "url": (p.get("URL") or "").strip() or None,
                },
            })
    print(f"  utilities: {len(out)} kept")
    return out


LAYERS = ("urban", "protected", "water", "utilities")


def main():
    which = [a for a in sys.argv[1:] if a in LAYERS] or list(LAYERS)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if "urban" in which:
        write_fc(OUT_DIR / "urban.geojson", fetch_urban())
    if "protected" in which:
        fetch_protected(OUT_DIR / "protected.geojson")
    if "water" in which:
        write_fc(OUT_DIR / "water.geojson", fetch_water())
    if "utilities" in which:
        write_fc(OUT_DIR / "utilities.geojson", fetch_utilities())


if __name__ == "__main__":
    main()
