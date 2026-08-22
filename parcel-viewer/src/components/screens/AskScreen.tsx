/**
 * Ask tab — live activity rail + grounded Q&A on a finished report.
 * Activity is the shared feed from raiApi (every analysis/ask narrates into
 * it); Ask posts a question to one report and renders the grounded answer.
 */
import { useEffect, useRef, useState } from "react";
import type { AskScreenProps } from "../../contracts/types";
import type { FeedFrame } from "../../data/raiApi";
import {
  askReport,
  fetchAnswer,
  getFeed,
  streamJob,
  subscribeFeed,
} from "../../data/raiApi";

interface Answer {
  answer: string;
  sources: string[];
  grounded: boolean;
}

/** Frame timestamp — accepts epoch ms or a parseable/ready-made string. */
function frameTime(ts: FeedFrame["ts"]): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function frameClass(kind: FeedFrame["kind"]): string {
  if (kind === "error") return "text-risk";
  if (kind === "done") return "text-strong";
  return "text-muted";
}

export function AskScreen({ platform, projects }: AskScreenProps) {
  /* ---- Activity feed (shared live log — copy on each frame so an in-place
   * growing array still re-renders) ---- */
  const [frames, setFrames] = useState<FeedFrame[]>(() => [...getFeed()]);
  useEffect(() => subscribeFeed(() => setFrames([...getFeed()])), []);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [frames.length]);

  /* ---- Ask a report ---- */
  const [pickedId, setPickedId] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  // Live data can replace the project list — fall back to the first row when
  // the remembered pick no longer exists.
  const selectedId = projects.some((p) => p.id === pickedId)
    ? pickedId
    : (projects[0]?.id ?? "");

  const submit = async () => {
    const q = question.trim();
    if (!q || !selectedId || busy) return;
    setBusy(true);
    setAnswer(null);
    setAskError(null);
    try {
      const { jobId: askId } = await askReport(selectedId, q);
      // Progress narrates into the shared feed via streamJob; here we only
      // wait for the terminal sentinel, then fetch the grounded answer.
      await new Promise<void>((resolve, reject) => {
        const abort = streamJob(askId, {
          onDone: () => {
            abort();
            resolve();
          },
          onError: (message) => {
            abort();
            reject(new Error(message));
          },
        });
      });
      setAnswer(await fetchAnswer(askId));
      setQuestion("");
    } catch (err) {
      setAskError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col p-4" data-platform={platform}>
      {/* sticky header — same bleed idiom as the other screens */}
      <div className="sticky top-0 z-10 -mx-4 bg-canvas/95 px-4 pb-3 backdrop-blur-sm">
        <header>
          <h1 className="text-[20px] font-semibold text-ink">Ask RAI</h1>
          <p className="mt-0.5 text-[11.5px] text-faint">
            Live agent activity, then ask a finished report
          </p>
        </header>
      </div>

      {/* 1 — Activity: the shared feed as a live narration log */}
      <section className="mt-1">
        <h2 className="px-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
          Activity
        </h2>
        <div
          ref={logRef}
          className="mt-2 max-h-64 overflow-y-auto rounded-2xl bg-surface-2 p-3 ring-1 ring-hairline"
          role="log"
          aria-label="Agent activity"
        >
          {frames.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-muted">
              Run due diligence on a parcel from Discover to see the agents work.
            </p>
          ) : (
            <ol className="flex flex-col gap-1">
              {frames.map((f, i) => (
                <li
                  key={i}
                  className={`font-jetbrains text-[11px] leading-snug ${frameClass(f.kind)}`}
                >
                  <span className="text-faint">{frameTime(f.ts)}</span> {f.text}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* 2 — Ask a report: pick a project, type a question, get a grounded answer */}
      <section className="mt-5">
        <h2 className="px-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
          Ask a report
        </h2>
        {projects.length === 0 ? (
          <p className="mt-2 rounded-2xl bg-surface-2 p-3 text-[12.5px] text-muted ring-1 ring-hairline">
            No reports yet — run due diligence from Discover first.
          </p>
        ) : (
          <form
            className="mt-2 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <select
              value={selectedId}
              onChange={(e) => setPickedId(e.target.value)}
              aria-label="Report to ask"
              className="min-h-11 w-full rounded-xl bg-white px-3 text-[13px] text-ink ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about this report…"
                aria-label="Ask about this report"
                enterKeyHint="send"
                className="min-h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-[13px] text-ink ring-1 ring-hairline placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <button
                type="submit"
                disabled={busy || question.trim().length === 0 || !selectedId}
                aria-label="Send"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-oxford text-white active:opacity-90 disabled:opacity-40"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 19V5" />
                  <path d="M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
          </form>
        )}

        {busy && (
          <p className="mt-3 font-jetbrains text-[11px] text-faint">
            Asking the analyst — watch Activity above…
          </p>
        )}

        {askError && (
          <div className="mt-3 rounded-xl bg-risk-soft px-3 py-2 text-[12px] text-risk">
            {askError}
          </div>
        )}

        {answer && (
          <div
            className={`mt-3 rounded-2xl p-3.5 shadow-sm ring-1 ring-hairline ${
              answer.grounded ? "bg-white" : "bg-surface-2"
            }`}
          >
            {!answer.grounded && (
              <div className="text-[10px] font-semibold uppercase tracking-wide text-watch">
                Not covered by this report
              </div>
            )}
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{answer.answer}</p>
            {answer.sources.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {answer.sources.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted ring-1 ring-hairline"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
