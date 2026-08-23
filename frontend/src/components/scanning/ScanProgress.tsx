"use client";

import { motion } from "framer-motion";
import type { StageState } from "@/lib/scan/scanState";

type ScanProgressProps = {
  /** One box per pipeline phase, in canonical order (from scanState). */
  stages: StageState[];
  /** Whole run finished — freezes every box filled green, pulses off. */
  done: boolean;
};

function statusText(stage: StageState): string {
  if (stage.status === "done") return "done";
  if (stage.status === "working") {
    return stage.retriggered ? "re-run due to findings" : "working";
  }
  return "waiting";
}

/**
 * The staging tracker — replaces the old progress bar. One box per pipeline
 * phase (orchestrate → compose), each going from empty to fully green:
 *
 *   pending  — outlined/empty hairline box, status "waiting"
 *   working  — brand-orange pulsing border, status "working" — or "re-run
 *              due to findings" when the phase started again after
 *              completing (the cross-examine → follow-up research loop)
 *   done     — fills solid green left→right with a smooth transition,
 *              status "done"
 *
 * Desktop lays the boxes out as a horizontal stepper with a connecting line
 * (green behind finished stretches); under md it stacks into a list.
 */
export function ScanProgress({ stages, done }: ScanProgressProps) {
  return (
    <ol
      aria-label="Pipeline stages"
      className="flex flex-col gap-2 md:flex-row md:items-stretch"
    >
      {stages.map((stage, i) => {
        const isDone = stage.status === "done";
        const isWorking = stage.status === "working" && !done;
        const prevDone = i > 0 && stages[i - 1].status === "done";
        const text = statusText(stage);

        return (
          <li
            key={stage.id}
            aria-label={`${stage.label}: ${text}`}
            className="relative min-w-0 md:flex-1"
          >
            {/* Stepper connector, in the gap to the previous box. */}
            {i > 0 && (
              <span
                aria-hidden
                className="absolute -left-2 top-1/2 hidden h-px w-2 md:block"
                style={{
                  background:
                    prevDone && isDone
                      ? "var(--color-go)"
                      : "var(--color-hairline)",
                }}
              />
            )}

            <div className="relative h-full overflow-hidden rounded-md border border-hairline bg-surface-2 px-2 py-2">
              {/* Green fill — sweeps left→right when the stage completes and
                  drains back out if the stage re-runs. */}
              <motion.span
                aria-hidden
                className="absolute inset-0 origin-left bg-go"
                initial={false}
                animate={{ scaleX: isDone ? 1 : 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />

              {/* Brand pulse on the border while the stage is working. */}
              {isWorking && (
                <motion.span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-md border-2 border-brand"
                  animate={{ opacity: [1, 0.25, 1] }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              )}

              <div className="relative">
                <p
                  className={`text-[11px] font-medium leading-tight ${
                    isDone
                      ? "text-oxford"
                      : isWorking
                        ? "text-ink"
                        : "text-faint"
                  }`}
                >
                  {stage.label}
                </p>
                <p
                  className={`mt-0.5 text-[10px] leading-tight ${
                    isDone
                      ? "text-oxford"
                      : isWorking
                        ? "text-brand"
                        : "text-faint"
                  }`}
                >
                  {text}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
