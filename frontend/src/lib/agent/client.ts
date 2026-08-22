// HTTP client for the Red Flag agent backend (agent_backend/main.py, FastAPI).
//
// The backend runs as a separate process — `uvicorn agent_backend.main:app` on
// port 8000 by default — and sets CORS to allow any origin, so the browser
// talks to it directly. Point NEXT_PUBLIC_AGENT_API elsewhere to move it.

import type { AgentReport } from "./report";

export const AGENT_API =
  process.env.NEXT_PUBLIC_AGENT_API ?? "http://localhost:8000";

export interface AnalyzeRequest {
  name: string;
  location: string;
  /** Document filenames the pipeline should read. */
  docs: string[];
}

export interface PortfolioRow {
  project: string;
  location: string;
  readiness: number;
  decision: string;
  dimensions: { name: string; rag: string; score: number; flags: string[] }[];
}

/** Thrown for any non-2xx, so callers can fall back to mock data on failure. */
export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AgentApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${AGENT_API}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    // Backend not running is the common case in local dev, and it must not be
    // a crash — every caller degrades to mock data instead.
    throw new AgentApiError(`agent backend unreachable at ${AGENT_API}`, undefined);
  }

  if (!response.ok) {
    throw new AgentApiError(
      `${init?.method ?? "GET"} ${path} failed: ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

/** Starts a pipeline run. Returns immediately — the run takes minutes. */
export function analyze(body: AnalyzeRequest): Promise<{ jobId: string }> {
  return request<{ jobId: string }>("/api/projects/analyze", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getReport(jobId: string): Promise<AgentReport> {
  return request<AgentReport>(`/api/reports/${jobId}`);
}

export function listProjects(): Promise<PortfolioRow[]> {
  return request<PortfolioRow[]>("/api/projects");
}

/** One grounded answer from the analyst, with the findings it leaned on. */
export interface ChatAnswer {
  answer: string;
  sources: string[];
  /** False when the report does not cover the question — the rail says so
   *  rather than presenting an improvised answer as fact. */
  grounded: boolean;
}

/**
 * Asks a question about a finished report. Returns its own job id; progress is
 * narrated on the same SSE endpoint the scan uses, then the answer is fetched
 * with getAnswer(). Two calls rather than one so a slow answer can show
 * progress instead of an idle spinner.
 */
export function askQuestion(
  reportId: string,
  question: string,
): Promise<{ jobId: string }> {
  return request<{ jobId: string }>(`/api/reports/${reportId}/ask`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

export function getAnswer(askId: string): Promise<ChatAnswer> {
  return request<ChatAnswer>(`/api/asks/${askId}`);
}

/** True when the backend answers. Used to choose live data over mock. */
export async function isBackendUp(): Promise<boolean> {
  try {
    await listProjects();
    return true;
  } catch {
    return false;
  }
}

export type JobStatus =
  | { kind: "status"; message: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * Subscribes to the agent's status narration.
 *
 * The backend emits `{"status": "..."}` frames and terminates with the
 * sentinel strings `__DONE__` or `__ERROR__ <message>`; both are translated
 * here so callers never parse sentinels themselves.
 *
 * Note the backend drains a single asyncio.Queue per job, so a second
 * subscriber to the same job would steal frames — one listener per job.
 *
 * Returns an unsubscribe function.
 */
export function streamJob(
  jobId: string,
  onEvent: (event: JobStatus) => void,
): () => void {
  const source = new EventSource(`${AGENT_API}/api/jobs/${jobId}/stream`);

  const close = () => source.close();

  source.onmessage = (message) => {
    let status: string;
    try {
      status = (JSON.parse(message.data) as { status: string }).status;
    } catch {
      return; // A frame we cannot parse is dropped, never fatal.
    }
    if (typeof status !== "string") return; // Well-formed frame, wrong shape.

    if (status.startsWith("__DONE__")) {
      onEvent({ kind: "done" });
      close();
      return;
    }
    if (status.startsWith("__ERROR__")) {
      onEvent({ kind: "error", message: status.replace("__ERROR__", "").trim() });
      close();
      return;
    }
    onEvent({ kind: "status", message: status });
  };

  source.onerror = () => {
    // EventSource retries on its own; a closed stream after __DONE__ also
    // lands here, so this is only fatal if nothing arrived at all.
    if (source.readyState === EventSource.CLOSED) {
      onEvent({ kind: "error", message: "stream closed" });
    }
  };

  return close;
}
