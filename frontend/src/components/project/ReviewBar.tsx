"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useProject } from "./ProjectContext";
import { bandPillClass } from "@/lib/band";
import {
  AgentApiError,
  ReviewConflictError,
  getReview,
  submitReview,
  type ReviewRecord,
} from "@/lib/agent/client";

/**
 * Human approve/reject bar for the displayed report.
 *
 * The report's findings and gaps are visible right below this bar, so the
 * reviewer decides in context. Review state lives on a SEPARATE endpoint from
 * the report contract (`/api/reports/{id}/review`) — when that endpoint 404s
 * or is unreachable (mock mode), the bar renders nothing at all.
 *
 * Status colors resolve through the band tokens (watch / strong / risk),
 * never literal green/red, per the theme rule in globals.css.
 */

type Decision = "APPROVED" | "REJECTED";

/** Which inline form is open, if any. */
type FormState = { decision: Decision } | null;

const REVIEWER_KEY = "rai.reviewerName";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ReviewBar() {
  const { project } = useProject();
  const reportId = project.id;

  // null = hidden (NOT_TRACKED, 404, unreachable) or still loading.
  const [review, setReview] = useState<ReviewRecord | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [reviewer, setReviewer] = useState("");
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set after a 409 — shows "already decided by X" + Override. */
  const [conflict, setConflict] = useState<ReviewRecord | null>(null);
  const [rationaleOpen, setRationaleOpen] = useState(false);

  // Pre-fill the reviewer name from the last decision on this machine. Done
  // on form-open rather than in an effect: localStorage doesn't exist during
  // the server render, and reading it in an event handler sidesteps both
  // hydration mismatch and set-state-in-effect.
  const prefillReviewer = () => {
    try {
      const saved = window.localStorage.getItem(REVIEWER_KEY);
      if (saved) setReviewer((current) => current || saved);
    } catch {
      // Storage unavailable — the field just starts empty.
    }
  };

  const refresh = useCallback(async () => {
    try {
      setReview(await getReview(reportId));
    } catch {
      setReview(null); // Unexpected failure: hide rather than crash the tab.
    }
  }, [reportId]);

  useEffect(() => {
    let cancelled = false;
    getReview(reportId)
      .then((record) => {
        if (!cancelled) setReview(record);
      })
      .catch(() => {
        if (!cancelled) setReview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const submit = async (decision: Decision, override: boolean) => {
    const name = reviewer.trim();
    if (!name) {
      setError("Your name is required to record a decision.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const record = await submitReview(
        reportId,
        decision,
        name,
        rationale.trim() || undefined,
        override,
      );
      try {
        window.localStorage.setItem(REVIEWER_KEY, name);
      } catch {
        // Non-fatal.
      }
      // Optimistic: the POST response IS the record — show it immediately,
      // then revalidate from the server in the background.
      setReview(record);
      setForm(null);
      setConflict(null);
      setRationale("");
      void refresh();
    } catch (err) {
      if (err instanceof ReviewConflictError) {
        setConflict(err.existing ?? null);
        if (err.existing) setReview(err.existing);
      } else if (err instanceof AgentApiError) {
        setError(
          err.status === undefined
            ? "The review service is unreachable — decision not recorded."
            : "The decision could not be recorded. Please try again.",
        );
      } else {
        setError("The decision could not be recorded. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!review || review.status === "NOT_TRACKED") return null;

  const decided = review.status === "APPROVED" || review.status === "REJECTED";

  return (
    <div className="mb-[14px] rounded-[11px] border border-hairline bg-canvas p-[14px_18px] shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        {review.status === "AWAITING_REVIEW" && !decided && (
          <>
            <span
              className={`inline-block rounded-full px-[11px] py-1 text-[12.5px] font-semibold ${bandPillClass.watch}`}
            >
              Pending review — not final
            </span>
            <span className="text-[12.5px] text-faint">
              Review the findings below, then record a decision.
            </span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setForm({ decision: "APPROVED" });
                  prefillReviewer();
                  setConflict(null);
                  setError(null);
                }}
                className="cursor-pointer rounded-full border border-oxford bg-oxford px-[15px] py-2 text-sm font-medium text-white"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm({ decision: "REJECTED" });
                  prefillReviewer();
                  setConflict(null);
                  setError(null);
                }}
                className="cursor-pointer rounded-full border border-hairline bg-canvas px-[15px] py-2 text-sm font-medium text-risk-ink"
              >
                Reject
              </button>
            </div>
          </>
        )}

        {decided && (
          <>
            <span
              className={`inline-block rounded-full px-[11px] py-1 text-[12.5px] font-semibold ${
                review.status === "APPROVED"
                  ? bandPillClass.strong
                  : bandPillClass.risk
              }`}
            >
              {review.status === "APPROVED" ? "Approved" : "Rejected"}
              {review.reviewedBy ? ` by ${review.reviewedBy}` : ""}
              {review.reviewedAt ? ` · ${formatDate(review.reviewedAt)}` : ""}
            </span>
            {review.rationale && (
              <button
                type="button"
                onClick={() => setRationaleOpen((v) => !v)}
                className="cursor-pointer text-[12.5px] text-muted underline"
              >
                {rationaleOpen ? "Hide rationale" : "View rationale"}
              </button>
            )}
          </>
        )}
      </div>

      {decided && rationaleOpen && review.rationale && (
        <div className="mt-3 border-t border-hairline pt-3 text-[12.5px] leading-[1.55] text-muted">
          {review.rationale}
        </div>
      )}

      {conflict && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-hairline pt-3">
          <span className="text-[12.5px] text-risk-ink">
            Already decided
            {conflict.reviewedBy ? ` by ${conflict.reviewedBy}` : ""}
            {conflict.reviewedAt ? ` · ${formatDate(conflict.reviewedAt)}` : ""}
            .
          </span>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit(form?.decision ?? "APPROVED", true)}
            className="cursor-pointer rounded-full border border-hairline bg-canvas px-[13px] py-1.5 text-[12.5px] font-medium text-ink disabled:opacity-50"
          >
            Override with my decision
          </button>
          <button
            type="button"
            onClick={() => {
              setConflict(null);
              setForm(null);
            }}
            className="cursor-pointer text-[12.5px] text-muted underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <AnimatePresence>
        {form && !conflict && (
          <motion.form
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="mt-3 border-t border-hairline pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(form.decision, false);
            }}
          >
            <div className="mb-2 text-[12.5px] font-semibold text-ink">
              {form.decision === "APPROVED" ? "Approve" : "Reject"} this report
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              <input
                type="text"
                required
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                placeholder="Your name (required)"
                className="min-w-[200px] flex-1 rounded-[5px] border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-vista"
              />
            </div>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Rationale (optional)"
              rows={2}
              className="mb-2 w-full rounded-[5px] border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-vista"
            />
            {error && (
              <div className="mb-2 text-[12.5px] text-risk-ink">{error}</div>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="cursor-pointer rounded-full border border-oxford bg-oxford px-[15px] py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {submitting ? "Recording…" : "Record decision"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm(null);
                  setError(null);
                }}
                className="cursor-pointer rounded-full border border-hairline bg-canvas px-[15px] py-2 text-sm font-medium text-muted"
              >
                Cancel
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
