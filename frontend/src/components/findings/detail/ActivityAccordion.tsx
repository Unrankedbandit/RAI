"use client";

import { useState } from "react";
import { clsx } from "@/lib/clsx";
import type { FindingActivity } from "@/lib/types";

/**
 * Activity audit trail — a disclosure row inside the unified detail
 * surface (no card chrome of its own; the chevron row IS the section
 * header). Collapsed by default; expanded events are hairline-separated
 * rows. "RAI" actors render semibold mono; timestamps align right.
 */
export function ActivityAccordion({ activity }: { activity: FindingActivity[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <span className="text-sm font-semibold text-ink">
          Activity — {activity.length} {activity.length === 1 ? "event" : "events"}
        </span>
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={clsx(
            "h-3 w-3 text-faint transition-transform",
            open && "rotate-180",
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>

      {open && (
        <div className="divide-y divide-hairline border-t border-hairline">
          {activity.map((event, i) => (
            <div
              key={i}
              className="flex items-baseline gap-3 px-6 py-2.5 text-left"
            >
              <span
                className={clsx(
                  "mono w-9 flex-none text-[12.5px] text-ink",
                  event.actor === "RAI" && "font-semibold",
                )}
              >
                {event.actor}
              </span>
              <span className="min-w-0 flex-1 text-sm text-muted">
                {event.text}
              </span>
              <span className="flex-none text-right text-[12.5px] text-faint">
                {event.timestamp}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
