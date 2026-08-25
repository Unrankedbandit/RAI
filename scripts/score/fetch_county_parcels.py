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


def load_registry() -> dict[str, str]:
    """Parse counties.ts for {name, status:'live', api:'arcgis', endpoint}.

    A regex over the literal entries is robust enough here — the file is
    formatted one county per line and the alternative (a duplicated Python
    registry) would drift from the frontend's truth."""
    text = COUNTIES_TS.read_text(encoding="utf-8")
    entries: dict[str, str] = {}
    for m in re.finditer(
        r"\{\s*name:\s*'([^']+)',\s*status:\s*'(live|partial|mosaic-only)',"
        r"\s*api:\s*'(arcgis|socrata)',(?:\s*endpoint:\s*'([^']+)')?",
        text,
    ):
        name, status, api, endpoint = m.groups()
        if status == "live" and api == "arcgis" and endpoint:
            entries[name] = endpoint
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
    else:
        registry = load_registry()
        endpoint = registry.get(args.county) or registry.get(
            args.county.strip().title())
        if not endpoint:
            live = ", ".join(sorted(registry))
            print(f"error: no live arcgis endpoint for {args.county!r}.\n"
                  f"live counties: {live}")
            return 2

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
            data = get_json(f"{endpoint}/query", params,
                            f"page @ offset {offset}")
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


if __name__ == "__main__":
    sys.exit(main())
