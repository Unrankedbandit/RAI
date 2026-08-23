"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { clsx } from "@/lib/clsx";
import { AgentApiError, resumeJob } from "@/lib/agent/client";
import type { GapItem } from "@/lib/scan/scanEvents";
import type { GateResolution } from "@/lib/scan/scanState";

type GapReviewCardProps = {
  /** Null for the mock/demo scan — there is no backend to answer the POST. */
  jobId: string | null;
  gaps: GapItem[];
  timeoutS: number;
  /** Set when the backend emits gate.resolved; null while the gate is open. */
  resolved: GateResolution | null;
};

type SubmitState = "idle" | "submitting" | "submitted" | "error" | "conflict";

function severityClass(severity?: string): string {
  const s = severity?.toLowerCase();
  if (s === "high" || s === "critical") return "bg-risk-soft text-risk-ink";
  if (s === "medium" || s === "moderate") return "bg-watch-soft text-watch-ink";
  return "bg-strong-soft text-strong-ink";
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Mid-run human-approval gate. The pipeline paused after the first research
 * step; the human ticks which gaps the swarm should chase and proceeds, or the
 * server-side timeout elapses and every gap is chased. Renders nothing until
 * gate.gap_review arrives, and collapses to a single summary line once
 * gate.resolved lands — a pure additive feature.
 */
export function GapReviewCard({
  jobId,
  gaps,
  timeoutS,
  resolved,
}: GapReviewCardProps) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(gaps.map((g) => g.id)),
  );
  const [secondsLeft, setSecondsLeft] = useState(timeoutS);
  const [submit, setSubmit] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const expired = timeoutS > 0 && secondsLeft === 0;
  const open = !resolved && submit !== "conflict";

  // Tick the gate's own countdown; the backend timeout is authoritative — at
  // zero we only stop the controls and wait for gate.resolved.
  useEffect(() => {
    if (!open || expired || timeoutS <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [open, expired, timeoutS]);

  const summary = useMemo(() => {
    if (resolved?.mode === "timeout") {
      return `Gap review timed out — chasing all ${gaps.length} gap${gaps.length === 1 ? "" : "s"}`;
    }
    if (resolved) {
      return `Gap review: ${resolved.approved.length} of ${gaps.length} gap${gaps.length === 1 ? "" : "s"} approved`;
    }
    if (submit === "conflict") {
      return "Gap review already resolved — the run continued";
    }
    return null;
  }, [resolved, submit, gaps.length]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function proceed() {
    setSubmitError(null);
    // Mock/demo scan: nothing to POST to — mark submitted and let the mock's
    // own gate_resolved event close the card.
    if (!jobId) {
      setSubmit("submitted");
      return;
    }
    setSubmit("submitting");
    try {
      await resumeJob(jobId, [...checked]);
      setSubmit("submitted");
    } catch (cause) {
      if (cause instanceof AgentApiError && cause.status === 409) {
        // The job wasn't awaiting review — already resolved (or timed out)
        // server-side; collapse the card. The gate.resolved frame follows.
        setSubmit("conflict");
        return;
      }
      setSubmit("error");
      setSubmitError(
        cause instanceof Error ? cause.message : "Could not send the decision.",
      );
    }
  }

  // Resolved (or superseded): collapse to a summary line in the scan feed.
  if (summary) {
    return (
      <motion.p
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="flex items-center gap-2.5 text-sm text-muted"
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: "var(--color-brand)" }}
        />
        {summary}
      </motion.p>
    );
  }

  const busy = submit === "submitting" || submit === "submitted";

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      aria-label="Gap review"
      className="rounded-[11px] border border-hairline bg-surface-2 p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium text-ink">
          Review the gaps before the next step
        </p>
        {timeoutS > 0 && (
          <p
            className={clsx(
              "mono text-xs tabular-nums",
              expired || secondsLeft <= 10 ? "text-risk-ink" : "text-faint",
            )}
          >
            {expired ? "0:00" : formatClock(secondsLeft)}
          </p>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        The research agents found {gaps.length} open gap
        {gaps.length === 1 ? "" : "s"}. Choose which ones the swarm should chase;
        the rest are left as-is.
      </p>

      <ul className="mt-3 space-y-2">
        <AnimatePresence initial={false}>
          {gaps.map((gap) => (
            <motion.li
              key={gap.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
            >
              <label
                className={clsx(
                  "flex cursor-pointer items-start gap-3 rounded-[5px] bg-canvas p-3",
                  busy && "pointer-events-none opacity-70",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked.has(gap.id)}
                  onChange={() => toggle(gap.id)}
                  disabled={busy || expired}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {gap.title}
                    </span>
                    {gap.severity && (
                      <span
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          severityClass(gap.severity),
                        )}
                      >
                        {gap.severity}
                      </span>
                    )}
                  </span>
                  {gap.detail && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                      {gap.detail}
                    </span>
                  )}
                </span>
              </label>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs text-faint">
          {expired
            ? "Time expired — waiting for the run to resume…"
            : submit === "submitted"
              ? "Decision sent — waiting for the run to resume…"
              : `${checked.size} of ${gaps.length} selected`}
        </p>
        <div className="flex items-center gap-2">
          {submit === "error" && (
            <Button variant="secondary" size="sm" onClick={() => void proceed()}>
              Retry
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            disabled={busy || expired}
            onClick={() => void proceed()}
          >
            {submit === "submitting"
              ? "Sending…"
              : submit === "submitted"
                ? "Sent"
                : "Proceed with selected"}
          </Button>
        </div>
      </div>

      {submit === "error" && submitError && (
        <p className="mt-2 text-xs text-risk-ink" role="alert">
          {submitError}
        </p>
      )}
    </motion.section>
  );
}
