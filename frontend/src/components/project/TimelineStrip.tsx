"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "@/lib/clsx";
import { bandColorVar } from "@/lib/band";
import type { TimelineEvent } from "@/lib/types";
import { useProject } from "./ProjectContext";

/**
 * Critical-path timeline — Gantt only (the old strip view was removed; each
 * phase row now clicks through to a full phase detail page instead).
 *
 * The Gantt draws one %-positioned bar per item against the min/max dates of
 * the data. Phase labels live in a fixed-width left column, the compact
 * duration label sits outside the bar, and the hover tooltip carries the
 * full detail. Two events sharing a `conflictKey` cross-highlight together —
 * hovering either one lights up both, even when non-adjacent.
 *
 * Every phase row is a link: clicking (or Enter on the focused row) opens
 * /projects/<projectId>/timeline/<eventId>. Deadline markers stay
 * hover-only — they are not phases and have no detail page.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function TimelineStrip() {
  const { project, timeline } = useProject();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const milestones = useMemo(
    () =>
      timeline
        .filter((e) => e.kind !== "deadline")
        .slice()
        .sort((a, b) => a.position - b.position),
    [timeline],
  );
  const deadlines = useMemo(
    () => timeline.filter((e) => e.kind === "deadline"),
    [timeline],
  );

  return (
    <div className="relative mb-4 overflow-visible rounded-[5px] border border-hairline bg-canvas px-5 pb-4 pt-3 shadow-card">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[12px] font-medium text-faint">
          Critical path to activation — hover a bar for details, click a phase
          for the full picture
        </div>
      </div>

      <TimelineGantt
        projectId={project.id}
        milestones={milestones}
        deadlines={deadlines}
        hoveredKey={hoveredKey}
        onEnterKey={setHoveredKey}
        onLeaveKey={() => setHoveredKey(null)}
      />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Gantt view — one horizontal bar per timeline item, hand-rolled divs.
 *
 * Items are point milestones, so each phase bar runs from the item's date to
 * the next item's date (the final item runs to the deadline when one exists,
 * else gets a short stub). Bar geometry is %-positioned against the min/max
 * dates of everything shown (milestones + deadlines), so no chart library is
 * needed and the bars scale with the card width.
 *
 * Text never overlaps bars: phase labels live in a fixed-width left column
 * (truncated), and the compact duration label sits outside the bar — after
 * the bar end when there is room, before the bar start as a fallback, and
 * omitted entirely when neither side has space (the hover tooltip always
 * carries the full detail).
 * ------------------------------------------------------------------------ */

/** Fixed phase-label column width; the bar lane is the remaining flex space. */
const GANTT_LABEL_PX = 160;

