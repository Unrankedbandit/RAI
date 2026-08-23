"""Adapter: Red Flag agent Report -> Solar Sentinel frontend contract.

Emits a COMPLETE ProjectDetail (frontend/src/lib/types.ts) — project, pillars,
factors, evidence (incl. cross-document contradictions with comparison tables),
timeline, documents, priority actions, suggested questions and chat history —
so the frontend can swap mockData for live agent output without touching the UI.

Conventions matched to frontend/src/lib/mockData.ts:
- band: >=70 strong | 40-69 watch | <40 risk; statusLabel Cleared/Watch/Flagged
- severity critical|high -> risk/Flagged; medium|low -> watch/Watch
- timeline dates ISO; ITC deadline pinned to 2030-12-31 (frontend constant)
"""
from __future__ import annotations

import re

from .schemas import Report

ITC_DEADLINE = "2030-12-31"

COMPONENT_TO_PILLAR = {
    "land": "Land", "zoning": "Land", "permitting": "Land", "community": "Land",
    "land_use": "Land", "resource": "Land", "resource_supply_chain": "Land",
    "resite": "Land",
    "state_law": "Law", "federal_law": "Law", "law": "Law", "ecology_epa": "Law",
    "ecology": "Law", "epa": "Law",
    "financials": "Finance", "finance": "Finance",
    "materials": "Materials", "supply_chain": "Materials",
    "demand": "Demand", "buyers": "Demand", "grid_integration": "Demand",
    "grid": "Demand", "interconnection": "Demand",
}

PILLARS = ["Land", "Law", "Finance", "Materials", "Demand"]

PILLAR_AGENTS = {
    "Land": ["extractor:land-docs", "scout:zoning", "researcher:land_use"],
    "Law": ["researcher:state_law", "researcher:federal_law", "researcher:ecology_epa"],
    "Finance": ["researcher:financials", "cross-examiner"],
    "Materials": ["researcher:supply_chain"],
    "Demand": ["researcher:demand", "researcher:interconnection"],
}

DOC_KIND = {
    "land": ("Land report", ["Land"]),
    "environmental": ("Environmental assessment", ["Land", "Law"]),
    "legal": ("Legal memo", ["Law"]),
    "community": ("Stakeholder report", ["Law", "Demand"]),
    "materials": ("Materials & price index", ["Materials", "Demand"]),
    "financial": ("Financial memo", ["Finance"]),
    "sensitivity": ("Financial model", ["Finance", "Demand"]),
    "tracker": ("Materials & demand tracker", ["Materials", "Demand"]),
    "register": ("Risk register", PILLARS),
    "site_comparison": ("Screening memorandum", PILLARS),
}

STOPWORDS = {"the", "and", "for", "with", "that", "this", "from", "into", "are",
             "not", "has", "have", "will", "our", "their", "its", "per", "via"}


def band(score: float) -> str:
    return "strong" if score >= 70 else "watch" if score >= 40 else "risk"


def status(decision: str) -> str:
    d = decision.lower()
    if "proceed" in d:
        return "on-track"
    if "investigate" in d:
        return "needs-review"
    return "at-risk"


def _sev_band(severity: str) -> tuple[str, str]:
    return ("risk", "Flagged") if severity in ("critical", "high") else ("watch", "Watch")


def _status_text(score: float, factors: list[dict]) -> str:
    """Pillar status line under the bar (matches frontend reference copy)."""
    if score >= 70:
        return "Unlocked"
    n_risk = sum(1 for f in factors if f["band"] == "risk")
    if n_risk:
        return f"{n_risk} flag{'s' if n_risk > 1 else ''} open"
    n_watch = sum(1 for f in factors if f["band"] == "watch")
    return f"{n_watch} in watch"


def _pillar_for(component: str) -> str:
    key = component.lower().replace(" ", "_").replace("/", "_").replace("&", "").strip("_")
    return COMPONENT_TO_PILLAR.get(key, "Land")


def _doc_entry(doc_id: str, title: str, uploaded: str) -> dict:
    low = title.lower()
    kind, pillars = next((v for k, v in DOC_KIND.items() if k in low), ("Diligence document", PILLARS))
    return {"id": doc_id, "title": title, "kind": kind, "pages": 0,
            "uploadedAt": uploaded, "pillars": pillars}


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]{4,}", text.lower())} - STOPWORDS


