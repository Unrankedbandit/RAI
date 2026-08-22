"use client";

import type { Factor } from "@/lib/types";
import { bandPillClass, statusLabelToBand } from "@/lib/band";

/**
 * One .factor card: head (name + status pill) and evidence line. Watch/risk
 * factors carry an inline detail block (why this matters + recommended steps);
 * cleared factors show only head + evidence, matching the reference.
 */
export function FactorCard({ factor }: { factor: Factor }) {
  const hasDetail = Boolean(factor.whyItMatters || factor.recommendedSteps?.length);
  return (
    <div className="rounded-[1px] border border-hairline p-[12px_14px]">
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <span className="text-sm font-semibold text-ink">{factor.name}</span>
        <span
          className={`flex-none rounded-full px-[9px] py-[2px] text-xs font-medium ${
            bandPillClass[statusLabelToBand(factor.statusLabel)]
          }`}
        >
          {factor.statusLabel}
        </span>
      </div>
      <div className="text-[12.5px] leading-[1.5] text-muted">{factor.evidence}</div>

      {hasDetail && (
        <div className="mt-[10px] border-t border-hairline pt-[10px]">
          {factor.whyItMatters && (
            <>
              <div className="mb-[5px] text-xs font-semibold text-faint">
                Why this matters
              </div>
              <div className="mb-[9px] text-[12.5px] leading-[1.5] text-muted">
                {factor.whyItMatters}
              </div>
            </>
          )}
          {factor.recommendedSteps && factor.recommendedSteps.length > 0 && (
            <>
              <div className="mb-[5px] text-xs font-semibold text-faint">
                Recommended steps
              </div>
              <ol className="m-0 list-decimal pl-4 text-[12.5px] leading-[1.65] text-muted">
                {factor.recommendedSteps.map((step, i) => (
                  <li key={i} className="mb-0.5">
                    {step}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}
