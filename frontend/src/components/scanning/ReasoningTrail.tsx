"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { TrailLine, TrailKind } from "@/lib/scan/scanState";

/** Dot color encodes the meaning of the line, not decoration. */
const dotColor: Record<TrailKind, string> = {
  read: "var(--color-vista)",
  flag: "var(--color-risk)",
  score: "var(--color-faint)",
  subagent: "var(--color-faint)",
};

/** Prefix shown before the text for certain kinds. */
const kindLabel: Record<TrailKind, string | null> = {
  read: null,
  flag: "Flag",
  score: null,
  subagent: null,
};

type ReasoningTrailProps = {
  lines: TrailLine[];
};

/**
 * A live reasoning log. Lines append one-by-one and the view auto-scrolls to
 * the newest as the agent reads the document set. Driven by real backend
 * events — each line arrives as a distinct fade-in, never a block replace.
 */
export function ReasoningTrail({ lines }: ReasoningTrailProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines.length]);

  return (
    <div className="h-72 overflow-y-auto rounded-[5px] bg-surface-2 p-4">
      <ol className="space-y-2.5">
        <AnimatePresence initial={false}>
          {lines.map((line) => (
            <motion.li
              key={line.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="flex gap-2.5 text-sm leading-relaxed"
            >
              <span
                aria-hidden
                className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: dotColor[line.kind] }}
              />
              {line.kind === "subagent" ? (
                <span className="mono text-faint">{line.text}</span>
              ) : (
                <span className="text-ink">
                  {kindLabel[line.kind] && (
                    <span className="mr-1.5 text-risk-ink">
                      {kindLabel[line.kind]}
                    </span>
                  )}
                  {line.text}
                </span>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
        <div ref={endRef} />
      </ol>
    </div>
  );
}
