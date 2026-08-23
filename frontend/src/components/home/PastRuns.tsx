"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listProjects, type PortfolioRow } from "@/lib/agent/client";
import { bandColorVar, bandPillClass } from "@/lib/band";
import { clsx } from "@/lib/clsx";
import type { RiskBand } from "@/lib/types";

/** Decision text → band, mirroring adapter.ts status(): anything that is not
 *  clearly Proceed/Investigate is treated as risk. */
function decisionBand(decision: string): RiskBand {
  const d = decision.toLowerCase();
  if (d.includes("proceed")) return "strong";
  if (d.includes("investigate")) return "watch";
  return "risk";
}

/**
 * Past runs from the agent backend (GET /api/projects), rendered worst-first —
 * the payload carries no dates, so the backend's order is kept as-is.
 *
 * The section renders nothing when the backend is down or has no runs: no
 * spinner, no error text, no layout shift — offline the Home page is exactly
 * as before. Each row links to /projects/<jobId>, which useProjectDetail's
 * share-link path resolves live from the backend, so reopening a run needs
 * nothing in sessionStorage.
 */
export function PastRuns() {
  const [rows, setRows] = useState<PortfolioRow[] | null>(null);

  useEffect(() => {
    listProjects()
      .then(setRows)
      .catch(() => setRows(null));
  }, []);

  if (rows === null || rows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-[11px] border border-hairline bg-canvas">
      <div className="flex items-baseline justify-between border-b border-hairline px-5 py-[14px]">
        <span className="text-sm font-semibold text-ink">Past runs</span>
        <span className="text-[12.5px] text-faint">
          {rows.length} {rows.length === 1 ? "run" : "runs"}
        </span>
      </div>
      {rows.map((row, i) => {
        const band = decisionBand(row.decision);
        return (
          <Link
            key={row.id}
            href={`/projects/${row.id}`}
            className={clsx(
              "flex items-center gap-[14px] px-5 py-[13px] transition-colors hover:bg-surface-2",
              i > 0 && "border-t border-hairline",
            )}
          >
            <div
              className="min-w-0 flex-1 truncate text-sm font-medium text-ink"
              title={row.project}
            >
              {row.project}
            </div>
            <div
              className="hidden w-40 shrink-0 truncate text-[12.5px] text-faint sm:block"
              title={row.location}
            >
              {row.location}
            </div>
            <span
              className={clsx(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium",
                bandPillClass[band],
              )}
            >
              {row.decision}
            </span>
            <div
              className="w-10 shrink-0 text-right text-[13.5px] font-semibold tabular-nums"
              style={{ color: bandColorVar[band] }}
            >
              {Math.round(row.readiness)}
            </div>
            <div className="hidden w-24 shrink-0 truncate text-right text-[12px] text-faint sm:block">
              {row.user ?? ""}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
