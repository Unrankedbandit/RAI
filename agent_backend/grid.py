"""Grid proximity service — nearest transmission line / substation for a
lat,lng query, plus the pmtiles archive the web overlay reads.

Data lives in agent_backend/data/grid/ (gitignored; produced by scripts/grid/).
The GeoJSON is parsed lazily on the first request and indexed in EPSG:3310
(CA Albers, meters) with a shapely STRtree — distances and closest points are
computed there, then the closest point is reprojected back to EPSG:4326.

Missing data is never faked: while lines.geojson/substations.geojson are
absent the endpoints answer 503 "grid data not loaded" and /api/grid/status
reports loaded:false. RAI_GRID_DATA_DIR overrides the data dir (tests)."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import nearest_points
from shapely.ops import transform as shp_transform
from shapely.strtree import STRtree

router = APIRouter()

DATA_DIR = Path(os.getenv("RAI_GRID_DATA_DIR") or
                Path(__file__).resolve().parent / "data" / "grid")

_TO_3310 = Transformer.from_crs("EPSG:4326", "EPSG:3310", always_xy=True)
_TO_4326 = Transformer.from_crs("EPSG:3310", "EPSG:4326", always_xy=True)

MILE_M = 1609.344
# Beyond this the query is out-of-state / off the map: report nulls, not a
# meaningless 500 km "nearest" number.
MAX_DISTANCE_M = 200_000.0
_BUCKET_ORDER = {"near": 0, "moderate": 1, "far": 2, "remote": 3}

DISCLAIMER = ("As-the-crow-flies distance to nearest mapped grid "
              "infrastructure. Initial screening only — not a buildable "
              "route, available capacity, or interconnection commitment.")

# None until first use; dict afterwards (loaded flag + trees). Feature props
# ride alongside their 3310 geometry in parallel lists.
_state: dict | None = None


def _num(value):
    """kv arrives as number/string/None; 0 and unparseable mean unknown."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v <= 0:
        return None
    return int(v) if v.is_integer() else v


