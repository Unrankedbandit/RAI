"use client";

import { useProject } from "./ProjectContext";
import { StatusPill } from "@/components/ui/StatusPill";
import type { Factor, PillarScore } from "@/lib/types";

/**
 * Findings tab — every finding the run produced for THIS project: pillar
 * factors first (grouped by pillar), then cross-document contradictions.
 * This is where findings live now; there is no global findings queue in the
 * nav anymore.
 */
export function FindingsTab() {
  const { project, evidence } = useProject();
  const pillars = project.pillars;

  const totalFactors = pillars.reduce((n, p) => n + p.factors.length, 0);
  const contradictions = Object.values(evidence).filter(
    (e) => e.kind === "contradiction",
  );

  if (totalFactors === 0 && contradictions.length === 0) {
    return (
      <div className="rounded-[11px] border border-hairline bg-canvas px-5 py-10 text-center text-[12.5px] text-faint shadow-card">
        No findings recorded for this project.
      </div>
    );
  }

  return (
    <div className="max-w-[860px] space-y-4">
      {pillars
        .filter((p) => p.factors.length > 0)
        .map((p) => (
          <PillarFindings key={p.name} pillar={p} />
        ))}

      {contradictions.length > 0 && (
        <div className="rounded-[11px] border border-hairline bg-canvas shadow-card">
          <div className="border-b border-hairline px-5 py-[14px] text-sm font-semibold text-ink">
            Cross-document contradictions ({contradictions.length})
          </div>
          {contradictions.map((e, i) => (
            <div
              key={e.id}
              className={i > 0 ? "border-t border-hairline px-5 py-[13px]" : "px-5 py-[13px]"}
            >
              <div className="mb-1 text-sm font-medium text-ink">
                {e.factorName}
              </div>
              <p className="text-[12.5px] leading-[1.6] text-muted">{e.summary}</p>
              {e.comparison && e.comparison.rows.length > 0 && (
                <div className="mt-2 overflow-hidden rounded-[5px] border border-hairline">
                  {e.comparison.rows.map((r, j) => (
                    <div
                      key={j}
                      className="grid grid-cols-[140px_1fr] gap-2 border-b border-hairline px-3 py-2 text-[12px] last:border-b-0"
                    >
                      <span className="font-medium text-faint">{r.label}</span>
                      <span className="text-muted">{r.a || r.b}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-1.5 text-[11px] text-faint">{e.confidence}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PillarFindings({ pillar }: { pillar: PillarScore }) {
  return (
    <div className="rounded-[11px] border border-hairline bg-canvas shadow-card">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-[14px]">
        <span className="text-sm font-semibold text-ink">{pillar.name}</span>
        <span className="text-[12.5px] text-faint">
          {pillar.factors.length} finding{pillar.factors.length > 1 ? "s" : ""}
        </span>
      </div>
      {pillar.factors.map((f, i) => (
        <FactorRow key={f.id} factor={f} divider={i > 0} />
      ))}
    </div>
  );
}

function FactorRow({ factor, divider }: { factor: Factor; divider: boolean }) {
  return (
    <div className={divider ? "border-t border-hairline px-5 py-[13px]" : "px-5 py-[13px]"}>
      <div className="flex items-start gap-3">
        <StatusPill
          band={factor.band}
          label={factor.statusLabel}
          size="sm"
          dot={false}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink">{factor.name}</div>
          <p className="mt-0.5 text-[12.5px] leading-[1.6] text-muted">
            {factor.evidence}
          </p>
          {factor.sources.length > 0 && (
            <div className="mt-1 text-[11px] text-faint">
              Source: {factor.sources.join(" · ")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
