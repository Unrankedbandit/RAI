#!/usr/bin/env python3
"""Fetch + normalize CA power-grid data -> agent_backend/data/grid/{lines,substations}.geojson

Sources (verified live 2026-08-24, see parcel-research/reports/07-power-grid-data-sources.md):
  1. CEC "California Electric Transmission Lines" — FeatureServer layer id 2 (geometry lives on layer 2!)
     https://services3.arcgis.com/bWPjFyq029ChCGur/arcgis/rest/services/Transmission_Line/FeatureServer/2
     License: free for public use with CEC attribution (https://www.energy.ca.gov/conditions-of-use)
  2. HIFLD "Electric Power Transmission Lines" (legacy live service; HIFLD Open deactivated 2025-08-26)
     https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0
     Queried with a California bbox envelope (intersects) as gap-fill to CEC. Public US Gov data; attribute DHS HIFLD.
  3. OpenStreetMap substations via Overpass API (power=substation in area ISO3166-2=US-CA, out center)
     https://overpass-api.de/api/interpreter   License: ODbL, "(c) OpenStreetMap contributors"

Fetch date: 2026-08-24. Re-runnable: python3 scripts/grid/fetch_grid_data.py  (stdlib only, no pip deps)

Normalized output attrs (contract: parcel-research/reports/10-grid-v1-contract.md section 1):
  lines.geojson:       kv (number|null), volt_class (string|null), owner, status, source ("CEC"|"HIFLD")
  substations.geojson: name (string|null), kv (number|null), source ("OSM")

NOTES / HONEST OMISSIONS:
  * CEC/HIFLD overlap DEDUP: SKIPPED. A ~500 m geometric containment dedup needs shapely/PostGIS;
    this script is stdlib-only per mission constraints. Expect duplicated corridors where HIFLD
    and CEC both map the same 115/230/500 kV lines (HIFLD gap-fill may double-count). Tile
    rendering tolerates this; the /api/grid/nearest endpoint should prefer source=="CEC" on ties.
  * HIFLD clip = bbox ENVELOPE intersect (-124.48,32.53,-114.13,42.01), not an exact CA boundary
    clip: segments just over the state line are included. Acceptable for screening distances.
  * Statuses indicating abandonment/removal are excluded (CEC "Closed"; HIFLD has none today:
    its statuses are IN SERVICE / NOT AVAILABLE / INACTIVE / UNDER CONSTRUCTION / PROPOSED).
    Proposed/under-construction kept with status flag, per contract.
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent.parent / "agent_backend" / "data" / "grid"

CEC_URL = (
    "https://services3.arcgis.com/bWPjFyq029ChCGur/arcgis/rest/services/"
    "Transmission_Line/FeatureServer/2/query"
)
HIFLD_URL = (
    "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/"
    "Electric_Power_Transmission_Lines/FeatureServer/0/query"
)
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",  # fallback mirror
]

CA_BBOX = (-124.48, 32.53, -114.13, 42.01)  # xmin, ymin, xmax, ymax (EPSG:4326)
PAGE = 2000  # maxRecordCount on both services

# Statuses that mean "gone" -> exclude per contract (abandoned/removed family).
EXCLUDE_STATUS = ("abandon", "remov", "closed", "retire", "decommission")

UA = {"User-Agent": "rai-grid-pipeline/1.0 (hackathon; contact: team)"}


def http_json(url, data=None, retries=3, timeout=120):
    """GET/POST JSON with retries. stdlib only."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - simple retry wrapper
            print(f"  ! attempt {attempt + 1}/{retries} failed: {e}", file=sys.stderr)
            if attempt == retries - 1:
                raise
            time.sleep(3 * (attempt + 1))


