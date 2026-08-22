"use client";

import { motion } from "framer-motion";
import { clsx } from "@/lib/clsx";
import type { AgentStatus } from "@/lib/scan/scanEvents";
import type { AgentBox } from "@/lib/scan/scanState";

/**
 * Pill styling per status, resolved entirely through the app's status tokens
 * (grey / near-black / orange / vista — the frozen palette has no green/red):
 *   working → vista, the app's live-activity accent, with a pulsing dot
 *   done    → strong grey, the palette's "cleared" color
 *   error   → risk orange, the palette's "flagged / danger" color
 *   waiting → dim faint on the recessed surface
 */
const pillClass: Record<AgentStatus, string> = {
  working: "bg-vista-soft text-ink",
  done: "bg-strong-soft text-strong-ink",
  error: "bg-risk-soft text-risk-ink",
  waiting: "bg-surface-2 text-faint",
};

const dotColor: Record<AgentStatus, string> = {
  working: "var(--color-vista)",
  done: "var(--color-strong)",
  error: "var(--color-risk)",
  waiting: "var(--color-faint)",
};

const statusLabel: Record<AgentStatus, string> = {
  working: "Working",
  done: "Done",
  error: "Error",
  waiting: "Waiting",
};

type AgentStatusGridProps = {
  /** Boxes in first-seen order; each updates in place as narration arrives. */
  agents: AgentBox[];
};

/**
 * The hero of the live run view: one box per agent seen so far, showing its
 * lifecycle pill and latest one-line activity. Boxes never scroll — a new box
 * fades in, then only its pill and activity line change.
 */
export function AgentStatusGrid({ agents }: AgentStatusGridProps) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {agents.map((agent) => (
        <motion.li
          key={agent.name}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="rounded-[5px] border border-hairline bg-surface-2 px-3 py-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="mono min-w-0 truncate text-sm text-ink">
              {agent.name}
            </span>
            <span
              className={clsx(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                pillClass[agent.status],
              )}
            >
              <span
                aria-hidden
                className={clsx(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  agent.status === "working" && "animate-pulse",
                )}
                style={{ backgroundColor: dotColor[agent.status] }}
              />
              {statusLabel[agent.status]}
            </span>
          </div>
          <p
            className="mt-1 truncate text-xs text-muted"
            title={agent.activity}
          >
            {agent.activity}
          </p>
        </motion.li>
      ))}
    </ul>
  );
}
