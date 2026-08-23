"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { clsx } from "@/lib/clsx";
import { Drawer } from "@/components/ui/Drawer";
import type { AgentStatus } from "@/lib/scan/scanEvents";
import {
  groupAgentsByCore,
  type AgentBox,
  type AgentCoreGroup,
  type AgentFeedLine,
} from "@/lib/scan/scanState";

/**
 * Tile border/glow per status (tokens only — brand for live work, the
 * verdict green/red for terminal done/error, dim hairline for waiting):
 *   working → pulsing brand ring (see .agent-tile-working in globals.css)
 *   done    → verdict green
 *   error   → verdict red
 *   waiting → dim hairline
 */
const tileColor: Record<AgentStatus, string> = {
  working: "var(--color-brand)",
  done: "var(--color-go)",
  error: "var(--color-nogo)",
  waiting: "var(--color-hairline)",
};

const statusLabel: Record<AgentStatus, string> = {
  working: "Working",
  done: "Done",
  error: "Error",
  waiting: "Waiting",
};

/** The feed-line dot follows the tile's status color language. */
const feedDotColor: Record<AgentStatus, string> = {
  working: "var(--color-brand)",
  done: "var(--color-go)",
  error: "var(--color-nogo)",
  waiting: "var(--color-faint)",
};

/** Short tile label: at most ~10 chars, ellipsis-truncated. */
function shortLabel(name: string): string {
  return name.length > 10 ? `${name.slice(0, 9)}…` : name;
}

/** The tiny-box label for an instance: the suffix after "<Core>:". */
function instanceSuffix(name: string): string {
  const i = name.indexOf(":");
  return i >= 0 ? name.slice(i + 1) : name;
}

/** Inline bot glyph — stroke-only, matching the design system's icon style. */
function BotGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="4.5" y="8" width="15" height="11" rx="2" />
      <path d="M12 8V5" />
      <circle cx="12" cy="3.6" r="1.1" />
      <path d="M9 12.5h.01M15 12.5h.01" />
      <path d="M9.5 15.5h5" />
      <path d="M2.5 12v3M21.5 12v3" />
    </svg>
  );
}

type AgentTileProps = {
  box: AgentBox;
  /** Display label (core name, or instance suffix for sub-instances). */
  label: string;
  onSelect: (name: string) => void;
};

/**
 * One agent as a small square tile (~64px): bot glyph, short name, and a
 * status border — nothing else. Clicking opens the agent's live feed.
 */
function AgentTile({ box, label, onSelect }: AgentTileProps) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      onClick={() => onSelect(box.name)}
      title={`${box.name} — ${statusLabel[box.status]}`}
      aria-label={`Open live feed for agent ${box.name}`}
      className={clsx(
        "flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-[5px] border bg-surface-2 px-1",
        box.status === "working" ? "agent-tile-working" : "hover:bg-select",
        box.status === "waiting" && "opacity-60",
      )}
      style={{ borderColor: tileColor[box.status] }}
    >
      <BotGlyph
        className={clsx(
          "h-5 w-5",
          box.status === "waiting" ? "text-faint" : "text-ink",
        )}
      />
      <span className="mono w-full truncate text-center text-[9px] leading-tight text-muted">
        {shortLabel(label)}
      </span>
    </motion.button>
  );
}

type CoreRowProps = {
  group: AgentCoreGroup;
  onSelect: (name: string) => void;
};

/**
 * One core's row: the core tile with its instance tiles nested next to it,
 * visually attached via a hairline-joined cluster. Every agent is a tile —
 * nothing card-sized. A single-instance core is just its own tile.
 */
