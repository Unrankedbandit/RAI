"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AgentApiError, analyze } from "@/lib/agent/client";
import { useProject } from "./ProjectContext";
import { ExportMemoButton } from "./ExportMemoButton";

/** Sticky header top row: eyebrow, title, run summary + action pills. */
export function ProjectHeader({ onShare }: { onShare: () => void }) {
  const { project, eyebrow, runSummary, documents } = useProject();
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Starts a fresh run with the same inputs, then follows it on /scanning. */
  const onRerun = async () => {
    setStarting(true);
    setError(null);
    try {
      const { jobId } = await analyze({
        name: project.name,
        location: project.location,
        docs: documents.map((d) => d.title),
      });
      router.push(`/scanning?job=${jobId}`);
    } catch (err) {
      setError(
        err instanceof AgentApiError
          ? err.message
          : "Couldn't start the re-run — try again.",
      );
      setStarting(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2.5">
      <div>
        <div className="mb-1.5 text-[12.5px] font-medium text-faint">{eyebrow}</div>
        <h1 className="mb-1 text-2xl font-semibold text-ink">{project.name}</h1>
        <div className="text-[15px] text-muted">{runSummary}</div>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex gap-2">
          <button
            onClick={onRerun}
            disabled={starting}
            className="rounded-full border border-hairline bg-canvas px-[15px] py-2 text-sm font-medium text-muted hover:text-ink disabled:opacity-50"
          >
            {starting ? "Starting…" : "Re-run analysis"}
          </button>
          <ExportMemoButton />
          <button
            onClick={onShare}
            className="rounded-full border border-hairline bg-canvas px-[15px] py-2 text-sm font-medium text-muted hover:text-ink"
          >
            Share
          </button>
        </div>
        {error && <div className="text-[12px] text-risk-ink">{error}</div>}
      </div>
    </div>
  );
}
