"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "@/lib/clsx";
import { bandColorVar } from "@/lib/band";
import type { TimelineEvent } from "@/lib/types";
import { useProject } from "./ProjectContext";

/**
 * Critical-path timeline — Gantt by default, strip as the alternate view.
 *
 * The section header carries a [Gantt | Strip] toggle. The Gantt (default)
 * draws one %-positioned bar per item against the min/max dates of the data;
 * the strip is the lean redesign below.
 *
 * Each milestone is a dot on the baseline plus ONE compact date chip
 * ("Oct 14") beneath it. The phase label, full date and description live
 * exclusively in the hover tooltip — no long text is ever stacked on the
 * strip, so there is nothing to overlap.
 *
 * Chips can never collide at any viewport width: the strip is measured with
 * a ResizeObserver and, walking milestones in position order, a chip is only
 * rendered when its centre sits at least CHIP_CLEAR_PX from the previously
 * shown chip (and clear of any deadline marker). Dots always render — a
 * suppressed chip's details remain one hover away. Until the first
 * measurement lands, no chips render at all (dots only), so there is no
 * first-paint overlap flash either.
 *
 * Two events sharing a `conflictKey` cross-highlight together — hovering
 * either one lights up both, even when non-adjacent.
 *
 * "You are here": there is no explicit current flag in the data, so the
 * current milestone is the LAST one whose date is today or in the past —
 * i.e. the most recently reached point on the path; if every milestone is
 * still upcoming, the FIRST upcoming one is marked instead. It gets a
 * brand-orange animate-ping ring around its (slightly larger) band-colored
 * core, matching the live-dot precedent in projects/page.tsx.
 */

