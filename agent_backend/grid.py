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
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pyproj import Transformer
from shapely.geometry import LineString, mapping, shape
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

# --- Connection-path feasibility (contract §5b) ---------------------------
# Corridor = parcel centroid → access point. The 150 m flat-cap buffer only
# selects STRtree candidates; reported mileage is always centerline∩polygon.
CORRIDOR_HALF_WIDTH_M = 150.0
# Boundary-touch artifacts from dense TIGER/CPAD vertices are not crossings.
MIN_CROSSING_M = 25.0
# "Notable" water crossing for the constrained_urban rung (interpretation —
# the contract says "notable water" without a number).
NOTABLE_WATER_MI = 0.1
# protected_conflict fires only on a substantial protected crossing. CPAD
# includes city parks, and a 0.1 mi clip of one must not preempt municipal
# guidance for an urban infill parcel (review 14 / report 11: protected ≠
# impossible). Smaller clips stay in the crossings list as a detail note.
PROTECTED_CONFLICT_MI = 0.5

# Optional blocker layers (contract §5a), loaded exactly like the grid data.
_BLOCKER_FILES = {"urban": "urban.geojson", "protected": "protected.geojson",
                  "water": "water.geojson", "utilities": "utilities.geojson"}

# Big-3 IOUs: portal_url is overridden with their ICA/hosting portals
# instead of the CEC `url` field (report 12). Needles match both
# "Pacific Gas & Electric" and "Pacific Gas and Electric" spellings.
# CEC LSE-layer entities that are NOT retail utilities a parcel can
# interconnect with: wholesalers, pooling authorities, and port districts
# whose polygons overlay the real retail territories (accuracy review #14).
_NON_RETAIL_UTILITIES = frozenset({
    "Metropolitan Water District of So. Cal",
    "Power and Water Resource Pooling Authority",
    "Port of Oakland",
    "Port of Stockton",
    "Eastside Power Authority",
})

_IOU_PORTALS = (
    ("pacific gas", "https://grip.pge.com"),
    ("edison", "https://drpep.sce.com/drpep/"),
    ("san diego gas", "https://interconnectionmapsdge.extweb.sempra.com"),
)

# Copy rules (contract §5b — accuracy is load-bearing; never quote circuit
# capacity or upgrade costs as fact).
ROUTE_SCREENING_SENTENCE = ("Route-screening flags from generalized public "
                            "boundaries — the path is at least this "
                            "constrained; not a buildability determination.")
NO_DISTRIBUTION_SENTENCE = ("We don't map distribution lines; the utility "
                            "determines the actual point of interconnection "
                            "and route.")

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
          "sub_geoms": [], "sub_props": [], "line_tree": None, "sub_tree": None,
          "blockers": _load_blockers()}
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


_load_lock = threading.Lock()


def _get(wait: bool) -> dict | None:
    """Load accessor. With wait=True (the warmup thread) blocks on the load
    lock and always returns the state. With wait=False (request handlers)
    returns None INSTANTLY when the warmup thread is mid-parse — the cold
    load is ~20-25 s of CPU (162k-feature CPAD layer) and a request must
    never queue behind it; callers turn None into a fast 503."""
    global _state
    if _state is None:
        if not wait and _load_lock.locked():
            return None  # warmup in progress — never queue behind it
        with _load_lock:
            if _state is None:
                _load()
    assert _state is not None  # _load always sets it
    return _state


def preload() -> None:
    """Startup warmup in a daemon thread (called from main.py's lifespan):
    the first parcel click never pays the cold parse, and uvicorn's single
    event loop is never blocked by it. Until the load lands, nearest/scan
    answer 503 (the frontend silently hides grid UI) and status reports
    loaded:false with warming:true."""
    threading.Thread(target=lambda: _get(wait=True), daemon=True,
                     name="grid-preload").start()


