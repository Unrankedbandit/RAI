"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { bandColorVar, bandPillClass, statusLabelText } from "@/lib/band";
import { clsx } from "@/lib/clsx";
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
    <div className="flex-[1.3_1_420px] rounded-[11px] border border-hairline bg-white py-1 shadow-card">
      <div className="flex items-center justify-between px-[18px] pb-2.5 pt-3.5">
        <span className="text-[13px] font-semibold text-ink">Projects</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search..."
          className="w-[150px] rounded-full bg-surface-2 px-[13px] py-[7px] text-[11.5px] text-muted placeholder:text-faint focus:outline-none"
        />
      </div>

      {filtered.map((p) => (
        <ProjectRow key={p.id} project={p} />
      ))}
    </div>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const { activationScore: score, band } = project;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="flex cursor-pointer items-center gap-3 border-t border-hairline px-[18px] py-[13px] transition-colors hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-ink">{project.name}</div>
        <div className="mt-px truncate text-[11px] text-faint">
          {project.tech ?? "Solar"} · {project.capacityMW} MW · {project.location}
        </div>
      </div>

      <div className="w-[110px] flex-none">
        <div className="mb-[5px] h-[5px] overflow-hidden rounded-full bg-hairline">
          <div
            className="h-full rounded-full"
            style={{ width: `${score}%`, backgroundColor: bandColorVar[band] }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-faint">
          <span className="font-semibold text-ink">{score}</span>
          <span>/ 100</span>
        </div>
      </div>

      <span
        className={clsx(
          "w-[112px] flex-none rounded-full px-2.5 py-[3px] text-center text-[10.5px] font-medium",
          bandPillClass[band],
        )}
      >
        {statusLabelText[project.status]}
      </span>

      <span className="w-4 flex-none text-center text-[11px] text-faint">→</span>
    </Link>
  );
}
