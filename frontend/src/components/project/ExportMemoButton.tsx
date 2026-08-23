"use client";

import { useState } from "react";

import { generateMemo, memoUrl } from "../../lib/agent/memoApi";
import { getLiveRun } from "../../lib/agent/liveStore";
import { useProject } from "./ProjectContext";

/**
 * Drop-in replacement for the dead "Export memo" pill in ProjectHeader —
 * identical visual, but wired to the backend memo writer. Generation is
 * LLM-speed (tens of seconds), so the pill flips to a disabled "Generating…"
 * for the duration; failures surface inline next to the pill rather than as
 * an alert, matching the rail's honest-degradation pattern.
 */
export function ExportMemoButton() {
  const { project } = useProject();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    // A live run's jobId is the report key; a mock/pre-tagged project falls
    // back to its own id (which is the report permalink key for those).
    const jobId = getLiveRun(project.id)?.jobId ?? project.id;
    try {
      await generateMemo(jobId);
      window.open(memoUrl(jobId), "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "memo export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={busy}
        className="rounded-full border border-hairline bg-canvas px-[15px] py-2 text-sm font-medium text-muted hover:text-ink disabled:opacity-60"
      >
        {busy ? "Generating…" : "Export memo"}
      </button>
      {error && <span className="text-[12px] text-risk">{error}</span>}
    </div>
  );
}
