"""Investment-memo export: render a finished report as a standalone HTML
document, written by an LLM through the OpenAI-compatible bridge.

Flow: POST /api/reports/{job_id}/memo loads reports/<job_id>.json, hands the
FULL report JSON to the writer model (deepseek-v4-pro via the bridge) with a
system prompt that pins the app's design tokens (see frontend globals.css),
validates the answer is a complete HTML5 document, then persists it to
memos/<job_id>.html. GET serves that file.

Failure contract — a memo is never faked: no LLM_API_KEY, a bridge exception,
or a non-HTML answer all surface as 502 with the reason. There is no template
fallback pretending to be the writer."""
from __future__ import annotations

import os
import re
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from . import db

router = APIRouter()

# Same store layout as main.py — duplicated here (not imported) because main
# imports this module and a back-import would be circular.
STORE = Path(__file__).resolve().parent / "reports"
MEMOS = Path(__file__).resolve().parent / "memos"

# Bridge config mirrors agents/base.py (same env vars, same default) so the
# memo writer rides the same OpenAI-compatible endpoint as the agents. The
# call itself uses httpx exactly like base.py's _openai_chat — the openai
# package is not in requirements.txt, and the bridge pattern is already httpx.
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://hackathon.josephbissell.com/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
MEMO_MODEL = os.getenv("MEMO_MODEL", "accounts/fireworks/models/deepseek-v4-pro")
MEMO_MAX_TOKENS = int(os.getenv("MEMO_MAX_TOKENS", "16000"))
MEMO_TIMEOUT = float(os.getenv("MEMO_TIMEOUT", "120"))

# job ids are uuid hex fragments / slugs only — the pattern is also the path
# traversal guard, since the id lands in a filesystem path.
_JOB_ID = re.compile(r"^[a-z0-9-]{1,32}$")
_FENCE = re.compile(r"^\s*```(?:html)?\s*|\s*```\s*$", re.IGNORECASE)

# The app's design language (frontend/src/app/globals.css, light theme),
# pinned into the writer's system prompt so the exported memo reads as part
# of the product instead of a default-styled dump. Status semantics matter:
# grey/near-black/orange only for status; green/amber/red only for verdicts.
_DESIGN_TOKENS = """
:root CSS variables you MUST declare and use for all styling:
  --color-ink: #0b0829;        /* primary text */
  --color-muted: #5b5a72;      /* secondary text */
  --color-faint: #9694a8;      /* tertiary labels */
  --color-hairline: #efedf5;   /* borders/dividers */
  --color-canvas: #ffffff;     /* main surface, always white */
  --color-surface-2: #faf9fc;  /* recessed surface */
  --color-brand: #ff8400;      /* brand mark + flagged/risk status */
  --color-brand-soft: #fff1df; /* risk tint background */
  --color-oxford: #0b0829;     /* high-contrast fills */
  --color-vista: #8fa0d8;      /* sparing accent */
  --color-vista-soft: #eef1fa;
  --color-strong: #6b6f7d;     /* cleared / on-track (grey, NEVER green) */
  --color-strong-soft: #f1f1f4;
  --color-watch: #1e1e26;      /* watch / needs attention (near-black) */
  --color-watch-soft: #ececef;
  --color-risk: #ff8400;       /* flagged / danger (orange) */
  --color-risk-soft: #fff1df;
  --color-go: #1f9d55;         /* verdict only: proceed */
  --color-hold: #d97706;       /* verdict only: hold */
  --color-nogo: #dc2626;       /* verdict only: no-go */
  --radius-lg: 11px;           /* cards/panels */
  --radius-md: 5px;
  --radius-sm: 1px;
  --shadow-card: 0 1px 2px rgba(11,8,41,0.03), 0 6px 14px rgba(11,8,41,0.04);
Typography: body font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
Roboto, sans-serif (the app's fallback stack behind Poppins); headings max
font-weight 600; numerals/ids may use ui-monospace, "JetBrains Mono", monospace.
Status colors are grey / near-black / orange ONLY — green/amber/red are
reserved for go/hold/no-go verdict dots.
"""

