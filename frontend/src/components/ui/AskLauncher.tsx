"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { severityOrder } from "@/lib/findings";
import {
  findings,
  findingsForProject,
  getFinding,
  getProject,
} from "@/lib/mockData";
import type { ChatMessage, Finding, ScriptedQA } from "@/lib/types";

/**
 * AskLauncher — the page-scoped "Ask about this" entry point.
 *
 * A 28px circular button that opens a 320px pop-out anchored below-right:
 * a "Suggested priority" card (scope-specific, grounded strictly in
 * mockData), a scripted chat thread reusing AskRail's ChatMessage/ScriptedQA
 * pattern, suggestion chips, and a free-text input with a canned fallback.
 *
 * The contract below is FROZEN: pages import AskLauncher with exactly this
 * props shape. Scoped scripted suggestions only — never invent claims.
 */
export type AskLauncherContext =
  | { scope: "finding"; findingId: string }
  | { scope: "queue" }
  | { scope: "project"; projectId: string };

const SCOPE_SUB: Record<AskLauncherContext["scope"], string> = {
  finding: "Grounded in this finding",
  queue: "Grounded in the queue",
  project: "Grounded in this project",
};

const SCOPE_PLACEHOLDER: Record<AskLauncherContext["scope"], string> = {
  finding: "Ask about this finding…",
  queue: "Ask about this queue…",
  project: "Ask about this project…",
};

const FALLBACK_ANSWER =
  "This mock answers from the current findings only — try a suggested question.";

/* ------------------------------------------------------------------ */
/* Queue priority — deterministic, computed from findings data only.   */
/* ------------------------------------------------------------------ */

/** Findings that reference `id` in their own linkedFindings. */
function referrersOf(id: string): Finding[] {
  return findings.filter((f) =>
    f.linkedFindings?.some((l) => l.findingId === id),
  );
}

/**
 * Prefer the Open finding most referenced by OTHER findings' linkedFindings
 * (ties break by severity, then stable queue order as the age proxy); else
 * the first Open finding by severity/age. Returns undefined when the queue
 * has no Open findings at all.
 */
