"use client";

import { useState } from "react";
import { clsx } from "@/lib/clsx";
import { bandColorVar } from "@/lib/band";
import type { TimelineEvent } from "@/lib/types";
import { useProject } from "./ProjectContext";

/**
 * Critical-path timeline strip. Milestone dots sit on a baseline; hovering a
 * dot reveals a dark tooltip. Two events sharing a `conflictKey` cross-highlight
 * together — hovering either one lights up both, even when non-adjacent
 * (matches the reference `toggleConflict()`).
 */
export function TimelineStrip() {
  const { timeline } = useProject();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const milestones = timeline.filter((e) => e.kind !== "deadline");
  const deadlines = timeline.filter((e) => e.kind === "deadline");

  return (
    <div className="relative mb-[18px] overflow-visible rounded-[5px] border border-hairline bg-canvas px-5 pb-5 pt-3.5 shadow-card">
      <div className="mb-4 text-[11px] font-medium text-faint">
        Critical path to activation — hover a point for details
      </div>
      <div className="relative mx-[10px] h-[34px] overflow-visible">
        <div className="absolute inset-x-0 top-[5px] h-[2px] bg-hairline" />

        {milestones.map((event) => (
          <MilestoneItem
            key={event.id}
            event={event}
            active={
              !!event.conflictKey && event.conflictKey === hoveredKey
            }
            onEnter={() =>
              event.conflictKey && setHoveredKey(event.conflictKey)
            }
            onLeave={() => setHoveredKey(null)}
          />
        ))}

        {deadlines.map((event) => (
          <DeadlineMarker key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}

function MilestoneItem({
  event,
  active,
  onEnter,
  onLeave,
}: {
  event: TimelineEvent;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  return (
    <div
      className="group/tl absolute top-0 z-[1] -translate-x-1/2 cursor-pointer text-center hover:z-40"
      style={{ left: `${event.position}%` }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        className={clsx(
          "mx-auto h-[11px] w-[11px] rounded-full border-2 border-white transition-[transform,box-shadow] duration-150",
          active
            ? "scale-[1.35] shadow-[0_0_0_3px_rgba(255,132,0,0.22)]"
            : "shadow-[0_0_0_1px_var(--color-hairline)] group-hover/tl:scale-[1.35] group-hover/tl:shadow-[0_0_0_3px_rgba(255,132,0,0.22)]",
        )}
        style={{ background: bandColorVar[event.band] }}
      />
      <div
        className={clsx(
          "mt-[9px] whitespace-nowrap text-[10px] transition-colors duration-150",
          active ? "font-semibold text-risk" : "text-muted",
        )}
      >
        {event.shortLabel ?? event.label}
      </div>
      <Tooltip event={event} placement="above" />
    </div>
  );
}

function DeadlineMarker({ event }: { event: TimelineEvent }) {
  return (
    <div
      className="group/tl absolute top-[-3px] bottom-[-3px] z-[2] w-[2px] cursor-pointer bg-risk hover:z-40"
      style={{ left: `${event.position}%` }}
    >
      <div className="absolute top-[-18px] -translate-x-[75%] whitespace-nowrap text-[10px] font-semibold text-risk">
        Deadline
      </div>
      <Tooltip event={event} placement="below" />
    </div>
  );
}

function Tooltip({
  event,
  placement,
}: {
  event: TimelineEvent;
  placement: "above" | "below";
}) {
  return (
    <div
      className={clsx(
        "pointer-events-none absolute left-1/2 z-50 w-[190px] -translate-x-1/2 translate-y-1 rounded-[3px] bg-oxford px-[13px] py-[11px] text-left text-[11px] leading-[1.5] text-white opacity-0 shadow-[0_10px_24px_rgba(11,8,41,0.22)] transition-[opacity,transform] duration-150 group-hover/tl:pointer-events-auto group-hover/tl:translate-y-0 group-hover/tl:opacity-100",
        placement === "above" ? "bottom-6" : "top-[14px]",
      )}
    >
      <div className="mb-[2px] font-semibold">{event.label}</div>
      {event.dateDisplay && (
        <div className="mb-[6px] text-[10px] text-vista">
          {event.dateDisplay}
        </div>
      )}
      {event.description}
      {event.conflictNote && (
        <div className="mt-[6px] border-t border-white/15 pt-[6px] text-[10.5px] font-medium text-[#FFD9A8]">
          {event.conflictNote}
        </div>
      )}
    </div>
  );
}
