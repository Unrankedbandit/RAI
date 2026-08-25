#!/usr/bin/env python3
"""smoke — post-deploy smoke test against a LIVE stack. Stdlib only.

Env:
  SMOKE_BASE_URL  backend base, e.g. https://rai-live-api.josephbissell.com
  SMOKE_WEB_URL   frontend base, e.g. https://rai-live.josephbissell.com
  SMOKE_TOKEN     optional ?token= query appended to backend calls (gate)

Checks (any failure exits 1):
  backend : /api/health ok + llm configured
            /api/grid/status loaded:true with nonzero archives
            grid.pmtiles + offlimits.pmtiles Range -> 206 partial content
            POST /api/projects/analyze -> 200 + jobId (contract only; the job
            itself takes minutes and is covered by e2e, not smoke)
  frontend: / and /parcels return 200 HTML

Run:
  SMOKE_BASE_URL=https://api.example.com SMOKE_WEB_URL=https://app.example.com \
      python scripts/smoke.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE = os.getenv("SMOKE_BASE_URL", "").rstrip("/")
WEB = os.getenv("SMOKE_WEB_URL", "").rstrip("/")
TOKEN = os.getenv("SMOKE_TOKEN", "")
TIMEOUT = 20

passed = failed = 0
UA = {"User-Agent": "rai-smoke/1.0"}


def q(url: str) -> str:
    return url + (("?" if "?" not in url else "&") + f"token={TOKEN}" if TOKEN else "")


def check(label: str, cond: bool, detail: str = ""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {label}")
    else:
        failed += 1
        print(f"  FAIL {label} {detail}")


def get(url: str, headers: dict | None = None):
    """(status, body-bytes, elapsed_ms); status 0 on transport error."""
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, r.read(), int((time.monotonic() - t0) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), int((time.monotonic() - t0) * 1000)
    except Exception as e:
        return 0, str(e).encode(), int((time.monotonic() - t0) * 1000)


def post_json(url: str, payload: dict):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={**UA, "Content-Type": "application/json"}, method="POST")
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, r.read(), int((time.monotonic() - t0) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), int((time.monotonic() - t0) * 1000)
    except Exception as e:
        return 0, str(e).encode(), int((time.monotonic() - t0) * 1000)


if not BASE and not WEB:
    print("SMOKE_BASE_URL / SMOKE_WEB_URL unset — nothing to check. "
          "Set them to a live deployment (repo vars SMOKE_BASE_URL/WEB_URL in CI).")
    sys.exit(2)

if BASE:
    print(f"== backend: {BASE} ==")
    s, b, ms = get(q(f"{BASE}/api/health"))
    check("health 200", s == 200, f"{s} ({ms}ms)")
    if s == 200:
        try:
            h = json.loads(b)
            check("health ok + llm configured",
                  h.get("ok") is True and h.get("llm", {}).get("configured") is True,
                  str(h)[:200])
        except json.JSONDecodeError:
            check("health parses as JSON", False, b[:120].decode(errors="replace"))

    s, b, ms = get(q(f"{BASE}/api/grid/status"))
    check("grid status 200", s == 200, f"{s} ({ms}ms)")
    if s == 200:
        try:
            st = json.loads(b)
            check("grid data loaded",
                  st.get("loaded") is True and st.get("pmtiles_bytes", 0) > 0
                  and st.get("lines", 0) > 0 and st.get("substations", 0) > 0,
                  str(st)[:200])
        except json.JSONDecodeError:
            check("grid status parses as JSON", False, b[:120].decode(errors="replace"))

    for name in ("grid", "offlimits"):
        s, b, ms = get(q(f"{BASE}/api/grid/tiles/{name}.pmtiles"),
                       headers={"Range": "bytes=0-255"})
        check(f"{name}.pmtiles Range -> 206 + 256B",
              s == 206 and len(b) == 256, f"{s} {len(b)}B ({ms}ms)")

    s, b, ms = post_json(q(f"{BASE}/api/projects/analyze"),
                         {"name": "smoke probe", "location": "Ventura County, CA",
                          "docs": [], "mode": "fast"})
    jid = None
    if s == 200:
        try:
            jid = json.loads(b).get("jobId")
        except json.JSONDecodeError:
            pass
    check("analyze 200 + jobId", s == 200 and isinstance(jid, str),
          f"{s} {b[:120].decode(errors='replace')} ({ms}ms)")

if WEB:
    print(f"== frontend: {WEB} ==")
    for path in ("/", "/parcels"):
        s, b, ms = get(f"{WEB}{path}")
        is_html = b"<" in b[:4096]
        check(f"GET {path} -> 200 HTML", s == 200 and is_html,
              f"{s} ({ms}ms)")

print("-" * 48)
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
