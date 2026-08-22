"use client";

import { useProject } from "./ProjectContext";

/** Sticky header top row: eyebrow, title, run summary + action pills. */
export function ProjectHeader({ onShare }: { onShare: () => void }) {
  const { project, eyebrow, runSummary } = useProject();

  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2.5">
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-faint">{eyebrow}</div>
        <h1 className="mb-1 text-[22px] font-semibold text-ink">{project.name}</h1>
        <div className="text-[13.5px] text-muted">{runSummary}</div>
      </div>
      <div className="flex gap-2">
        <button className="rounded-full border border-hairline bg-canvas px-[15px] py-2 text-[12.5px] font-medium text-muted hover:text-ink">
          Re-run analysis
        </button>
        <button className="rounded-full border border-hairline bg-canvas px-[15px] py-2 text-[12.5px] font-medium text-muted hover:text-ink">
          Export memo
        </button>
        <button
          onClick={onShare}
          className="rounded-full border border-hairline bg-canvas px-[15px] py-2 text-[12.5px] font-medium text-muted hover:text-ink"
        >
          Share
        </button>
      </div>
    </div>
  );
}
