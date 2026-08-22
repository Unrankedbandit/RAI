import { useEffect, useState } from "react";
import type { ScanScreenProps } from "../../contracts/types";

const STEPS = [
  "Reading project documents",
  "Checking the public record",
  "Cross-checking claims",
  "Scoring readiness",
  "Drafting findings",
] as const;

/** Fake uploads shown once the simulated scan starts. */
const DOCS = ["feasibility_study.pdf", "site_control_letter.docx"];

type Phase = "idle" | "running" | "done";

function CheckGlyph({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5l3.5 3.5L13 4.5" />
    </svg>
  );
}

/** Full-screen takeover: start a new project by uploading documents. */
export function ScanScreen({ platform, onClose }: ScanScreenProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  /** Index of the active step; === STEPS.length once every step is complete. */
  const [step, setStep] = useState(0);

  // NOTE: simulation only — these timers mock the scan pipeline for the
  // mockup; no real upload or analysis ever happens.
  useEffect(() => {
    if (phase !== "running") return;
    const timer = setInterval(() => {
      setStep((s) => Math.min(s + 1, STEPS.length));
    }, 1100);
    return () => clearInterval(timer); // cleaned up on unmount/close
  }, [phase]);

  useEffect(() => {
    if (phase === "running" && step >= STEPS.length) setPhase("done");
  }, [phase, step]);

  const start = () => {
    setStep(0);
    setPhase("running");
  };

  return (
    <div className="flex h-full flex-col bg-canvas" data-platform={platform}>
      {/* top bar */}
      <header className="flex h-14 flex-none items-center border-b border-hairline px-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors active:bg-surface-2"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
        <div className="flex-1 text-center text-[15px] font-semibold text-ink">New project</div>
        <div className="h-11 w-11" aria-hidden="true" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {phase === "idle" && (
          <div className="flex h-full flex-col justify-center">
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-hairline px-6 py-10 text-center">
              <svg
                viewBox="0 0 16 16"
                className="h-7 w-7 text-ink"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 10V2.5M8 2.5L4.8 5.7M8 2.5l3.2 3.2" />
                <path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
              </svg>
              <div className="text-[14px] font-semibold text-ink">Drop documents to begin</div>
              <div className="text-[11px] text-faint">PDF, DOCX, XLSX — one or several</div>
              <button
                type="button"
                onClick={() => {
                  /* no-op in mockup — real picker wired in production */
                }}
                className="mt-2 rounded-full bg-oxford px-5 py-2.5 text-[12px] font-medium text-white"
              >
                Browse files
              </button>
            </div>
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={start}
                className="flex min-h-11 items-center px-4 text-[12px] text-muted underline underline-offset-2"
              >
                Simulate upload →
              </button>
            </div>
          </div>
        )}

        {phase === "running" && (
          <div>
            {/* fake uploaded docs, appear at start of the simulated scan */}
            <div className="flex flex-wrap gap-2">
              {DOCS.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[11px] text-muted"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3 w-3 flex-none text-faint"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 1.5h5l3 3v10H4z M9 1.5v3h3" />
                  </svg>
                  <span className="font-jetbrains text-[10.5px]">{d}</span>
                  <span className="text-faint">· Analyzed</span>
                </span>
              ))}
            </div>

            {/* quiet stage tracker */}
            <ol className="mt-6 flex flex-col">
              {STEPS.map((label, i) => {
                const state = i < step ? "done" : i === step ? "active" : "pending";
                return (
                  <li key={label} className="flex items-center gap-3 py-2">
                    <span
                      className={`flex h-7 w-7 flex-none items-center justify-center rounded-full ${
                        state === "done"
                          ? "bg-strong-soft text-strong"
                          : state === "active"
                            ? "bg-brand-soft text-brand"
                            : "bg-surface-2 text-faint"
                      }`}
                    >
                      {state === "done" ? (
                        <CheckGlyph className="h-3.5 w-3.5" />
                      ) : state === "active" ? (
                        <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
                      ) : (
                        <span className="font-jetbrains text-[11px]">{i + 1}</span>
                      )}
                    </span>
                    <span
                      className={`text-[13px] ${
                        state === "active"
                          ? "font-medium text-ink"
                          : state === "done"
                            ? "text-muted"
                            : "text-faint"
                      }`}
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>

            {/* live status line, appears once cross-checking has run */}
            {step > 2 && (
              <div className="mt-4 font-jetbrains text-[11px] text-muted">
                2 contradictions found so far · live source check in progress
              </div>
            )}
          </div>
        )}

        {phase === "done" && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-strong-soft text-strong">
              <CheckGlyph className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-[20px] font-semibold text-ink">Diligence complete</h2>
            <p className="mt-1.5 text-[12px] text-muted">
              Readiness <span className="font-jetbrains">62/100</span> ·{" "}
              <span className="font-jetbrains">2</span> contradictions need review
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 min-h-11 w-full rounded-full bg-oxford text-[13px] font-medium text-white"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
