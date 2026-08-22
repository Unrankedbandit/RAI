"""Bright Data scraper tool tests — no live key needed; httpx.post is mocked.

Covers:
  a. clean scrape — markdown containing the expect markers comes straight back
  b. changed HTML — markers vanish, scraper.repair fires, the JS-rendered
     re-fetch wins (asserts render:"true" went out on the second call)
  c. total failure — transport errors on both attempts -> "" + scraper.failed
  d. no token — graceful skip: "" + scraper.skipped, no HTTP call at all

Run: .venv/bin/python scripts/test-brightdata.py   (exit 0 = all passed)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx

from agent_backend.obs import Trace, set_current_trace
from agent_backend.tools import brightdata_scrape

passed, failed = [], []


def ok(name, cond, detail=""):
    (passed if cond else failed).append(name)
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f" — {detail}" if detail and not cond else ""))


class FakeResp:
    def __init__(self, text):
        self.text = text
        self.status_code = 200

    def raise_for_status(self):
        return None


class FakeBrightData:
    """Scripted stand-in for POST https://api.brightdata.com/request. Each
    queued item is a response body (str) or an Exception to raise."""

    def __init__(self, *items):
        self.items = list(items)
        self.calls = []

    def __call__(self, url, headers=None, json=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "json": json})
        item = self.items.pop(0)
        if isinstance(item, Exception):
            raise item
        return FakeResp(item)


def run_scenario(fake, *args, **kwargs):
    """Call brightdata_scrape with a fresh trace and the fake patched in."""
    trace = Trace(f"test-{len(passed) + len(failed)}")
    set_current_trace(trace)
    orig = httpx.post
    httpx.post = fake
    try:
        out = brightdata_scrape(*args, **kwargs)
    finally:
        httpx.post = orig
    return out, trace.events


os.environ["BRIGHTDATA_API_TOKEN"] = "test-token"
os.environ.pop("BRIGHTDATA_ZONE", None)

URL = "https://planning.example.gov/parcel-04/solar-ordinance"
MARKERS = "4.2 MW, Section 17.48"

# a) clean scrape — markers present on the first fetch
CLEAN = "# Solar ordinance\nParcel 04 approved for 4.2 MW under Section 17.48.\n"
fake = FakeBrightData(CLEAN)
out, events = run_scenario(fake, URL, expect=MARKERS)
ok("a. clean scrape returns content", out == CLEAN, repr(out[:60]))
ok("a. no repair/failure events",
   not [e for e in events if e.kind in ("scraper.repair", "scraper.failed")],
   str([e.kind for e in events]))
ok("a. request shape: zone/url/format/data_format",
   fake.calls[0]["json"] == {"zone": "web_unlocker1", "url": URL,
                             "format": "raw", "data_format": "markdown"},
   str(fake.calls[0]["json"]))
ok("a. auth header is Bearer token",
   fake.calls[0]["headers"]["Authorization"] == "Bearer test-token")
ok("a. only one HTTP call", len(fake.calls) == 1, str(len(fake.calls)))

# b) site changed its HTML — markers vanish, repair escalates to render=true
CHANGED = "# Solar ordinance\nOur permitting portal has moved — see the new page.\n"
REPAIRED = "# Solar ordinance (rendered)\nParcel 04 approved for 4.2 MW under Section 17.48.\n"
fake = FakeBrightData(CHANGED, REPAIRED)
out, events = run_scenario(fake, URL, expect=MARKERS)
repair = [e for e in events if e.kind == "scraper.repair"]
ok("b. scraper.repair event emitted", len(repair) == 1,
   str([e.kind for e in events]))
ok("b. repair event is a warn with url + reason",
   bool(repair) and repair[0].level == "warn"
   and repair[0].data.get("url") == URL and "markers absent" in repair[0].data.get("reason", ""),
   str(repair[0].to_json() if repair else "no event"))
ok("b. repair re-fetch used render:true",
   len(fake.calls) == 2 and fake.calls[1]["json"].get("render") == "true",
   str([c["json"] for c in fake.calls]))
ok("b. repaired content returned", out == REPAIRED, repr(out[:60]))

# c) total failure — both attempts error out
fake = FakeBrightData(httpx.ConnectError("connection refused"),
                      httpx.ConnectError("connection refused"))
out, events = run_scenario(fake, URL, expect=MARKERS)
fails = [e for e in events if e.kind == "scraper.failed"]
ok("c. graceful empty result", out == "", repr(out))
ok("c. scraper.failed error event(s) emitted",
   len(fails) >= 1 and all(e.level == "error" for e in fails),
   str([e.kind for e in events]))
ok("c. repair still attempted after first failure", len(fake.calls) == 2,
   str(len(fake.calls)))

# d) no token — skip without any HTTP call
del os.environ["BRIGHTDATA_API_TOKEN"]
fake = FakeBrightData()
out, events = run_scenario(fake, URL, expect=MARKERS)
ok("d. no token -> graceful empty", out == "", repr(out))
ok("d. scraper.skipped event emitted",
   any(e.kind == "scraper.skipped" for e in events),
   str([e.kind for e in events]))
ok("d. no HTTP call made", len(fake.calls) == 0, str(len(fake.calls)))

print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