def _load_blockers() -> dict:
    """The four optional corridor-blocker layers (contract §5a). Each file is
    independently optional: missing/unparseable/empty → available False and
    that check is skipped (missing data is never faked)."""
    layers = {}
    for key, fname in _BLOCKER_FILES.items():
        layer = {"available": False, "geoms": [], "props": [], "tree": None}
        try:
            fc = json.loads((DATA_DIR / fname).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            layers[key] = layer
            continue
        for f in fc.get("features", []):
            try:
                geom = shp_transform(_TO_3310.transform, shape(f["geometry"]))
            except Exception:
                continue
            if geom.is_empty:
                continue
            layer["geoms"].append(geom)
            layer["props"].append(f.get("properties") or {})
        if layer["geoms"]:
            layer["tree"] = STRtree(layer["geoms"])
            layer["available"] = True
        layers[key] = layer
    return layers


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


def _parts(geom):
    """Flatten a (multi-part) intersection into LineString parts."""
    if geom.is_empty:
        return
    if geom.geom_type == "LineString":
        yield geom
    elif hasattr(geom, "geoms"):
        for g in geom.geoms:
            yield from _parts(g)


def _round_coords(coords, nd=6):
    if isinstance(coords[0], (int, float)):
        return [round(c, nd) for c in coords]
    return [_round_coords(c, nd) for c in coords]


def _render_feature(geom3310, props: dict) -> dict:
    """One render-FC feature, reprojected to EPSG:4326 (contract §5b)."""
    geom = mapping(shp_transform(_TO_4326.transform, geom3310))
    geom["coordinates"] = _round_coords(geom["coordinates"])
    return {"type": "Feature", "properties": props, "geometry": geom}


def _crossings(layer: dict, centerline, corridor):
    """None when the layer is unavailable (distinguish from zero crossings);
    else (total_mi, hits) with hits = (props, length_m, intersection geom).
    The buffer only selects candidates; mileage is centerline∩polygon."""
    if not layer["available"]:
        return None
    hits, total_m = [], 0.0
    for i in layer["tree"].query(corridor, predicate="intersects"):
        inter = centerline.intersection(layer["geoms"][int(i)])
        length = inter.length
        if length < MIN_CROSSING_M:
            continue
        hits.append((layer["props"][int(i)], length, inter))
        total_m += length
    return _mi(total_m), hits


def _municipal(utilities: dict, pt) -> dict | None:
    """Point-in-polygon of the QUERY point against the CEC utility layer.
    Polygons overlap (the Metropolitan Water District wholesaler polygon
    blankets LADWP retail territory over LA): collect ALL containing hits
    and take the SMALLEST area — the specific retail territory beats a
    wholesale overlay (report 12). Big-3 IOU portal_url is overridden with
    the utility's ICA portal; only those three have ICA portals, so the
    "ICA portal" wording is emitted for them alone."""
    if not utilities["available"]:
        return None
    hits = [int(i) for i in utilities["tree"].query(pt, predicate="intersects")]
    hits = [i for i in hits if utilities["props"][i].get("utility")]
    # Wholesale/pooling/port overlays in the CEC LSE layer aren't retail
    # providers a parcel can interconnect with — drop them before the
    # min-area pick, else e.g. the Power and Water Resource Pooling
    # Authority beats PG&E across the Central Valley.
    hits = [i for i in hits
            if utilities["props"][i]["utility"] not in _NON_RETAIL_UTILITIES]
    if not hits:
        return None
    p = utilities["props"][min(hits, key=lambda i: utilities["geoms"][i].area)]
    utility = p.get("utility")
    kind = p.get("kind") or "unknown"
    portal = p.get("url") or None
    ica = None
    for needle, ica_url in _IOU_PORTALS:
        if needle in utility.lower():
            ica = ica_url
            break
    if ica:
        portal = ica
    if kind.upper() == "IOU":
        if ica:
            link_note = (f" Check hosting capacity on {utility}'s ICA "
                         f"portal ({portal}).")
        else:
            link_note = (f" Interconnection information on {utility}'s "
                         f"site ({portal or 'see the utility'}).")
        detail = (f"{utility} is the interconnection decision-maker "
                  "here. Distribution interconnection runs under CPUC "
                  f"Rule 21, administered by {utility} — Fast Track "
                  f"screens first.{link_note} Selling power wholesale (to "
                  "third parties or the CAISO market) moves the project "
                  "to FERC jurisdiction — WDAT on distribution, CAISO "
                  "tariff on transmission. " + NO_DISTRIBUTION_SENTENCE)
    else:
        link = f" ({p.get('url')})" if p.get("url") else ""
        detail = (f"This parcel is in {utility} territory (publicly "
                  "owned utility). CPUC Rule 21 does NOT apply — "
                  f"{utility} administers its own interconnection "
                  f"process; contact the utility directly{link}. There "
                  "is no public hosting-capacity map for most municipal "
                  "utilities. " + NO_DISTRIBUTION_SENTENCE)
    return {"utility": utility, "kind": kind, "portal_url": portal,
            "detail": detail}


def _verdict(access: dict, total_mi: float, urban, protected, water,
             municipal, unavailable: list) -> dict:
    """Contract §5b precedence: remote > protected_conflict > municipal_path
    > constrained_urban > review > clear_rural. A missing layer is never
    faked as clear: its check is skipped and the verdict can be no stronger
    than clear only when every layer answered."""
    bucket = access.get("bucket")
    urban_mi = urban[0] if urban else None
    fraction = urban_mi / total_mi if urban_mi is not None and total_mi > 0 else None
    protected_hits = protected[1] if protected else []
    water_hits = water[1] if water else []

    if bucket == "remote":
        if access.get("kind") is None:
            summary = "No mapped grid access within screening range"
        else:
            summary = (f"Nearest mapped grid access is {access['label']} — "
                       "beyond practical screening range")
        return {"code": "remote",
                "summary": summary,
                "detail": "The nearest mapped grid infrastructure is beyond "
                          "screening distance; any connection would mean "
                          "long new line construction. "
                          + ROUTE_SCREENING_SENTENCE}

    worst_protected = max((l for _, l, _ in protected_hits), default=0.0)
    if _mi(worst_protected) >= PROTECTED_CONFLICT_MI:
        names = [p.get("name") or "unnamed area" for p, _, _ in protected_hits]
        mi = _mi(worst_protected)
        return {"code": "protected_conflict",
                "summary": f"Corridor crosses protected land ({names[0]}, "
                           f"~{mi:.1f} mi) — plan the route around it early",
                "detail": f"A substantial stretch ({mi:.1f} mi) of the "
                          f"straight corridor crosses protected land "
                          f"({', '.join(names)}); routing around it or "
                          "confirming the holding's rules is required early "
                          "— protected ≠ impossible. "
                          + ROUTE_SCREENING_SENTENCE}

    # Sub-threshold protected clips never set the verdict, but stay in the
    # crossings list and get a detail note on the verdict that does fire.
    protected_note = ""
    if protected_hits:
        names = ", ".join(sorted({p.get("name") or "unnamed area"
                                  for p, _, _ in protected_hits}))
        protected_note = (f"The corridor also clips protected land ({names}) "
                          f"under the {PROTECTED_CONFLICT_MI:g} mi conflict "
                          "threshold — confirm the holding's rules during "
                          "routing. ")

    if (urban_mi is not None and municipal
            and (urban_mi >= 1.0 or (fraction or 0) >= 0.5)):
        areas = ", ".join(sorted({p.get("name") or "urban area"
                                  for p, _, _ in urban[1]}))
        return {"code": "municipal_path",
                "summary": "Corridor crosses developed land — realistic "
                           f"path is distribution interconnection via "
                           f"{municipal['utility']}",
                "detail": f"{urban_mi:.1f} of {total_mi:.1f} mi "
                          f"({(fraction or 0) * 100:.0f}%) of the straight "
                          f"corridor lies inside {areas}; a gen-tie through "
                          "developed land is the constrained option — the "
                          "serving utility's distribution system is the "
                          "practical interconnection path (see municipal "
                          "guidance). " + protected_note
                          + ROUTE_SCREENING_SENTENCE}

    notable_water = any(_mi(l) >= NOTABLE_WATER_MI for _, l, _ in water_hits)
    if (urban_mi is not None and urban_mi >= 0.25) or notable_water:
        bits = []
        if urban_mi is not None and urban_mi >= 0.25:
            areas = ", ".join(sorted({p.get("name") or "urban area"
                                      for p, _, _ in urban[1]}))
            bits.append(f"{urban_mi:.1f} mi inside {areas}")
        if notable_water:
            bits.append("a notable water crossing "
                        f"({_mi(max(l for _, l, _ in water_hits)):.1f} mi)")
        return {"code": "constrained_urban",
                "summary": "Corridor crosses developed land or major water "
                           "— route study needed",
                "detail": ("The straight corridor has " + " and ".join(bits)
                           + ". " + protected_note
                           + ROUTE_SCREENING_SENTENCE)}

    if unavailable:
        return {"code": "review",
                "summary": "Screening incomplete — some map layers "
                           "unavailable",
                "detail": "No blockers detected along the corridor in the "
                          "loaded layers, but these layers are unavailable: "
                          + ", ".join(unavailable)
                          + "; unscreened blockers may exist. "
                          + protected_note + ROUTE_SCREENING_SENTENCE}

    # Honest "no crossings" wording: sub-threshold protected clips exist,
    # so only urban/water are asserted clear when the note is present.
    no_crossings = (f"No urban or major-water crossings detected along the "
                    f"{total_mi:.1f} mi corridor. " if protected_note else
                    f"No urban, protected-land, or major-water crossings "
                    f"detected along the {total_mi:.1f} mi corridor. ")
    return {"code": "clear_rural",
            "summary": "Clear rural corridor",
            "detail": no_crossings + protected_note
                      + ROUTE_SCREENING_SENTENCE}


def _path(st: dict, pt, access_pt, access: dict) -> dict:
    """Corridor blocker screen for the parcel→access straight line
    (contract §5b; design + perf basis report 13)."""
    blockers = st["blockers"]
    centerline = LineString([pt, access_pt])
    corridor = centerline.buffer(CORRIDOR_HALF_WIDTH_M, cap_style="flat")
    total_mi = _mi(centerline.length)

    urban = _crossings(blockers["urban"], centerline, corridor)
    protected = _crossings(blockers["protected"], centerline, corridor)
    water = _crossings(blockers["water"], centerline, corridor)
    municipal = _municipal(blockers["utilities"], pt)
    unavailable = [k for k, layer in blockers.items() if not layer["available"]]

    # Render FC (EPSG:4326): blocked subsegments + label midpoints; when the
    # parcel sits in a served territory and the corridor crosses an urban
    # area, the connector stops at the urban-boundary entry point and the
    # notional in-town leg rides the local grid (via segment).
    features = []
    for kind, result in (("urban", urban), ("protected", protected),
                         ("water", water)):
        if not result:
            continue
        for props, length, inter in result[1]:
            name = props.get("name")
            mi = _mi(length)
            fallback = {"urban": "urban area", "protected": "protected land",
                        "water": "water"}[kind]
            for part in _parts(inter):
                features.append(_render_feature(
                    part, {"kind": kind, "label": name, "mi": round(mi, 2)}))
            mid = inter.interpolate(inter.length / 2)
            features.append(_render_feature(
                mid, {"label": f"crosses {name or fallback} · {mi:.1f} mi"}))
    if municipal and urban and urban[1]:
        # Entry = first urban-boundary hit from the parcel side: the parcel-
        # side endpoint of the nearest crossing subsegment.
        entry = min((nearest_points(pt, inter)[1] for _, _, inter in urban[1]),
                    key=lambda p: pt.distance(p))
        features.append(_render_feature(entry, {"kind": "entry"}))
        via = LineString([entry, access_pt])
        if via.length > 0:
            features.append(_render_feature(
                via, {"kind": "via", "utility": municipal["utility"]}))

    verdict = _verdict(access, total_mi, urban, protected, water, municipal,
                       unavailable)
    return {
        "total_mi": round(total_mi, 2),
        "corridor_half_width_m": int(CORRIDOR_HALF_WIDTH_M),
        "urban": {"available": blockers["urban"]["available"],
                  "crossing_mi": round(urban[0], 2) if urban else None,
                  "fraction": round(urban[0] / total_mi, 2)
                  if urban and total_mi > 0 else None,
                  "areas": sorted({p.get("name") for p, _, _ in urban[1]
                                   if p.get("name")}) if urban else []},
        "protected": {"available": blockers["protected"]["available"],
                      "crossings": [{"name": p.get("name"),
                                     "mi": round(_mi(l), 2)}
                                    for p, l, _ in protected[1]]
                      if protected else []},
        "water": {"available": blockers["water"]["available"],
                  "crossings": [{"mi": round(_mi(l), 2)}
                                for _, l, _ in water[1]] if water else []},
        "municipal": municipal,
        "render": {"type": "FeatureCollection", "features": features},
        "verdict": verdict,
    }


def _option(access: dict, hookup: dict, path: dict | None,
            chosen: bool) -> dict:
    """One connection-point comparison option — the frozen §6b shape the
    frontend builds against (exact keys; both candidates fully worked up so
    the user can compare/switch per parcel). `id` mirrors the hookup method
    ("substation" | "line-tap"); verdict is trimmed to code+summary — the
    full corridor screen rides `path`. `reason` is filled by _reason once
    both options exist (the comparison needs both corridors)."""
    verdict = (path or {}).get("verdict") or {}
    return {
        "id": hookup["method"],
        "kind": access["kind"],
        "method": hookup["method"],
        "label": access["label"],
        "distance_m": access["distance_m"],
        "distance_mi": access["distance_mi"],
        "bucket": access["bucket"],
        "gentie_mi": hookup["gentie_mi"],
        "tap_point": hookup["tap_point"],
        "summary": hookup["summary"],
        "detail": hookup["detail"],
        "reason": "",
        "verdict": ({"code": verdict.get("code"),
                     "summary": verdict.get("summary")} if path else None),
        "path": path,
        "chosen": chosen,
    }


def _reason(chosen: dict, alt: dict | None,
            tied: bool) -> tuple[str, str | None]:
    """Why the pick won — and why the other option didn't (§6b copy rules).
    Screening-aid tone: distances/buckets are map facts; the switchyard-vs-
    gen-tie tradeoff is stated as the usual case, never as costed fact.
    Corridor-aware honesty (the point of shipping both options): when the
    picked corridor screens municipal_path/protected_conflict/
    constrained_urban and the alternative screens strictly better on
    _VERDICT_RANK, BOTH reasons say so — a clear corridor a mile farther
    away can beat a short one through town."""
    if alt is None:
        return ("Only mapped grid access within screening range — nothing "
                "else to compare."), None
    s = chosen if chosen["kind"] == "substation" else alt
    t = alt if chosen["kind"] == "substation" else chosen
    # Distances are formatted from distance_m so the reason matches the
    # option's `label` exactly (distance_mi is the 2-dp rounded twin).
    s_bit = (f"substation at {_mi(s['distance_m']):.1f} mi ({s['bucket']})")
    t_bit = (f"transmission line at {_mi(t['distance_m']):.1f} mi "
             f"({t['bucket']})")
    if chosen["kind"] == "substation":
        reason = (f"Picked the {s_bit} over a tap on the {t_bit}. "
                  "Interconnecting at an existing substation bus avoids "
                  "building a new tap switchyard (substation-scale "
                  "construction) — the longer gen-tie is usually cheaper "
                  "than the switchyard.")
        if tied:
            reason += (" Both sit in the same screening band — the "
                       "substation bus is preferred.")
        alt_reason = (f"Not picked: the {t_bit} loses to the {s_bit}. A "
                      "line tap needs a new tap switchyard on top of the "
                      "gen-tie — the existing substation bus avoids that.")
    else:
        reason = (f"Picked a tap on the {t_bit} over the {s_bit}: the "
                  "line is in a closer screening band, so at screening "
                  "level the shorter gen-tie outweighs the new-switchyard "
                  "work a tap requires.")
        alt_reason = (f"Not picked: the {s_bit} is in a farther screening "
                      f"band than the {t_bit} — the extra gen-tie miles "
                      "outweigh avoiding a new switchyard at screening "
                      "level.")
    chosen_code = (chosen.get("verdict") or {}).get("code")
    alt_code = (alt.get("verdict") or {}).get("code")
    if (chosen_code in ("municipal_path", "protected_conflict",
                        "constrained_urban")
            and alt_code is not None
            and (_VERDICT_RANK.get(alt_code, len(_VERDICT_RANK))
                 < _VERDICT_RANK.get(chosen_code, len(_VERDICT_RANK)))):
        reason += (f" Note: this corridor screens {chosen_code} while the "
                   f"{alt['id']} option screens {alt_code} — compare both "
                   "below.")
        alt_reason += (f" Note: the chosen {chosen['id']} corridor screens "
                       f"{chosen_code} while this option screens {alt_code} "
                       "— compare both below.")
    return reason, alt_reason


def _siting(blockers: dict, pt) -> dict | None:
    """Off-limits siting flag (contract §7b): point-in-polygon of the query
    point against the already-loaded protected/water trees. Absent when
    neither layer is available — missing data is never faked; each key is
    null-safe when its own layer is missing."""
    protected = blockers["protected"]
    water = blockers["water"]
    if not protected["available"] and not water["available"]:
        return None
    name = None
    if protected["available"]:
        hits = [int(i) for i in protected["tree"].query(pt, predicate="intersects")]
        if hits:
            # Overlapping CPAD holdings: the smallest (most specific) names it.
            best = min(hits, key=lambda i: protected["geoms"][i].area)
            name = protected["props"][best].get("name") or None
    on_water = bool(water["available"] and
                    list(water["tree"].query(pt, predicate="intersects")))
    return {"protected": name, "water": on_water}


def _analyze(lat: float, lng: float) -> dict:
    """Full grid analysis for one point — the /api/grid/nearest payload minus
    "query" (contract §6a: grid_nearest and the scan candidates share it)."""
    st = _get(wait=False)
    if st is None:
        raise HTTPException(status_code=503, detail="grid data warming up")
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
        hit_t = (dist, props, closest)
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
        hit_s = (dist, props, closest)
    else:
        hit_s = None

    # Screening-relevant nearest: substation wins ties on bucket rank (its
    # thresholds are the practical interconnection proxy), else transmission.
    if hit_t is None and hit_s is None:
        access = {"kind": None, "distance_m": None, "distance_mi": None,
                  "bucket": "remote",
                  "label": "No mapped grid infrastructure within 200 km"}
        access_pt = None
    else:
        b_t = _bucket(hit_t[0], "transmission") if hit_t else None
        b_s = _bucket(hit_s[0], "substation") if hit_s else None
        if hit_s and (hit_t is None or _BUCKET_ORDER[b_s] <= _BUCKET_ORDER[b_t]):
            kind, (dist, props, access_pt), bucket = "substation", hit_s, b_s
        else:
            kind, (dist, props, access_pt), bucket = "transmission", hit_t, b_t
        access = {"kind": kind, "distance_m": round(dist, 1),
                  "distance_mi": round(dist / MILE_M, 2), "bucket": bucket,
                  "label": _label(kind, dist, props)}

    hookup = _hookup(access, transmission, substation)
    resp = {"transmission": transmission, "substation": substation,
            "access": access,
            "hookup": hookup,
            "disclaimer": DISCLAIMER}
    if access_pt is not None:  # contract §5b: corridor needs both endpoints
        resp["path"] = _path(st, pt, access_pt, access)

    # --- Comparison options (contract §6b) --------------------------------
    # BOTH candidate access points fully worked up, so the frontend can let
    # the user compare/switch connection points per parcel. The CHOSEN side
    # reuses the hookup/path computed above (no double work); the
    # alternative costs one extra _hookup + _path. /api/grid/scan calls
    # _analyze up to 3× per parcel, so a scan now also pays for up to 3
    # alternative corridors — acceptable at screening scale, and c0 reuses
    # c0_analysis rather than recomputing.
    options: list[dict] = []
    if access_pt is not None:
        chosen_opt = _option(access, hookup, resp.get("path"), chosen=True)
        alt_opt = None
        if hit_t is not None and hit_s is not None:
            if access["kind"] == "substation":
                alt_kind, (alt_dist, alt_props, alt_pt) = "transmission", hit_t
            else:
                alt_kind, (alt_dist, alt_props, alt_pt) = "substation", hit_s
            # Same shape dict as the chosen access — the pick itself is
            # untouched; this is purely the road not taken, worked up.
            alt_access = {"kind": alt_kind, "distance_m": round(alt_dist, 1),
                          "distance_mi": round(alt_dist / MILE_M, 2),
                          "bucket": _bucket(alt_dist, alt_kind),
                          "label": _label(alt_kind, alt_dist, alt_props)}
            alt_opt = _option(alt_access,
                              _hookup(alt_access, transmission, substation),
                              _path(st, pt, alt_pt, alt_access),
                              chosen=False)
        tied = alt_opt is not None and access["bucket"] == alt_opt["bucket"]
        chosen_reason, alt_reason = _reason(chosen_opt, alt_opt, tied)
        chosen_opt["reason"] = chosen_reason
        access["reason"] = chosen_reason
        options.append(chosen_opt)
        if alt_opt is not None:
            alt_opt["reason"] = alt_reason
            options.append(alt_opt)
    else:
        # Missing data is never faked: nothing mapped, nothing to compare.
        access["reason"] = ("No mapped transmission line or substation "
                            "within screening range (200 km) — no "
                            "connection point to compare.")
    resp["options"] = options
    # Contract §7b: siting flag rides _analyze, so every scan candidate (§6a)
    # inherits it automatically.
    siting = _siting(st["blockers"], pt)
    if siting is not None:
        resp["siting"] = siting
    return resp


@router.get("/api/grid/nearest")
async def grid_nearest(lat: float, lng: float):
    return {"query": {"lat": lat, "lng": lng}, **_analyze(lat, lng)}


# --- Pre-scanned farm-origin candidates (contract §6a) ---------------------
# Scan bodies carry one parcel polygon; reject anything past 5 MB before
# parsing (contract §6a perf note).
MAX_SCAN_BODY_BYTES = 5 * 1024 * 1024
# Candidates closer than this (EPSG:3310 meters) are duplicates — drop them.
SCAN_DEDUPE_M = 50.0
# Verdict rank for picking "best" (contract §6a frozen order). A candidate
# with no corridor — access.kind None → _analyze omits "path" — ranks remote.
_VERDICT_RANK = {"clear_rural": 0, "municipal_path": 1, "constrained_urban": 2,
                 "review": 3, "protected_conflict": 4, "remote": 5}


def _scan_rank(candidate: dict) -> tuple:
    """(verdict rank, gentie miles, urban crossing miles) — lower wins."""
    path = candidate.get("path") or {}
    code = (path.get("verdict") or {}).get("code")
    gentie = (candidate.get("hookup") or {}).get("gentie_mi")
    urban = (path.get("urban") or {}).get("crossing_mi")
    return (_VERDICT_RANK.get(code, _VERDICT_RANK["remote"]),
            gentie if gentie is not None else float("inf"),
            urban if urban is not None else 0.0)


@router.post("/api/grid/scan")
async def grid_scan(request: Request):
    st = _get(wait=False)
    if st is None:
        raise HTTPException(status_code=503, detail="grid data warming up")
    if not st["loaded"]:
        raise HTTPException(status_code=503, detail="grid data not loaded")
    body = await request.body()
    if len(body) > MAX_SCAN_BODY_BYTES:
        raise HTTPException(status_code=413,
                            detail="geometry body too large (5 MB max)")
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="body is not valid JSON")
    geom_json = payload.get("geometry") if isinstance(payload, dict) else None
    if isinstance(payload, dict) and "type" in payload:
        raise HTTPException(status_code=400, detail='body must be '
                            '{"geometry": <GeoJSON Polygon|MultiPolygon>}, '
                            f'not a bare GeoJSON {payload["type"]} object')
    if not isinstance(geom_json, dict):
        raise HTTPException(status_code=400, detail='body must be '
                            '{"geometry": <GeoJSON Polygon|MultiPolygon>}')
    try:
        geom = shape(geom_json)
    except Exception:
        raise HTTPException(status_code=400, detail="unparseable geometry")
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise HTTPException(status_code=400, detail="geometry must be a "
                            f"Polygon or MultiPolygon, got {geom.geom_type}")
    if geom.is_empty:
        raise HTTPException(status_code=400, detail="geometry is empty")
    poly = shp_transform(_TO_3310.transform, geom)

    # c0: parcel centroid. Holes/concave shapes can put the centroid outside
    # the parcel — representative_point() guarantees an interior point.
    c0 = poly.centroid
    if not poly.covers(c0):
        c0 = poly.representative_point()
    lng0, lat0 = _TO_4326.transform(c0.x, c0.y)
    c0_analysis = _analyze(lat0, lng0)

    # The boundary targets c0's access point; the closest point rides on the
    # transmission/substation entry named by access.kind.
    access_pt = None
    kind = c0_analysis["access"].get("kind")
    if kind:
        closest = (c0_analysis.get(kind) or {}).get("closest")
        if closest:
            access_pt = shp_transform(_TO_3310.transform, shape(
                {"type": "Point",
                 "coordinates": [closest["lng"], closest["lat"]]}))
    if access_pt is None:
        # Nothing within 200 km: scanning edges is meaningless off-grid.
        candidates = [{"id": "c0", "kind": "centroid",
                       "point": {"lat": round(lat0, 6), "lng": round(lng0, 6)},
                       **c0_analysis}]
        return {"candidates": candidates, "best": "c0"}

    # c1: boundary point nearest the access point — a pad sits inside the
    # fence line, not on it, so pull 2% back toward c0 along the segment.
    # c2: midpoint of the c0→c1 segment.
    seg = LineString([c0, nearest_points(access_pt, poly.boundary)[1]])
    if seg.length > 0:
        c1 = seg.interpolate(seg.length * 0.98)
        c2 = seg.interpolate(seg.length * 0.5)
    else:
        c1 = c2 = c0
    specs = [("c0", "centroid", c0), ("c1", "edge-nearest", c1),
             ("c2", "mid", c2)]
    kept = []  # contract cap is 4; three specs never reach it
    for cid, ckind, pt in specs:
        if any(pt.distance(p) < SCAN_DEDUPE_M for _, _, p in kept):
            continue
        kept.append((cid, ckind, pt))

    candidates = []
    for cid, ckind, pt in kept:
        clng, clat = _TO_4326.transform(pt.x, pt.y)
        # c0 reuses c0_analysis — its options/alternative corridor are not
        # computed twice (§6b note on _analyze).
        analysis = c0_analysis if cid == "c0" else _analyze(clat, clng)
        candidates.append({"id": cid, "kind": ckind,
                           "point": {"lat": round(clat, 6),
                                     "lng": round(clng, 6)},
                           **analysis})
    return {"candidates": candidates,
            "best": min(candidates, key=_scan_rank)["id"]}


