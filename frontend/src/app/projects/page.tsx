"use client";

import { PortfolioShell } from "@/components/portfolio/PortfolioShell";
import { PortfolioSummary } from "@/components/portfolio/PortfolioSummary";
import { ProjectList } from "@/components/portfolio/ProjectList";
import { PortfolioMap } from "@/components/portfolio/PortfolioMap";
import { Button } from "@/components/ui/Button";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { bandColorVar } from "@/lib/band";
import {
  summarizeProjects,
  useLiveProjects,
} from "@/lib/agent/useLiveProjects";
import {
  projects as mockProjects,
  riskFactorDefinitions,
} from "@/lib/mockData";

export default function ProjectsPage() {
  const live = useLiveProjects();

  // Neutral loading state — mock rows must never flash while the backend
  // answer is still in flight.
  if (live.status === "loading") {
    return (
      <PortfolioShell>
        <div className="mb-5">
          <div className="mb-1 text-2xl font-semibold text-ink">
            Current projects
          </div>
          <div className="text-[15px] text-muted">
            Checking the backend for live portfolio data…
          </div>
        </div>
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[92px] animate-pulse rounded-[5px] border border-hairline bg-surface-2"
            />
          ))}
        </div>
        <div className="flex flex-wrap items-start gap-3.5">
          <div className="h-[360px] flex-[1.3_1_420px] animate-pulse rounded-[11px] border border-hairline bg-surface-2" />
          <div className="h-[360px] flex-[1_1_300px] animate-pulse rounded-[11px] border border-hairline bg-surface-2" />
        </div>
      </PortfolioShell>
    );
  }

  const offline = live.status === "offline";
  // Live rows only when the backend answered; mock solely as the labelled
  // offline placeholder — the two are never merged.
  const projects = offline ? mockProjects : live.projects;
  const summary = summarizeProjects(projects);

  return (
    <PortfolioShell>
      {/* head-row */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-2.5">
        <div>
          <div className="mb-1 text-2xl font-semibold text-ink">
            Current projects
          </div>
          <div className="flex items-center gap-2 text-[15px] text-muted">
            <span className="relative flex h-[7px] w-[7px] flex-none">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                style={{ backgroundColor: bandColorVar[summary.avgBand] }}
              />
              <span
                className="relative inline-flex h-[7px] w-[7px] rounded-full"
                style={{ backgroundColor: bandColorVar[summary.avgBand] }}
              />
            </span>
            <span>
              <span className="font-semibold text-ink">{summary.count}</span>{" "}
              active projects · flagged before the 2030 ITC deadline
            </span>
          </div>
        </div>
        <Button variant="secondary" className="border border-hairline">
          Export report
        </Button>
      </div>

      {offline && <OfflineBanner />}

      {/* stat row */}
      <div className="mb-5">
        <PortfolioSummary summary={summary} projects={projects} />
      </div>

      {/* portfolio-layout */}
      <div className="flex flex-wrap items-start gap-3.5">
        <ProjectList projects={projects} />
        {/*
         * Live rows carry no coordinates, so when live the map draws NO
         * project pins — the real researched-parcel dots come from the
         * lib/agent/researched layer inside the map view. Mock pins render
         * only in the labelled offline fallback.
         */}
        <PortfolioMap
          projects={projects}
          mapProjects={offline ? projects : []}
          factors={riskFactorDefinitions}
        />
      </div>
    </PortfolioShell>
  );
}
