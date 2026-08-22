// HTTP client for the Red Flag agent backend (agent_backend/main.py, FastAPI).
//
// In production the browser reaches the backend through the hackathon gate at
// https://rai-api.josephbissell.com, which authenticates every request. Auth
// travels as a `token` query param on each call (EventSource cannot set
// headers, so a header-based scheme would leave the job stream out), with
// `credentials: "include"` on fetches as the SSO-cookie fallback. Point
// NEXT_PUBLIC_AGENT_API elsewhere (e.g. http://localhost:8000) for local dev.

import type { AgentReport } from "./report";

export const AGENT_API =
  process.env.NEXT_PUBLIC_AGENT_API ?? "https://rai-api.josephbissell.com";

/** The hackathon gate's shared read token — sent as a query param
 * (EventSource can't set headers). */
const GATE_TOKEN = "fwk_r_150d6c7cd1370d88868bef84";

/** Appends the gate token to any URL, preserving existing query params. */
export const withGateToken = (url: string): string =>
  `${url}${url.includes("?") ? "&" : "?"}token=${GATE_TOKEN}`;

/** Builds an authenticated backend URL for a path like "/api/projects". */
export const apiUrl = (path: string): string =>
  withGateToken(`${AGENT_API}${path}`);

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
    response = await fetch(apiUrl(path), {
      credentials: "include",
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
  | {
      /** Structured trace event ({"event": {kind, msg, agent?, ...}}). The
       *  backend may attach model/tier fields — those are deliberately NOT
       *  forwarded; the UI must never render model names. */
      kind: "trace";
      agent?: string;
      phase?: string;
      msg: string;
      level?: string;
      eventKind?: string;
    }
  | { kind: "gate_review"; gaps: GateGap[]; timeoutS: number }
  | { kind: "gate_resolved"; mode: "approved" | "timeout"; approved: string[] }
  | { kind: "done" }
  | { kind: "error"; message: string };

/** One gap surfaced for human review at the mid-run gate (gate.gap_review). */
export interface GateGap {
  id: string;
  title: string;
  detail?: string;
  severity?: string;
}

/** Trace-event frames arrive wrapped: {"event": {kind, msg, level, ts, agent?, phase?, data?}}. */
type TraceFrame = {
  event?: {
    kind?: string;
    msg?: unknown;
    level?: unknown;
    agent?: unknown;
    phase?: unknown;
    data?: {
      gaps?: unknown;
      timeoutS?: unknown;
      mode?: unknown;
      approved?: unknown;
    };
  };
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function toGateGap(value: unknown): GateGap | null {
  if (typeof value !== "object" || value === null) return null;
  const gap = value as Record<string, unknown>;
  if (typeof gap.id !== "string" || typeof gap.title !== "string") return null;
  return {
    id: gap.id,
    title: gap.title,
    detail: typeof gap.detail === "string" ? gap.detail : undefined,
    severity: typeof gap.severity === "string" ? gap.severity : undefined,
  };
}

/**
 * Translate a gate trace event into a JobStatus, or return null when the frame
 * isn't a gate event the UI knows how to handle.
 */
function parseGateFrame(frame: TraceFrame): JobStatus | null {
  const { kind, data } = frame.event ?? {};
  if (kind === "gate.gap_review") {
    const gaps = Array.isArray(data?.gaps)
      ? data.gaps.map(toGateGap).filter((g): g is GateGap => g !== null)
      : [];
    const timeoutS =
      typeof data?.timeoutS === "number" && data.timeoutS > 0
        ? data.timeoutS
        : 0;
    return { kind: "gate_review", gaps, timeoutS };
  }
  if (kind === "gate.resolved") {
    const mode = data?.mode === "timeout" ? "timeout" : "approved";
    const approved = isStringArray(data?.approved) ? data.approved : [];
    return { kind: "gate_resolved", mode, approved };
  }
  return null;
}

/**
 * Answers the mid-run gap-review gate: POSTs the subset of gap ids the swarm
 * should chase ([] = chase none). Throws AgentApiError with status 409 when
 * the job is no longer awaiting review (already resolved).
 */
export async function resumeJob(jobId: string, approved: string[]): Promise<void> {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/jobs/${jobId}/resume`), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved }),
    });
  } catch {
    throw new AgentApiError(`agent backend unreachable at ${AGENT_API}`, undefined);
  }
  if (!response.ok) {
    throw new AgentApiError(
      `POST /api/jobs/${jobId}/resume failed: ${response.status}`,
      response.status,
    );
  }
}

/**
 * Subscribes to the agent's status narration.
 *
 * The backend emits `{"status": "..."}` frames and terminates with the
 * sentinel strings `__DONE__` or `__ERROR__ <message>`; both are translated
 * here so callers never parse sentinels themselves.
 *
 * The stream is replayable — pass `?from_idx=N` to re-read from frame N — so
 * multiple subscribers to the same job each get the full narration rather
 * than stealing frames from one another.
 *
 * Returns an unsubscribe function.
 */
export function streamJob(
  jobId: string,
  onEvent: (event: JobStatus) => void,
): () => void {
  const source = new EventSource(apiUrl(`/api/jobs/${jobId}/stream`), {
    withCredentials: true,
  });

  const close = () => source.close();

  source.onmessage = (message) => {
    let frame: { status?: string } & TraceFrame;
    try {
      frame = JSON.parse(message.data) as { status?: string } & TraceFrame;
    } catch {
      return; // A frame we cannot parse is dropped, never fatal.
    }

    // Trace-event frames ({"event": {kind, ...}}): the mid-run review gate
    // has its own contract; everything else is forwarded as a generic trace
    // so the run view can attribute activity to an agent box (or, when the
    // frame names no agent, file it under the ambient run log).
    if (frame.event) {
      const gate = parseGateFrame(frame);
      if (gate) {
        onEvent(gate);
        return;
      }
      const ev = frame.event;
      if (typeof ev.msg === "string" && ev.msg) {
        onEvent({
          kind: "trace",
          agent: typeof ev.agent === "string" ? ev.agent : undefined,
          phase: typeof ev.phase === "string" ? ev.phase : undefined,
          msg: ev.msg,
          level: typeof ev.level === "string" ? ev.level : undefined,
          eventKind: typeof ev.kind === "string" ? ev.kind : undefined,
        });
      }
      return;
    }

    const status = frame.status;
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
