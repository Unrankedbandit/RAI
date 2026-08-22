"use client";

import { motion } from "framer-motion";
import { bandColorVar } from "@/lib/band";
import type { RiskBand } from "@/lib/types";

export type ScoreBarRow = {
  /** Short project name shown under the bar, e.g. "Alpha". */
  name: string;
  score: number;
  band: RiskBand;
};

/**
 * Vertical bar chart of each project's activation score, colored by risk band.
 * Built from plain divs + framer height — no chart library, no icons. Matches
 * the reference `.bar-chart` (120px tall, bars capped at 34px wide).
 */
export function ScoreBars({ rows }: { rows: ScoreBarRow[] }) {
  return (
    <div className="flex h-[120px] items-end gap-[14px] pt-[10px]">
      {rows.map((row) => {
        const pct = Math.max(0, Math.min(100, row.score));
        return (
          <div
            key={row.name}
            className="flex h-full flex-1 flex-col items-center justify-end gap-2"
          >
            <div className="text-[12.5px] font-medium text-muted tabular-nums">
              {row.score}
            </div>
            <motion.div
              className="w-full max-w-[34px] rounded-t-[4px]"
              style={{ backgroundColor: bandColorVar[row.band] }}
              initial={{ height: 0 }}
              animate={{ height: `${pct}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
            <div className="text-[12.5px] text-faint">{row.name}</div>
          </div>
        );
      })}
    </div>
  );
}
