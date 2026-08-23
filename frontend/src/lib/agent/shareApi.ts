// Share endpoints (agent_backend/share.py): mint a public read-only link for
// a finished report, fetch through it, and let a gate-authenticated viewer
// claim their own copy. Mirrors client.ts conventions: the gate token rides
// as a query param via apiUrl(), bodyless requests send no content-type
// header, and fetches carry credentials:"include" as the SSO-cookie fallback.

import { AgentApiError, apiUrl } from "./client";
import type { AgentReport } from "./report";

export interface ShareLink {
  token: string;
  /** Backend-relative path ("/share/<token>") — the frontend origin serves
   *  the page, so the absolute URL is window.location.origin + this. */
  url: string;
}

export interface ClaimResult {
  ok: boolean;
  /** Fresh report id of the viewer's copy — appears in their portfolio. */
  reportId: string;
  user: string;
}

/** Mints (or reuses — the backend is idempotent per job) a share token. */
export async function createShare(jobId: string): Promise<ShareLink> {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/reports/${jobId}/share`), {
      method: "POST",
      credentials: "include",
    });
  } catch {
    throw new AgentApiError("agent backend unreachable", undefined);
  }
  if (!response.ok) {
    throw new AgentApiError(
      `POST /api/reports/${jobId}/share failed: ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as ShareLink;
}

/** PUBLIC lane — works without the gate cookie; the token is the auth. */
export async function fetchSharedReport(token: string): Promise<AgentReport> {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/share/${token}`), {
      credentials: "include",
    });
  } catch {
    throw new AgentApiError("agent backend unreachable", undefined);
  }
  if (!response.ok) {
    throw new AgentApiError(
      `GET /api/share/${token} failed: ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as AgentReport;
}

/**
 * Best-effort claim of the shared report into the viewer's portfolio.
 * Returns null on 401 — the normal case for public link viewers without a
 * gate session — and throws AgentApiError for any other failure, so the
 * caller only has to special-case "not signed in".
 */
export async function claimShare(token: string): Promise<ClaimResult | null> {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/share/${token}/claim`), {
      method: "POST",
      credentials: "include",
    });
  } catch {
    throw new AgentApiError("agent backend unreachable", undefined);
  }
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new AgentApiError(
      `POST /api/share/${token}/claim failed: ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as ClaimResult;
}