function CoreRow({ group, onSelect }: CoreRowProps) {
  const single = group.instances.length === 1;
  if (single) {
    const box = group.instances[0];
    return (
      <li>
        <AgentTile box={box} label={box.name} onSelect={onSelect} />
      </li>
    );
  }
  const coreBox: AgentBox = {
    name: group.core,
    status: group.status,
    activity: group.activity,
  };
  return (
    <li className="flex items-stretch gap-1">
      <AgentTile box={coreBox} label={group.core} onSelect={onSelect} />
      <ul className="flex items-stretch gap-1 border-l border-hairline pl-1">
        {group.instances.map((instance) => (
          <AgentTile
            key={instance.name}
            box={instance}
            label={instanceSuffix(instance.name)}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </li>
  );
}

type AgentFeedDrawerProps = {
  /** Selected tile's name (agent or core), null while closed. */
  selected: string | null;
  onClose: () => void;
  agents: AgentBox[];
  groups: AgentCoreGroup[];
  feeds: Record<string, AgentFeedLine[]>;
};

/**
 * The tile pop-up: the codebase's Drawer idiom showing the selected agent's
 * live feed — every trace/status frame the stream attributed to it — with a
 * status header, auto-scrolling as new frames land. Reads the same scan
 * state as the grid; no second backend connection.
 */
function AgentFeedDrawer({
  selected,
  onClose,
  agents,
  groups,
  feeds,
}: AgentFeedDrawerProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // A core tile with several instances shows all its instances' frames
  // merged in stream order; an instance tile shows only its own.
  const lines = useMemo<AgentFeedLine[]>(() => {
    if (!selected) return [];
    const own = feeds[selected];
    if (own) return own;
    const group = groups.find((g) => g.core === selected);
    if (!group) return [];
    return group.instances
      .flatMap((i) => feeds[i.name] ?? [])
      .sort((a, b) => a.id - b.id);
  }, [selected, groups, feeds]);

  const box =
    agents.find((a) => a.name === selected) ??
    (() => {
      const group = groups.find((g) => g.core === selected);
      return group
        ? { name: group.core, status: group.status, activity: group.activity }
        : undefined;
    })();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines.length, selected]);

  return (
    <Drawer
      open={selected !== null}
      onClose={onClose}
      title={selected ?? ""}
      subtitle={box ? `Status: ${statusLabel[box.status]}` : undefined}
      width={420}
    >
      {lines.length === 0 ? (
        <p className="text-sm text-faint">No feed lines yet for this agent.</p>
      ) : (
        <ol className="space-y-2">
          {lines.map((line) => (
            <li key={line.id} className="flex gap-2 text-sm leading-relaxed">
              <span
                aria-hidden
                className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: feedDotColor[line.status] }}
              />
              <span className="mono text-xs text-muted">{line.text}</span>
            </li>
          ))}
          <div ref={endRef} />
        </ol>
      )}
    </Drawer>
  );
}

type AgentStatusGridProps = {
  /** Every agent instance in first-seen order; grouped by core for display. */
  agents: AgentBox[];
  /** Per-agent live feed history from the same scan state. */
  feeds: Record<string, AgentFeedLine[]>;
};

/**
 * The hero of the live run view: a header counter ("N active · M total")
 * above a wrap of tiny square agent tiles — one per core, with sub-instance
 * tiles nested beside it. Tiles carry only a bot glyph, a short name, and a
 * status border/glow; clicking any tile opens that agent's live feed in a
 * drawer. New tiles fade in, then only borders/glows change.
 */
export function AgentStatusGrid({ agents, feeds }: AgentStatusGridProps) {
  const groups = groupAgentsByCore(agents);
  const [selected, setSelected] = useState<string | null>(null);
  const active = agents.filter((a) => a.status === "working").length;

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-faint">Agents</p>
        <p className="mono text-xs text-faint tabular-nums">
          {active} active · {agents.length} total
        </p>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-2">
        {groups.map((group) => (
          <CoreRow key={group.core} group={group} onSelect={setSelected} />
        ))}
      </ul>
      <AgentFeedDrawer
        selected={selected}
        onClose={() => setSelected(null)}
        agents={agents}
        groups={groups}
        feeds={feeds}
      />
    </>
  );
}
