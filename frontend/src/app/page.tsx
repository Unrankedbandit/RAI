"use client";

import { PortfolioShell } from "@/components/portfolio/PortfolioShell";
import { StatusDonut, type DonutSegment } from "@/components/home/StatusDonut";
import { ScoreBars, type ScoreBarRow } from "@/components/home/ScoreBars";
import { StatusPill } from "@/components/ui/StatusPill";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { clsx } from "@/lib/clsx";
import { statusLabelText, statusToBand } from "@/lib/band";
import {
  summarizeProjects,
  useLiveProjects,
} from "@/lib/agent/useLiveProjects";
import { projects as mockProjects, recentActivity } from "@/lib/mockData";
import type { RecentActivity } from "@/lib/types";

/** "Project Alpha" → "Alpha" for the compact chart / stat labels. */
function shortName(name: string): string {
  return name.replace(/^Project\s+/, "");
}

export default function HomePage() {
  const live = useLiveProjects();

  // Neutral loading state — mock data must never flash while the backend
  // answer is still in flight.
  if (live.status === "loading") {
    return (
      <PortfolioShell>
        <div className="text-2xl font-semibold text-ink">Home</div>
        <p className="mt-1 mb-[22px] text-[15px] text-muted">
          Checking the backend for live portfolio data…
        </p>
        <div className="mb-[18px] grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[86px] animate-pulse rounded-[5px] border border-hairline bg-surface-2"
            />
          ))}
        </div>
        <div className="mb-[22px] grid gap-3 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-[180px] animate-pulse rounded-[11px] border border-hairline bg-surface-2"
            />
          ))}
        </div>
        <div className="h-[240px] animate-pulse rounded-[11px] border border-hairline bg-surface-2" />
      </PortfolioShell>
    );
  }

  const offline = live.status === "offline";
  // Live rows only when the backend answered; mock solely as the labelled
  // offline placeholder — the two are never merged.
  const projects = offline ? mockProjects : live.projects;
  const summary = summarizeProjects(projects);

  const needsReviewNames = projects
    .filter((p) => p.status === "needs-review")
    .map((p) => shortName(p.name));

  const stats = [
    {
      label: "Active projects",
      value: summary.count,
      sub: "Across the current pipeline",
    },
    {
      label: "Portfolio activation",
      value: summary.avgScore,
      sub: "Average score out of 100",
    },
    {
      label: "Needs review",
      value: summary.needsReview,
      sub: needsReviewNames.join(", ") || "None",
    },
  ];

  const donutSegments: DonutSegment[] = [
    { label: "On track", value: summary.onTrack, band: "strong" },
    { label: "Needs review", value: summary.needsReview, band: "watch" },
    { label: "At risk", value: summary.atRisk, band: "risk" },
  ];

  const scoreRows: ScoreBarRow[] = projects.map((p) => ({
    id: p.id,
    name: shortName(p.name),
    score: p.activationScore,
    band: p.band,
  }));

  // When live, the feed lists the real pipeline rows (the backend exposes no
  // timestamps, so the time column shows "—"). Mock feed only when offline.
  const activity: RecentActivity[] = offline
    ? recentActivity
    : projects.map((p) => ({
        name: p.name,
        kind: "Project" as const,
        status: p.status,
        time: "—",
      }));

  return (
    <PortfolioShell>
      <div className="text-2xl font-semibold text-ink">Home</div>
      <p className="mt-1 mb-[22px] text-[15px] text-muted">
        Start a new project from the top bar, or check on recent activity across your pipeline.
      </p>

      {offline && <OfflineBanner />}

      {/* Stacks on phones (three ~90px cards would truncate to nothing);
          three-across from sm up, matching StatBoxes' existing idiom. */}
      <div className="mb-[18px] grid gap-3 sm:grid-cols-3">
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

      {/* Stacks on phones — the 110px donut svg + legend overflows a
          half-width card below md. */}
      <div className="mb-[22px] grid gap-3 md:grid-cols-2">
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
          <ScoreBars rows={scoreRows} />
        </div>
      </div>

      <div className="overflow-hidden rounded-[11px] border border-hairline bg-canvas shadow-card">
        <div className="border-b border-hairline px-5 py-[14px] text-sm font-semibold text-ink">
          {offline ? "Recent activity" : "Pipeline activity"}
        </div>
        {activity.map((a, i) => (
          <div
            key={`${a.name}-${a.time}-${i}`}
            className={clsx(
              "flex items-center gap-[14px] px-5 py-[13px]",
              i > 0 && "border-t border-hairline",
            )}
          >
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={a.name}>
              {a.name}
            </div>
            {/* kind column hidden on phones: with the 44px rail strip the row
                only has ~284px, and 80+110+110px of fixed columns clipped the
                time column off the card edge. */}
            <div className="hidden w-20 shrink-0 text-[12.5px] text-faint sm:block">{a.kind}</div>
            <div className="w-[110px] shrink-0">
              {a.kind === "Project" && a.status ? (
                <StatusPill
                  band={statusToBand(a.status)}
                  label={statusLabelText[a.status]}
                  size="sm"
                  dot={false}
                />
              ) : (
                <span
                  className="block truncate text-[12.5px] text-faint"
                  title={a.project}
                >
                  {a.project}
                </span>
              )}
            </div>
            <div className="w-auto shrink-0 text-right text-[12.5px] text-faint sm:w-[110px]">
              {a.time}
            </div>
          </div>
        ))}
      </div>
    </PortfolioShell>
  );
}
