"use client";

import { motion } from "framer-motion";
import { bandColorVar } from "@/lib/band";
import type { RiskBand } from "@/lib/types";

type DonutRingProps = {
  value: number; // 0–100
  band: RiskBand;
  size?: number;
  stroke?: number;
  /** Large number in the center; defaults to the value. */
  centerLabel?: string;
  /** Small caption under the number. */
  caption?: string;
};

/** Aggregate score ring. Track is faint; the arc is band-colored. */
export function DonutRing({
  value,
  band,
  size = 160,
  stroke = 14,
  centerLabel,
  caption,
}: DonutRingProps) {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-surface-2)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={bandColorVar[band]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold leading-none text-ink">
          {centerLabel ?? pct}
        </span>
        {caption && (
          <span className="mt-1 text-xs text-muted">{caption}</span>
        )}
      </div>
    </div>
  );
}
