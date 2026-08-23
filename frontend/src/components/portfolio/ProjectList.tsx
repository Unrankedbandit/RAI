"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ScoreBar } from "@/components/ui/ScoreBar";
import { StatusPill } from "@/components/ui/StatusPill";
import { statusLabelText } from "@/lib/band";
import type { Project } from "@/lib/types";

/**
 * Projects list card: a titled head row with a local search box, then one
 * fixed-column row per project. Column widths are pinned so every row aligns
 * across the score bar and status pill. The whole row links to the project.
 */
export function ProjectList({ projects }: { projects: Project[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: 0.24 }}
      className="flex-[1.3_1_420px] rounded-[11px] border border-hairline bg-canvas py-1 shadow-card"
    >
      <div className="flex items-center justify-between px-[18px] pb-2.5 pt-3.5">
        <span className="text-sm font-semibold text-ink">Projects</span>
        <div className="relative">
          <span className="pointer-events-none absolute left-[9px] top-1/2 -translate-y-1/2 text-faint">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.2-3.2" />
            </svg>
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="w-[160px] rounded-full bg-surface-2 py-[7px] pl-7 pr-[13px] text-[12.5px] text-muted placeholder:text-faint focus:outline-none"
          />
        </div>
      </div>

      {filtered.length > 0 ? (
        <div className="divide-y divide-hairline border-t border-hairline">
          {filtered.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
        </div>
      ) : (
        <div className="border-t border-hairline px-[18px] py-8 text-center text-[12.5px] text-faint">
          No projects match
        </div>
      )}
    </motion.div>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const { activationScore: score, band } = project;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex cursor-pointer items-center gap-3 px-[18px] py-[13px] transition-colors hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink" title={project.name}>
          {project.name}
        </div>
        <div
          className="mt-px truncate text-[12.5px] text-faint"
          title={`${project.tech ?? "Solar"} · ${project.capacityMW} MW · ${project.location}`}
        >
          {project.tech ?? "Solar"} · {project.capacityMW} MW · {project.location}
        </div>
      </div>

      {/* Score bar yields to the name on phones; the pill keeps the score
          readable via its band colour. */}
      <div className="hidden w-[110px] flex-none sm:block">
        <ScoreBar value={score} band={band} height={5} className="mb-[5px]" />
        <div className="flex justify-between text-xs text-faint">
          <span className="font-semibold text-ink">{score}</span>
          <span>/ 100</span>
        </div>
      </div>

      <StatusPill
        band={band}
        label={statusLabelText[project.status]}
        size="sm"
        className="flex-none justify-center sm:w-[112px]"
      />

      <span className="w-4 flex-none text-center text-[12.5px] text-faint transition-transform duration-200 group-hover:translate-x-0.5">
        →
      </span>
    </Link>
  );
}