def _link_evidence(text: str, evidence: dict[str, dict]) -> str | None:
    tw = _words(text)
    best, best_score = None, 0
    for ev_id, ev in evidence.items():
        score = len(tw & _words(ev["summary"]))
        if score > best_score:
            best, best_score = ev_id, score
    return best if best_score >= 2 else None


def _iso_from(text: str | None) -> str | None:
    if not text:
        return None
    m = re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})", text)
    if m:
        month = ["jan", "feb", "mar", "apr", "may", "jun",
                 "jul", "aug", "sep", "oct", "nov", "dec"].index(m.group(1).lower()[:3]) + 1
        return f"{m.group(2)}-{month:02d}-01"
    m = re.search(r"Q([1-4])\s*(\d{4})", text)
    if m:
        return f"{m.group(2)}-{int(m.group(1)) * 3 - 2:02d}-01"
    return None


# Timeline-entry severity -> marker band: dated deal-killers read red, secured
# items read green. Keep in lockstep with frontend/src/lib/agent/adapter.ts.
_SEV_TO_BAND = {"critical": "risk", "high": "risk", "medium": "watch", "low": "strong"}


def _date_display(iso: str) -> str:
    """"2026-08-03" -> "Aug 3, 2026" (mockData's tooltip date format)."""
    y, m, d = iso.split("-")
    mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][int(m) - 1]
    return f"{mon} {int(d)}, {y}"


