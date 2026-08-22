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
 *
 * Labels never collide: milestones alternate between two vertical lanes —
 * even-indexed (by position) sit on the upper lane, odd-indexed drop to a
 * lower lane with a thin connector tick back up to their dot. A milestone
 * within 10% of the deadline marker is always forced to the lower lane so its
 * label can never run into the anchored-right Deadline label/bar.
 *
 * "You are here": there is no explicit current flag in the data, so the
 * current milestone is the LAST one whose date is today or in the past —
 * i.e. the most recently reached point on the path; if every milestone is
 * still upcoming, the FIRST upcoming one is marked instead. It gets a
 * brand-orange animate-ping ring around its (slightly larger) band-colored
 * core, matching the live-dot precedent in projects/page.tsx.
 */
export function TimelineStrip() {
  const { timeline } = useProject();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const milestones = timeline
    .filter((e) => e.kind !== "deadline")
    .slice()
    .sort((a, b) => a.position - b.position);
  const deadlines = timeline.filter((e) => e.kind === "deadline");

  const currentId = currentMilestoneId(milestones);

  return (
    <div className="relative mb-[18px] overflow-visible rounded-[5px] border border-hairline bg-canvas px-6 pb-6 pt-4 shadow-card">
      <div className="mb-5 text-[12.5px] font-medium text-faint">
        Critical path to activation — hover a point for details
      </div>
      <div className="relative mx-4 h-[60px] overflow-visible">
        <div className="absolute inset-x-0 top-[6px] h-[2px] bg-hairline" />

        {milestones.map((event, i) => {
          const nearDeadline = deadlines.some(
            (d) => Math.abs(d.position - event.position) < 10,
          );
          return (
            <MilestoneItem
              key={event.id}
              event={event}
              lane={nearDeadline ? 1 : i % 2 === 0 ? 0 : 1}
              isCurrent={event.id === currentId}
              active={
                !!event.conflictKey && event.conflictKey === hoveredKey
              }
              onEnter={() =>
                event.conflictKey && setHoveredKey(event.conflictKey)
              }
              onLeave={() => setHoveredKey(null)}
            />
          );
        })}

        {deadlines.map((event) => (
          <DeadlineMarker key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}

/** Last milestone already reached (date <= today); if none has been reached,
 *  the first upcoming one. Dates are ISO strings from the project data. */
function currentMilestoneId(milestones: TimelineEvent[]): string | null {
  if (milestones.length === 0) return null;
  const now = Date.now();
  const byDate = milestones.slice().sort((a, b) => a.date.localeCompare(b.date));
  let current: TimelineEvent | null = null;
  for (const e of byDate) {
    if (Date.parse(e.date) <= now) current = e;
    else break;
  }
  return (current ?? byDate[0] ?? null)?.id ?? null;
}

/** Horizontal label nudge so the first/last labels never overflow the strip
 *  edges (centered by default, pulled inward near the edges). */
function labelShift(position: number): string {
  if (position <= 8) return "translateX(-30%)";
  if (position >= 92) return "translateX(-70%)";
  return "translateX(-50%)";
}

function MilestoneItem({
  event,
  lane,
  isCurrent,
  active,
  onEnter,
  onLeave,
}: {
  event: TimelineEvent;
  lane: 0 | 1;
  isCurrent: boolean;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  return (
    <div
      className="group/tl absolute top-0 z-[1] cursor-pointer hover:z-40"
      style={{ left: `${event.position}%` }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {isCurrent ? (
        <span className="relative flex h-[14px] w-[14px] -translate-x-1/2">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: "var(--color-brand)" }}
          />
          <span
            className={clsx(
              "relative inline-flex h-[14px] w-[14px] rounded-full border-2 border-canvas transition-[transform,box-shadow] duration-150",
              active
                ? "scale-[1.3] shadow-[0_0_0_3px_rgba(255,132,0,0.22)]"
                : "shadow-[0_0_0_1px_var(--color-hairline)] group-hover/tl:scale-[1.3] group-hover/tl:shadow-[0_0_0_3px_rgba(255,132,0,0.22)]",
            )}
            style={{ background: bandColorVar[event.band] }}
          />
        </span>
      ) : (
        <div
          className={clsx(
            "h-[13px] w-[13px] -translate-x-1/2 rounded-full border-2 border-canvas transition-[transform,box-shadow] duration-150",
            active
              ? "scale-[1.35] shadow-[0_0_0_3px_rgba(255,132,0,0.22)]"
              : "shadow-[0_0_0_1px_var(--color-hairline)] group-hover/tl:scale-[1.35] group-hover/tl:shadow-[0_0_0_3px_rgba(255,132,0,0.22)]",
          )}
          style={{ background: bandColorVar[event.band] }}
        />
      )}

      {/* Lane 2 connector tick: drops from the dot down to the lower label. */}
      {lane === 1 && (
        <div className="absolute left-0 top-[15px] h-[20px] w-px bg-hairline" />
      )}

      <div
        className={clsx(
          "absolute left-0 whitespace-nowrap text-xs transition-colors duration-150",
          lane === 0 ? "top-[21px]" : "top-[39px]",
          active
            ? "font-semibold text-risk"
            : isCurrent
              ? "font-medium text-ink"
              : "text-muted",
        )}
        style={{ transform: labelShift(event.position) }}
      >
        {event.shortLabel ?? event.label}
      </div>

      <Tooltip event={event} placement="above" isCurrent={isCurrent} />
    </div>
  );
}

function DeadlineMarker({ event }: { event: TimelineEvent }) {
  return (
    <div
      className="group/tl absolute top-[-3px] bottom-[-3px] z-[2] w-[2px] cursor-pointer bg-risk hover:z-40"
      style={{ left: `${event.position}%` }}
    >
      <div className="absolute right-0 top-[-20px] whitespace-nowrap text-xs font-semibold text-risk">
        Deadline
      </div>
      <Tooltip event={event} placement="below" />
    </div>
  );
}

function Tooltip({
  event,
  placement,
  isCurrent = false,
}: {
  event: TimelineEvent;
  placement: "above" | "below";
  isCurrent?: boolean;
}) {
  return (
    <div
      className={clsx(
        "pointer-events-none absolute left-0 z-50 w-[230px] -translate-x-1/2 translate-y-1 rounded-[3px] bg-oxford px-[14px] py-3 text-left text-[12.5px] leading-[1.5] text-white opacity-0 shadow-[0_10px_24px_rgba(11,8,41,0.22)] transition-[opacity,transform] duration-150 group-hover/tl:pointer-events-auto group-hover/tl:translate-y-0 group-hover/tl:opacity-100",
        // Milestone wrappers are dot-sized now — anchor "above" tooltips just
        // over the dot (13/14px core) instead of the old label-height offset.
        placement === "above" && (isCurrent ? "bottom-[20px]" : "bottom-[19px]"),
        placement === "below" && "top-[16px]",
      )}
    >
      <div className="mb-[2px] font-semibold">{event.label}</div>
      {event.dateDisplay && (
        <div className="mb-[6px] text-xs text-vista">
          {event.dateDisplay}
        </div>
      )}
      {event.description}
      {event.conflictNote && (
        <div className="mt-[6px] border-t border-white/15 pt-[6px] text-[12.5px] font-medium text-[#FFD9A8]">
          {event.conflictNote}
        </div>
      )}
    </div>
  );
}
