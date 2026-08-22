"use client";

import { useMemo, useState } from "react";
import { clsx } from "@/lib/clsx";
import { mockParcels } from "@/lib/discover/parcels";
import { RAMP_GRADIENT_CSS, NO_DATA_COLOR, scoreVerdict } from "@/lib/discover/scoreRamp";
import type { DiscoverLayerId } from "@/lib/discover/types";
import { DiscoverMap } from "@/components/discover/DiscoverMap";
import { ScoreSheet } from "@/components/discover/ScoreSheet";

/**
 * /discover — Parcel discovery map + score sheet (web).
 * Project-start surface: browse precomputed score tiles, tap a parcel for the
 * "why", end in the single seam CTA. Wide path is tiles/precomputed; the live
 * fetch (Data Scouts) only runs after the CTA creates the project.
 */

const LAYERS: { id: DiscoverLayerId; label: string; live: boolean }[] = [
  { id: "score", label: "Solar score", live: true },
  { id: "slope", label: "Slope", live: false },
  { id: "flood", label: "Flood", live: false },
  { id: "fire", label: "Fire", live: false },
];

export default function DiscoverPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<DiscoverLayerId>("score");
  const [search, setSearch] = useState("");

  const parcels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mockParcels;
    return mockParcels.filter((p) =>
      [p.apn, p.county, p.address, p.owner ?? "", p.zoning]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [search]);

  const selected = mockParcels.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col px-8 py-5">
      {/* header strip */}
      <div className="mb-4 flex flex-none flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[17px] font-semibold text-ink">Parcel discovery</h1>
          <p className="text-[12px] text-muted">
            California · 17 parcels scored (mock) · red = no-go, green = go
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {/* search */}
          <div className="flex w-72 items-center gap-2 rounded-full bg-white px-4 py-2 ring-1 ring-hairline transition-shadow focus-within:ring-2 focus-within:ring-vista">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" strokeLinecap="round" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Address, APN, or county…"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="text-faint hover:text-ink"
              >
                <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          {/* layer toggle */}
          <div className="flex items-center gap-1.5">
            {LAYERS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setActiveLayer(l.id)}
                className={clsx(
                  "rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors",
                  activeLayer === l.id
                    ? "bg-ink text-white"
                    : "bg-surface-2 text-muted hover:text-ink",
                )}
              >
                {l.label}
                {!l.live && activeLayer !== l.id && (
                  <span className="ml-1 text-faint">·</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* map + sheet */}
      <div className="flex min-h-0 flex-1 gap-4 pb-1">
        <div className="relative min-w-0 flex-1">
          <DiscoverMap
            parcels={parcels}
            activeLayer={activeLayer}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {/* legend — bottom-left overlay */}
          <div className="absolute bottom-3 left-3 rounded-[8px] border border-hairline bg-white/95 px-3 py-2.5 shadow-card backdrop-blur">
            <div className="flex items-center justify-between text-[10px] font-medium text-muted">
              <span>{scoreVerdict(0)}</span>
              <span className="text-faint">Solar score</span>
              <span>{scoreVerdict(100)}</span>
            </div>
            <div
              className="mt-1.5 h-2 w-44 rounded-full"
              style={{ background: RAMP_GRADIENT_CSS }}
            />
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-faint">
              <span
                className="inline-block size-2 rounded-[2px]"
                style={{ backgroundColor: NO_DATA_COLOR }}
              />
              No data
            </div>
          </div>
        </div>
        <ScoreSheet parcel={selected} />
      </div>
    </div>
  );
}
