#!/usr/bin/env python3
"""Aggregate scored parcels into fixed grid cells -> scorecells.geojsonl.

Low-zoom LOD tier for the parcel-scores overlay (LOD research 2026-08-25:
nobody ships raw parcels below ~z10 — Regrid z10-21; tippecanoe dropping
alone throws away the score signal at low zoom). Each output feature is one
square cell carrying the mean score + parcel count + gated %, so the z0-9
map is a statistically honest heat choropleth instead of a thinned sprinkle
of surviving parcels.

Cell: --cell-deg (default 0.05°, ~5 km N-S) lon/lat squares. Parcel anchor:
geometry bbox center — every parcel is far smaller than a cell, so bbox vs
true centroid is immaterial, and walking rings is much cheaper than shapely
on 12M rows.

Props per cell: score (int, mean 0-100), n (parcel count), gated (% gated),
acres (sum). The frontend styles cells with the same frozen ramp as parcels.

Usage: bin_scores.py [scored.geojsonl ...] [-o OUT] [--cell-deg 0.05]
Default inputs: every *.scored.geojsonl in the scores dir.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCORES_DIR = Path(os.getenv("RAI_SCORES_DIR")
                  or REPO_ROOT / "agent_backend" / "data" / "scores")


def bbox_center(geom: dict) -> tuple[float, float] | None:
    """Min/max over all positions; works for every GeoJSON geometry type."""
    stack = [geom.get("coordinates")]
    minx = miny = math.inf
    maxx = maxy = -math.inf
    while stack:
        node = stack.pop()
        if not isinstance(node, (list, tuple)) or not node:
            continue
        if isinstance(node[0], (int, float)):
            x, y = node[0], node[1]
            if x < minx: minx = x
            if x > maxx: maxx = x
            if y < miny: miny = y
            if y > maxy: maxy = y
        else:
            stack.extend(node)
    if minx is math.inf:
        return None
    return (minx + maxx) / 2, (miny + maxy) / 2


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("inputs", nargs="*",
                    help="scored geojsonl files (default: all in scores dir)")
    ap.add_argument("-o", "--out", default=str(SCORES_DIR / "scorecells.geojsonl"))
    ap.add_argument("--cell-deg", type=float, default=0.05)
    args = ap.parse_args()

    files = [Path(f) for f in args.inputs] or sorted(
        SCORES_DIR.glob("*.scored.geojsonl"))
    if not files:
        print("no scored geojsonl — run score_parcels.py first")
        return 1

    cells: dict[tuple[int, int], list[float]] = {}
    t0 = time.time()
    rows = 0
    for path in files:
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                f = json.loads(line)
                anchor = bbox_center(f.get("geometry") or {})
                if anchor is None:
                    continue
                props = f.get("properties") or {}
                key = (int(anchor[0] // args.cell_deg),
                       int(anchor[1] // args.cell_deg))
                cell = cells.setdefault(key, [0.0, 0, 0, 0.0])
                cell[0] += float(props.get("score") or 0)
                cell[1] += 1
                cell[2] += 1 if props.get("gated") else 0
                cell[3] += float(props.get("acres") or 0)
                rows += 1
        print(f"  {path.name}: {rows:,} rows binned "
              f"({rows / (time.time() - t0):.0f}/s)", flush=True)

    out_path = Path(args.out)
    d = args.cell_deg
    with out_path.open("w", encoding="utf-8") as out:
        for (cx, cy), (total, n, gated, acres) in sorted(cells.items()):
            if not n:
                continue
            x0, y0 = cx * d, cy * d
            ring = [[x0, y0], [x0 + d, y0], [x0 + d, y0 + d],
                    [x0, y0 + d], [x0, y0]]
            feature = {
                "type": "Feature",
                "properties": {
                    "score": round(total / n),
                    "n": n,
                    "gated": round(100 * gated / n),
                    "acres": round(acres),
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
            out.write(json.dumps(feature, separators=(",", ":")) + "\n")
    print(f"done: {rows:,} parcels -> {len(cells):,} cells -> {out_path} "
          f"({time.time() - t0:.1f}s)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
