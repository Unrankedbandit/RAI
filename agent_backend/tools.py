"""Tool layer available to agents.

Generated code execution happens inside a Daytona sandbox (see sandbox.py).
Document parsing does NOT — `pdf_extract` and `xlsx_extract` run pypdf and
openpyxl in this process, on the host. That is a deliberate trade for speed on
trusted dossiers, but it means a malicious PDF is parsed with host privileges;
route untrusted uploads through `sandbox_run` before trusting their contents.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent
KB_DIR = Path(os.getenv("KB_DIR", str(_BACKEND_DIR / "research")))
DOC_DIR = Path(os.getenv("DOC_DIR", str(_BACKEND_DIR / "project-docs")))

# Sandbox credentials, egress allow-list and timeouts live in sandbox.py,
# next to the code that enforces them.


def pdf_extract(filename: str) -> str:
    """Extract full text of a PDF dossier with page markers. Runs in the sandbox."""
    from pypdf import PdfReader
    reader = PdfReader(str(DOC_DIR / filename))
    return "\n".join(f"--- page {i+1} ---\n{p.extract_text() or ''}" for i, p in enumerate(reader.pages))[:12000]


def xlsx_extract(filename: str) -> str:
    """Extract all sheets of an XLSX dossier as pipe-delimited rows."""
    import openpyxl
    wb = openpyxl.load_workbook(str(DOC_DIR / filename), data_only=True)
    out = []
    for ws in wb.worksheets:
        out.append(f"=== SHEET: {ws.title} ===")
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) if c is not None else "" for c in row]
            if any(cells):
                out.append(" | ".join(cells))
    return "\n".join(out)[:12000]


def kb_lookup(query: str, max_hits: int = 5) -> str:
    """Keyword search the compiled due-diligence knowledge base for benchmark context."""
    terms = [t.lower() for t in re.findall(r"[a-zA-Z0-9$%.-]{3,}", query)]
    hits: list[tuple[int, str]] = []
    for md in KB_DIR.glob("*.md"):
        for para in md.read_text(encoding="utf-8").split("\n\n"):
            score = sum(para.lower().count(t) for t in terms)
            if score:
                hits.append((score, para.strip()))
    hits.sort(key=lambda h: -h[0])
    return "\n\n---\n\n".join(p for _, p in hits[:max_hits]) or "no knowledge-base matches"


def web_search(query: str) -> str:
    """Search the web for current, location-specific regulatory/market data."""
    key = os.getenv("TAVILY_API_KEY", "")
    if not key:
        # Offline mode: these are knowledge-base passages, NOT web results —
        # they carry no URLs. Say so plainly, or scouts invent citations for
        # text that never came from the web.
        return "WEB SEARCH UNAVAILABLE (no TAVILY_API_KEY) — knowledge-base fallback, do not cite URLs from this:\n" + kb_lookup(query)
    import httpx
    r = httpx.post(
        "https://api.tavily.com/search",
        json={"api_key": key, "query": query, "max_results": 5},
        timeout=30,
    )
    if r.status_code >= 400:
        return f"WEB SEARCH FAILED: HTTP {r.status_code} — fall back to kb_lookup."
    results = r.json().get("results", [])
    return "\n".join(f"- {x['title']}: {x['url']}\n  {x.get('content','')[:400]}" for x in results)


def web_fetch(url: str) -> str:
    """Fetch and read a specific source document or regulation page."""
    import httpx
    r = httpx.get(url, timeout=30, follow_redirects=True)
    if r.status_code >= 400:
        # A 404 page stripped of tags reads like real content — the scout
        # can't tell a dead link from a source. State the failure explicitly.
        return f"FETCH FAILED: HTTP {r.status_code} for {url} — do not cite this URL; try another source or kb_lookup."
    text = re.sub(r"<[^>]+>", " ", r.text)
    return re.sub(r"\s+", " ", text)[:8000]


# --- Bright Data Web Unlocker -------------------------------------------------
# POST https://api.brightdata.com/request — Bearer token + zone, returns page
# content (data_format=markdown). The repair path escalates to render="true"
# when expected markers vanish, i.e. the target site changed its HTML.
# Note: Bright Data's AI `extract` tool exists only on their MCP server (it
# samples the MCP client's LLM) — no standalone AI-extract REST endpoint is
# documented, so repair re-fetches with rendering instead of guessing one.

BRIGHTDATA_ENDPOINT = "https://api.brightdata.com/request"


def _bd_unlock(url: str, *, render: bool, timeout: float) -> str:
    """One Web Unlocker call. With format=raw the body comes back as plain
    text; if the documented JSON envelope ({status_code, headers, body}) is
    what comes back instead, unwrap it."""
    import httpx
    payload = {
        "zone": os.getenv("BRIGHTDATA_ZONE", "web_unlocker1"),
        "url": url,
        "format": "raw",
        "data_format": "markdown",
    }
    if render:
        payload["render"] = "true"
    r = httpx.post(
        BRIGHTDATA_ENDPOINT,
        headers={
            "Authorization": f"Bearer {os.environ['BRIGHTDATA_API_TOKEN']}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=timeout,
    )
    r.raise_for_status()
    text = r.text
    try:
        envelope = json.loads(text)
    except ValueError:
        return text
    if isinstance(envelope, dict) and isinstance(envelope.get("body"), str):
        return envelope["body"]
    return text


def _missing_markers(content: str, markers: list[str]) -> list[str]:
    low = content.lower()
    return [m for m in markers if m.lower() not in low]


def brightdata_scrape(url: str, expect: str = "") -> str:
    """Scrape a URL through Bright Data Web Unlocker — bot-detection and CAPTCHA
    proof — and return clean markdown. Validates the comma-separated `expect`
    markers the caller says the page must contain (figures, statute names);
    when they vanish the tool assumes the site's HTML changed and self-repairs
    by re-fetching with JS rendering. Needs BRIGHTDATA_API_TOKEN; without it
    returns empty so the agent falls back to web_search/kb_lookup."""
    from .obs import current_trace
    t = current_trace()
    if not os.getenv("BRIGHTDATA_API_TOKEN", ""):
        t.event("scraper.skipped",
                "BRIGHTDATA_API_TOKEN not set — returning empty; agent falls back "
                "to web_search/kb_lookup", url=url)
        return ""
    timeout = float(os.getenv("BRIGHTDATA_TIMEOUT_S", "60"))
    markers = [m.strip() for m in expect.split(",") if m.strip()]

    content = ""
    try:
        with t.span("scraper.fetch", f"unlock {url}", url=url) as sp:
            content = _bd_unlock(url, render=False, timeout=timeout)
            sp["chars"] = len(content)
    except Exception as exc:
        t.error("scraper.failed", f"unlock request failed — {type(exc).__name__}: {exc}",
                url=url, render=False)

    missing = _missing_markers(content, markers)
    if content.strip() and not missing:
        return content
    reason = ("empty response" if not content.strip()
              else f"expected markers absent: {', '.join(missing)}")
    t.warn("scraper.repair",
           f"{url}: {reason} — page structure may have changed; "
           "re-fetching with JS rendering",
           url=url, reason=reason, markers=markers)

    try:
        with t.span("scraper.fetch", f"repair render {url}", url=url, render=True) as sp:
            repaired = _bd_unlock(url, render=True, timeout=timeout)
            sp["chars"] = len(repaired)
    except Exception as exc:
        t.error("scraper.failed", f"repair fetch failed — {type(exc).__name__}: {exc}",
                url=url, render=True, reason=reason)
        return ""
    if not repaired.strip():
        t.error("scraper.failed", "repair fetch returned empty — giving up",
                url=url, render=True, reason=reason)
        return ""
    still = _missing_markers(repaired, markers)
    if still:
        # The site really did change: the old markers, not the pipeline, are
        # stale. Return the rendered markdown and say which markers went away
        # so the agent re-derives expectations from the live page.
        t.event("scraper.repaired",
                f"rendered fetch succeeded; markers still absent (stale): {', '.join(still)}",
                url=url, stillMissing=still, chars=len(repaired))
    return repaired


def sandbox_run(code: str) -> str:
    """Execute untrusted generated code in an isolated Daytona sandbox
    (parsing, reconciliation math, scoring) — never on the host.

    The sandbox carries the model credential, so generated code can call
    Claude from inside it; egress is restricted to SANDBOX_ALLOWED_DOMAINS.
    """
    # Implementation lives in sandbox.py, which traces the create/exec/delete
    # lifecycle and refuses to fall back to host execution unless explicitly
    # permitted. Imported lazily so tools.py stays importable without the SDK.
    from .sandbox import sandbox_run as _run
    return _run(code)


# --- JSON Schemas for tool specs (the model needs these to pass arguments) ---
pdf_extract.schema = {"type": "object", "properties": {"filename": {"type": "string", "description": "Dossier filename in the project docs directory, e.g. 01_Land_and_Site_Due_Diligence.pdf"}}, "required": ["filename"]}
xlsx_extract.schema = {"type": "object", "properties": {"filename": {"type": "string", "description": "Spreadsheet filename in the project docs directory, e.g. 01_Project_Red_Flag_Risk_Register.xlsx"}}, "required": ["filename"]}
kb_lookup.schema = {"type": "object", "properties": {"query": {"type": "string", "description": "Keywords to search the due-diligence knowledge base for, e.g. transformer lead time or zoning prohibition"}, "max_hits": {"type": "integer", "description": "Max passages to return (default 5)"}}, "required": ["query"]}
web_search.schema = {"type": "object", "properties": {"query": {"type": "string", "description": "Web search query for current or location-specific regulatory and market data"}}, "required": ["query"]}
web_fetch.schema = {"type": "object", "properties": {"url": {"type": "string", "description": "Full https URL of the source page to read"}}, "required": ["url"]}
brightdata_scrape.schema = {"type": "object", "properties": {"url": {"type": "string", "description": "Full https URL of the page to scrape through Bright Data Web Unlocker"}, "expect": {"type": "string", "description": "Comma-separated markers the page must contain (figures, statute/program names). When they vanish, the tool assumes the site's HTML changed and self-repairs with a JS-rendered fetch."}}, "required": ["url"]}
sandbox_run.schema = {"type": "object", "properties": {"code": {"type": "string", "description": "Python code to execute in the isolated sandbox"}}, "required": ["code"]}