def to_sentinel(report: Report, project_id: str, lat: float = 0, lon: float = 0,
                capacity_mw: float = 0, uploaded: str = "2026-08-14") -> dict:
    """Convert a Red Flag Report into a complete Solar Sentinel ProjectDetail."""
    # Dimension names arrive in whatever case the model felt like ("land" vs
    # "Land") — normalize for lookup or pillars silently zero out.
    dims = {d.name.strip().lower(): d for d in report.dimensions}
    evidence: dict[str, dict] = {}
    pillars = []

    for name in PILLARS:
        dim = dims.get(name.lower())
        score = dim.score if dim else 0.0
        factors = []

        for i, text in enumerate(dim.flags if dim else []):
            b = band(score)
            factors.append({
                "id": f"{name.lower()}-flag-{i}", "name": text[:90], "band": b,
                "statusLabel": "Cleared" if b == "strong" else "Watch" if b == "watch" else "Flagged",
                "evidence": text, "sources": [],
            })

        for rf in report.red_flags:
            if _pillar_for(rf.component) != name:
                continue
            b, label = _sev_band(rf.severity)
            ev_id = f"ev-{name.lower()}-{len(evidence)}"
            factors.append({
                "id": ev_id, "name": rf.title[:90], "band": b, "statusLabel": label,
                "evidence": rf.evidence, "sources": rf.sources, "evidenceId": ev_id,
            })
            evidence[ev_id] = {
                "id": ev_id, "factorName": rf.title[:90], "kind": "single",
                "summary": rf.evidence,
                "confidence": "High confidence" if rf.benchmark else "Medium confidence",
                "sources": [{
                    "title": s or rf.component, "location": rf.component,
                    "highlight": rf.evidence, "extractedLabel": rf.component,
                    "extractedValue": rf.benchmark or "",
                } for s in (rf.sources or [rf.component])],
            }

        pillars.append({
            "name": name, "score": score, "band": band(score),
            "unlocked": score >= 70, "statusText": _status_text(score, factors),
            "subAgents": PILLAR_AGENTS[name], "factors": factors,
        })

    for i, c in enumerate(report.contradictions):
        ev_id = f"ev-contradiction-{i}"
        sources = [
            {"title": s, "location": "cross-document check", "highlight": claim,
             "extractedLabel": "claim", "extractedValue": claim}
            for s, claim in zip(c.sources, c.claims)
        ] or [{"title": "agent cross-examination", "location": "", "highlight": c.explanation,
               "extractedLabel": "", "extractedValue": ""}]
        rows = [{"label": src, "a": claim, "b": ""} for src, claim in zip(c.sources, c.claims)]
        if len(rows) >= 2:
            rows.append({"label": "Conflict", "a": "", "b": "contradictory"})
        evidence[ev_id] = {
            "id": ev_id, "factorName": f"Contradiction: {c.explanation[:60]}",
            "kind": "contradiction", "summary": c.explanation,
            "confidence": "High confidence" if c.severity in ("critical", "high") else "Needs review",
            "sources": sources,
            "comparison": {"dimension": c.explanation[:60], "rows": rows},
        }

    # timeline: the agent-emitted critical path wins when present (full strip
    # elements: shortLabel, dateDisplay, description, per-event band); the
    # agency-action deadline parse is the fallback for pre-contract reports.
    raw_timeline = []
    for t in report.action_pack.timeline:
        iso = t.date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", t.date or "") else _iso_from(t.date)
        if iso:
            entry = {
                "label": t.label[:80], "date": iso, "kind": t.kind,
                "shortLabel": t.label[:26], "dateDisplay": _date_display(iso),
                "band": _SEV_TO_BAND.get(t.severity, "watch"),
            }
            if t.detail:
                entry["description"] = t.detail
            raw_timeline.append(entry)
    if not raw_timeline:
        for a in report.action_pack.agency_actions:
            iso = _iso_from(a.deadline)
            if iso:
                raw_timeline.append({"label": f"{a.agency} — {a.action}"[:80], "date": iso, "kind": "milestone"})
    raw_timeline.append({"label": "ITC deadline", "date": ITC_DEADLINE, "kind": "deadline"})
    raw_timeline.sort(key=lambda e: e["date"])

    from datetime import date as _date
    b = band(report.readiness)
    ords = [_date.fromisoformat(e["date"]).toordinal() for e in raw_timeline]
    mn, mx = min(ords), max(ords)
    timeline = []
    for i, e in enumerate(raw_timeline):
        ev = {
            "id": f"tl-{i}", "label": e["label"], "date": e["date"], "kind": e["kind"],
            "band": e.get("band", b),
            "position": 50 if mx == mn else int(((ords[i] - mn) / (mx - mn)) * 1000 + 0.5) / 10,
        }
        for opt in ("shortLabel", "dateDisplay", "description"):
            if opt in e:
                ev[opt] = e[opt]
        timeline.append(ev)

    # documents from all cited sources
    seen: dict[str, dict] = {}
    all_sources = [s for rf in report.red_flags for s in rf.sources] + \
                  [s for c in report.contradictions for s in c.sources]
    for s in all_sources:
        if re.search(r"\.(pdf|xlsx)$", s, re.I) and s not in seen:
            seen[s] = _doc_entry(f"doc-{len(seen) + 1:02d}", s, uploaded)
    documents = list(seen.values())

    priority_actions = []
    cps = report.action_pack.conditions_precedent
    for i, cp in enumerate(cps):
        action = {
            "id": f"pa-{i + 1}", "rank": i + 1, "title": cp[:90], "detail": cp,
            "impact": "high", "scoreDelta": 6,
        }
        if link := _link_evidence(cp, evidence):
            action["evidenceLink"] = link
        priority_actions.append(action)
    for i, rfi in enumerate(report.action_pack.rfis[:3]):
        action = {
            "id": f"pa-{len(cps) + i + 1}", "rank": len(cps) + i + 1,
            "title": rfi[:90], "detail": rfi, "impact": "medium", "scoreDelta": 3,
        }
        if link := _link_evidence(rfi, evidence):
            action["evidenceLink"] = link
        priority_actions.append(action)

    b = band(report.readiness)
    projected = min(100, report.readiness + (6 if b == "strong" else 18 if b == "watch" else 28))
    crit = sum(1 for f in report.red_flags if f.severity == "critical")

    suggested = [
        {"question": "What's the top item to clear next?",
         "answer": {"role": "assistant",
                    "text": report.recommended_next_action
                            or f"Clear the {crit} critical red flags, starting with the lowest-scoring pillar."}},
        {"question": f"Why is the activation score {report.readiness:.0f}?",
         "answer": {"role": "assistant",
                    "text": (f"{crit} critical red flags and {len(report.contradictions)} cross-document "
                             f"contradictions. Weakest pillars: "
                             + ", ".join(f"{d.name} {d.score:.0f}" for d in
                                         sorted(report.dimensions, key=lambda x: x.score)[:2]) + ".")}},
    ]

    return {
        "project": {
            "id": project_id, "name": report.project, "location": report.location,
            "capacityMW": capacity_mw, "latitude": lat, "longitude": lon,
            "activationScore": report.readiness, "band": b,
            "scoreReason": report.recommended_next_action or "",
            "status": status(report.decision), "pillars": pillars,
        },
        "eyebrow": f"Solar · {capacity_mw} MW · {report.location}",
        "runSummary": f"{len(documents)} documents analyzed · {len(report.missing_info)} open items",
        "scoreBandLabel": f"{b.capitalize()} · {report.readiness:.0f}/100",
        "scoreNote": report.recommended_next_action or "",
        "evidence": evidence,
        "timeline": timeline,
        "documents": documents,
        "priorityActions": priority_actions,
        "projectedScoreAfterMitigation": projected,
        "suggestedQuestions": suggested,
        "chatHistory": [{
            "role": "assistant",
            "text": (f"I've completed diligence on {report.project}. Activation score "
                     f"{report.readiness:.0f}/100 — decision: {report.decision}. "
                     f"{crit} critical flags, {len(report.contradictions)} cross-document "
                     f"contradictions, {len(report.missing_info)} open information requests. "
                     f"Ask me what to prioritize."),
        }],
        "report": {
            "badge": "RED FLAG REPORT",
            "title": f"{report.project} — due-diligence report",
            "preparedBy": "Red Flag agent framework",
            "summary": report.recommended_next_action or "",
            "findings": [{"title": rf.title[:90], "text": rf.evidence}
                         for rf in report.red_flags[:5]],
            "recommendedActions": report.action_pack.conditions_precedent[:5],
            "sourceBasis": (f"{len(documents)} source documents + "
                            f"{len(report.acquired_data)} acquired research packs"),
        },
        # Conditional key: the parity harness uses strict deepEqual against the
        # TS adapter — emit acquiredData only when non-empty, in lockstep.
        **({"acquiredData": [{"component": a.component, "dataPoints": a.data_points,
                              "sources": a.sources, "stillMissing": a.still_missing}
                             for a in report.acquired_data]} if report.acquired_data else {}),
        "map": {
            "parcelSize": "—",
            "toggles": [
                {"id": "zoning", "label": "Zoning", "on": True},
                {"id": "protected-land", "label": "Protected land", "on": True},
                {"id": "transmission", "label": "Transmission", "on": False},
            ],
            "distances": [],
            "zones": [],
            "pin": {"left": 50, "top": 50, "label": report.location},
        },
        "teamMembers": [],
    }


