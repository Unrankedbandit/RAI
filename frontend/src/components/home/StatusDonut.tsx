"use client";

import { motion } from "framer-motion";
import { bandColorVar } from "@/lib/band";
import type { RiskBand } from "@/lib/types";

export type DonutSegment = {
  label: string;
  value: number;
  band: RiskBand;
};

type StatusDonutProps = {
  segments: DonutSegment[];
  size?: number;
  stroke?: number;
};

/**
 * Inline-SVG donut of the portfolio status mix with a labelled legend to the
 * right. Segments use the status palette only (strong/watch/risk) — no chart
 * library, no icons. Matches the reference `.pie-wrap` at 110px / r=42.
 */
export function StatusDonut({
  segments,
  size = 110,
  stroke = 16,
}: StatusDonutProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sum = segments.reduce((a, s) => a + s.value, 0) || 1;

  const fracs = segments.map((seg) => seg.value / sum);
  const arcs = segments.map((seg, i) => ({
    seg,
    frac: fracs[i],
    start: fracs.slice(0, i).reduce((a, f) => a + f, 0),
  }));

  return (
    <div className="flex items-center gap-5">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0 -rotate-90"
      >
        {arcs.map(({ seg, frac, start }) => {
          const segLen = frac * c;
          const offset = -start * c;
          if (seg.value === 0) return null;
          return (
            <motion.circle
              key={seg.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={bandColorVar[seg.band]}
              strokeWidth={stroke}
              strokeDasharray={`${segLen} ${c - segLen}`}
              initial={{ strokeDashoffset: offset + c }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          );
        })}
      </svg>

      <ul className="flex flex-col gap-2">
        {segments.map((seg) => (
          <li
            key={seg.label}
            className="flex items-center gap-2 text-[11.5px] text-muted"
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: bandColorVar[seg.band] }}
            />
            {seg.label} — {seg.value}
          </li>
        ))}
      </ul>
    </div>
  );
}
