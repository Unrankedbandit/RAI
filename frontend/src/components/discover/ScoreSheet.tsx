"use client";

import Link from "next/link";
import { clsx } from "@/lib/clsx";
import { scoreColor, scoreVerdict } from "@/lib/discover/scoreRamp";
import type { Parcel } from "@/lib/discover/types";

/**
 * Parcel score sheet (web): the "why this score" panel. Ends in a single CTA —
 * "Run full due diligence" creates the project and seeds the audit trail with
 * this parcel as Finding 0 (site-map principle 6). Same information architecture
 * as the mobile sheet; chrome re-expresses the ramp in brand language.
 */

const DRIVERS = [
  { key: "openSpace", label: "Open space" },
  { key: "buildingFreedom", label: "Building-free" },
  { key: "acreageFit", label: "Acreage fit" },
] as const;

function MetaRow({
  label,
  value,
  mono = false,
  faint = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  faint?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="shrink-0 text-[12.5px] text-muted">{label}</span>
      <span
        className={clsx(
          "min-w-0 text-right text-[12.5px]",
          mono && "font-jetbrains",
          faint ? "text-faint" : "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function ScoreSheet({ parcel }: { parcel: Parcel | null }) {
  return (
    <aside className="flex w-[380px] flex-none flex-col rounded-[11px] border border-hairline bg-canvas shadow-card">
      {!parcel ? (
        /* empty state */
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-faint">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3 6.5 10 3l7 3.5v7L10 17l-7-3.5z" strokeLinejoin="round" />
              <path d="M3 6.5 10 10l7-3.5M10 10v7" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-sm font-medium text-ink">Select a parcel</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            Every parcel is scored 0–100 for solar-development probability.
            Red is no-go, green is go — click any parcel for the breakdown.
          </p>
        </div>
      ) : (
        <>
          {/* score strip — the one data-viz accent on chrome */}
          <div
            className="h-[3px] rounded-t-[11px]"
            style={{ backgroundColor: scoreColor(parcel.score) }}
          />
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* header: brand pill + verdict + address */}
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-canvas px-3 py-1.5 ring-1 ring-hairline">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: scoreColor(parcel.score) }}
                />
                <span className="font-jetbrains text-sm font-semibold text-ink">
                  {parcel.score}
                </span>
              </span>
              <span className="text-[12.5px] font-medium uppercase tracking-wide text-muted">
                {scoreVerdict(parcel.score)}
              </span>
            </div>
            <h2 className="mt-3 text-[15px] font-semibold leading-snug text-ink">
              {parcel.address}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-muted">
              <span className="font-jetbrains">{parcel.acres}</span> ac ·{" "}
              {parcel.county} County
            </p>

            {/* why this score */}
            <div className="mt-5">
              <h3 className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">
                Why this score
              </h3>
              <div className="mt-2.5 space-y-2.5">
                {DRIVERS.map(({ key, label }) => {
                  const pct = Math.round(parcel.drivers[key] * 100);
                  return (
                    <div key={key} className="flex items-center gap-2.5">
                      <span className="w-28 flex-none text-[12.5px] text-muted">
                        {label}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-vista-soft">
                        <div
                          className="h-full rounded-full bg-vista"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-9 flex-none text-right font-jetbrains text-[12.5px] text-ink">
                        {pct}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* meta */}
            <div className="mt-5 divide-y divide-hairline border-y border-hairline">
              <MetaRow label="APN" value={parcel.apn} mono />
              <MetaRow label="Zoning" value={parcel.zoning} />
              <MetaRow
                label="Owner"
                value={parcel.owner ?? "On file — hidden"}
                faint={parcel.owner === undefined}
              />
            </div>

            {/* vintage + disclaimer */}
            <div className="mt-4">
              <div className="font-jetbrains text-[12.5px] text-faint">
                Score as of {parcel.scoredAt}
              </div>
              <p className="mt-0.5 text-[12.5px] text-faint">
                Probabilistic estimate — not an appraisal.
              </p>
            </div>
          </div>

          {/* the seam — single CTA */}
          <div className="flex-none border-t border-hairline p-4">
            <Link
              href={`/scanning?from=discover&apn=${encodeURIComponent(parcel.apn)}&score=${parcel.score}`}
              className="block w-full rounded-full bg-oxford py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Run full due diligence →
            </Link>
            <p className="mt-2 text-center text-[12.5px] text-faint">
              Creates the project with this parcel as its first evidence item.
            </p>
          </div>
        </>
      )}
    </aside>
  );
}
