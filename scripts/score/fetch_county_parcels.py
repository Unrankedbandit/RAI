#!/usr/bin/env python3
"""Fetch one county's parcels from its ArcGIS endpoint ->
agent_backend/data/scores/<County>.geojsonl (one GeoJSON Feature per line).

The endpoint registry is parsed from frontend/src/lib/parcels/counties.ts —
the single source of truth for which counties are live and where their
FeatureServer/MapServer layer URLs point (contract: parcel-research/reports/
10-grid-v1-contract.md section 8b; "live counties only", arcgis api only —
Socrata counties are out of scope for this fetcher).

Pagination: resultOffset/resultRecordCount with f=geojson&outSR=4326 and a
minimal outFields (APN candidates actually present in the layer schema — the
scorer only needs geometry; an APN keeps the output debuggable). The page
size is probed from the service metadata's maxRecordCount (default 1000).

Robustness: each page is retried up to 3x with backoff; progress is recorded
in <County>.geojsonl.progress (next offset) so an interrupted run resumes
where it left off. Delete the .progress file to start over.

Usage: fetch_county_parcels.py <county> [--max-pages N]
RAI_SCORES_DIR overrides the output dir (tests/fixtures)."""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parents[2]
SCORES_DIR = Path(
    __import__("os").getenv("RAI_SCORES_DIR")
    or REPO_ROOT / "agent_backend" / "data" / "scores"
)
COUNTIES_TS = REPO_ROOT / "frontend" / "src" / "lib" / "parcels" / "counties.ts"

DEFAULT_PAGE_SIZE = 1000
MAX_RETRIES = 5  # i15 500s on ~20% of pages — 3 was thin for it
# DWR i15 statewide assessor-parcel mosaic (the "statewide" identify path).
I15_ENDPOINT = ("https://gis.water.ca.gov/arcgis/rest/services/Planning/"
                "i15_Parcels_Assessor_Lightbox/MapServer/0")
I15_PAGE_SIZE = 1500  # probed max for county-filtered geometry pages
TIMEOUT_S = 60

# APN candidates mirrored from counties.ts APN_FIELDS — kept minimal on
# purpose; missing fields are simply not requested.
APN_CANDIDATES = [
    "APN", "AIN", "apn", "ParcelNumber", "AssessmentNo", "mapblklot",
    "asmtnum", "AsmtNum", "ASMT_PRCL_INT", "PARNO", "Asmt", "Name",
    "PARCEL_APN",
]


def load_registry() -> dict[str, dict[str, str]]:
    """Parse counties.ts for {name, status, api, endpoint}.

    A regex over the literal entries is robust enough here — the file is
    formatted one county per line and the alternative (a duplicated Python
    registry) would drift from the frontend's truth. Returns only 'live'
    counties with an endpoint; value carries the api so the caller picks
    the ArcGIS or Socrata pager."""
    text = COUNTIES_TS.read_text(encoding="utf-8")
    entries: dict[str, dict[str, str]] = {}
    for m in re.finditer(
        r"\{\s*name:\s*'([^']+)',\s*status:\s*'(live|partial|mosaic-only)',"
        r"\s*api:\s*'(arcgis|socrata)',(?:\s*endpoint:\s*'([^']+)')?",
        text,
    ):
        name, status, api, endpoint = m.groups()
        if status == "live" and endpoint:
            entries[name] = {"api": api, "endpoint": endpoint}
    return entries


