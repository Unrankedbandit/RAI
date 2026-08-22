import { useEffect, useRef, useState } from "react";
import { registry } from "../../registry";
import { scoreVerdict } from "../../contracts/colors";
import type { HandoffOverlayProps } from "../../contracts/types";
import {
  startAnalysis,
  streamJob,
  fetchReport,
  type RaiReport,
} from "../../data/raiApi";

/**
 * The discovery→diligence seam (site-map principle 5: one funnel, not two
 * products), now wired to the REAL RAI agent loop: create a project from the
 * parcel → stream the agent's live narration over SSE → render the finished
 * report card → hand off to web for deep review.
 *
 * The "Continue on web" button opens the REAL RAI web demo — the seam is
 * literally clickable across the two public URLs.
 */
const WEB_APP_URL = "https://rai.josephbissell.com";

/** Nine agent phases collapsed to five plain-English steps (principle 1). */
const STAGES = [
  "Reading project documents",
  "Checking the public record",
  "Cross-checking claims",
  "Scoring readiness",
  "Drafting findings",
] as const;

type Phase = "running" | "done" | "error";

/** RAG → brand status chips (two-palette doctrine: no red/green in UI). */
const RAG_CHIP: Record<RaiReport["dimensions"][number]["rag"], string> = {
  red: "bg-risk-soft text-risk",
  amber: "bg-watch-soft text-watch",
  green: "bg-strong-soft text-strong",
};

