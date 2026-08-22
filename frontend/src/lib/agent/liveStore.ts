// Carries a finished agent report from the scanning page to the project view.
//
// sessionStorage rather than a React context because the two live on different
// routes and the scan ends in a navigation — a provider would unmount before
// the destination mounts. Cleared when the tab closes, which is the right
// lifetime for a demo run.

import type { AgentReport } from "./report";

const KEY = "solarhack.liveReports";

export interface LiveRun {
  jobId: string;
  projectId: string;
  report: AgentReport;
  finishedAt: string;
}

/** "Solar Alpha" -> "solar-alpha", matching the ids mockData already uses. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function readAll(): Record<string, LiveRun> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}") as Record<
      string,
      LiveRun
    >;
  } catch {
    return {};
  }
}

export function saveLiveRun(run: LiveRun): void {
  if (typeof window === "undefined") return;
  const all = readAll();
  all[run.projectId] = run;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Quota exceeded on a large report. The project view falls back to mock
    // data rather than failing the run.
  }
}

export function getLiveRun(projectId: string): LiveRun | undefined {
  return readAll()[projectId];
}

/**
 * The stored run as its raw JSON string, or null.
 *
 * A string rather than an object so useSyncExternalStore can compare
 * successive snapshots by value — returning a fresh object each read would
 * make it re-render forever.
 */
export function getLiveRunRaw(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  const run = readAll()[projectId];
  return run ? JSON.stringify(run) : null;
}

/** sessionStorage only fires `storage` in *other* tabs, so this rarely fires.
 *  It exists to satisfy the store contract and to pick up cross-tab runs. */
export function subscribeLiveRuns(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function listLiveRuns(): LiveRun[] {
  return Object.values(readAll());
}