def get_json(url: str, params: dict, what: str) -> dict:
    """GET with retry: 3 attempts, 2s/4s/8s backoff; raises after the last."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, params=params, timeout=TIMEOUT_S)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001 — any page error is retryable
            print(f"  [retry {attempt}/{MAX_RETRIES}] {what}: {e}",
                  flush=True)
            if attempt == MAX_RETRIES:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("county", help="County name as in counties.ts (e.g. Fresno)")
    ap.add_argument("--max-pages", type=int, default=0,
                    help="stop after N pages (0 = all; smoke tests)")
    ap.add_argument("--source", choices=["county", "i15"], default="county",
                    help="i15 = DWR statewide Lightbox mosaic, county-filtered "
                         "(for counties without a live FeatureServer). Recipe "
                         "verified 2026-08-25 (report 15): WHERE COUNTYNAME, "
                         "1500/page, plain resultOffset (orderBy 500s), retry "
                         "on the ~20%% page-500 rate. License note: i15 data "
                         "is LightBox-copyrighted — derived-display terms "
                         "unverified; county-direct sources are cleaner.")
    args = ap.parse_args()

    where = "1=1"
    if args.source == "i15":
        endpoint = I15_ENDPOINT
        where = f"COUNTYNAME='{args.county.strip().title()}'"
        run_arcgis(args, endpoint, where)
        return 0
    registry = load_registry()
    entry = registry.get(args.county) or registry.get(
        args.county.strip().title())
    if not entry:
        live = ", ".join(sorted(registry))
        print(f"error: no live endpoint for {args.county!r}.\n"
              f"live counties: {live}")
        return 2
    if entry["api"] == "socrata":
        return run_socrata(args, entry["endpoint"])
    run_arcgis(args, entry["endpoint"], where)
    return 0


def run_arcgis(args, endpoint: str, where: str) -> int:

    SCORES_DIR.mkdir(parents=True, exist_ok=True)
    out_path = SCORES_DIR / f"{args.county}.geojsonl"
    progress_path = out_path.with_suffix(out_path.suffix + ".progress")

    # Service metadata: page-size cap + schema (for a minimal outFields).
    meta = get_json(endpoint, {"f": "json"}, "service metadata")
    page_size = int(meta.get("maxRecordCount") or DEFAULT_PAGE_SIZE)
    if args.source == "i15":
        page_size = min(page_size, I15_PAGE_SIZE)
    if page_size <= 0:
        page_size = DEFAULT_PAGE_SIZE
    schema_fields = [f.get("name") for f in meta.get("fields", [])
                     if f.get("name")]
    lower = {f.lower(): f for f in schema_fields}
    out_fields = list(dict.fromkeys(
        lower[c.lower()] for c in APN_CANDIDATES if c.lower() in lower))
    print(f"{args.county}: {endpoint}\n"
          f"  maxRecordCount={page_size} fields={len(schema_fields)} "
          f"outFields={out_fields or ['(none)']}", flush=True)

    offset = 0
    if progress_path.exists():
        offset = int(progress_path.read_text().strip() or 0)
        print(f"  resuming at offset {offset}", flush=True)
    mode = "a" if offset else "w"

    total = offset
    pages = 0
    t0 = time.time()
    with out_path.open(mode, encoding="utf-8") as out:
        while True:
            params = {
                "where": where,
                "outFields": ",".join(out_fields) if out_fields else "",
                "returnGeometry": "true",
                "outSR": "4326",
                "f": "geojson",
                "resultOffset": offset,
                "resultRecordCount": page_size,
            }
            try:
                data = get_json(f"{endpoint}/query", params,
                                f"page @ offset {offset}")
            except Exception:
                # i15 has POISON pages (deterministic 500s, e.g. Kern offset
                # 40500 on 2026-08-25 — likely a record that breaks geojson
                # serialization). A screening layer can survive a dropped
                # page; record it loudly and move on.
                skipped_path = out_path.with_suffix(out_path.suffix + ".skipped")
                with skipped_path.open("a", encoding="utf-8") as sk:
                    sk.write(f"{offset}\n")
                print(f"  !! SKIP page @ offset {offset} after "
                      f"{MAX_RETRIES} retries (logged to {skipped_path.name})",
                      flush=True)
                offset += page_size
                progress_path.write_text(str(offset))
                continue
            features = data.get("features") or []
            if not features:
                break
            for f in features:
                out.write(json.dumps(f, separators=(",", ":")) + "\n")
            out.flush()
            offset += len(features)
            total += len(features)
            pages += 1
            # Checkpoint AFTER the page is durably written.
            progress_path.write_text(str(offset))
            print(f"  page {pages}: +{len(features)} "
                  f"(total {total}, {total / (time.time() - t0):.0f}/s)",
                  flush=True)
            if len(features) < page_size:
                break  # short page = end of the result set
            if args.max_pages and pages >= args.max_pages:
                print(f"  --max-pages {args.max_pages} reached", flush=True)
                return 0
    # Completed: clear the checkpoint so the next run starts fresh.
    progress_path.unlink(missing_ok=True)
    print(f"done: {total} parcels -> {out_path} "
          f"({time.time() - t0:.1f}s)", flush=True)
    return 0


SOCRATA_PAGE_SIZE = 2000  # geometry rows run ~1 KB each — 2 MB pages
# WKT geometry columns arrive in projected coordinates: dataset id -> CRS.
# nr6j-72z7 (San Mateo) verified EPSG:2227 on 2026-08-25 (probe coordinate
# transforms to South San Francisco).
SOCRATA_WKT_CRS = {"nr6j-72z7": "EPSG:2227"}


def run_socrata(args, endpoint: str) -> int:
    """Socrata pager for the two live Socrata counties (San Mateo, Santa
    Clara). $limit/$offset chunking (past the 50k/req cap is fine — probed
    2026-08-25), geometry column auto-detected (dict value with a GeoJSON
    'type' — `shape` on San Mateo, `the_geom` on Santa Clara), APN kept when
    present. Same .progress resume + output shape as the ArcGIS path."""
    SCORES_DIR.mkdir(parents=True, exist_ok=True)
    out_path = SCORES_DIR / f"{args.county}.geojsonl"
    progress_path = out_path.with_suffix(out_path.suffix + ".progress")

    # Schema probe: one row's keys + which value is the geometry. Two shapes
    # exist in the wild (probed 2026-08-25): GeoJSON dict (Santa Clara's
    # `the_geom`) and WKT text in State Plane feet (San Mateo's `shape`).
    rows = get_json(endpoint, {"$limit": 1}, "socrata schema probe")
    sample = rows[0] if isinstance(rows, list) and rows else {}
    if not isinstance(sample, dict) or not sample:
        print(f"error: socrata probe returned no rows for {args.county!r}")
        return 2
    geo_col, geo_mode = None, None
    for k, v in sample.items():
        if isinstance(v, dict) and isinstance(v.get("type"), str):
            geo_col, geo_mode = k, "geojson"
            break
        if isinstance(v, str) and v.lstrip()[:8].upper().startswith(
                ("POLYGON", "MULTIPOL", "POINT", "MULTIPOI", "LINESTRI",
                 "MULTILIN")):
            geo_col, geo_mode = k, "wkt"
            break
    if not geo_col:
        print(f"error: no geometry column found on {endpoint}")
        return 2
    # WKT columns are projected coordinates — per-dataset CRS, verified by
    # transforming a probe coordinate (nr6j-72z7 → South San Francisco).
    to_wgs84 = None
    if geo_mode == "wkt":
        from pyproj import Transformer
        from shapely.ops import transform as shp_transform
        import shapely.wkt  # noqa: F401 — used in the row loop below
        dataset_id = endpoint.rstrip("/").split("/")[-1].replace(".json", "")
        crs = SOCRATA_WKT_CRS.get(dataset_id)
        if not crs:
            print(f"error: WKT geometry on {endpoint} but no known CRS — "
                  f"verify the State Plane zone and add it to SOCRATA_WKT_CRS")
            return 2
        tf = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

        def to_wgs84(geom):  # shapely geom -> GeoJSON dict in EPSG:4326
            from shapely.geometry import mapping
            return mapping(shp_transform(
                lambda x, y, z=None: tf.transform(x, y), geom))

    apn_col = next(
        (k for k in sample if k.lower() in ("apn", "ain", "parcelnumber")),
        None,
    )
    select = f"{apn_col},{geo_col}" if apn_col else geo_col
    print(f"{args.county}: {endpoint}\n"
          f"  socrata geo_col={geo_col} mode={geo_mode} apn_col={apn_col} "
          f"page={SOCRATA_PAGE_SIZE}", flush=True)

    offset = 0
    if progress_path.exists():
        offset = int(progress_path.read_text().strip() or 0)
        print(f"  resuming at offset {offset}", flush=True)
    mode = "a" if offset else "w"

    total = offset
    pages = 0
    t0 = time.time()
    with out_path.open(mode, encoding="utf-8") as out:
        while True:
            params = {"$limit": SOCRATA_PAGE_SIZE, "$offset": offset,
                      "$select": select}
            try:
                rows = get_json(endpoint, params, f"page @ offset {offset}")
            except Exception:
                skipped_path = out_path.with_suffix(out_path.suffix + ".skipped")
                with skipped_path.open("a", encoding="utf-8") as sk:
                    sk.write(f"{offset}\n")
                print(f"  !! SKIP page @ offset {offset} after "
                      f"{MAX_RETRIES} retries (logged to {skipped_path.name})",
                      flush=True)
                offset += SOCRATA_PAGE_SIZE
                progress_path.write_text(str(offset))
                continue
            if not isinstance(rows, list) or not rows:
                break
            for row in rows:
                raw = row.get(geo_col)
                geometry = None
                if geo_mode == "geojson":
                    if isinstance(raw, dict):
                        geometry = raw
                elif isinstance(raw, str) and raw.strip():
                    try:
                        geometry = to_wgs84(shapely.wkt.loads(raw))
                    except Exception:
                        geometry = None  # malformed WKT row — skip, keep paging
                if not geometry:
                    continue  # rows without geometry can't be scored
                props = {}
                if apn_col and row.get(apn_col) is not None:
                    props["apn"] = str(row[apn_col])
                feature = {"type": "Feature", "geometry": geometry,
                           "properties": props}
                out.write(json.dumps(feature, separators=(",", ":")) + "\n")
            out.flush()
            offset += len(rows)
            total += len(rows)
            pages += 1
            progress_path.write_text(str(offset))
            print(f"  page {pages}: +{len(rows)} "
                  f"(total {total}, {total / (time.time() - t0):.0f}/s)",
                  flush=True)
            if len(rows) < SOCRATA_PAGE_SIZE:
                break
            if args.max_pages and pages >= args.max_pages:
                print(f"  --max-pages {args.max_pages} reached", flush=True)
                return 0
    progress_path.unlink(missing_ok=True)
    print(f"done: {total} parcels -> {out_path} "
          f"({time.time() - t0:.1f}s)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
