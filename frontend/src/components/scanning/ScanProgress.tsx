"use client";

import { motion } from "framer-motion";

type ScanProgressProps = {
  /** 0–100. */
  percent: number;
  /** True when no event has landed recently: read as "still working", not stalled. */
  indeterminate: boolean;
  /** Filename currently in focus, or null before any document is read. */
  file: string | null;
  done: boolean;
};

/**
 * The moving progress indicator: a rounded bar that visibly fills left→right,
 * with the document currently being read and a live percentage. Vista marks
 * work-in-progress — a structural accent, never a status or the reserved brand
 * orange.
 *
 * In indeterminate mode (a milestone is taking a while) the bar keeps its
 * current width but overlays a shimmer sweep and pulses, and the numeric
 * percentage is replaced by a "working…" label — so it never fabricates a
 * climbing number the backend hasn't earned.
 */
export function ScanProgress({ percent, indeterminate, file, done }: ScanProgressProps) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const shimmering = indeterminate && !done;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          {!done && (
            <motion.span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-vista"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          <span className="truncate text-sm text-muted">
            {done ? (
              "Analysis complete"
            ) : file ? (
              <>
                Reading <span className="text-ink">{file}</span>
              </>
            ) : (
              "Preparing…"
            )}
          </span>
        </div>
        {shimmering ? (
          <motion.span
            className="shrink-0 text-sm font-medium text-faint"
            animate={{ opacity: [1, 0.45, 1] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          >
            working…
          </motion.span>
        ) : (
          <span className="shrink-0 text-sm font-medium tabular-nums text-ink">
            {pct}%
          </span>
        )}
      </div>

      <div className="relative mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        <motion.div
          className="h-full rounded-full bg-vista"
          initial={{ width: "0%" }}
          animate={{
            width: `${pct}%`,
            opacity: shimmering ? [1, 0.65, 1] : 1,
          }}
          transition={{
            width: { duration: 0.25, ease: "linear" },
            opacity: shimmering
              ? { duration: 1.3, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.2 },
          }}
        />
        {shimmering && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--color-vista-soft), transparent)",
            }}
            initial={{ x: "-100%" }}
            animate={{ x: "400%" }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>
    </div>
  );
}
