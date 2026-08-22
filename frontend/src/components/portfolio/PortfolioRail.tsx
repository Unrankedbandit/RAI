"use client";

import { useEffect, useRef, useState } from "react";
import { portfolioSuggestedQuestions } from "@/lib/mockData";
import type { ChatMessage } from "@/lib/types";

const FALLBACK_ANSWER =
  "I can answer across the whole pipeline — try one of the suggested questions, or ask about a specific project or risk factor.";

/**
 * The global Ask Questions rail, portfolio-framed (Home / Current Projects).
 * Same collapsible chrome as the project rail — collapses to a 44px vertical
 * strip; the shell widens the column when it does. Answers are scripted from
 * the portfolio-level suggested questions.
 */
export function PortfolioRail({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  function ask(question: string) {
    const text = question.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { role: "user", text }]);
    setPending(true);
    const match = portfolioSuggestedQuestions.find(
      (q) => q.question.trim().toLowerCase() === text.toLowerCase(),
    );
    const answer = match ? match.answer.text : FALLBACK_ANSWER;
    window.setTimeout(() => {
      setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
      setPending(false);
    }, 900);
  }

  if (collapsed) {
    return (
      <aside
        className="flex h-full w-11 flex-none cursor-pointer items-center justify-center border-l border-hairline bg-canvas"
        onClick={onToggle}
      >
        <div className="flex rotate-180 items-center gap-[9px] text-sm font-semibold text-ink [writing-mode:vertical-rl]">
          <span className="h-[7px] w-[7px] rounded-full bg-faint" />
          Ask Questions
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[380px] flex-none flex-col overflow-hidden border-l border-hairline bg-canvas">
      <div className="flex-none border-b border-hairline bg-surface-2 px-[18px] py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <span className="h-[7px] w-[7px] rounded-full bg-faint" />
            Ask Questions
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="rounded-full border border-hairline px-[9px] py-1 text-[12.5px] text-faint hover:text-ink"
          >
            Collapse
          </button>
        </div>
        <div className="ml-4 mt-[3px] text-[12.5px] text-faint">
          Grounded in your portfolio
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-[18px]">
        <div className="mb-[14px] flex-none text-sm leading-[1.55] text-ink">
          Ask about any project, or across the whole pipeline.
        </div>

        <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
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
                <span className="flex gap-1">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="h-[5px] w-[5px] animate-pulse rounded-full bg-faint"
                      style={{ animationDelay: `${d * 0.2}s` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex-none">
          <div className="mb-2 text-[12.5px] font-medium text-faint">Suggested</div>
          <div className="flex flex-wrap gap-1.5">
            {portfolioSuggestedQuestions.map((q) => (
              <button
                key={q.question}
                type="button"
                onClick={() => ask(q.question)}
                className="rounded-full border border-hairline bg-surface-2 px-[10px] py-[6px] text-[12.5px] text-muted hover:border-ink hover:text-ink"
              >
                {q.question}
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2 rounded-full border border-hairline bg-surface-2 p-[5px]">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  ask(draft);
                  setDraft("");
                }
              }}
              placeholder="Ask about your portfolio..."
              className="flex-1 border-none bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-faint"
            />
            <button
              type="button"
              onClick={() => {
                ask(draft);
                setDraft("");
              }}
              className="h-9 w-9 flex-none rounded-full bg-oxford text-sm text-white hover:opacity-90"
              aria-label="Send"
            >
              →
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
