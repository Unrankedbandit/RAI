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
  const { project, scoreBandLabel, scoreNote } = useProject();
  const [selected, setSelected] = useState(0);
  const pillar = project.pillars[selected];

  return (
    <div>
      {/* Ring card */}
      <div className="mb-[14px] flex items-center gap-[18px] rounded-[11px] border border-hairline bg-canvas p-[18px_20px] shadow-card">
        <ScoreRing score={project.activationScore} band={project.band} />
        <div>
          <div
            className="mb-[5px] text-[13px] font-semibold"
            style={{ color: bandColorVar[project.band] }}
          >
            {scoreBandLabel}
          </div>
          <div className="mb-2 text-[12px] leading-[1.5] text-muted">{scoreNote}</div>
          <span className="inline-block rounded-full bg-surface-2 px-2.5 py-1 text-[10.5px] text-faint">
            {ITC_DEADLINE_LABEL}
          </span>
        </div>
      </div>

      {/* Pillar grid */}
      <div className="mb-[14px] grid grid-cols-5 gap-2">
        {project.pillars.map((p, i) => (
          <button
            key={p.name}
            type="button"
            onClick={() => setSelected(i)}
            className={`cursor-pointer rounded-[5px] border border-hairline p-[11px_12px] text-left shadow-card ${
              i === selected ? "bg-select" : "bg-canvas"
            }`}
          >
            <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
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
            <div className={`text-[10px] ${p.unlocked ? "text-strong" : "text-faint"}`}>
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
    </div>
  );
}