def _load() -> dict:
    global _state
    if _state is not None:
        return _state
    st = {"loaded": False, "line_geoms": [], "line_props": [],
          "sub_geoms": [], "sub_props": [], "line_tree": None, "sub_tree": None}
    try:
        lines = json.loads((DATA_DIR / "lines.geojson").read_text(encoding="utf-8"))
        subs = json.loads((DATA_DIR / "substations.geojson").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _state = st
        return st
    for f in lines.get("features", []):
        try:
            geom = shp_transform(_TO_3310.transform, shape(f["geometry"]))
        except Exception:
            continue
        p = f.get("properties") or {}
        st["line_geoms"].append(geom)
        st["line_props"].append({
            "kv": _num(p.get("kv")),
            "volt_class": p.get("volt_class") or None,
            "owner": p.get("owner") or None,
            "status": p.get("status") or None,
            "source": p.get("source") or None,
        })
    for f in subs.get("features", []):
        try:
            geom = shp_transform(_TO_3310.transform, shape(f["geometry"]))
        except Exception:
            continue
        p = f.get("properties") or {}
        st["sub_geoms"].append(geom)
        st["sub_props"].append({
            "name": p.get("name") or None,
            "kv": _num(p.get("kv")),
            "source": p.get("source") or None,
        })
    if st["line_geoms"]:
        st["line_tree"] = STRtree(st["line_geoms"])
    if st["sub_geoms"]:
        st["sub_tree"] = STRtree(st["sub_geoms"])
    st["loaded"] = True
    _state = st
    return st


def _bucket(distance_m: float, kind: str) -> str:
    # Contract §2 thresholds (miles): substation near <1, moderate 1–2,
    # far 2–5; transmission near <0.5, moderate 0.5–1, far 1–3.
    mi = distance_m / MILE_M
    if kind == "substation":
        if mi < 1: return "near"
        if mi < 2: return "moderate"
        if mi <= 5: return "far"
        return "remote"
    if mi < 0.5: return "near"
    if mi < 1: return "moderate"
    if mi <= 3: return "far"
    return "remote"


def _nearest(tree, geoms, props, pt):
    """(distance_m, props, closest-geom-in-3310) or None past 200 km."""
    if tree is None:
        return None
    idx = int(tree.nearest(pt))
    geom = geoms[idx]
    dist = pt.distance(geom)
    if dist > MAX_DISTANCE_M:
        return None
    return dist, props[idx], nearest_points(pt, geom)[1]


def _label(kind: str, distance_m: float, props: dict) -> str:
    mi = distance_m / MILE_M
    if kind == "transmission":
        kv = props.get("kv")
        if kv:
            return f"{mi:.1f} mi to nearest {kv:g} kV transmission line"
        return f"{mi:.1f} mi to nearest transmission line"
    name = props.get("name")
    if name:
        return f"{mi:.1f} mi to nearest substation ({name})"
    return f"{mi:.1f} mi to nearest substation"


def _mi(distance_m: float) -> float:
    return distance_m / MILE_M


def _hookup(access: dict, transmission: dict | None,
            substation: dict | None) -> dict:
    """Required physical hookup for the parcel, derived from the chosen access
    point. Two shapes (GRID V1 contract §2b):
      - substation  → a gen-tie line from the parcel to the substation bus;
                      the simplest interconnection path.
      - line tap    → transmission lines can't be clamped onto: a new tap
                      switchyard is built at the tap point, then a gen-tie
                      spur from parcel to switchyard. Substation-scale work
                      on top of the gen-tie.
    `alternative` names the other option when it exists nearby — a slightly
    farther substation often beats a line tap (no new switchyard).
    Distance guidance follows developer screening norms (go ≤1–2 mi to a
    substation, outer screen ~5 mi — report 08)."""
    kind = access.get("kind")
    if kind is None:
        return {
            "method": "none", "gentie_mi": None, "tap_point": None,
            "summary": "No mapped grid access within screening range",
            "detail": "Nothing mapped within 200 km. Any interconnection "
                      "would mean long new transmission construction — "
                      "effectively a greenfield grid project, not a hookup.",
            "alternative": None,
        }

    bucket = access.get("bucket")
    if kind == "substation":
        dist_m = access["distance_m"]
        mi = _mi(dist_m)
        name = substation.get("name") if substation else None
        kv = substation.get("kv") if substation else None
        target = f"{name} substation" if name else "the nearest substation"
        if kv:
            target += f" ({kv:g} kV)"
        summary = f"Gen-tie ~{mi:.1f} mi to {target}"
        detail = ("A new generation-tie (gen-tie) line from the parcel to "
                  f"the substation, interconnecting at the substation bus — "
                  "the simplest hookup path. Requires a utility "
                  "interconnection study and available capacity at that bus.")
        if bucket == "far":
            detail += (" At this distance the gen-tie is a real cost driver; "
                       "~5 mi is the outer screening line for most "
                       "developers.")
        elif bucket == "remote":
            detail += (" Beyond ~5 mi the gen-tie alone usually kills "
                       "utility-scale economics.")
        alternative = None
        if transmission:
            t_mi = _mi(transmission["distance_m"])
            if t_mi < mi:  # line is closer, but tapping it costs more
                kv_t = transmission.get("kv")
                alt_t = f"the {kv_t:g} kV line" if kv_t else "a transmission line"
                alternative = (f"Closer: {alt_t} at {t_mi:.1f} mi — but a "
                               "line tap needs a new switchyard, so the "
                               "farther substation is usually cheaper.")
        method, tap = "substation", substation.get("closest") if substation else None
    else:  # transmission line tap
        dist_m = access["distance_m"]
        mi = _mi(dist_m)
        kv = transmission.get("kv") if transmission else None
        line = f"the {kv:g} kV line" if kv else "the nearest transmission line"
        summary = f"Tap {line} (~{mi:.1f} mi gen-tie) — needs a new switchyard"
        detail = ("A transmission line can't be clamped onto: the hookup is "
                  f"a new tap switchyard built where the spur meets {line}, "
                  f"plus a ~{mi:.1f} mi gen-tie from the parcel to that "
                  "switchyard. That is substation-scale construction with "
                  "utility/CAISO approval and protection studies on top of "
                  "the gen-tie.")
        if kv and kv >= 345:
            detail += (f" Tapping a {kv:g} kV trunk line is a major "
                       "CAISO-controlled undertaking — usually only viable "
                       "for large projects.")
        if bucket in ("far", "remote"):
            detail += (" At this distance the gen-tie spur itself becomes a "
                       "dominant cost.")
        alternative = None
        if substation:
            s_mi = _mi(substation["distance_m"])
            name_s = substation.get("name") or "the nearest substation"
            alternative = (f"Alternative: gen-tie {s_mi:.1f} mi to {name_s} "
                           "— farther, but interconnects at an existing bus "
                           "with no new switchyard.")
        method, tap = "line-tap", transmission.get("closest") if transmission else None

    return {"method": method, "gentie_mi": round(_mi(access["distance_m"]), 2),
            "tap_point": tap, "summary": summary, "detail": detail,
            "alternative": alternative}


@router.get("/api/grid/nearest")
async def grid_nearest(lat: float, lng: float):
    st = _load()
    if not st["loaded"]:
        raise HTTPException(status_code=503, detail="grid data not loaded")
    pt = shp_transform(_TO_3310.transform, shape({"type": "Point", "coordinates": [lng, lat]}))

    transmission = substation = None
    hit = _nearest(st["line_tree"], st["line_geoms"], st["line_props"], pt)
    if hit:
        dist, props, closest = hit
        clng, clat = _TO_4326.transform(closest.x, closest.y)
        transmission = {
            "distance_m": round(dist, 1), "distance_mi": round(dist / MILE_M, 2),
            **props,
            "closest": {"lat": round(clat, 6), "lng": round(clng, 6)},
        }
        hit_t = (dist, props)
    else:
        hit_t = None
    hit = _nearest(st["sub_tree"], st["sub_geoms"], st["sub_props"], pt)
    if hit:
        dist, props, closest = hit
        clng, clat = _TO_4326.transform(closest.x, closest.y)
        substation = {
            "distance_m": round(dist, 1), "distance_mi": round(dist / MILE_M, 2),
            **props,
            "closest": {"lat": round(clat, 6), "lng": round(clng, 6)},
        }
        hit_s = (dist, props)
    else:
        hit_s = None

    # Screening-relevant nearest: substation wins ties on bucket rank (its
    # thresholds are the practical interconnection proxy), else transmission.
    if hit_t is None and hit_s is None:
        access = {"kind": None, "distance_m": None, "distance_mi": None,
                  "bucket": "remote",
                  "label": "No mapped grid infrastructure within 200 km"}
    else:
        b_t = _bucket(hit_t[0], "transmission") if hit_t else None
        b_s = _bucket(hit_s[0], "substation") if hit_s else None
        if hit_s and (hit_t is None or _BUCKET_ORDER[b_s] <= _BUCKET_ORDER[b_t]):
            kind, (dist, props), bucket = "substation", hit_s, b_s
        else:
            kind, (dist, props), bucket = "transmission", hit_t, b_t
        access = {"kind": kind, "distance_m": round(dist, 1),
                  "distance_mi": round(dist / MILE_M, 2), "bucket": bucket,
                  "label": _label(kind, dist, props)}

    return {"query": {"lat": lat, "lng": lng}, "transmission": transmission,
            "substation": substation, "access": access,
            "hookup": _hookup(access, transmission, substation),
            "disclaimer": DISCLAIMER}


@router.get("/api/grid/tiles/grid.pmtiles")
async def grid_tiles(request: Request):
    """pmtiles needs HTTP Range reads — serve 206 partial content, no deps."""
    path = DATA_DIR / "grid.pmtiles"
    if not path.exists():
        raise HTTPException(status_code=503, detail="grid data not loaded")
    size = path.stat().st_size
    m = re.fullmatch(r"bytes=(\d*)-(\d*)", request.headers.get("range", "").strip())
    if not m or not (m.group(1) or m.group(2)):
        return FileResponse(path, media_type="application/octet-stream",
                            headers={"Accept-Ranges": "bytes"})
    if m.group(1):
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else size - 1
    else:  # suffix form: bytes=-N → last N bytes
        start = max(0, size - int(m.group(2)))
        end = size - 1
    end = min(end, size - 1)
    if start >= size or start > end:
        raise HTTPException(status_code=416, detail="range not satisfiable",
                            headers={"Content-Range": f"bytes */{size}"})
    with path.open("rb") as f:
        f.seek(start)
        data = f.read(end - start + 1)
    return Response(content=data, status_code=206,
                    media_type="application/octet-stream",
                    headers={"Content-Range": f"bytes {start}-{end}/{size}",
                             "Accept-Ranges": "bytes",
                             "Content-Length": str(len(data))})


@router.get("/api/grid/status")
async def grid_status():
    st = _load()
    path = DATA_DIR / "grid.pmtiles"
    return {"lines": len(st["line_geoms"]), "substations": len(st["sub_geoms"]),
            "pmtiles_bytes": path.stat().st_size if path.exists() else 0,
            "loaded": st["loaded"]}