# Serveable pmtiles archives (contract §7b/§8b): grid = transmission/
# substations, offlimits = no-go land classes, scores = precomputed parcel
# screening scores. Anything else is a 404, never a path probe.
_TILE_ARCHIVES = frozenset({"grid", "offlimits", "scores"})


@router.get("/api/grid/tiles/{name}.pmtiles")
async def grid_tiles(name: str, request: Request):
    """pmtiles needs HTTP Range reads — serve 206 partial content, no deps."""
    if name not in _TILE_ARCHIVES:
        raise HTTPException(status_code=404, detail="unknown tile archive")
    path = DATA_DIR / f"{name}.pmtiles"
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
    # Peek, never trigger the cold parse from a status poll: _state None =
    # warmup still running (preload thread) — report it, answer instantly.
    st = _state
    path = DATA_DIR / "grid.pmtiles"
    offlimits = DATA_DIR / "offlimits.pmtiles"
    scores = DATA_DIR / "scores.pmtiles"
    base = {"pmtiles_bytes": path.stat().st_size if path.exists() else 0,
            # Contract §7b: additive — the off-limits archive's size (0 = not
            # baked yet).
            "offlimits_pmtiles_bytes":
                offlimits.stat().st_size if offlimits.exists() else 0,
            # Contract §8b: the precomputed parcel-scores archive's size.
            "scores_pmtiles_bytes":
                scores.stat().st_size if scores.exists() else 0}
    if st is None:
        return {**base, "lines": 0, "substations": 0,
                "loaded": False, "warming": True, "layers": {}}
    return {**base,
            "lines": len(st["line_geoms"]), "substations": len(st["sub_geoms"]),
            "loaded": st["loaded"],
            "warming": False,
            "layers": {k: v["available"]
                       for k, v in st.get("blockers", {}).items()}}
