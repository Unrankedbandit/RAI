#!/usr/bin/env python3
"""Statewide fan-out: fetch -> score -> bake every CA county's parcels.

Pipeline per county (scripts/score/):
  1. fetch_county_parcels.py <County>            — live county endpoints
     (ArcGIS offset pager; Socrata pager for San Mateo / Santa Clara)
  2. fetch_county_parcels.py <County> --source i15 — the 12 counties with no
     full-fabric endpoint (partial subsets + mosaic-only): DWR statewide
     mosaic, county-filtered. Flaky (~20% page 500s, poison pages) hence a
     separate, smaller worker pool.
  3. score_parcels.py <County>                   — deterministic, local-only
  4. bake_scores.sh (all *.scored.geojsonl -> one scores layer) — re-run
     after every BAKE_EVERY newly scored counties so the map grows during
     the run; bake goes to a temp file then atomic-mv's over the live
     scores.pmtiles.

Resume-safe: completed fetches (geojsonl present, no .progress) and counties
whose .scored.geojsonl is newer than their raw file are skipped. Kern is
skipped entirely when its .progress exists (an i15 fetch was already running
when this runner was written — score/bake it separately when that finishes).

Status: agent_backend/data/scores/STATEWIDE.status.json every 30 s, plus
per-county logs in data/scores/logs/.

Usage: run_statewide.py [--fetch-only] [--score-only] [--no-bake]
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "score"))
from fetch_county_parcels import COUNTIES_TS, load_registry  # noqa: E402

SCORES_DIR = Path(os.getenv("RAI_SCORES_DIR")
                  or REPO_ROOT / "agent_backend" / "data" / "scores")
GRID_DIR = REPO_ROOT / "agent_backend" / "data" / "grid"
LOGS_DIR = SCORES_DIR / "logs"
VENV_PY = REPO_ROOT / ".venv" / "bin" / "python"
FETCH = REPO_ROOT / "scripts" / "score" / "fetch_county_parcels.py"
SCORE = REPO_ROOT / "scripts" / "score" / "score_parcels.py"
# Incremental bakes stay single-tier (fast, parcels only); the FINAL bake is
# the two-tier LOD archive (scorecells z0-9 + parcels z10+) per the
# 2026-08-25 LOD research.
BAKE_INCREMENTAL = REPO_ROOT / "scripts" / "score" / "bake_scores.sh"
BAKE_FINAL = REPO_ROOT / "scripts" / "score" / "bake_scores_lod.sh"

FETCH_WORKERS = 4   # county-direct (each fetch is sequential per server)
I15_WORKERS = 2     # the DWR mosaic 500s under pressure — stay polite
SCORE_WORKERS = 3   # CPU-bound shapely; each process loads grid state
BAKE_EVERY = 5      # newly scored counties between incremental bakes

# Probed 2026-08-25 (used only to schedule biggest-first so the long poles
# start early). Unknown counties sort after these, alphabetically.
ESTIMATES = {
    "Los Angeles": 2432677, "San Diego": 1089701, "Orange": 987165,
    "San Bernardino": 839971, "Santa Clara": 502789, "Sacramento": 502081,
    "Alameda": 489784, "Contra Costa": 387862, "Ventura": 267914,
    "San Francisco": 227632, "San Mateo": 235348, "Fresno": 315548,
    "Riverside": 800000, "Kern": 428916, "Placer": 160000, "Imperial": 60000,
    "Kings": 45000, "Calaveras": 30000, "Modoc": 6000, "Butte": 110000,
    "Santa Barbara": 150000, "Santa Cruz": 100000, "Siskiyou": 50000,
    "Tehama": 30000,
}

state_lock = threading.Lock()
state: dict[str, dict] = {}
score_q: queue.Queue[str] = queue.Queue()
newly_scored = 0
bake_lock = threading.Lock()
bake_enabled = True


def note(county: str, **kw) -> None:
    with state_lock:
        state.setdefault(county, {}).update(kw, updated=time.time())


def run_step(county: str, cmd: list[str], tag: str, log_suffix: str) -> bool:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOGS_DIR / f"{county}.{log_suffix}.log"
    note(county, **{tag: "running"})
    t0 = time.time()
    with log_path.open("a", encoding="utf-8") as log:
        log.write(f"\n=== {time.strftime('%H:%M:%S')} {' '.join(cmd)}\n")
        rc = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT).returncode
    ok = rc == 0
    note(county, **{tag: "done" if ok else "FAILED",
                    f"{tag}_seconds": round(time.time() - t0)})
    if not ok:
        print(f"!! {county} {tag} FAILED (rc={rc}) — {log_path}", flush=True)
    return ok


def fetch_one(county: str, i15: bool) -> None:
    cmd = [str(VENV_PY), str(FETCH), county]
    if i15:
        cmd += ["--source", "i15"]
    note(county, source="i15" if i15 else "county")
    if run_step(county, cmd, "fetch", "fetch"):
        score_q.put(county)


def score_one(county: str) -> None:
    global newly_scored
    if run_step(county, [str(VENV_PY), str(SCORE), county], "score", "score"):
        with state_lock:
            newly_scored += 1
            n = newly_scored
        if bake_enabled and n % BAKE_EVERY == 0:
            bake(incremental=True)


def bake(incremental: bool) -> None:
    """Rebake all scored counties to a temp archive, atomic-mv over live."""
    if not bake_lock.acquire(blocking=False):
        return  # a bake is already running; the next threshold will catch up
    try:
        tmp = GRID_DIR / f"scores.pmtiles.baking"
        env = dict(os.environ, SCORES_PMTILES_OUT=str(tmp))
        t0 = time.time()
        rc = subprocess.run(
            ["bash", str(BAKE_FINAL if not incremental else BAKE_INCREMENTAL)],
            env=env,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT).returncode
        if rc == 0 and tmp.exists():
            os.replace(tmp, GRID_DIR / "scores.pmtiles")
            note("_bake", state=("incremental" if incremental else "final"),
                 seconds=round(time.time() - t0),
                 bytes=(GRID_DIR / "scores.pmtiles").stat().st_size)
            print(f"== bake ({'incremental' if incremental else 'final'}) "
                  f"done in {time.time()-t0:.0f}s", flush=True)
        else:
            tmp.unlink(missing_ok=True)
            note("_bake", state="FAILED", rc=rc)
            print("!! bake FAILED — live scores.pmtiles untouched", flush=True)
    finally:
        bake_lock.release()


def status_writer(stop: threading.Event) -> None:
    status_path = SCORES_DIR / "STATEWIDE.status.json"
    while not stop.is_set():
        with state_lock:
            snap = dict(state)
        done = sum(1 for v in snap.values()
                   if v.get("score") == "done")
        payload = {"updated": time.strftime("%Y-%m-%dT%H:%M:%S"),
                   "scored_done": done, "counties": snap}
        status_path.write_text(json.dumps(payload, indent=1))
        stop.wait(30)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fetch-only", action="store_true")
    ap.add_argument("--score-only", action="store_true")
    ap.add_argument("--no-bake", action="store_true")
    args = ap.parse_args()
    global bake_enabled
    bake_enabled = not args.no_bake and not args.fetch_only

    live = load_registry()  # {name: {api, endpoint}} — live counties only
    text = COUNTIES_TS.read_text(encoding="utf-8")
    i15_names = [m.group(1) for m in re.finditer(
        r"\{\s*name:\s*'([^']+)',\s*status:\s*'(partial|mosaic-only)'", text)]

    county_direct, i15 = [], []
    for name in sorted(set(live) | set(i15_names),
                       key=lambda n: -ESTIMATES.get(n, 0)):
        raw = SCORES_DIR / f"{name}.geojsonl"
        progress = SCORES_DIR / f"{name}.geojsonl.progress"
        scored = SCORES_DIR / f"{name}.scored.geojsonl"
        if raw.exists() and not progress.exists():
            if scored.exists() and scored.stat().st_mtime >= raw.stat().st_mtime:
                note(name, fetch="cached", score="cached")
                continue  # fully done already
            if args.fetch_only:
                note(name, fetch="cached")
                continue
            note(name, fetch="cached")
            if not args.score_only:
                pass
            score_q.put(name)  # fetched earlier, needs scoring
            continue
        if progress.exists():
            # In flight elsewhere (Kern i15 run) — do not double-pull.
            note(name, fetch="external-in-progress", source="i15")
            continue
        (i15 if name in i15_names else county_direct).append(name)

    print(f"county-direct queue ({len(county_direct)}): "
          f"{', '.join(county_direct)}", flush=True)
    print(f"i15 queue ({len(i15)}): {', '.join(i15)}", flush=True)

    stop = threading.Event()
    threading.Thread(target=status_writer, args=(stop,),
                     daemon=True).start()

    scorers = ThreadPoolExecutor(max_workers=SCORE_WORKERS)
    fetch_pools = [
        ThreadPoolExecutor(max_workers=FETCH_WORKERS),
        ThreadPoolExecutor(max_workers=I15_WORKERS),
    ]
    if not args.score_only:
        for c in county_direct:
            fetch_pools[0].submit(fetch_one, c, False)
        for c in i15:
            fetch_pools[1].submit(fetch_one, c, True)
    else:
        for c in county_direct + i15:
            if (SCORES_DIR / f"{c}.geojsonl").exists():
                score_q.put(c)

    # Feed the scoring pool until all fetches have finished and the queue
    # has drained.
    pending_fetches = len(county_direct) + len(i15)
    while True:
        try:
            county = score_q.get(timeout=10)
        except queue.Empty:
            with state_lock:
                done_fetches = sum(
                    1 for v in state.values()
                    if v.get("fetch") in ("done", "FAILED", "cached",
                                          "external-in-progress"))
            if args.score_only or done_fetches >= pending_fetches + sum(
                    1 for v in state.values()
                    if v.get("fetch") == "cached"):
                if score_q.empty():
                    break
            continue
        if not args.fetch_only:
            scorers.submit(score_one, county)

    for pool in fetch_pools:
        pool.shutdown(wait=True)
    scorers.shutdown(wait=True)
    if bake_enabled:
        bake(incremental=False)
    stop.set()

    failed = [k for k, v in state.items()
              if "FAILED" in (v.get("fetch"), v.get("score"))]
    print(f"STATEWIDE RUN COMPLETE — failed steps: {failed or 'none'}",
          flush=True)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
