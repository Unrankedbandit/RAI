"use client";

import Link from "next/link";
import { PortfolioShell } from "@/components/portfolio/PortfolioShell";
import { StatusDonut, type DonutSegment } from "@/components/home/StatusDonut";
import { ScoreBars, type ScoreBarRow } from "@/components/home/ScoreBars";
import { StatusPill } from "@/components/ui/StatusPill";
import { clsx } from "@/lib/clsx";
import { statusLabelText } from "@/lib/band";
import { summarize, useLiveProjects } from "@/lib/agent/useLiveProjects";

/** "Solar Alpha — 250 MW solar + storage" -> "Solar Alpha" for compact labels. */
function shortName(name: string): string {
  return name.replace(/^Project\s+/, "").split("—")[0].trim();
}

/**
 * Home dashboard — every number and row is the live portfolio from the agent
 * backend (useLiveProjects). No mock projects, no fabricated activity.
 */
export default function HomePage() {
  const { projects, loading, failed } = useLiveProjects();
  const summary = summarize(projects);

  const needsReviewNames = projects
    .filter((p) => p.status === "needs-review")
    .map((p) => shortName(p.name));

  const stats = [
    {
      label: "Active projects",
      value: loading ? "…" : summary.count,
      sub: "Across the current pipeline",
    },
    {
      label: "Portfolio activation",
      value: loading ? "…" : summary.avgScore,
      sub: "Average score out of 100",
    },
    {
      label: "Needs review",
      value: loading ? "…" : summary.needsReview,
      sub: needsReviewNames.join(", ") || "None",
    },
  ];

  const donutSegments: DonutSegment[] = [
    { label: "On track", value: summary.onTrack, band: "strong" },
    { label: "Needs review", value: summary.needsReview, band: "watch" },
    { label: "At risk", value: summary.atRisk, band: "risk" },
  ];

  const scoreRows: ScoreBarRow[] = projects.map((p) => ({
    name: shortName(p.name),
    score: p.activationScore,
    band: p.band,
  }));

  return (
    <PortfolioShell>
      <div className="text-2xl font-semibold text-ink">Home</div>
      <p className="mt-1 mb-[22px] text-[15px] text-muted">
        Start a new project from the top bar, or check on recent activity across your pipeline.
      </p>

      <div className="mb-[18px] grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-[5px] border border-hairline bg-canvas px-[18px] py-4 shadow-card"
          >
            <div className="mb-1.5 text-[12.5px] font-medium text-faint">
              {s.label}
            </div>
            <div className="text-[24px] font-semibold text-ink tabular-nums">
              {s.value}
            </div>
            <div className="mt-[3px] truncate text-[12.5px] text-muted" title={s.sub}>
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-[22px] grid grid-cols-2 gap-3">
        <div className="rounded-[11px] border border-hairline bg-canvas px-5 py-[18px] shadow-card">
          <div className="mb-[14px] text-sm font-semibold text-ink">
            Portfolio status
          </div>
          <StatusDonut segments={donutSegments} />
        </div>

        <div className="rounded-[11px] border border-hairline bg-canvas px-5 py-[18px] shadow-card">
          <div className="mb-[14px] text-sm font-semibold text-ink">
            Activation score by project
          </div>
          {scoreRows.length > 0 ? (
            <ScoreBars rows={scoreRows} />
          ) : (
            <div className="py-8 text-center text-[12.5px] text-faint">
              {loading ? "Loading…" : "No projects yet"}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-[11px] border border-hairline bg-canvas shadow-card">
        <div className="border-b border-hairline px-5 py-[14px] text-sm font-semibold text-ink">
          Current pipeline
        </div>
        {failed && (
          <div className="px-5 py-[13px] text-[12.5px] text-faint">
            Portfolio backend unreachable — try again in a moment.
          </div>
        )}
        {!failed && projects.length === 0 && (
          <div className="px-5 py-[13px] text-[12.5px] text-faint">
            {loading ? "Loading…" : "No projects yet — start one from the top bar."}
          </div>
        )}
        {projects.map((p, i) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className={clsx(
              "flex items-center gap-[14px] px-5 py-[13px] transition-colors hover:bg-surface-2",
              i > 0 && "border-t border-hairline",
            )}
          >
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={p.name}>
              {p.name}
            </div>
            <div className="w-20 shrink-0 text-[12.5px] text-faint">Project</div>
            <div className="w-[110px] shrink-0">
              <StatusPill
                band={p.band}
                label={statusLabelText[p.status]}
                size="sm"
                dot={false}
              />
            </div>
            <div className="w-[110px] shrink-0 truncate text-right text-[12.5px] text-faint" title={p.location}>
              {p.location}
            </div>
          </Link>
        ))}
      </div>
    </PortfolioShell>
  );
}
