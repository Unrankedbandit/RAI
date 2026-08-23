"use client";

import { PortfolioShell } from "@/components/portfolio/PortfolioShell";
import { PortfolioSummary } from "@/components/portfolio/PortfolioSummary";
import { ProjectList } from "@/components/portfolio/ProjectList";
import { PortfolioMap } from "@/components/portfolio/PortfolioMap";
import { Button } from "@/components/ui/Button";
import { bandColorVar } from "@/lib/band";
import { summarize, useLiveProjects } from "@/lib/agent/useLiveProjects";
import { riskFactorDefinitions } from "@/lib/mockData";

/**
 * The live portfolio. Data comes from the agent backend on every load
 * (useLiveProjects) — mock projects are never rendered here. The map pins
 * only projects with real coordinates.
 */
export default function ProjectsPage() {
  const { projects, loading, failed } = useLiveProjects();
  const summary = summarize(projects);
  const mappable = projects.filter((p) => p.latitude !== 0 || p.longitude !== 0);

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
              <span className="font-semibold text-ink">
                {loading ? "…" : summary.count}
              </span>{" "}
              active projects — flagged before the 2030 ITC deadline
            </span>
          </div>
        </div>
        <Button variant="secondary" className="border border-hairline">
          Export report
        </Button>
      </div>

      {/* stat row */}
      <div className="mb-5">
        <PortfolioSummary summary={summary} projects={projects} />
      </div>

      {/* portfolio-layout */}
      <div className="flex flex-wrap items-start gap-3.5">
        {loading ? (
          <div className="flex-[1.3_1_420px] rounded-[11px] border border-hairline bg-canvas px-[18px] py-8 text-center text-[12.5px] text-faint shadow-card">
            Loading live portfolio…
          </div>
        ) : failed ? (
          <div className="flex-[1.3_1_420px] rounded-[11px] border border-hairline bg-canvas px-[18px] py-8 text-center text-[12.5px] text-faint shadow-card">
            Portfolio backend unreachable — try again in a moment.
          </div>
        ) : (
          <ProjectList projects={projects} />
        )}
        <PortfolioMap projects={mappable} factors={riskFactorDefinitions} />
      </div>
    </PortfolioShell>
  );
}
