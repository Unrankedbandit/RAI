"use client";

import { motion } from "framer-motion";
import { clsx } from "@/lib/clsx";
import type { AgentStatus } from "@/lib/scan/scanEvents";
import {
  groupAgentsByCore,
  type AgentBox,
  type AgentCoreGroup,
} from "@/lib/scan/scanState";

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

/** The tiny-box label for an instance: the suffix after "<Core>:". */
function instanceSuffix(name: string): string {
  const i = name.indexOf(":");
  return i >= 0 ? name.slice(i + 1) : name;
}

/**
 * One sub-instance chip: a mini status dot (pulsing while working) plus the
 * instance suffix. Roughly half the height of a main box's pill row.
 */
function TinyInstanceBox({ instance }: { instance: AgentBox }) {
  return (
    <li
      title={`${instance.name} — ${statusLabel[instance.status]}`}
      className={clsx(
        "inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] leading-tight",
        pillClass[instance.status],
      )}
    >
      <span
        aria-hidden
        className={clsx(
          "inline-block h-1 w-1 rounded-full",
          instance.status === "working" && "animate-pulse",
        )}
        style={{ backgroundColor: dotColor[instance.status] }}
      />
      <span className="mono">{instanceSuffix(instance.name)}</span>
    </li>
  );
}

function CoreBox({ group }: { group: AgentCoreGroup }) {
  // A single-instance core needs no tiny row — the main box covers it, and
  // keeps the instance's full name as its label.
  const single = group.instances.length === 1;
  const label = single ? group.instances[0].name : group.core;
  return (
    <motion.li
      key={group.core}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="rounded-[5px] border border-hairline bg-surface-2 px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="mono min-w-0 truncate text-sm text-ink">{label}</span>
        <span
          className={clsx(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
            pillClass[group.status],
          )}
        >
          <span
            aria-hidden
            className={clsx(
              "inline-block h-1.5 w-1.5 rounded-full",
              group.status === "working" && "animate-pulse",
            )}
            style={{ backgroundColor: dotColor[group.status] }}
          />
          {statusLabel[group.status]}
        </span>
      </div>
      <p className="mt-1 truncate text-xs text-muted" title={group.activity}>
        {group.activity}
      </p>
      {!single && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {group.instances.map((instance) => (
            <TinyInstanceBox key={instance.name} instance={instance} />
          ))}
        </ul>
      )}
    </motion.li>
  );
}

type AgentStatusGridProps = {
  /** Every agent instance in first-seen order; grouped by core for display. */
  agents: AgentBox[];
};

/**
 * The hero of the live run view: one box per core agent seen so far, showing
 * its lifecycle pill (worst-of its instances) and latest one-line activity.
 * Cores with sub-instances carry a compact wrapping row of tiny boxes — one
 * per instance — nested under the activity line. Boxes never scroll — a new
 * box fades in, then only its pill, activity line, and tiny boxes change.
 */
export function AgentStatusGrid({ agents }: AgentStatusGridProps) {
  const groups = groupAgentsByCore(agents);
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {groups.map((group) => (
        <CoreBox key={group.core} group={group} />
      ))}
    </ul>
  );
}
