"use client";

import { motion } from "framer-motion";
import { bandColorVar, bandTextClass } from "@/lib/band";
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
 * Shared card chrome: hairline border that deepens on hover with a subtle
 * 1px lift. Motion (fade/slide-up) is layered on via framer-motion.
 */
const cardChrome =
  "rounded-[5px] border border-hairline bg-canvas px-4 py-[14px] shadow-card transition hover:-translate-y-px hover:border-hairline";

/**
 * Portfolio stat row: a portfolio-activation ring card followed by three
 * count cards (on track / needs review / at risk). The ring arc and the count
 * values all resolve their colour through the band system. Cards fade/slide
 * in on mount with a ~60ms stagger.
 */
export function PortfolioSummary({
  summary,
  projects,
}: {
  summary: Summary;
  projects: Project[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
      <RingCard
        score={summary.avgScore}
        band={summary.avgBand}
        count={summary.count}
      />
      <CountCard
        index={1}
        label="On track"
        value={summary.onTrack}
        band="strong"
        sub={namesFor(projects, "on-track")}
      />
      <CountCard
        index={2}
        label="Needs review"
        value={summary.needsReview}
        band="watch"
        sub={namesFor(projects, "needs-review")}
      />
      <CountCard
        index={3}
        label="At risk"
        value={summary.atRisk}
        band="risk"
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
  const size = 64;
  const stroke = 7;
  const center = size / 2;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`flex items-center gap-3.5 ${cardChrome}`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0"
      >
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={bandColorVar[band]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: "easeOut", delay: 0.15 }}
          transform={`rotate(-90 ${center} ${center})`}
        />
        <circle
          cx={center}
          cy={center}
          r={r - stroke / 2 - 2}
          fill="var(--color-surface-2)"
        />
        <text
          x={center}
          y={center + 5}
          textAnchor="middle"
          fontSize="15"
          fontWeight="600"
          fill="var(--color-ink)"
        >
          {score}
        </text>
      </svg>
      <div className="min-w-0">
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-faint">
          Portfolio activation
        </div>
        <div className="text-[12.5px] text-muted">
          Average across {count} projects
        </div>
      </div>
    </motion.div>
  );
}

function CountCard({
  index,
  label,
  value,
  band,
  sub,
}: {
  index: number;
  label: string;
  value: number;
  band: RiskBand;
  sub: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: index * 0.06 }}
      className={cardChrome}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
        <span
          className="inline-block h-[7px] w-[7px] flex-none rounded-full"
          style={{ backgroundColor: bandColorVar[band] }}
        />
        <span className="min-w-0 truncate" title={label}>
          {label}
        </span>
      </div>
      <div
        className={`text-2xl font-semibold leading-none ${bandTextClass[band]}`}
      >
        {value}
      </div>
      <div
        className="mt-[3px] truncate text-[12.5px] text-muted"
        title={sub || undefined}
      >
        {sub || "—"}
      </div>
    </motion.div>
  );
}