function queuePriority():
  | { finding: Finding; referrers: Finding[] }
  | undefined {
  const open = findings.filter((f) => f.status === "Open");
  if (open.length === 0) return undefined;

  const sorted = [...open].sort((a, b) => {
    const byRefs = referrersOf(b.id).length - referrersOf(a.id).length;
    if (byRefs !== 0) return byRefs;
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
  const top = sorted[0];
  if (!top) return undefined;
  return { finding: top, referrers: referrersOf(top.id) };
}

/* ------------------------------------------------------------------ */
/* Scripted chips per scope — every answer quotes real mock data.      */
/* ------------------------------------------------------------------ */

function scriptedQuestions(context: AskLauncherContext): ScriptedQA[] {
  if (context.scope === "finding") {
    const f = getFinding(context.findingId);
    if (!f) return [];
    return [
      {
        question: "Why does this matter?",
        answer: { role: "assistant", text: f.whyItMatters },
      },
      {
        question: "What should we do next?",
        answer: { role: "assistant", text: f.recommendedAction },
      },
      {
        question: "What's the status?",
        answer: {
          role: "assistant",
          text: `${f.id} is ${f.status} — ${f.severity} severity, ${f.workstream}, detected ${f.detectedAt}. ${f.resolutionSummary}`,
        },
      },
    ];
  }

  if (context.scope === "queue") {
    const priority = queuePriority();
    const counts: Record<Finding["status"], number> = {
      Open: 0,
      Blocked: 0,
      "In review": 0,
      Resolved: 0,
    };
    for (const f of findings) counts[f.status] += 1;
    const openHigh = findings
      .filter((f) => f.status === "Open" && f.severity === "High")
      .map((f) => f.id);
    const blocksEdges = findings.flatMap((f) =>
      (f.linkedFindings ?? [])
        .filter((l) => l.relation === "Blocks")
        .map((l) => `${f.id} blocks ${l.findingId}`),
    );

    const qas: ScriptedQA[] = [];
    if (priority) {
      const { finding: top, referrers } = priority;
      const rel = referrers[0]?.linkedFindings?.find(
        (l) => l.findingId === top.id,
      )?.relation;
      qas.push({
        question: "Which finding should I triage first?",
        answer: {
          role: "assistant",
          text:
            `Start with ${top.id} — ${top.title}. It's Open at ${top.severity} severity, detected ${top.detectedAt}.` +
            (referrers.length > 0 && rel
              ? ` ${referrers.map((r) => r.id).join(", ")} references it as "${rel}".`
              : ""),
        },
      });
    }
    qas.push(
      {
        question: "How many findings are open?",
        answer: {
          role: "assistant",
          text: `${counts.Open} findings are Open${openHigh.length > 0 ? ` (${openHigh.join(", ")} are High severity)` : ""}, ${counts.Blocked} Blocked, ${counts["In review"]} in review, ${counts.Resolved} resolved.`,
        },
      },
      {
        question: "What's blocking other work?",
        answer: {
          role: "assistant",
          text:
            blocksEdges.length > 0
              ? `${blocksEdges.length === 1 ? "One finding blocks" : `${blocksEdges.length} findings block`} downstream work: ${blocksEdges.join("; ")}.`
              : "No finding currently blocks another — the queue has no Blocks relations.",
        },
      },
    );
    return qas;
  }

  // project scope
  const project = getProject(context.projectId);
  if (!project) return [];
  const active = findingsForProject(context.projectId).filter(
    (f) => f.status !== "Resolved",
  );
  return [
    {
      question: "Any open flags on this project?",
      answer: {
        role: "assistant",
        text:
          active.length > 0
            ? `${project.name} has ${active.length} active ${active.length === 1 ? "finding" : "findings"}: ${active.map((f) => `${f.id} (${f.status}, ${f.severity}) — ${f.title}`).join("; ")}.`
            : `${project.name} has no active findings — everything flagged so far is resolved.`,
      },
    },
    {
      question: "What's the activation score?",
      answer: {
        role: "assistant",
        text: `${project.name}'s Activation Score is ${project.activationScore}. ${project.scoreReason}`,
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Suggested priority card content — never invents an unlinked claim.  */
/* ------------------------------------------------------------------ */

function FindingLink({ id }: { id: string }) {
  return (
    <Link
      href={`/findings/${id}`}
      className="font-jetbrains text-ink underline underline-offset-2 hover:text-oxford"
    >
      {id}
    </Link>
  );
}

function PriorityCard({ context }: { context: AskLauncherContext }) {
  let body: React.ReactNode;

  if (context.scope === "finding") {
    const link = getFinding(context.findingId)?.linkedFindings?.[0];
    body = link ? (
      <>
        Review {link.relation.toLowerCase()} <FindingLink id={link.findingId} />{" "}
        first — {link.title}
      </>
    ) : (
      "No linked findings — this one stands alone."
    );
  } else if (context.scope === "queue") {
    const priority = queuePriority();
    body = priority ? (
      <>
        Start with <FindingLink id={priority.finding.id} /> —{" "}
        {priority.finding.title} (Open · {priority.finding.severity}
        {priority.referrers.length > 0
          ? ` · referenced by ${priority.referrers.map((r) => r.id).join(", ")}`
          : ""}
        )
      </>
    ) : (
      "Queue is clear — no open findings."
    );
  } else {
    body = "Ask about a specific flag on this project.";
  }

  return (
    <div className="mb-2 border-b border-hairline pb-3">
      <div className="mb-[5px] text-[12.5px] uppercase tracking-wide text-faint">
        Suggested priority
      </div>
      <div className="text-[12px] leading-[1.5] text-muted">{body}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function AskLauncher({ context }: { context: AskLauncherContext }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");
  const wrapRef = useRef<HTMLSpanElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const scripted = scriptedQuestions(context);

  // Close on outside click and Escape — only while open.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Keep the thread pinned to the latest message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, open]);

  /** AskRail's scripted-answer pattern: user turn, typing indicator, then
   *  the matched canned answer (or the grounded fallback). */
  function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setPending(true);

    const match = scripted.find(
      (q) => q.question.trim().toLowerCase() === text.toLowerCase(),
    );
    const answer = match ? match.answer.text : FALLBACK_ANSWER;

    window.setTimeout(() => {
      setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
      setPending(false);
    }, 800);
  }

  function submit() {
    ask(draft);
    setDraft("");
  }

  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-label="Ask about this"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-muted ring-1 ring-hairline hover:bg-select"
      >
        <svg
          viewBox="0 0 14 14"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden="true"
        >
          <path
            d="M2 3.5A1.5 1.5 0 0 1 3.5 2h7A1.5 1.5 0 0 1 12 3.5v4a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V9H3.5A1.5 1.5 0 0 1 2 7.5z"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Ask RAI"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[320px] rounded-[11px] border border-hairline bg-canvas shadow-pop"
        >
          {/* Header */}
          <div className="border-b border-hairline px-[14px] py-3">
            <div className="text-[12px] font-semibold text-ink">Ask RAI</div>
            <div className="mt-[2px] text-[12.5px] text-faint">
              {SCOPE_SUB[context.scope]}
            </div>
          </div>

          <div className="p-[14px]">
            <PriorityCard context={context} />

            {/* Thread */}
            {(messages.length > 0 || pending) && (
              <div
                ref={threadRef}
                className="mb-[10px] max-h-[220px] overflow-y-auto"
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
            )}

            {/* Suggestion chips */}
            {scripted.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-[6px]">
                {scripted.map((q) => (
                  <button
                    key={q.question}
                    type="button"
                    onClick={() => ask(q.question)}
                    className="cursor-pointer rounded-full border border-hairline bg-surface-2 px-[10px] py-[6px] text-[12.5px] text-muted hover:border-oxford hover:text-ink"
                  >
                    {q.question}
                  </button>
                ))}
              </div>
            )}

            {/* Input row */}
            <div className="flex items-center gap-2 rounded-full px-3 py-2 ring-1 ring-hairline">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder={SCOPE_PLACEHOLDER[context.scope]}
                className="min-w-0 flex-1 border-none bg-transparent text-[12px] text-ink focus:outline-none"
              />
              <button
                type="button"
                aria-label="Send"
                onClick={submit}
                className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-oxford text-[12.5px] text-white hover:opacity-90"
              >
                →
              </button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
