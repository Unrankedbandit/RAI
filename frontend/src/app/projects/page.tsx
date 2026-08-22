import { PortfolioShell } from "@/components/portfolio/PortfolioShell";
import { PortfolioSummary } from "@/components/portfolio/PortfolioSummary";
import { ProjectList } from "@/components/portfolio/ProjectList";
import { PortfolioMap } from "@/components/portfolio/PortfolioMap";
import { Button } from "@/components/ui/Button";
import { bandColorVar } from "@/lib/band";
import { projects, portfolioSummary, riskFactorDefinitions } from "@/lib/mockData";

export default function ProjectsPage() {
  const summary = portfolioSummary();

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

      {/* stat row */}
      <div className="mb-5">
        <PortfolioSummary summary={summary} projects={projects} />
      </div>

      {/* portfolio-layout */}
      <div className="flex flex-wrap items-start gap-3.5">
        <ProjectList projects={projects} />
        <PortfolioMap projects={projects} factors={riskFactorDefinitions} />
      </div>
    </PortfolioShell>
  );
}