if __name__ == "__main__":
    """Regenerate Sentinel-shaped JSON from every stored agent report."""
    import json
    from pathlib import Path
    from .schemas import Report as _Report

    here = Path(__file__).resolve().parent
    out_dir = here / "sentinel-samples"
    out_dir.mkdir(exist_ok=True)
    meta = {  # filename -> (id, lat, lon, capacity_mw)
        "solar-alpha.json": ("solar-alpha", 38.31, -121.94, 250),
        "parcel-a-boulder-city.json": ("parcel-a", 35.9056, -114.9345, 180),
        "parcel-b-sloan-canyon.json": ("parcel-b", 35.9167, -115.1260, 180),
    }
    for f in sorted((here / "reports").glob("*.json")):
        pid, lat, lon, mw = meta.get(f.name, (f.stem, 0, 0, 0))
        sentinel = to_sentinel(_Report.model_validate_json(f.read_text(encoding="utf-8")),
                               pid, lat, lon, mw)
        out = out_dir / f.name.replace(".json", ".sentinel.json")
        out.write_text(json.dumps(sentinel, indent=2), encoding="utf-8")
        p = sentinel["project"]
        print(f"{out.name}: {p['name'][:40]} | score {p['activationScore']} {p['band']} | "
              f"{sum(len(pl['factors']) for pl in p['pillars'])} factors | "
              f"{len(sentinel['evidence'])} evidence | {len(sentinel['priorityActions'])} actions")