def arcgis_pages(base, extra_params):
    """Yield GeoJSON FeatureCollections from an ArcGIS FeatureServer, paginating resultOffset."""
    offset = 0
    while True:
        params = {
            "where": "1=1",
            "outFields": "*",
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


def excluded(status):
    return status and any(tok in str(status).lower() for tok in EXCLUDE_STATUS)


def parse_float(s):
    if s is None:
        return None
    m = re.search(r"\d+(\.\d+)?", str(s))
    return float(m.group(0)) if m else None


def fmt_kv(kv):
    """kv number -> volt_class string per contract examples ('115','230','500'; keep '34.5')."""
    if kv is None:
        return None
    return str(int(kv)) if kv == int(kv) else str(kv)


def norm_cec(props):
    kv = parse_float(props.get("kV"))
    if kv is None:
        kv = parse_float(props.get("kV_Sort"))
    if kv == 0:
        kv = None
    owner = (props.get("Owner") or "").strip() or None
    status = (props.get("Status") or "").strip() or None
    return {
        "kv": kv,
        "volt_class": fmt_kv(kv),
        "owner": owner,
        "status": status,
        "source": "CEC",
    }


def norm_hifld(props):
    kv = props.get("VOLTAGE")
    kv = float(kv) if isinstance(kv, (int, float)) and kv > 0 else None
    owner = (props.get("OWNER") or "").strip()
    owner = None if owner in ("", "NOT AVAILABLE") else owner
    status = (props.get("STATUS") or "").strip() or None
    vclass = fmt_kv(kv) if kv is not None else ((props.get("VOLT_CLASS") or "").strip() or None)
    return {
        "kv": kv,
        "volt_class": vclass,
        "owner": owner,
        "status": status,
        "source": "HIFLD",
    }


def fetch_lines():
    out = []

    print("== CEC Transmission_Line layer 2 ==", flush=True)
    dropped = kept = 0
    for feats in arcgis_pages(CEC_URL, {}):
        for f in feats:
            g = f.get("geometry")
            if not g or g.get("type") not in ("LineString", "MultiLineString"):
                continue
            p = f.get("properties", {})
            if excluded(p.get("Status")):
                dropped += 1
                continue
            out.append({"type": "Feature", "geometry": g, "properties": norm_cec(p)})
            kept += 1
        print(f"  cec: {kept} kept so far", flush=True)
    print(f"  CEC done: {kept} kept, {dropped} dropped (closed/abandoned/removed)")

    print("== HIFLD Electric_Power_Transmission_Lines (CA bbox envelope) ==", flush=True)
    xmin, ymin, xmax, ymax = CA_BBOX
    env = {
        "geometry": f"{xmin},{ymin},{xmax},{ymax}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
    }
    dropped = kept = 0
    for feats in arcgis_pages(HIFLD_URL, env):
        for f in feats:
            g = f.get("geometry")
            if not g or g.get("type") not in ("LineString", "MultiLineString"):
                continue
            p = f.get("properties", {})
            if excluded(p.get("STATUS")):
                dropped += 1
                continue
            out.append({"type": "Feature", "geometry": g, "properties": norm_hifld(p)})
            kept += 1
        print(f"  hifld: {kept} kept so far", flush=True)
    print(f"  HIFLD done: {kept} kept, {dropped} dropped")
    return out


OVERPASS_QL = """
[out:json][timeout:180];
area["ISO3166-2"="US-CA"]->.ca;
(
  nwr["power"="substation"](area.ca);
);
out center;
"""


def parse_osm_kv(tag):
    """OSM voltage tag like '500000;230000' (volts) -> max kV number."""
    if not tag:
        return None
    vals = []
    for part in re.split(r"[;,/]", str(tag)):
        m = re.search(r"\d+(\.\d+)?", part)
        if m:
            v = float(m.group(0))
            vals.append(v / 1000.0 if v > 1000 else v)  # volts -> kV heuristic
    if not vals:
        return None
    kv = max(vals)
    return int(kv) if kv == int(kv) else kv


def fetch_substations():
    print("== OSM power=substation via Overpass (CA) ==", flush=True)
    body = urllib.parse.urlencode({"data": OVERPASS_QL}).encode()
    last_err = None
    data = None
    for url in OVERPASS_URLS:
        try:
            print(f"  POST {url}")
            data = http_json(url, data=body, retries=2, timeout=300)
            break
        except Exception as e:  # noqa: BLE001
            print(f"  ! {url} failed: {e}")
            last_err = e
    if data is None:
        raise RuntimeError(f"all Overpass mirrors failed: {last_err}")

    out = []
    for el in data.get("elements", []):
        if el["type"] == "node":
            lon, lat = el.get("lon"), el.get("lat")
        else:
            c = el.get("center") or {}
            lon, lat = c.get("lon"), c.get("lat")
        if lon is None or lat is None:
            continue
        tags = el.get("tags", {})
        props = {
            "name": (tags.get("name") or "").strip() or None,
            "kv": parse_osm_kv(tags.get("voltage")),
            "source": "OSM",
        }
        out.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": props,
        })
    print(f"  OSM substations: {len(out)}")
    return out


def write_fc(path, features):
    fc = {"type": "FeatureCollection", "features": features}
    with open(path, "w") as f:
        json.dump(fc, f, separators=(",", ":"))
    print(f"wrote {path} ({len(features)} features, {path.stat().st_size / 1e6:.1f} MB)")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    lines = fetch_lines()
    write_fc(OUT_DIR / "lines.geojson", lines)
    subs = fetch_substations()
    write_fc(OUT_DIR / "substations.geojson", subs)


if __name__ == "__main__":
    main()
