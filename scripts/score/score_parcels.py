#!/usr/bin/env python3
"""Score a county's parcels -> agent_backend/data/scores/<County>.scored.geojsonl.

Scoring model v1-LITE (contract: parcel-research/reports/10-grid-v1-contract.md
section 8a). Per parcel, geometry math in EPSG:3310 (CA Albers, meters):

  HARD GATES -> score 0, gated:true
    - protected (CPAD) area overlap >= 50% of the parcel
    - water area overlap >= 20%
    - centroid inside a military or tribal polygon
  SCORE (0-100) = 0.5 * grid + 0.3 * openness + 0.2 * acreage
    - grid:      distance to nearest grid access (substation-preferred, the
                 exact pick /api/grid/nearest makes — same trees, same bucket
                 compare). Piecewise: <0.5 mi = 100; 3 mi = 60; 5 mi = 35;
                 >=10 mi = 0 (linear between anchors).
    - openness:  Census urban-area overlap as the v1-lite proxy (documented in
                 the contract as the NLCD stand-in): 0% urban = 100, >=50% = 0.
    - acreage:   <2 ac = 10; 5 ac = 50; 20 ac = 80; >=50 ac = 100 (piecewise
                 linear between anchors).

Spatial logic is NEVER re-implemented here: the grid line/substation trees,
the blocker layers (urban/protected/water), the CRS transformers and the
distance helpers all come from agent_backend.grid (the same module the API
serves). Military/tribal polygons are not part of grid.py's blocker set, so
they are loaded here with grid.py's exact transformer/tree idiom.

Gate precision: protected/water/urban overlap fractions are TRUE polygon
intersection areas (shapely intersection against STRtree candidates), not
centroid-in estimates — measured fast enough for batch use (see the perf
line this script prints).

Output props: {score:int, gated:bool, dist_mi:num|null, kv:int|null,
acres:num}; geometry simplified at 75 m in EPSG:3310 (midpoint of the
contract's <=100 m tolerance — parcel outlines stay legible at tile zooms
while vertex counts drop ~80%), reprojected back to EPSG:4326.

Usage: score_parcels.py <county>
RAI_SCORES_DIR overrides the data dir (fixtures); RAI_GRID_DATA_DIR overrides
the grid layer dir (grid.py's own knob)."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from shapely.geometry import mapping, shape  # noqa: E402
from shapely.ops import transform as shp_transform  # noqa: E402
from shapely.strtree import STRtree  # noqa: E402

from agent_backend import grid  # noqa: E402

SCORES_DIR = Path(os.getenv("RAI_SCORES_DIR")
                  or REPO_ROOT / "agent_backend" / "data" / "scores")

ACRE_M2 = 4046.8564224
SIMPLIFY_M = 75.0  # contract allows <=100 m; 75 keeps shapes legible
PROTECTED_GATE = 0.50
WATER_GATE = 0.20

# Piecewise anchors (contract section 8a), linear between them.
_GRID_CURVE = [(0.0, 100.0), (0.5, 100.0), (3.0, 60.0), (5.0, 35.0),
               (10.0, 0.0)]
_ACRE_CURVE = [(0.0, 10.0), (2.0, 10.0), (5.0, 50.0), (20.0, 80.0),
               (50.0, 100.0)]


def _piecewise(curve: list[tuple[float, float]], x: float) -> float:
    if x <= curve[0][0]:
        return curve[0][1]
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return curve[-1][1]


def _load_poly_layer(fname: str) -> dict:
    """Military/tribal polygons, loaded with grid.py's exact idiom
    (4326 -> 3310 transform + STRtree) so centroid-in tests match the rest
    of the pipeline's spatial behavior."""
    layer = {"available": False, "geoms": [], "tree": None}
    try:
        fc = json.loads((grid.DATA_DIR / fname).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return layer
    for f in fc.get("features", []):
        try:
            geom = shp_transform(grid._TO_3310.transform, shape(f["geometry"]))
        except Exception:
            continue
        if not geom.is_empty:
            layer["geoms"].append(geom)
    if layer["geoms"]:
        layer["tree"] = STRtree(layer["geoms"])
        layer["available"] = True
    return layer


def _overlap_fraction(layer: dict, poly) -> float | None:
    """True intersection-area fraction of `poly` covered by the layer's
    polygons (None when the layer is unavailable). Overlapping holdings are
    unioned via per-candidate intersection areas summed against the parcel —
    CPAD holdings within one county rarely stack, and the gate thresholds
    (>=50% / >=20%) tolerate the small double-count risk at shared borders;
    the sum is clamped to 1."""
    if not layer["available"]:
        return None
    hits = layer["tree"].query(poly, predicate="intersects")
    if len(hits) == 0:
        return 0.0
    area = 0.0
    for i in hits:
        g = layer["geoms"][int(i)]
        try:
            area += poly.intersection(g).area
        except Exception:
            # Invalid layer geometry slips through occasionally (a few CPAD
            # holdings) — GEOS TopologyException killed the LA run once.
            # Repair the candidate and retry once; then skip it.
            try:
                area += poly.intersection(g.buffer(0)).area
            except Exception:
                continue
    return min(area / poly.area, 1.0) if poly.area > 0 else 0.0


def _grid_access(st: dict, pt) -> tuple[float | None, int | None]:
    """(distance_mi, kv) to the screening-relevant nearest access —
    substation preferred on bucket rank, exactly like grid._analyze."""
    hit_t = grid._nearest(st["line_tree"], st["line_geoms"],
                          st["line_props"], pt)
    hit_s = grid._nearest(st["sub_tree"], st["sub_geoms"],
                          st["sub_props"], pt)
    if hit_t is None and hit_s is None:
        return None, None
    b_t = grid._bucket(hit_t[0], "transmission") if hit_t else None
    b_s = grid._bucket(hit_s[0], "substation") if hit_s else None
    if hit_s and (hit_t is None
                  or grid._BUCKET_ORDER[b_s] <= grid._BUCKET_ORDER[b_t]):
        dist, props, _ = hit_s
    else:
        dist, props, _ = hit_t
    return dist / grid.MILE_M, props.get("kv")


def score_feature(st: dict, extra: dict, feature: dict,
                  perf: dict) -> dict | None:
    """One geojsonl feature -> scored feature, or None on bad geometry."""
    try:
        poly = shp_transform(grid._TO_3310.transform,
                             shape(feature["geometry"]))
    except Exception:
        return None
    if poly.is_empty or poly.area <= 0:
        return None
    if not poly.is_valid:  # county fabrics carry self-intersections
        poly = poly.buffer(0)
        if poly.is_empty or poly.area <= 0:
            return None

    acres = poly.area / ACRE_M2
    centroid = poly.centroid
    if not poly.covers(centroid):
        centroid = poly.representative_point()

    # Hard gates (true intersection fractions — perf measured below).
    t = time.perf_counter()
    protected_frac = _overlap_fraction(st["blockers"]["protected"], poly)
    perf["protected_s"] = perf.get("protected_s", 0.0) + time.perf_counter() - t
    t = time.perf_counter()
    water_frac = _overlap_fraction(st["blockers"]["water"], poly)
    perf["water_s"] = perf.get("water_s", 0.0) + time.perf_counter() - t

    gated = False
    if protected_frac is not None and protected_frac >= PROTECTED_GATE:
        gated = True
    elif water_frac is not None and water_frac >= WATER_GATE:
        gated = True
    else:
        for key in ("military", "tribal"):
            layer = extra[key]
            if layer["available"] and list(
                    layer["tree"].query(centroid, predicate="intersects")):
                gated = True
                break

    dist_mi, kv = _grid_access(st, centroid)
    if gated:
        score = 0
    else:
        grid_pts = _piecewise(_GRID_CURVE, dist_mi) if dist_mi is not None else 0.0
        t = time.perf_counter()
        urban_frac = _overlap_fraction(st["blockers"]["urban"], poly)
        perf["urban_s"] = perf.get("urban_s", 0.0) + time.perf_counter() - t
        open_pts = 100.0 * (1.0 - min(urban_frac or 0.0, 0.5) / 0.5)
        acre_pts = _piecewise(_ACRE_CURVE, acres)
        score = int(round(0.5 * grid_pts + 0.3 * open_pts + 0.2 * acre_pts))

    geom = mapping(shp_transform(grid._TO_4326.transform,
                                 poly.simplify(SIMPLIFY_M,
                                               preserve_topology=True)))
    geom["coordinates"] = grid._round_coords(geom["coordinates"])
    return {
        "type": "Feature",
        "properties": {
            "score": score,
            "gated": gated,
            "dist_mi": round(dist_mi, 2) if dist_mi is not None else None,
            "kv": kv,
            "acres": round(acres, 2),
        },
        "geometry": geom,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("county", help="County name (input <County>.geojsonl)")
    ap.add_argument("--limit", type=int, default=0, help="score first N only")
    args = ap.parse_args()

    in_path = SCORES_DIR / f"{args.county}.geojsonl"
    out_path = SCORES_DIR / f"{args.county}.scored.geojsonl"
    if not in_path.exists():
        print(f"error: {in_path} missing — run fetch_county_parcels.py first")
        return 2

    t0 = time.time()
    st = grid._get(wait=True)  # the backend's own loader — one implementation
    if not st["loaded"]:
        print("error: grid data not loaded (lines/substations missing)")
        return 1
    extra = {"military": _load_poly_layer("military.geojson"),
             "tribal": _load_poly_layer("tribal.geojson")}
    layers = {k: v["available"] for k, v in st["blockers"].items()}
    print(f"layers: lines={len(st['line_geoms'])} subs={len(st['sub_geoms'])} "
          f"blockers={layers} "
          f"military={extra['military']['available']} "
          f"tribal={extra['tribal']['available']} "
          f"({time.time() - t0:.1f}s load)", flush=True)

    n = gated = skipped = 0
    hist = [0] * 6  # 0, 1-20, 21-40, 41-60, 61-80, 81-100
    perf: dict[str, float] = {}
    t1 = time.time()
    with in_path.open(encoding="utf-8") as src, \
            out_path.open("w", encoding="utf-8") as out:
        for line in src:
            line = line.strip()
            if not line:
                continue
            if args.limit and n >= args.limit:
                break
            try:
                feature = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue
            try:
                scored = score_feature(st, extra, feature, perf)
            except Exception:
                # A pathological parcel must never kill a multi-million
                # parcel run — count it skipped and move on.
                skipped += 1
                continue
            if scored is None:
                skipped += 1
                continue
            out.write(json.dumps(scored, separators=(",", ":")) + "\n")
            n += 1
            gated += scored["properties"]["gated"]
            s = scored["properties"]["score"]
            hist[0 if s == 0 else min((s - 1) // 20 + 1, 5)] += 1
            if n % 500 == 0:
                print(f"  {n} scored ({n / (time.time() - t1):.0f}/s)",
                      flush=True)
    wall = time.time() - t1
    print(f"done: {n} scored, {skipped} skipped, "
          f"{100 * gated / n:.1f}% gated" if n else "done: 0 scored", flush=True)
    print("score histogram [0, 1-20, 21-40, 41-60, 61-80, 81-100]: "
          f"{hist}", flush=True)
    print(f"wall: {wall:.1f}s ({n / wall:.0f}/s) — overlap time: "
          f"protected {perf.get('protected_s', 0):.2f}s, "
          f"water {perf.get('water_s', 0):.2f}s, "
          f"urban {perf.get('urban_s', 0):.2f}s "
          f"(TRUE polygon intersections, not centroid estimates)", flush=True)
    print(f"-> {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