_SYSTEM = (
    "You are an investment-memo writer. Output ONE complete standalone HTML5 "
    "document (<!DOCTYPE html>…</html>) styled with these design tokens:\n"
    f"{_DESIGN_TOKENS}\n"
    "Semantic sections, in order: header (project, location, date), decision "
    "line with readiness score, executive summary, scores by component table, "
    "key findings, contradictions, critical path, action pack, acquired data + "
    "sources, missing info, recommended next action, footer disclaimer. Use "
    "ONLY facts present in the report JSON — no invented numbers/URLs. Inline "
    "CSS only (a single <style> block in <head>, no external assets). Your "
    "reply IS the document: the first characters must be '<!DOCTYPE html>' — "
    "no commentary, no preamble, no code fences."
)


def _check_job_id(job_id: str) -> None:
    if not _JOB_ID.match(job_id):
        raise HTTPException(status_code=400, detail=f"invalid job id {job_id!r}")


def _extract_html(text: str) -> str:
    """The writer is told to return bare HTML; models still wrap it in
    ```html fences or prepend a one-line preamble ("Here is the document…").
    Strip fences, then slice from the first doctype/html tag to the closing
    </html> — the memo is the document, not the chat around it."""
    t = _FENCE.sub("", text).strip()
    low = t.lower()
    starts = [i for i in (low.find("<!doctype"), low.find("<html")) if i >= 0]
    if starts:
        t = t[min(starts):]
        low = t.lower()
    end = low.rfind("</html>")
    if end >= 0:
        t = t[: end + len("</html>")]
    return t


async def _write_memo(report_json: str) -> str:
    """One call against the bridge's chat-completions endpoint; returns the
    writer's raw text. Raises on any transport/HTTP failure — the route maps
    that to a 502 carrying the reason."""
    headers = {"Authorization": f"Bearer {LLM_API_KEY}"}
    payload = {
        "model": MEMO_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM},
            # Instruction AFTER the data, not before it: chatty models spend
            # their preamble on the system prompt alone and get truncated
            # before the doctype — ending the user turn with the command
            # starts the document immediately.
            {"role": "user", "content": (
                "Report JSON:\n" + report_json +
                "\n\nWrite the complete HTML memo now. Your reply IS the "
                "document — begin with <!DOCTYPE html>."
            )},
        ],
        "temperature": 0,
        "max_tokens": MEMO_MAX_TOKENS,
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(MEMO_TIMEOUT, connect=30)) as client:
        r = await client.post(f"{LLM_BASE_URL}/chat/completions", headers=headers, json=payload)
        r.raise_for_status()
        return r.json()["choices"][0]["message"].get("content") or ""


@router.post("/api/reports/{job_id}/memo")
async def generate_memo(job_id: str):
    """Write (or overwrite) the memo for a finished report. 502 — never a
    template — when the writer can't produce a real HTML document."""
    _check_job_id(job_id)
    # Load report — DB when configured, file fallback for tests/dev.
    report_json = None
    if db.is_enabled():
        db_report = await db.get_report(job_id)
        if db_report is not None:
            report_json = json.dumps(db_report, indent=2)
    else:
        path = STORE / f"{job_id}.json"
        if path.exists():
            report_json = path.read_text(encoding="utf-8")
    if report_json is None:
        raise HTTPException(status_code=404, detail=f"unknown report {job_id}")

    if not LLM_API_KEY:
        raise HTTPException(
            status_code=502,
            detail="LLM_API_KEY not configured — the memo writer cannot reach the bridge",
        )

    try:
        raw = await _write_memo(report_json)
    except Exception as e:
        # Surface the provider's reason — a bare "502" has sent people hunting
        # in the wrong layer before. HTTPStatusError also carries the bridge's
        # body, which says WHY (unknown model vs gateway timeout).
        detail = f"memo writer failed: {type(e).__name__}: {e}"
        if isinstance(e, httpx.HTTPStatusError):
            detail += f" (bridge body: {e.response.text[:400]})"
        raise HTTPException(status_code=502, detail=detail)

    html = _extract_html(raw)
    if "<html" not in html.lower() or "</html>" not in html.lower():
        raise HTTPException(
            status_code=502,
            detail=f"writer returned non-HTML: {html[:120]}",
        )

    MEMOS.mkdir(exist_ok=True)
    out = MEMOS / f"{job_id}.html"
    out.write_text(html, encoding="utf-8")
    return {"ok": True, "jobId": job_id, "bytes": out.stat().st_size}


@router.get("/api/reports/{job_id}/memo")
async def get_memo(job_id: str):
    """Serve the generated memo. 404 until a POST has written it."""
    _check_job_id(job_id)
    path = MEMOS / f"{job_id}.html"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"no memo for job {job_id} — POST first to generate",
        )
    return FileResponse(path, media_type="text/html")
