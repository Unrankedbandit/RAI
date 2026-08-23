"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { AgentReport } from "./report";
import { getReport } from "./client";
import { getLiveRunRaw, subscribeLiveRuns, type LiveRun } from "./liveStore";

/** Live route ids are the backend's 12-hex job ids — the only ids
 *  getReport() can resolve directly. Slugs and mock ids are not fetched. */
const JOB_ID = /^[0-9a-f]{12}$/i;

/**
 * The raw AgentReport behind a project route, when one exists.
 *
 * Synchronous sessionStorage first (a scan this browser just ran), then —
 * for job-id-shaped route ids only — one cancellable fetch of the stored
 * backend report. Mock/demo projects have neither: report is null and every
 * consumer degrades honestly. Read through useSyncExternalStore for the same
 * SSR reason as useProjectDetail: sessionStorage does not exist on the
 * server, so the server snapshot is null and hydration swaps live data in.
 */
export function useAgentReport(projectId: string): {
  report: AgentReport | null;
  jobId: string | null;
} {
  const raw = useSyncExternalStore(
    subscribeLiveRuns,
    () => getLiveRunRaw(projectId),
    () => null, // server: never live
  );

  const live = (() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LiveRun;
    } catch {
      return null; // Corrupt entry — treat as absent.
    }
  })();

  // Share-link path: a report this browser didn't run. null records a
  // SETTLED fetch with no report, so consumers stop waiting.
  const [fetched, setFetched] = useState<{
    forId: string;
    report: AgentReport | null;
  } | null>(null);

  useEffect(() => {
    if (live || !JOB_ID.test(projectId)) return;
    let cancelled = false;
    getReport(projectId)
      .then((report) => {
        if (!cancelled) setFetched({ forId: projectId, report });
      })
      .catch(() => {
        if (!cancelled) setFetched({ forId: projectId, report: null });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, live]);

  if (live) return { report: live.report, jobId: live.jobId };
  const settled = fetched && fetched.forId === projectId ? fetched : null;
  if (settled?.report) return { report: settled.report, jobId: projectId };
  return { report: null, jobId: null };
}