/** Minimum horizontal clearance between chip centres (chip ~48px + gap). */
const CHIP_CLEAR_PX = 56;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Compact chip text from the ISO event date, e.g. "Oct 14". */
function dateChip(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const d = new Date(time);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function TimelineStrip() {
  const { timeline } = useProject();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // Default view is the Gantt; the strip stays as the alternate. Session-only
  // state — the choice is intentionally not persisted across navigation,
  // matching the rails' "not persisted on purpose" convention.
  const [view, setView] = useState<"gantt" | "strip">("gantt");

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

  const currentId = currentMilestoneId(milestones);

  // Measured strip width drives chip collision suppression. ResizeObserver
  // fires immediately on observe(), so no synchronous setState is needed.
  const stripRef = useRef<HTMLDivElement>(null);
  const [stripWidth, setStripWidth] = useState(0);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setStripWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const visibleChips = useMemo(() => {
    const visible = new Set<string>();
    if (stripWidth > 0) {
      const minGapPct = (CHIP_CLEAR_PX / stripWidth) * 100;
      const deadlineClearPct = minGapPct / 2;
      let lastShown = -Infinity;
      for (const event of milestones) {
        const nearDeadline = deadlines.some(
          (d) => Math.abs(d.position - event.position) < deadlineClearPct,
        );
        if (!nearDeadline && event.position - lastShown >= minGapPct) {
          visible.add(event.id);
          lastShown = event.position;
        }
      }
    }
    return visible;
  }, [milestones, deadlines, stripWidth]);

  return (
    <div className="relative mb-4 overflow-visible rounded-[5px] border border-hairline bg-canvas px-5 pb-4 pt-3 shadow-card">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[12px] font-medium text-faint">
          Critical path to activation — hover a{" "}
          {view === "gantt" ? "bar" : "point"} for details
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Timeline view">
          <ViewButton active={view === "gantt"} onClick={() => setView("gantt")}>
            Gantt
          </ViewButton>
          <ViewButton active={view === "strip"} onClick={() => setView("strip")}>
            Strip
          </ViewButton>
        </div>
      </div>

      {view === "gantt" ? (
        <TimelineGantt
          milestones={milestones}
          deadlines={deadlines}
          hoveredKey={hoveredKey}
          onEnterKey={setHoveredKey}
          onLeaveKey={() => setHoveredKey(null)}
        />
      ) : (
        <div ref={stripRef} className="relative mx-1 h-[54px] overflow-visible">
          <div className="absolute inset-x-0 top-[23px] h-[2px] bg-hairline" />

          {milestones.map((event) => (
            <MilestoneItem
              key={event.id}
              event={event}
              isCurrent={event.id === currentId}
              showChip={visibleChips.has(event.id)}
              active={!!event.conflictKey && event.conflictKey === hoveredKey}
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
      )}
    </div>
  );
}

function ViewButton({
  active = false,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "rounded-full px-3 py-1.5 text-xs font-medium",
        active ? "bg-oxford text-white" : "bg-surface-2 text-muted",
      )}
    >
      {children}
    </button>
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
 * carries the full detail, same as the strip).
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
  milestones,
  deadlines,
  hoveredKey,
  onEnterKey,
  onLeaveKey,
}: {
  milestones: TimelineEvent[];
  deadlines: TimelineEvent[];
  hoveredKey: string | null;
  onEnterKey: (key: string) => void;
  onLeaveKey: () => void;
}) {
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
          return (
            <div
              key={event.id}
              className="group/tl relative flex h-[30px] items-center"
              onMouseEnter={() =>
                event.conflictKey && onEnterKey(event.conflictKey)
              }
              onMouseLeave={onLeaveKey}
            >
              <div
                className="flex-none truncate pr-3 text-[12px] font-medium text-ink"
                style={{ width: GANTT_LABEL_PX }}
                title={event.label}
              >
                {event.label}
              </div>
              <div className="relative h-full min-w-0 flex-1">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-hairline" />
                <div
                  className={clsx(
                    "absolute top-1/2 h-[10px] min-w-[3px] -translate-y-1/2 cursor-pointer rounded-full transition-[box-shadow] duration-150",
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

/** Horizontal chip nudge so the first/last chips never drift past the strip
 *  edges (centered by default, pulled inward near the edges). */
function chipShift(position: number): string {
  if (position <= 8) return "translateX(-30%)";
  if (position >= 92) return "translateX(-70%)";
  return "translateX(-50%)";
}

function MilestoneItem({
  event,
  isCurrent,
  showChip,
  active,
  onEnter,
  onLeave,
}: {
  event: TimelineEvent;
  isCurrent: boolean;
  showChip: boolean;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const chip = dateChip(event.date);
  return (
    <div
      className="group/tl absolute top-[17px] z-[1] cursor-pointer hover:z-40"
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

      {/* The only persistent text on the strip: one compact date chip. */}
      {showChip && chip && (
        <div
          className={clsx(
            "absolute left-0 top-[16px] whitespace-nowrap rounded-full border px-[7px] py-px text-[10.5px] font-medium leading-[15px] transition-colors duration-150",
            active
              ? "border-risk-soft bg-risk-soft text-risk-ink"
              : isCurrent
                ? "border-hairline bg-canvas text-ink shadow-card"
                : "border-hairline bg-surface-2 text-muted",
          )}
          style={{ transform: chipShift(event.position) }}
        >
          {chip}
        </div>
      )}

      <Tooltip event={event} placement="above" isCurrent={isCurrent} />
    </div>
  );
}

function DeadlineMarker({ event }: { event: TimelineEvent }) {
  return (
    <div
      className="group/tl absolute bottom-0 top-[13px] z-[2] w-[2px] cursor-pointer bg-risk hover:z-40"
      style={{ left: `${event.position}%` }}
    >
      {/* Anchored right of the bar and ABOVE the baseline, inside the strip —
          a different lane from the date chips below the line, so the two can
          never meet. */}
      <div className="absolute right-0 top-[-13px] whitespace-nowrap text-[10.5px] font-semibold text-risk">
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
        // Milestone wrappers are dot-sized — anchor "above" tooltips just
        // over the dot (13/14px core).
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
