"use client";

import { motion } from "framer-motion";
import type { RiskBand } from "@/lib/types";
import { bandColorVar } from "@/lib/band";

const R = 38;
const CIRC = 2 * Math.PI * R; // ≈ 238.76

/**
 * 80px donut ring (viewBox 0 0 90 90, r=38) matching the reference .ring-card
 * SVG. Track is the hairline line color; the progress arc is the score's band
 * color, dash computed from score/100 and rotated -90.
 */
export function ScoreRing({ score, band }: { score: number; band: RiskBand }) {
  const offset = CIRC * (1 - Math.min(Math.max(score, 0), 100) / 100);
  return (
    <svg width="80" height="80" viewBox="0 0 90 90" className="flex-none">
      <circle cx="45" cy="45" r={R} fill="none" stroke="#EFEDF5" strokeWidth="8" />
      <motion.circle
        cx="45"
        cy="45"
        r={R}
        fill="none"
        stroke={bandColorVar[band]}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={CIRC}
        transform="rotate(-90 45 45)"
        initial={{ strokeDashoffset: CIRC }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
      <text
        x="45"
        y="50"
        textAnchor="middle"
        fontFamily="var(--font-poppins), Poppins, sans-serif"
        fontSize="21"
        fontWeight="600"
        fill="#0B0829"
      >
        {score}
      </text>
    </svg>
  );
}
