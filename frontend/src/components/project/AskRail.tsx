"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "@/lib/clsx";
import type { ChatMessage } from "@/lib/types";
import {
  askQuestion,
  getAnswer,
  streamJob,
  type ChatAnswer,
} from "@/lib/agent/client";
import { getLiveRun } from "@/lib/agent/liveStore";
import { useProject } from "./ProjectContext";

const FALLBACK_ANSWER =
  "I can only answer from what's in this project's findings right now — try one of the suggested questions, or ask about a specific flag.";

/**
 * Ask Questions rail — the full-height right panel, present on every tab.
 * Collapses to a 44px vertical strip. Submitting a chip or typed question
 * appends a user turn, shows a typing indicator for ~900ms, then appends the
 * grounded answer (matched against the project's suggested questions, or a
 * fallback). Matches the reference `ask()` / `submitInput()` behavior.
 */
export function AskRail({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const {
    project,
    priorityActions,
    projectedScoreAfterMitigation,
    suggestedQuestions,
    chatHistory,
  } = useProject();

  const [messages, setMessages] = useState<ChatMessage[]>(chatHistory);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  /** Answers from the scripted chips — the path used when no agent run backs
   *  this project, and the fallback when the backend cannot be reached. */
  function answerFromScript(text: string) {
    const match = suggestedQuestions.find(
      (q) => q.question.trim().toLowerCase() === text.toLowerCase(),
    );
    const answer = match ? match.answer.text : FALLBACK_ANSWER;

    window.setTimeout(() => {
      setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
      setPending(false);
    }, 900);
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setPending(true);

    const live = getLiveRun(project.id);
    if (!live) {
      answerFromScript(text);
      return;
    }

    try {
      // The analyst answers from this project's finished report, so the
      // question can be phrased any way — no chip matching involved.
      const { jobId } = await askQuestion(live.jobId, text);
      const answer = await new Promise<ChatAnswer>((resolve, reject) => {
        const close = streamJob(jobId, (event) => {
          if (event.kind === "error") {
            close();
            reject(new Error(event.message));
          } else if (event.kind === "done") {
            getAnswer(jobId).then(resolve, reject);
          }
          // status frames are the analyst narrating; the rail shows a typing
          // indicator rather than its internal steps.
        });
      });

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: answer.grounded
            ? answer.answer
            : `${answer.answer}\n\n(Not covered by this project's report.)`,
        },
      ]);
      setPending(false);
    } catch {
      // Backend unreachable or the analyst failed: fall back to the script so
      // the rail always answers something.
      answerFromScript(text);
    }
  }

  function submit() {
    void ask(draft);
    setDraft("");
  }

  if (collapsed) {
    return (
      <aside
        className="flex h-full w-11 flex-none cursor-pointer items-center justify-center border-l border-hairline bg-canvas"
        onClick={onToggle}
      >
        <div className="flex rotate-180 items-center gap-[9px] text-[12.5px] font-semibold text-ink [writing-mode:vertical-rl]">
          <span className="h-[7px] w-[7px] rounded-full bg-faint" />
          Ask Questions
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[380px] flex-none flex-col overflow-hidden border-l border-hairline bg-canvas">
      {/* Header */}
      <div className="flex-none border-b border-hairline bg-surface-2 px-[18px] py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <span className="h-[7px] w-[7px] rounded-full bg-faint" />
            Ask Questions
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="rounded-full border border-hairline px-[9px] py-1 text-[10.5px] text-faint hover:text-ink"
          >
            Collapse
          </button>
        </div>
        <div className="ml-4 mt-[3px] text-[11.5px] text-faint">
          Grounded in this project&apos;s findings
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-[18px]">
        {/* Top recommendations */}
        <div className="mb-1 flex-none border-b border-hairline pb-[14px]">
          <div className="mb-3 text-[12.5px] leading-[1.5] text-ink">
            Two actions would have the highest impact on {project.name}&apos;s
            Activation Score:
          </div>

          {priorityActions.map((action) => (
            <div
              key={action.id}
              className="border-t border-hairline py-[11px] first:border-t-0 first:pt-0"
            >
              <div className="mb-[5px] flex items-start justify-between gap-[10px]">
                <div className="text-[12.5px] font-medium leading-[1.4] text-ink">
                  <span className="font-normal text-faint">{action.rank}.</span>{" "}
                  {action.title}
                </div>
                <span className="flex-none rounded-full bg-strong-soft px-[10px] py-[3px] text-[11.5px] font-semibold text-strong-ink">
                  +{action.scoreDelta}
                </span>
              </div>
              <a
                href="#"
                className="text-[11px] text-muted underline underline-offset-2 hover:text-ink"
              >
                View supporting evidence
              </a>
            </div>
          ))}

          <div className="mt-1 border-t border-hairline pt-3 text-[12px] leading-[1.5] text-muted">
            Projected Activation Score after mitigation:{" "}
            <strong className="font-semibold text-ink">
              {projectedScoreAfterMitigation} / 100
            </strong>
          </div>
        </div>

        {/* Thread */}
        <div
          ref={threadRef}
          className={clsx(
            "min-h-0 flex-1 overflow-y-auto",
            (messages.length > 0 || pending) && "mb-[10px]",
          )}
        >
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="my-[10px] flex justify-end">
                <div className="max-w-[82%] rounded-[7px_7px_0_7px] bg-oxford px-[13px] py-[9px] text-[12px] leading-[1.45] text-white">
                  {msg.text}
                </div>
              </div>
            ) : (
              <div key={i} className="mb-[10px] flex justify-start">
                <div className="max-w-[92%] rounded-[7px_7px_7px_0] bg-surface-2 px-[13px] py-[10px] text-[12px] leading-[1.5] text-muted">
                  {msg.text}
                </div>
              </div>
            ),
          )}
          {pending && (
            <div className="mb-[10px] flex justify-start">
              <div className="rounded-[7px_7px_7px_0] bg-surface-2 px-[13px] py-[10px]">
                <div className="flex gap-1 py-[2px]">
                  <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-faint" />
                  <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-faint [animation-delay:0.2s]" />
                  <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-faint [animation-delay:0.4s]" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom block: chips + input */}
        <div className="flex-none">
          <div className="mb-2 text-[10.5px] font-medium text-faint">
            Ask a question
          </div>
          <div className="flex flex-wrap gap-[6px]">
            {suggestedQuestions.map((q) => (
              <button
                key={q.question}
                type="button"
                onClick={() => void ask(q.question)}
                className="cursor-pointer rounded-full border border-hairline bg-surface-2 px-[10px] py-[6px] text-[10.5px] text-muted hover:border-oxford hover:text-ink"
              >
                {q.question}
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2 rounded-full border border-hairline bg-surface-2 p-[5px]">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="Ask about this project..."
              className="flex-1 border-none bg-transparent py-2 pl-3 pr-2.5 text-[12.5px] text-ink focus:outline-none"
            />
            <button
              type="button"
              onClick={submit}
              className="h-9 w-9 flex-none rounded-full bg-oxford text-[14px] text-white hover:opacity-90"
            >
              →
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
