#!/usr/bin/env python3
"""Fetch + normalize CA off-limits (no-go) layers -> agent_backend/data/grid/

Products (contract: parcel-research/reports/10-grid-v1-contract.md section 7a):
  tribal.geojson     Census TIGER 2025 AIANNH (American Indian / Alaska Native /
                     Native Hawaiian areas), CA-clipped, props: name
  military.geojson   Census TIGER 2025 MIL (military installations), CA-clipped,
                     props: name (where available)
  offlimits.pmtiles  tippecanoe bake: protected + water (existing files) + tribal + military

Sources (all verified live 2026-08-24):
  1. TIGER/Line 2025 AIANNH national zip (listing of TIGER2025/AIANNH/ shows exactly
     tl_2025_us_aiannh.zip; HEAD 200, 9.2 MB). Public domain (U.S. Gov work).
     https://www2.census.gov/geo/tiger/TIGER2025/AIANNH/tl_2025_us_aiannh.zip
  2. TIGER/Line 2025 MIL national zip (listing of TIGER2025/MIL/ shows exactly
     tl_2025_us_mil.zip; HEAD 200, 2.9 MB). Public domain.
     https://www2.census.gov/geo/tiger/TIGER2025/MIL/tl_2025_us_mil.zip
  (PAD-US DOD fallback was NOT needed — the TIGER military file is live.)

Fetch date: 2026-08-24. Re-runnable; stdlib urllib + minimal shp/dbf readers reused
from fetch_blockers.py; shapely/pyproj from repo .venv for clip:
  ~/hackathons/rai/RAI/.venv/bin/python3 scripts/grid/fetch_offlimits.py [tribal|military ...]

NOTES:
  * CA clip = EXACT state polygon (unary_union of the 58 county boundaries, same
    ca_state_polygon()/clip_state() approach as the urban layer in fetch_blockers.py)
    per the §7a instruction to reuse the county-union clip.
  * Name property: first non-empty of NAME / FULLNAME / NAMELSAD in the DBF
    (AIANNH carries NAME+NAMELSAD; MIL carries FULLNAME on most records).
    Source CRS is NAD83 (EPSG:4269); treated as WGS84/4326 (< ~2 m shift, irrelevant
    at screening scale). No simplification — these national files are small.
"""

import io
import struct
import sys
import zipfile

from shapely.geometry import mapping, shape

from fetch_blockers import (
    OUT_DIR,
    ca_state_polygon,
    clip_state,
    http_open,
    parse_shp_polygons,
    rings_to_geom,
    write_fc,
)

AIANNH_ZIP = "https://www2.census.gov/geo/tiger/TIGER2025/AIANNH/tl_2025_us_aiannh.zip"
MIL_ZIP = "https://www2.census.gov/geo/tiger/TIGER2025/MIL/tl_2025_us_mil.zip"
NAME_FIELDS = ("NAME", "FULLNAME", "NAMELSAD")


def parse_dbf_field(buf, wanted):
    """Minimal stdlib .dbf reader: {FIELD: [values]} for the wanted columns (stripped, '' -> None)."""
    nrec = struct.unpack("<I", buf[4:8])[0]
    hlen, rlen = struct.unpack("<2H", buf[8:12])
    fields, flens, starts = [], [], []
    off, p = 32, 1
    while buf[off] != 0x0D:
        fields.append(buf[off : off + 11].split(b"\x00")[0].decode("ascii", "replace").upper())
        flens.append(buf[off + 16])
        starts.append(p)
        p += buf[off + 16]
        off += 32
    out = {w: [None] * nrec for w in wanted}
    idxs = [(fields.index(w), w) for w in wanted if w in fields]
    roff = hlen
    for i in range(nrec):
        rec = buf[roff : roff + rlen]
        roff += rlen
        if rec[0:1] == b"*":  # deleted record
            continue
        for idx, w in idxs:
            val = rec[starts[idx] : starts[idx] + flens[idx]].decode("latin-1").strip() or None
            if out[w][i] is None and val:
                out[w][i] = val
    return out


def fetch_tiger_layer(url, label):
    """Download a national TIGER polygon zip, exact-state clip to CA, props: name."""
    print(f"== {label}: {url} ==", flush=True)
    data = http_open(url, timeout=300)
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = zf.namelist()
    shp = zf.read(next(n for n in names if n.endswith(".shp")))
    dbf = zf.read(next(n for n in names if n.endswith(".dbf")))
    cols = parse_dbf_field(dbf, NAME_FIELDS)
    nrec = len(next(iter(cols.values()))) if cols else 0
    state = ca_state_polygon()
    out, dropped = [], 0
    for i, rings in enumerate(parse_shp_polygons(shp)):
        geom = rings_to_geom(rings)
        if geom is None:
            continue
        if not geom.intersects(state):
            dropped += 1
            continue
        geom = clip_state(geom, state)
        if geom is None:
            dropped += 1
            continue
        name = None
        for w in NAME_FIELDS:
            vals = cols.get(w)
            if vals and i < len(vals) and vals[i]:
                name = vals[i]
                break
        out.append({
            "type": "Feature",
            "geometry": mapping(geom),
            "properties": {"name": name},
        })
    print(f"  {label}: {len(out)} kept (of {nrec} national records), "
          f"{dropped} dropped outside CA")
    return out


LAYERS = ("tribal", "military")


def main():
    which = [a for a in sys.argv[1:] if a in LAYERS] or list(LAYERS)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if "tribal" in which:
        write_fc(OUT_DIR / "tribal.geojson", fetch_tiger_layer(AIANNH_ZIP, "tribal (AIANNH)"))
    if "military" in which:
        write_fc(OUT_DIR / "military.geojson", fetch_tiger_layer(MIL_ZIP, "military (MIL)"))


if __name__ == "__main__":
    main()
