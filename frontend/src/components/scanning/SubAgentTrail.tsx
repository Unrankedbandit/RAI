"use client";

import { clsx } from "@/lib/clsx";

type SubAgentTrailProps = {
  /** Sub-agents spawned so far, in arrival order. */
  subAgents: string[];
  done: boolean;
};

/**
 * A subtle trail of the sub-agents doing the reading. Each pill appears as its
 * sub-agent is spawned by the backend — vista (structural), never a risk color.
 * While the run is live, the newest pill's dot pulses to mark the active one.
 */
export function SubAgentTrail({ subAgents, done }: SubAgentTrailProps) {
  const lastIndex = subAgents.length - 1;

  return (
    <div>
      <p className="text-xs text-faint">Sub-agents</p>
      {subAgents.length === 0 ? (
        <p className="mt-2 text-xs text-muted">Spawning…</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {subAgents.map((name, i) => {
            const active = !done && i === lastIndex;
            return (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 rounded-full bg-vista-soft px-2.5 py-1 text-xs font-medium text-ink"
              >
                <span
                  aria-hidden
                  className={clsx(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    active && "animate-pulse",
                  )}
                  style={{ backgroundColor: "var(--color-vista)" }}
                />
                <span className="mono">{name}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
