// HTTP client for the Red Flag agent backend (agent_backend/main.py, FastAPI).
//
// In production the browser reaches the backend through the hackathon gate at
// https://rai-api.josephbissell.com, which authenticates every request. Auth
// travels as a `token` query param on each call (EventSource cannot set
// headers, so a header-based scheme would leave the job stream out), with
// `credentials: "include"` on fetches as the SSO-cookie fallback. The backend
// whitelists https://rai.josephbissell.com for CORS; other origins (local
// verification, previews) are blocked — point NEXT_PUBLIC_AGENT_API elsewhere
// (e.g. http://localhost:8000) for local dev.

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
  /** Per-run pipeline lane; omitted = the backend's PIPELINE_MODE env decides. */
  mode?: "fast" | "deep";
}

export interface PortfolioRow {
  /** The run's jobId — the report's permalink key. */
  id: string;
  project: string;
  location: string;
  readiness: number;
  decision: string;
  /** hackathon login that started the run (null on pre-tagged reports) */
  user?: string | null;
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
      // Only JSON-body requests declare content-type: a GET that sends it
      // triggers a CORS preflight, and the hackathon gate answers OPTIONS
      // with Access-Control-Allow-Origin: * — which browsers reject for
      // credentialed requests, so the GET would never be sent. Bodyless
      // GETs stay CORS-safelisted "simple requests" and pass the gate.
      headers: init?.body
        ? { "content-type": "application/json", ...init?.headers }
        : { ...init?.headers },
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

/* ---------- Human review (approve / reject a finished report) ---------- */

export type ReviewStatus =
  | "AWAITING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "NOT_TRACKED";

export interface ReviewRecord {
  status: ReviewStatus;
  reviewedBy: string | null;
  /** ISO timestamp, null until decided. */
  reviewedAt: string | null;
  rationale: string | null;
}

/**
 * Thrown on HTTP 409 — the report was already decided. Carries the existing
 * record when the server includes one in the error body, so the UI can say
 * "already decided by X" without a second round-trip.
 */
export class ReviewConflictError extends AgentApiError {
  constructor(
    message: string,
    readonly existing?: ReviewRecord,
  ) {
    super(message, 409);
    this.name = "ReviewConflictError";
  }
}

/**
 * Fetches the review state for a report. Returns null — rather than throwing —
 * when the endpoint is unreachable or the report is unknown (404), so the
 * review UI simply hides itself, mirroring the mock-data degradation policy.
 */
export async function getReview(reportId: string): Promise<ReviewRecord | null> {
  try {
    return await request<ReviewRecord>(`/api/reports/${reportId}/review`);
  } catch (error) {
    if (
      error instanceof AgentApiError &&
      (error.status === undefined || error.status === 404)
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Records a human decision on a report. Pass `override: true` to replace an
 * existing decision (server returns 409 without it). Throws
 * ReviewConflictError on 409 so callers can offer the override affordance.
 */
export async function submitReview(
  reportId: string,
  decision: "APPROVED" | "REJECTED",
  reviewer: string,
  rationale?: string,
  override?: boolean,
): Promise<ReviewRecord> {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/reports/${reportId}/review`), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision,
        reviewer,
        ...(rationale ? { rationale } : {}),
        ...(override ? { override: true } : {}),
      }),
    });
  } catch {
    throw new AgentApiError(`agent backend unreachable at ${AGENT_API}`, undefined);
  }

  if (response.status === 409) {
    // The conflict body may carry the existing record; parse leniently.
    let existing: ReviewRecord | undefined;
    try {
      const body = (await response.json()) as Partial<ReviewRecord>;
      if (typeof body.status === "string") existing = body as ReviewRecord;
    } catch {
      // No usable body — the caller falls back to a plain conflict message.
    }
    throw new ReviewConflictError(
      `POST /api/reports/${reportId}/review failed: 409`,
      existing,
    );
  }
  if (!response.ok) {
    throw new AgentApiError(
      `POST /api/reports/${reportId}/review failed: ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as ReviewRecord;
}

export function listProjects(): Promise<PortfolioRow[]> {
  return request<PortfolioRow[]>("/api/projects");
}

/* ---------- Grid proximity (GRID V1 contract §2) ---------- */

export type GridBucket = "near" | "moderate" | "far" | "remote";

export interface GridPoint {
  lat: number;
  lng: number;
}

/** The screening-relevant nearest asset — what the rail chip and the map
 *  connector describe. `closest` is optional: the contract shows it on
 *  transmission/substation, but the connector brief reads it off access, so
 *  both spellings are accepted (gridAccessClosest resolves). */
export interface GridAccess {
  kind: "substation" | "transmission";
  distance_m: number;
  distance_mi: number;
  bucket: GridBucket;
  label: string;
  closest?: GridPoint | null;
}

/** Required physical hookup for the parcel (GRID V1 §2b). `substation` =
 *  gen-tie to an existing substation bus; `line-tap` = new tap switchyard at
 *  the line + gen-tie spur; `none` = nothing mapped in screening range.
 *  Optional: older backends without the field just don't render the block. */
export interface GridHookup {
  method: "substation" | "line-tap" | "none";
  gentie_mi: number | null;
  tap_point: GridPoint | null;
  summary: string;
  detail: string;
  alternative: string | null;
}

export interface GridNearest {
  transmission: { closest?: GridPoint | null } | null;
  substation: { closest?: GridPoint | null } | null;
  access: GridAccess | null;
  hookup?: GridHookup | null;
  disclaimer: string;
}

/** The point a parcel→grid connector draws to: access.closest when present,
 *  else the closest of the access.kind asset. Null = no connector. */
export function gridAccessClosest(n: GridNearest): GridPoint | null {
  const a = n.access;
  if (!a) return null;
  return (
    a.closest ??
    (a.kind === "substation"
      ? (n.substation?.closest ?? null)
      : (n.transmission?.closest ?? null))
  );
}

/**
 * Nearest mapped grid infrastructure to a point. Returns null — never
 * throws — on any failure (silent degradation per contract §4: no chip, no
 * connector, the tile overlay is unaffected).
 */
export async function getGridNearest(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<GridNearest | null> {
  try {
    return await request<GridNearest>(
      `/api/grid/nearest?lat=${lat}&lng=${lng}`,
      { signal },
    );
  } catch {
    return null;
  }
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
      /** Structured payload passthrough (e.g. job.mode's {"mode": "deep"}). */
      data?: Record<string, unknown>;
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
    /** Gate frames carry gaps/timeoutS/mode/approved (parseGateFrame narrows);
     *  any other frame's payload rides along as an open record. */
    data?: Record<string, unknown>;
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
          data: typeof ev.data === "object" && ev.data !== null ? (ev.data as Record<string, unknown>) : undefined,
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
