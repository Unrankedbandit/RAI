#!/usr/bin/env python3
"""seed_benchmarks — populate the ground-truth benchmark store
(agent_backend/data/benchmarks.sqlite) from the repo's three curated sources:

  (a) the LIAISON role prompt's hardcoded benchmark block (roles.py) —
      each benchmark bullet, one record per source URL it cites;
  (b) research/*.md — markdown table rows / bolded metric lines carrying a
      number + unit + source. CONSERVATIVE: only lines with a real source
      URL (http(s):// or bare domain/path like flybvu.com/1099) are seeded;
      named-but-unlinked citations ("LBNL 2023") are skipped;
  (c) the ITC_GROUND_TRUTH / ITC_SOURCE_URL constants (sentinel_adapter.py).

All rows seeded verified_at=NULL / verified_by=NULL — a human review approval
(review.py) is what flips a row to verified. Idempotent: upsert by id, and
re-seeding never clears an existing verification.

Run from repo root: .venv/bin/python scripts/seed_benchmarks.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agent_backend import benchmarks  # noqa: E402
from agent_backend.agents.roles import LIAISON  # noqa: E402
from agent_backend.sentinel_adapter import ITC_GROUND_TRUTH, ITC_SOURCE_URL  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
RESEARCH_DIR = REPO_ROOT / "research"

URL_RE = re.compile(r"https?://[^\s)>;]+")
# Bare "domain.tld/path" citations (the research notes carry a few of these).
BARE_URL_RE = re.compile(r"\b(?:[a-z0-9-]+\.)+(?:com|gov|org|net|edu)/[^\s)>;]*")
NUM_RE = re.compile(r"\d")

_GEO_BY_LABEL = [
    ("caiso", "California (CAISO)"),
    ("ceqa", "California"),
    ("federal tax", "United States"),
]


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def _clean(text: str, limit: int = 240) -> str:
    text = URL_RE.sub("", text)
    text = BARE_URL_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip(" ;()")
    return text[:limit]


def from_liaison() -> list[dict]:
    """Parse the benchmark block of the LIAISON prompt string: one record per
    (benchmark bullet, source URL cited in that bullet)."""
    m = re.search(r"verified public benchmarks.*?\n(.*?)\n\s*For EVERY timeline entry",
                  LIAISON, re.S)
    if not m:
        return []
    block = m.group(1)
    records = []
    bullets = re.split(r"(?m)^(?=- )", block)
    for bullet in bullets:
        if not bullet.strip().startswith("- "):
            continue
        label = bullet.split(":", 1)[0].lstrip("- ").strip()
        urls = URL_RE.findall(bullet)
        geo = next((g for key, g in _GEO_BY_LABEL if key in label.lower()), "")
        value = _clean(bullet.split(":", 1)[1] if ":" in bullet else bullet)
        for i, url in enumerate(urls, 1):
            records.append({
                "id": f"{_slug(label)}-{i}",
                "name": label,
                "value": value,
                "unit": "",
                "geography": geo,
                "source_url": url,
            })
    return records


def from_research() -> list[dict]:
    """Parse research/*.md table rows and bolded metric lines — only those
    carrying a number and a REAL source URL are seeded."""
    records = []
    for md in sorted(RESEARCH_DIR.glob("*.md")):
        geo = "Nevada" if "nevada" in md.stem else "Solano County, CA"
        for line in md.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            is_table = stripped.startswith("|") and "---" not in stripped
            is_bold_metric = "**" in stripped and NUM_RE.search(stripped)
            if not (is_table or is_bold_metric):
                continue
            urls = URL_RE.findall(stripped)
            urls += [u for u in BARE_URL_RE.findall(stripped)
                     if not any(u in w for w in urls)]
            if not urls or not NUM_RE.search(stripped):
                continue  # conservative: no real source URL → no row
            if is_table:
                cells = [c.strip() for c in stripped.strip("|").split("|")]
                name = re.sub(r"\*\*", "", cells[0])
                body = " | ".join(cells[1:])
            else:
                bm = re.search(r"\*\*([^*]+)\*\*", stripped)
                name = bm.group(1) if bm else stripped[:60]
                body = stripped
            for i, url in enumerate(urls, 1):
                full_url = url if url.startswith("http") else f"https://{url}"
                records.append({
                    "id": f"{md.stem}-{_slug(name)[:40]}-{i}",
                    "name": f"{name} ({md.stem})",
                    "value": _clean(body),
                    "unit": "",
                    "geography": geo,
                    "source_url": full_url,
                })
    return records


def from_itc() -> list[dict]:
    return [{
        "id": "itc-45y-48e-obbba-deadline",
        "name": "Federal clean-energy tax credit (§45Y/§48E) post-OBBBA deadline",
        "value": ITC_GROUND_TRUTH,
        "unit": "",
        "geography": "United States",
        "source_url": ITC_SOURCE_URL,
    }]


def main() -> None:
    benchmarks.init_db()
    groups = {
        "roles.py LIAISON block": from_liaison(),
        "research/*.md": from_research(),
        "sentinel_adapter ITC constants": from_itc(),
    }
    total = 0
    for label, records in groups.items():
        for rec in records:
            benchmarks.upsert(rec)
        print(f"  {label}: {len(records)} record(s)")
        total += len(records)
    print(f"seeded {total} benchmark record(s) into {benchmarks.DB_PATH} "
          f"(verified_at=NULL — idempotent upsert)")


if __name__ == "__main__":
    main()
