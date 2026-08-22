"""Tool layer available to agents.

Generated code execution happens inside a Daytona sandbox (see sandbox.py).
Document parsing does NOT — `pdf_extract` and `xlsx_extract` run pypdf and
openpyxl in this process, on the host. That is a deliberate trade for speed on
trusted dossiers, but it means a malicious PDF is parsed with host privileges;
route untrusted uploads through `sandbox_run` before trusting their contents.
"""
from __future__ import annotations

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
        return kb_lookup(query)  # demo-resilient fallback: answer from KB
    import httpx
    r = httpx.post(
        "https://api.tavily.com/search",
        json={"api_key": key, "query": query, "max_results": 5},
        timeout=30,
    )
    results = r.json().get("results", [])
    return "\n".join(f"- {x['title']}: {x['url']}\n  {x.get('content','')[:400]}" for x in results)


def web_fetch(url: str) -> str:
    """Fetch and read a specific source document or regulation page."""
    import httpx
    r = httpx.get(url, timeout=30, follow_redirects=True)
    text = re.sub(r"<[^>]+>", " ", r.text)
    return re.sub(r"\s+", " ", text)[:8000]


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
sandbox_run.schema = {"type": "object", "properties": {"code": {"type": "string", "description": "Python code to execute in the isolated sandbox"}}, "required": ["code"]}
