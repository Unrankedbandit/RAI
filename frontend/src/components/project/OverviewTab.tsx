"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useProject } from "./ProjectContext";
import { useAgentReport } from "@/lib/agent/useAgentReport";
import { ScoreRing } from "./overview/ScoreRing";
import { FactorCard } from "./overview/FactorCard";
import { PropertyInfoCard } from "./overview/PropertyInfoCard";
import { CountyCodesPanel } from "./overview/CountyCodesPanel";
import { ActionChecklist } from "./overview/ActionChecklist";
import { bandColorVar, bandFillClass } from "@/lib/band";
import { ITC_DEADLINE_LABEL } from "@/lib/mockData";

/**
 * Overview tab — faithful port of the reference `#page-overview`:
 * a score ring card, a five-column pillar grid, and a detail card that shows
 * the selected pillar's factors. Land (index 0) is selected by default.
 *
 * Two columns at lg — score + pillars + factors + property/county on the left,
 * the action checklist on the right — but only when the checklist has content.
 * ActionChecklist renders null on mock data and on an empty action_pack, so
 * splitting unconditionally would leave the right column blank; the same
 * emptiness test keeps the page single-column in that case.
 */
export function OverviewTab() {
  const { project, scoreBandLabel, scoreNote } = useProject();
  const { report } = useAgentReport(project.id);
  const [selected, setSelected] = useState(0);
  const pillar = project.pillars[selected];

  const pack = report?.action_pack;
  const twoColumn = Boolean(
    pack &&
      (pack.rfis?.length ?? 0) +
        (pack.agency_actions?.length ?? 0) +
        (pack.verification_requests?.length ?? 0) +
        (pack.conditions_precedent?.length ?? 0) >
        0,
  );

  return (
    <div className={twoColumn ? "grid gap-[14px] lg:grid-cols-5" : undefined}>
      <div className={twoColumn ? "min-w-0 lg:col-span-3" : undefined}>
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

        {/* Pillar grid — collapses on phones, where five ~50px columns
            overflowed their card borders; five-across returns at lg. */}
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
        <div className="mb-[14px] rounded-[11px] border border-hairline bg-canvas p-[16px_18px] shadow-card">
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

        {/* Property info + county code links, from the raw agent report. */}
        <div className="grid gap-[14px] lg:grid-cols-2">
          <PropertyInfoCard />
          <CountyCodesPanel />
        </div>
      </div>

      {/* Report action_pack as a persistent checklist; null on mock data. */}
      <div className={twoColumn ? "min-w-0 lg:col-span-2" : undefined}>
        <ActionChecklist />
      </div>
    </div>
  );
}
