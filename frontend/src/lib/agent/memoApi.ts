// Memo export calls for the agent backend (agent_backend/memo.py).
//
// POST generates the standalone HTML memo on the server (LLM-written, can
// take a while and can 502 — the backend never fakes one); GET serves the
// generated file, so the button opens memoUrl() in a new tab after a
// successful generate.

import { AGENT_API, AgentApiError, apiUrl } from "./client";

/**
 * Generates the memo for a report. Throws AgentApiError on any non-2xx,
 * surfacing the backend's `detail` (the 502 body carries WHY the writer
 * failed — missing key, bridge error, or non-HTML output).
 */
export async function generateMemo(jobId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/reports/${jobId}/memo`), {
      method: "POST",
      credentials: "include",
      // No body → no content-type header: keeps the request CORS-safelisted
      // through the hackathon gate, same convention as client.ts request().
    });
  } catch {
    throw new AgentApiError(`agent backend unreachable at ${AGENT_API}`, undefined);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Non-JSON error body — the status line alone still names the failure.
    }
    throw new AgentApiError(
      `POST /api/reports/${jobId}/memo failed: ${response.status}${detail ? ` — ${detail}` : ""}`,
      response.status,
    );
  }
}

/** URL of the generated memo document (404 until generateMemo succeeds). */
export function memoUrl(jobId: string): string {
  return apiUrl(`/api/reports/${jobId}/memo`);
}
