"use client";

import { useState } from "react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { IntakeModal } from "@/components/intake/IntakeModal";

/**
 * Slim top bar: navigation moved to the left sidebar, so the top strip carries
 * only the theme switch and the app's primary action — start a new project
 * (opens the staged intake modal; no navigation).
 */
export function TopBar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex h-[57px] flex-none items-center justify-end gap-3 border-b border-hairline bg-canvas px-8">
        <ThemeToggle />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-oxford px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 1.5v9M1.5 6h9" />
          </svg>
          Start new project
        </button>
      </div>
      <IntakeModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
