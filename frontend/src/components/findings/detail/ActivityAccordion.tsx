"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { clsx } from "@/lib/clsx";
import type { FindingActivity } from "@/lib/types";

/**
 * Activity audit trail — collapsed by default, sits directly under the
 * field grid. "RAI" actors render bold in jetbrains; timestamps align right.
 */
export function ActivityAccordion({ activity }: { activity: FindingActivity[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Card padded={false}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
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
        <div className="border-t border-hairline px-5 py-3">
          {activity.map((event, i) => (
            <div
              key={i}
              className="flex items-baseline gap-3 py-2 text-left"
            >
              <span
                className={clsx(
                  "w-9 flex-none font-jetbrains text-[12.5px] text-ink",
                  event.actor === "RAI" && "font-bold",
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
    </Card>
  );
}
