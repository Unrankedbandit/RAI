import { bandColorVar } from "@/lib/band";
import type { Project, RiskBand } from "@/lib/types";

type Summary = {
  count: number;
  avgScore: number;
  avgBand: RiskBand;
  onTrack: number;
  needsReview: number;
  atRisk: number;
};

/** Short display name, e.g. "Project Beta" → "Beta". */
function shortName(name: string): string {
  return name.replace(/^Project\s+/, "");
}

function namesFor(projects: Project[], status: Project["status"]): string {
  return projects
    .filter((p) => p.status === status)
    .map((p) => shortName(p.name))
    .join(", ");
}

/**
 * Portfolio stat row: a portfolio-activation ring card followed by three
 * count cards (on track / needs review / at risk). The ring arc and the count
 * values all resolve their colour through the band system.
 */
export function PortfolioSummary({
  summary,
  projects,
}: {
  summary: Summary;
  projects: Project[];
}) {
  return (
    <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr] gap-3">
      <RingCard
        score={summary.avgScore}
        band={summary.avgBand}
        count={summary.count}
      />
      <CountCard
        label="On track"
        value={summary.onTrack}
        valueClass="text-strong-ink"
        sub={namesFor(projects, "on-track")}
      />
      <CountCard
        label="Needs review"
        value={summary.needsReview}
        valueClass="text-watch-ink"
        sub={namesFor(projects, "needs-review")}
      />
      <CountCard
        label="At risk"
        value={summary.atRisk}
        valueClass="text-risk-ink"
        sub={namesFor(projects, "at-risk")}
      />
    </div>
  );
}

function RingCard({
  score,
  band,
  count,
}: {
  score: number;
  band: RiskBand;
  count: number;
}) {
  const r = 27;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);

  return (
    <div className="flex items-center gap-3.5 rounded-[5px] border border-hairline bg-white px-4 py-[14px] shadow-card">
      <svg width="58" height="58" viewBox="0 0 66 66" className="shrink-0">
        <circle
          cx="33"
          cy="33"
          r={r}
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth="7"
        />
        <circle
          cx="33"
          cy="33"
          r={r}
          fill="none"
          stroke={bandColorVar[band]}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 33 33)"
        />
        <text
          x="33"
          y="38"
          textAnchor="middle"
          fontSize="15"
          fontWeight="600"
          fill="var(--color-ink)"
        >
          {score}
        </text>
      </svg>
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-faint">
          Portfolio activation
        </div>
        <div className="text-[11px] text-muted">
          Average across {count} projects
        </div>
      </div>
    </div>
  );
}

function CountCard({
  label,
  value,
  valueClass,
  sub,
}: {
  label: string;
  value: number;
  valueClass: string;
  sub: string;
}) {
  return (
    <div className="rounded-[5px] border border-hairline bg-white px-4 py-[14px] shadow-card">
      <div className="mb-1.5 text-[11px] font-medium text-faint">{label}</div>
      <div className={`text-[22px] font-semibold leading-none ${valueClass}`}>
        {value}
      </div>
      <div className="mt-[3px] text-[11px] text-muted">{sub}</div>
    </div>
  );
}