/** "Aug 2026"-style axis label from epoch ms. */
function axisLabel(time: number): string {
  const d = new Date(time);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Compact duration for the label next to a bar, e.g. "10 wks", "3.5 yrs". */
function formatDuration(ms: number): string {
  const days = Math.round(ms / 86_400_000);
  if (days < 14) return `${days}d`;
  if (days < 75) return `${Math.round(days / 7)} wks`;
  if (days < 550) return `${Math.round(days / 30.4)} mos`;
  return `${(days / 365.25).toFixed(1)} yrs`;
}

/** Lane-relative position for a % within the bar lane, past the label column. */
function laneLeft(pctPos: number): string {
  return `calc(${GANTT_LABEL_PX}px + (100% - ${GANTT_LABEL_PX}px) * ${pctPos / 100})`;
}

function TimelineGantt({
  projectId,
  milestones,
  deadlines,
  hoveredKey,
  onEnterKey,
  onLeaveKey,
}: {
  projectId: string;
  milestones: TimelineEvent[];
  deadlines: TimelineEvent[];
  hoveredKey: string | null;
  onEnterKey: (key: string) => void;
  onLeaveKey: () => void;
}) {
  const router = useRouter();
  const rows = useMemo(
    () =>
      milestones
        .filter((e) => !Number.isNaN(Date.parse(e.date)))
        .slice()
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
    [milestones],
  );
  const dlines = useMemo(
    () => deadlines.filter((e) => !Number.isNaN(Date.parse(e.date))),
    [deadlines],
  );

  const range = useMemo(() => {
    const all = [...rows, ...dlines].map((e) => Date.parse(e.date));
    if (all.length === 0) return null;
    const min = Math.min(...all);
    const max = Math.max(...all);
    return { min, span: Math.max(max - min, 86_400_000) };
  }, [rows, dlines]);

  // Sampled once per mount (render stays pure); hooks must precede the
  // early return below (react-hooks/rules-of-hooks).
  const [today] = useState(() => Date.now());

  if (!range || rows.length === 0) {
    return (
      <div className="py-5 text-center text-[12.5px] text-faint">
        No dated milestones to chart.
      </div>
    );
  }

  const pct = (t: number) => ((t - range.min) / range.span) * 100;

  // Bar end for each row: the next milestone's date; for the last row the
  // first deadline after it, else a short stub so the bar stays visible.
  const ends = rows.map((e, i) => {
    const start = Date.parse(e.date);
    if (i + 1 < rows.length) return Date.parse(rows[i + 1].date);
    const after = dlines
      .map((d) => Date.parse(d.date))
      .filter((t) => t > start)
      .sort((a, b) => a - b)[0];
    return after ?? start + range.span * 0.05;
  });

  const todayPct =
    today > range.min && today < range.min + range.span ? pct(today) : null;

  return (
    <div className="select-none" aria-label="Project timeline Gantt chart">
      {/* Axis: min/max dates + the deadline caption, aligned with the lane. */}
      <div className="flex">
        <div style={{ width: GANTT_LABEL_PX }} className="flex-none" />
        <div className="relative h-[14px] flex-1 text-[10.5px] leading-[14px] text-faint">
          <span className="absolute left-0">{axisLabel(range.min)}</span>
          <span className="absolute right-0">
            {axisLabel(range.min + range.span)}
          </span>
          {dlines.map((d) => {
            const p = pct(Date.parse(d.date));
            // Near the range edge the caption would collide with the max
            // date label — the red line + hover tooltip carry it there.
            if (p > 85) return null;
            return (
              <span
                key={d.id}
                className="absolute whitespace-nowrap font-semibold text-risk"
                style={
                  p > 60
                    ? { right: `${100 - p + 0.75}%` }
                    : { left: `${p + 0.75}%` }
                }
              >
                Deadline
              </span>
            );
          })}
        </div>
      </div>

      {/* Rows, with the deadline verticals + today line overlaid across them. */}
      <div className="relative">
        {rows.map((event, i) => {
          const start = Date.parse(event.date);
          const end = ends[i];
          const startPct = pct(start);
          const endPct = pct(end);
          const duration = formatDuration(Math.max(end - start, 0));
          const active =
            !!event.conflictKey && event.conflictKey === hoveredKey;
          const href = `/projects/${projectId}/timeline/${event.id}`;
          const open = () => router.push(href);
          return (
            <div
              key={event.id}
              role="link"
              tabIndex={0}
              aria-label={`Open phase: ${event.label}`}
              onClick={open}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  open();
                }
              }}
              className="group/tl relative flex h-[30px] cursor-pointer items-center"
              onMouseEnter={() =>
                event.conflictKey && onEnterKey(event.conflictKey)
              }
              onMouseLeave={onLeaveKey}
            >
              <div
                className="flex-none truncate pr-3 text-[12px] font-medium text-ink group-hover/tl:text-brand"
                style={{ width: GANTT_LABEL_PX }}
                title={event.label}
              >
                {event.label}
              </div>
              <div className="relative h-full min-w-0 flex-1">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-hairline" />
                <div
                  className={clsx(
                    "absolute top-1/2 h-[10px] min-w-[3px] -translate-y-1/2 rounded-full transition-[box-shadow] duration-150",
                    active
                      ? "shadow-[0_0_0_3px_rgba(255,132,0,0.22)]"
                      : "group-hover/tl:shadow-[0_0_0_3px_rgba(255,132,0,0.22)]",
                  )}
                  style={{
                    left: `${startPct}%`,
                    width: `${Math.max(endPct - startPct, 0)}%`,
                    backgroundColor: bandColorVar[event.band],
                  }}
                >
                  <Tooltip event={event} placement="above" />
                </div>
                {/* Duration label — always OUTSIDE the bar, never on it. */}
                {endPct <= 78 ? (
                  <span
                    className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-[7px] text-[10.5px] text-faint"
                    style={{ left: `${endPct}%` }}
                  >
                    {duration}
                  </span>
                ) : startPct >= 24 ? (
                  <span
                    className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pr-[7px] text-[10.5px] text-faint"
                    style={{ right: `${100 - startPct}%` }}
                  >
                    {duration}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}

        {dlines.map((d) => (
          <div
            key={d.id}
            className="group/tl absolute bottom-0 top-0 z-[2] w-[10px] -translate-x-1/2 cursor-pointer"
            style={{ left: laneLeft(pct(Date.parse(d.date))) }}
          >
            <div className="absolute bottom-0 left-1/2 top-0 w-[2px] -translate-x-1/2 bg-risk" />
            <Tooltip event={d} placement="below" />
          </div>
        ))}

        {todayPct !== null && (
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-[1px] bg-brand opacity-70"
            style={{ left: laneLeft(todayPct) }}
            aria-hidden
          />
        )}
      </div>
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