const DECISION_CHIP: Record<RaiReport["decision"], string> = {
  Proceed: "bg-strong-soft text-strong",
  Investigate: "bg-brand-soft text-brand",
  Hold: "bg-risk-soft text-risk",
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function HandoffOverlay({ parcel, open, onClose }: HandoffOverlayProps) {
  const [phase, setPhase] = useState<Phase>("running");
  const [stage, setStage] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [report, setReport] = useState<RaiReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Session token: stale callbacks from a superseded run are ignored. */
  const sessionRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !parcel) return;
    const session = ++sessionRef.current;
    const alive = () => sessionRef.current === session;
    let abortStream: (() => void) | null = null;
    let cancelled = false;
    let frames = 0;

    setPhase("running");
    setStage(0);
    setLines([]);
    setJobId(null);
    setReport(null);
    setError(null);

    const pushLine = (text: string) => {
      if (!alive()) return;
      setLines((prev) => [...prev.slice(-59), text]);
      // Heuristic stage check-off: one stage per ~2 narration frames.
      frames += 1;
      if (frames % 2 === 0) setStage((s) => Math.min(s + 1, STAGES.length));
    };

    startAnalysis({ name: parcel.apn, location: parcel.county, docs: [] })
      .then(({ jobId: id }) => {
        if (cancelled || !alive()) return;
        setJobId(id);
        abortStream = streamJob(id, {
          onStatus: pushLine,
          onEvent: pushLine,
          onDone: () => {
            if (!alive()) return;
            setStage(STAGES.length);
            fetchReport(id)
              .then((r) => {
                if (!alive()) return;
                setReport(r);
                setPhase("done");
              })
              .catch((err) => {
                if (!alive()) return;
                setError(errorMessage(err));
                setPhase("error");
              });
          },
          onError: (message) => {
            if (!alive()) return;
            setError(message);
            setPhase("error");
          },
        });
      })
      .catch((err) => {
        if (cancelled || !alive()) return;
        setError(errorMessage(err));
        setPhase("error");
      });

    return () => {
      cancelled = true;
      abortStream?.();
    };
  }, [open, parcel]);

  // Keep the narration log pinned to the latest frame.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!open || !parcel) return null;

  const ScorePill = registry.scorePill;
  const visibleLines = lines.slice(-6);

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-canvas">
      {/* header */}
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="text-[11px] font-semibold tracking-[0.18em] text-brand uppercase">
          {phase === "done"
            ? "Diligence report"
            : phase === "error"
              ? "Analysis failed"
              : "Diligence running"}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to map"
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors active:bg-select"
        >
          <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {phase === "error" ? (
          /* honest inline error — never fake success */
          <div className="mt-6 rounded-2xl bg-surface-2 p-4 ring-1 ring-hairline">
            <div className="text-sm font-semibold text-ink">Analysis failed</div>
            <p className="mt-2 break-words font-jetbrains text-[11px] text-muted">
              {error}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-full py-3 text-sm font-medium text-muted ring-1 ring-hairline transition-colors active:bg-select"
            >
              Back to map
            </button>
          </div>
        ) : phase === "done" && report ? (
          <>
            {/* report card — labeled with what the backend actually analyzed */}
            <div className="mt-2 rounded-2xl bg-surface-2 p-4 ring-1 ring-hairline">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">
                    {report.project}
                  </div>
                  <div className="font-jetbrains text-[11px] text-muted">
                    {report.location}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${DECISION_CHIP[report.decision] ?? "bg-brand-soft text-brand"}`}
                >
                  {report.decision}
                </span>
              </div>

              {/* readiness gauge */}
              <div className="mt-4 flex items-center gap-3">
                <span className="font-jetbrains text-4xl font-semibold leading-none text-ink">
                  {Math.round(report.readiness)}
                  <span className="text-lg text-faint">/100</span>
                </span>
                <ScorePill score={report.readiness} size="lg" />
              </div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Readiness
              </div>

              {/* RAG dimensions */}
              <ol className="mt-4 space-y-2">
                {report.dimensions.map((d) => (
                  <li key={d.name} className="flex items-center gap-2">
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 font-jetbrains text-[10px] font-semibold uppercase ${RAG_CHIP[d.rag] ?? "bg-strong-soft text-strong"}`}
                    >
                      {d.rag}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">
                      {d.name}
                    </span>
                    <span className="shrink-0 font-jetbrains text-[11px] text-muted">
                      {Math.round(d.score)}
                    </span>
                  </li>
                ))}
              </ol>

              <p className="mt-4 font-jetbrains text-[11px] text-muted">
                {report.action_pack.rfis.length} RFI
                {report.action_pack.rfis.length === 1 ? "" : "s"} issued
              </p>
              {report.recommended_next_action && (
                <p className="mt-1 text-[11px] text-faint">
                  Next: {report.recommended_next_action}
                </p>
              )}

              <button
                type="button"
                onClick={onClose}
                className="mt-4 block w-full rounded-full bg-brand py-3 text-center text-sm font-semibold text-canvas"
              >
                View findings →
              </button>
            </div>

            {/* handoff card */}
            <div className="mt-4 rounded-2xl bg-oxford p-4 text-canvas">
              <div className="text-sm font-semibold">Deep review continues on web</div>
              <p className="mt-1 text-xs text-canvas/70">
                Upload the full dossier, review contradictions, and action findings
                from the primary surface.
              </p>
              {jobId && (
                <div className="mt-3 inline-flex items-center rounded-full bg-canvas/10 px-3 py-1 font-jetbrains text-[11px] text-canvas/90">
                  job {jobId}
                </div>
              )}
              <a
                href={WEB_APP_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block w-full rounded-full bg-brand py-3 text-center text-sm font-semibold text-canvas"
              >
                Continue on web →
              </a>
            </div>
          </>
        ) : (
          <>
            {/* the parcel became the project's first evidence item */}
            <div className="mt-2 rounded-2xl bg-surface-2 p-4 ring-1 ring-hairline">
              <div className="flex items-center gap-3">
                <ScorePill score={parcel.score} size="md" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">
                    {parcel.address}
                  </div>
                  <div className="font-jetbrains text-[11px] text-muted">
                    {parcel.apn} · {parcel.acres} ac · {parcel.county} County
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-faint">
                Parcel score ({parcel.score} — {scoreVerdict(parcel.score).toLowerCase()})
                attached as the project's first live-sourced fact.
              </p>
            </div>

            {/* quiet stage tracker — checks off as real narration arrives */}
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Due diligence running
              </h3>
              <ol className="mt-3 space-y-3">
                {STAGES.map((label, i) => {
                  const done = stage > i;
                  const active = stage === i;
                  return (
                    <li key={label} className="flex items-center gap-3">
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                          done
                            ? "bg-strong-soft text-strong"
                            : active
                              ? "bg-brand-soft text-brand"
                              : "bg-surface-2 text-faint ring-1 ring-hairline"
                        }`}
                      >
                        {done ? (
                          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
                            <path d="M2 6.5l2.5 2.5L10 3.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          i + 1
                        )}
                      </span>
                      <span
                        className={`text-sm ${
                          done ? "text-muted" : active ? "font-medium text-ink" : "text-faint"
                        }`}
                      >
                        {label}
                        {active && "…"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* live agent narration — real SSE text from the backend */}
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Agent log
                </h3>
                {jobId && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 font-jetbrains text-[10px] text-faint ring-1 ring-hairline">
                    job {jobId}
                  </span>
                )}
              </div>
              <div
                ref={logRef}
                className="mt-2 max-h-32 overflow-y-auto rounded-xl bg-surface-2 p-3 ring-1 ring-hairline"
              >
                {visibleLines.length === 0 ? (
                  <p className="font-jetbrains text-[11px] text-faint">
                    Connecting to the agent…
                  </p>
                ) : (
                  visibleLines.map((line, i) => (
                    <p
                      key={`${lines.length - visibleLines.length + i}`}
                      className={`font-jetbrains text-[11px] leading-5 ${
                        i === visibleLines.length - 1 ? "text-ink" : "text-muted"
                      }`}
                    >
                      {line}
                    </p>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {phase === "running" && (
        <button
          type="button"
          onClick={onClose}
          className="mx-4 mb-4 rounded-full py-3 text-sm font-medium text-muted ring-1 ring-hairline transition-colors active:bg-select"
        >
          Back to map
        </button>
      )}
    </div>
  );
}
