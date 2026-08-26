"""In-app human review of finished reports.

The human approves/rejects the FINAL report inside the RAI app — right where
the gaps are shown — and Port records the decision. The Report JSON is
parity-locked with the frontend adapter, so review state lives in a SIDECAR
subdirectory next to the reports: `reports/review/{jobId}.json`
(the subdirectory keeps it out of check-all's flat `reports/*.json`
Report-schema sweep — a sidecar is not a Report).

Port write-back is fire-and-forget via PortClient: Port down or unconfigured
never fails the review request.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from .obs import Trace
from .port_client import PortClient

# Status vocabulary shared with the factory_run blueprint enum. NOT_TRACKED is
# reserved for runs that predate review tracking; when a report exists and no
# sidecar does, the pipeline's terminal state since PR #4 is AWAITING_REVIEW,
# so that is the default (prefer it over NOT_TRACKED when unsure).
AWAITING = "AWAITING_REVIEW"
DECIDED = ("APPROVED", "REJECTED")
NOT_TRACKED = "NOT_TRACKED"

_RUN_BP = "factory_run"


def sidecar_path(store: Path, report_id: str) -> Path:
    sidecar_dir = store / "review"
    sidecar_dir.mkdir(exist_ok=True)
    return sidecar_dir / f"{report_id}.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load(store: Path, report_id: str) -> dict:
    """Current review state for a report that exists (caller checks that)."""
    path = sidecar_path(store, report_id)
    if not path.exists():
        return {"status": AWAITING, "reviewedBy": None,
                "reviewedAt": None, "rationale": None}
    rec = json.loads(path.read_text(encoding="utf-8"))
    rec.setdefault("rationale", None)
    return rec


def decide(store: Path, report_id: str, *, decision: str, reviewer: str,
           rationale: str | None, client: PortClient, trace: Trace) -> dict:
    """Persist a human decision to the sidecar, mirror it to Port, and trace
    it. Returns the stored record. Never raises on Port failure — the client
    is fire-and-forget and swallows its own errors."""
    record = {
        "status": decision,
        "reviewedBy": reviewer,
        "reviewedAt": _now_iso(),
        "rationale": rationale,
    }
    sidecar_path(store, report_id).write_text(
        json.dumps(record, indent=2), encoding="utf-8")
    # Port is the system of record for the decision: flip the run's status and
    # stamp who decided, when, and why.
    client.upsert_entity(
        _RUN_BP, report_id,
        properties={
            "status": decision,
            "reviewedBy": reviewer,
            "reviewedAt": record["reviewedAt"],
            "reviewRationale": rationale or "",
        },
    )
    trace.event("review.decided", f"{reviewer} {decision} report {report_id}",
                decision=decision, reviewer=reviewer, report_id=report_id)
    if decision == "APPROVED":
        # Benchmark verification write-back: an approval vouches for every
        # source the report cited, so flip those benchmark rows to verified.
        # NOTE (audit 2026-08-25): reports today carry ~no source_urls —
        # ground_truth was populated in 0 of 42 reports — so this usually
        # matches nothing yet; it lights up as the liaison starts citing.
        try:
            _verify_cited_sources(store, report_id, reviewer)
        except Exception:
            pass  # fire-and-forget, same discipline as the Port mirror
    return record


_URL_RE = re.compile(r"https?://[^\s)\]>\"',;]+")


def _verify_cited_sources(store: Path, report_id: str, reviewer: str) -> int:
    """Collect the report's cited source URLs and mark matching benchmark
    rows verified. Sources: every timeline entry's source_url, any URL inside
    its ground_truth note, and any URL in a red flag's or contradiction's
    sources list (the Report schema has no `findings` field — review
    2026-08-25)."""
    from . import benchmarks
    path = store / f"{report_id}.json"
    if not path.exists():
        return 0
    report = json.loads(path.read_text(encoding="utf-8"))
    urls: set[str] = set()
    for entry in (report.get("action_pack") or {}).get("timeline") or []:
        src = entry.get("source_url")
        if isinstance(src, str) and src.strip():
            urls.add(src.strip())
        gt = entry.get("ground_truth")
        if isinstance(gt, str):
            urls.update(_URL_RE.findall(gt))
    for key in ("red_flags", "contradictions"):
        for finding in report.get(key) or []:
            for s in finding.get("sources") or []:
                if isinstance(s, str):
                    urls.update(_URL_RE.findall(s))
    return benchmarks.mark_verified(reviewer=reviewer, source_urls=sorted(urls))
