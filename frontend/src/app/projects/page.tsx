import { PortfolioShell } from "@/components/portfolio/PortfolioShell";
import { PortfolioSummary } from "@/components/portfolio/PortfolioSummary";
import { NewProjectDropbox } from "@/components/portfolio/NewProjectDropbox";
import { ProjectList } from "@/components/portfolio/ProjectList";
import { PortfolioMap } from "@/components/portfolio/PortfolioMap";
import { projects, portfolioSummary, riskFactorDefinitions } from "@/lib/mockData";

export default function ProjectsPage() {
  const summary = portfolioSummary();

  return (
    <PortfolioShell maxWidth={1100} wideWidth={1500}>
      {/* head-row */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-2.5">
        <div>
          <div className="mb-1 text-[22px] font-semibold text-ink">
            Current projects
          </div>
          <div className="text-[13.5px] text-muted">
            {summary.count} active projects · flagged before the 2030 ITC deadline
          </div>
        </div>
        <button
          type="button"
          className="rounded-full border border-hairline bg-canvas px-4 py-2 text-[12.5px] font-medium text-muted hover:text-ink"
        >
          Export report
        </button>
      </div>

      {/* dropzone */}
      <div className="mb-5">
        <NewProjectDropbox />
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
