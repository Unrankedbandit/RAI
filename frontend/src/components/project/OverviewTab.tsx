"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useProject } from "./ProjectContext";
import { ScoreRing } from "./overview/ScoreRing";
import { FactorCard } from "./overview/FactorCard";
import { bandColorVar, bandFillClass } from "@/lib/band";
import { ITC_DEADLINE_LABEL } from "@/lib/mockData";

/**
 * Overview tab — faithful port of the reference `#page-overview`:
 * a score ring card, a five-column pillar grid, and a detail card that shows
 * the selected pillar's factors. Land (index 0) is selected by default.
 */
export function OverviewTab() {
  const { project, scoreBandLabel, scoreNote, acquiredData } = useProject();
  const [selected, setSelected] = useState(0);
  const pillar = project.pillars[selected];

  return (
    <div>
      {/* Ring card */}
      <div className="mb-[14px] flex items-center gap-[18px] rounded-[11px] border border-hairline bg-canvas p-[18px_20px] shadow-card">
        <ScoreRing score={project.activationScore} band={project.band} />
        <div>
          <div
            className="mb-[5px] text-sm font-semibold"
            style={{ color: bandColorVar[project.band] }}
          >
            {scoreBandLabel}
          </div>
          <div className="mb-2 text-[12.5px] leading-[1.5] text-muted">{scoreNote}</div>
          <span className="inline-block rounded-full bg-surface-2 px-2.5 py-1 text-[12.5px] text-faint">
            {ITC_DEADLINE_LABEL}
          </span>
        </div>
      </div>

      {/* Pillar grid */}
      <div className="mb-[14px] grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {project.pillars.map((p, i) => (
          <button
            key={p.name}
            type="button"
            onClick={() => setSelected(i)}
            className={`cursor-pointer rounded-[5px] border border-hairline p-[11px_12px] text-left shadow-card ${
              i === selected ? "bg-select" : "bg-canvas"
            }`}
          >
            <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
              <span className="font-semibold text-ink">{p.name}</span>
              <span style={{ color: bandColorVar[p.band] }}>{p.score}</span>
            </div>
            <div className="mb-[5px] h-[5px] overflow-hidden rounded-full bg-hairline">
              <motion.div
                className={`h-full rounded-full ${bandFillClass[p.band]}`}
                initial={{ width: 0 }}
                animate={{ width: `${p.score}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </div>
            <div className={`text-xs ${p.unlocked ? "text-strong" : "text-faint"}`}>
              {p.statusText}
            </div>
          </button>
        ))}
      </div>

      {/* Detail card */}
      <div className="rounded-[11px] border border-hairline bg-canvas p-[16px_18px] shadow-card">
        <AnimatePresence mode="wait">
          <motion.div
            key={pillar.name}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="space-y-2"
          >
            {pillar.factors.map((factor) => (
              <FactorCard key={factor.id} factor={factor} />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Acquired data — research packs the agent run scraped (absent for
          mocks and reports with none) */}
      {acquiredData && acquiredData.length > 0 && (
        <div className="mt-[14px] rounded-[11px] border border-hairline bg-canvas p-[16px_18px]">
          <div className="mb-3 text-sm font-semibold text-ink">Acquired data</div>
          {acquiredData.map((pack, i) => (
            <div
              key={`${pack.component}-${i}`}
              className="mt-3 border-t border-hairline pt-3 first:mt-0 first:border-t-0 first:pt-0"
            >
              <div className="text-[13px] font-semibold text-ink">
                {pack.component.replace(/_/g, " ")}
              </div>
              <ul className="list-disc pl-4">
                {pack.dataPoints.map((point, j) => (
                  <li key={j} className="text-[12.5px] leading-[1.5] text-muted">
                    {point}
                  </li>
                ))}
              </ul>
              {pack.sources.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {pack.sources.map((source, j) =>
                    /^https?:\/\//.test(source) ? (
                      <a
                        key={j}
                        href={source}
                        target="_blank"
                        rel="noreferrer"
                        title={source}
                        className="max-w-64 truncate rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-faint underline-offset-2 hover:text-ink hover:underline"
                      >
                        {source}
                      </a>
                    ) : (
                      <span
                        key={j}
                        title={source}
                        className="max-w-64 truncate rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-faint"
                      >
                        {source}
                      </span>
                    ),
                  )}
                </div>
              )}
              {pack.stillMissing.length > 0 && (
                <div className="mt-1.5 text-[12px] text-risk-ink">
                  Still missing: {pack.stillMissing.join("; ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
