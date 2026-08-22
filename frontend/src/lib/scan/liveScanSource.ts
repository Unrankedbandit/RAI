// Live scan source — adapts the real agent backend to the ScanEvent stream.
//
// The backend (agent_backend/main.py) narrates free-text status frames over
// SSE and ends with a sentinel; `streamJob` normalizes those into
// status/done/error. Here we translate that narration into typed ScanEvents so
// the same hook, progress model, and UI drive both the live run and the mock.
//
// The backend can't report structured pillar milestones, so this source drives
// the bar with an honest asymptotic estimate (a `progress` event) rather than
// faking five jumps it can't back up. On completion it fetches the report,
// hands it to the project view via the live store, and emits `complete` with
// the real readiness as the activation score.

import type { ScanSource } from "./scanEvents";
import { getReport, streamJob } from "@/lib/agent/client";
import { saveLiveRun } from "@/lib/agent/liveStore";

/** Asymptotic-to-95% progress for a run of unknown length (never claims done). */
function approximateProgress(eventCount: number): number {
  return 95 * (1 - Math.exp(-eventCount / 18));
}

const FILENAME = /([\w.\-]+\.(?:pdf|xlsx|csv|docx))/i;
const AGENT_PREFIX = /^\[([^\]]+)\]\s*/;

function isFlag(message: string): boolean {
  const t = message.toLowerCase();
  return (
    t.includes("contradict") ||
    t.includes("conflict") ||
    t.includes("gap") ||
    t.includes("missing") ||
    t.includes("flag") ||
    t.includes("red flag")
  );
}

function isRead(message: string): boolean {
  const t = message.toLowerCase();
  return t.includes("extract") || t.includes("reading") || t.includes("read ");
}

/** Turn a readiness figure (0–1 or 0–100) into a 0–100 activation score. */
function toActivationScore(readiness: number): number {
  return Math.round(readiness <= 1 ? readiness * 100 : readiness);
}

export function createLiveScanSource(
  jobId: string,
  projectId: string,
): ScanSource {
  return ({ onEvent, onClose }) => {
    let count = 0;
    let cancelled = false;
    const seenAgents = new Set<string>();

    const unsubscribe = streamJob(jobId, (event) => {
      if (cancelled) return;

      if (event.kind === "status") {
        count += 1;
        onEvent({ type: "progress", percent: approximateProgress(count) });

        const message = event.message;
        const agent = AGENT_PREFIX.exec(message)?.[1];
        const body = message.replace(AGENT_PREFIX, "").trim();

        // First sighting of a sub-agent → a pill + a muted trail line.
        if (agent && !seenAgents.has(agent)) {
          seenAgents.add(agent);
          onEvent({
            type: "subagent_spawned",
            name: agent,
            parentPillar: "pipeline",
          });
        }

        const filename = FILENAME.exec(message)?.[1];
        if (filename && isRead(message)) {
          onEvent({ type: "reading_document", filename });
        } else {
          onEvent({ type: "finding", text: body || message, flag: isFlag(message) });
        }
        return;
      }

      if (event.kind === "error") {
        // A bare "stream closed" is a dropped connection — the hook treats that
        // as a timeout, never silent success. A real __ERROR__ is a failure.
        if (event.message === "stream closed") {
          onClose();
        } else {
          onEvent({ type: "error", message: event.message });
        }
        return;
      }

      // event.kind === "done": pull the finished report, stash it for the
      // project view, then signal completion with the real score.
      void (async () => {
        try {
          const report = await getReport(jobId);
          if (cancelled) return;
          saveLiveRun({
            jobId,
            projectId,
            report,
            finishedAt: new Date().toISOString(),
          });
          const activationScore = toActivationScore(report.readiness);
          onEvent({ type: "progress", percent: 99 });
          onEvent({ type: "complete", projectId, activationScore });
        } catch (cause) {
          if (cancelled) return;
          onEvent({
            type: "error",
            message:
              cause instanceof Error
                ? cause.message
                : "Could not load the finished report.",
          });
        }
      })();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  };
}
