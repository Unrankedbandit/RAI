"use client";

import { motion } from "framer-motion";
import { clsx } from "@/lib/clsx";
import { bandColorVar } from "@/lib/band";
import type { RiskBand } from "@/lib/types";

type ScoreBarProps = {
  value: number; // 0–100
  band: RiskBand;
  /** Thin rounded track height. */
  height?: number;
  className?: string;
  animate?: boolean;
};

/** Thin, fully-rounded progress bar for sub-scores. Colored by band only. */
export function ScoreBar({
  value,
  band,
  height = 8,
  className,
  animate = true,
}: ScoreBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={clsx("w-full overflow-hidden rounded-full bg-surface-2", className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: bandColorVar[band] }}
        initial={animate ? { width: 0 } : false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
    </div>
  );
}
