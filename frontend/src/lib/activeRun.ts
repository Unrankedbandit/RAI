/** Cross-page "a run is in flight" marker. sessionStorage: the badge on other
 * pages needs it, and it dies with the tab — the right lifetime for a demo run. */

export const ACTIVE_RUN_KEY = "rai.activeRun";

export function setActiveRun(jobId: string): void {
  try {
    sessionStorage.setItem(ACTIVE_RUN_KEY, jobId);
  } catch {
    /* private mode etc. — badge simply won't show */
  }
}

export function clearActiveRun(): void {
  try {
    sessionStorage.removeItem(ACTIVE_RUN_KEY);
  } catch {
    /* ignore */
  }
}

export function getActiveRun(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(ACTIVE_RUN_KEY);
  } catch {
    return null;
  }
}
