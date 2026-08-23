"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useProject } from "./ProjectContext";
import { AgentApiError } from "@/lib/agent/client";
import { createShare } from "@/lib/agent/shareApi";
import { getLiveRun } from "@/lib/agent/liveStore";

type ShareState =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "error"; message: string };

/**
 * Share modal — mints a public read-only link (POST /api/reports/{id}/share)
 * while open, and offers it for copying. The browser's own job id wins
 * (sessionStorage live run) so freshly-finished scans share correctly; a
 * plain route id is POSTed as-is and a 404 surfaces honestly.
 */
export function ShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { project } = useProject();
  const [state, setState] = useState<ShareState>({ kind: "loading" });
  const [copied, setCopied] = useState(false);

  // Reset when the modal opens — the documented render-phase adjustment
  // pattern; the effect-bodied equivalent is react-hooks/set-state-in-effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setState({ kind: "loading" });
      setCopied(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // The route id is the slug for mock projects; the real backend job id
    // only exists in sessionStorage when THIS browser ran the scan.
    const jobId = getLiveRun(project.id)?.jobId ?? project.id;
    createShare(jobId)
      .then((link) => {
        if (cancelled) return;
        setState({ kind: "ready", url: `${window.location.origin}${link.url}` });
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof AgentApiError && error.status === 404) {
          // Mock projects have no backend report to share.
          setState({ kind: "error", message: "Share is available for live reports." });
        } else {
          const status =
            error instanceof AgentApiError && error.status !== undefined
              ? ` — ${error.status}`
              : "";
          setState({ kind: "error", message: `Could not create a share link${status}` });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, project.id]);

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (insecure context) — the input is selectable.
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(11,8,41,.35)]"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="max-h-[86vh] w-[460px] max-w-[92vw] overflow-y-auto rounded-[11px] bg-canvas shadow-pop"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.15 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-hairline p-[18px_20px]">
              <div className="text-[15px] font-semibold text-ink">Share {project.name}</div>
              <button
                type="button"
                onClick={onClose}
                className="h-[28px] w-[28px] cursor-pointer rounded-full bg-surface-2 text-[15px] leading-none text-muted"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="p-5">
              <div className="mb-[9px] text-[12.5px] font-semibold text-faint">
                Public link — anyone with it can view this report
              </div>
              {state.kind === "loading" && (
                <div className="flex items-center gap-2 text-[12.5px] text-muted">
                  <span className="h-3 w-3 animate-pulse rounded-full bg-surface-2" />
                  Creating share link…
                </div>
              )}
              {state.kind === "error" && (
                <p className="text-[12.5px] leading-[1.6] text-muted">{state.message}</p>
              )}
              {state.kind === "ready" && (
                <>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={state.url}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 rounded-[5px] border border-hairline bg-surface-2 px-3 py-[9px] text-sm text-ink outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => copyLink(state.url)}
                      className="cursor-pointer rounded-full bg-oxford px-[15px] py-2 text-sm font-medium text-white"
                    >
                      {copied ? "Copied" : "Copy link"}
                    </button>
                  </div>
                  <p className="mt-[9px] text-[12px] leading-[1.6] text-faint">
                    Read-only. Teammates signed in through the gate also get a copy in
                    their portfolio.
                  </p>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end border-t border-hairline p-[16px_20px]">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-full border border-hairline bg-canvas px-[15px] py-2 text-sm font-medium text-muted"
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
