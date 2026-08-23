"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useProjectDetail } from "@/lib/agent/useProjectDetail";
import { getLiveRun } from "@/lib/agent/liveStore";
import { getReport } from "@/lib/agent/client";
import type { AgentReport } from "@/lib/agent/report";
import { bandColorVar, bandPillClass, bandLabel } from "@/lib/band";
import { clsx } from "@/lib/clsx";
import type { TimelineEvent } from "@/lib/types";

/**
 * Phase detail page — the click-through target of the critical-path Gantt
 * (/projects/<id>/timeline/<eventId>, eventId = the positional "tl-N" ids
 * the adapter assigns per report, or the seeded mock ids).
 *
 * Everything shown comes from real data: the phase header + sub-timeline
 * from detail.timeline (always available), and the procedures/context
 * sections from the raw agent report when one exists for this project
 * (sessionStorage live run, else the backend report when the route id is
 * the 12-hex job id). Mock projects have no raw report — those sections
 * render their honest empty copy rather than invented content.
 */

/** Words too generic to match on — matching on these would tag every item. */
const STOPWORDS = new Set([
  "approval", "approved", "target", "expected", "projected", "scheduled",
  "secured", "complete", "completed", "date", "phase", "milestone",
  "project", "start", "final", "site", "full", "the", "and", "for",
]);

/**
 * Matching heuristic (deliberately conservative): tokenize the phase label,
 * drop stopwords and tokens under 4 chars; an item matches when at least one
 * surviving "strong" token appears in the item's text as a whole word with a
 * prefix match (\b<token>\w* — so "permit" matches "permitting", "enviro"
 * matches "environmental"). One strong token is required, never zero, so an
 * unmatchable label yields the honest empty state instead of noise.
 */
function strongTokens(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesAny(text: string, tokens: string[]): boolean {
  const hay = text.toLowerCase();
  return tokens.some((t) => new RegExp(`\\b${escapeRe(t)}\\w*`).test(hay));
}

export default function TimelinePhasePage() {
  const params = useParams<{ id: string; phase: string }>();
  const { detail, loading } = useProjectDetail(params.id);

  // Raw agent report: sessionStorage first (a scan this browser just ran),
  // else the backend when the route id is the 12-hex job id. Mock projects
  // resolve to null — the honest empty path.
  const [report, setReport] = useState<AgentReport | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let cancelled = false;
    // Sync setState in an effect body cascades renders (react-hooks rule), so
    // even the synchronous sessionStorage hit resolves through a microtask.
    const apply = (r: AgentReport | null) => {
      void Promise.resolve().then(() => {
        if (!cancelled) setReport(r);
      });
    };
    const live = getLiveRun(params.id);
    if (live) {
      apply(live.report);
    } else if (/^[0-9a-f]{12}$/i.test(params.id)) {
      getReport(params.id)
        .then((r) => !cancelled && setReport(r))
        .catch(() => !cancelled && setReport(null));
    } else {
      apply(null);
    }
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[760px] animate-pulse px-6 py-16">
        <div className="h-3 w-24 rounded bg-surface-2" />
        <div className="mt-4 h-6 w-2/3 rounded bg-surface-2" />
        <div className="mt-2 h-3 w-40 rounded bg-surface-2" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-md px-8 py-16 text-center">
        <p className="text-muted">
          Project not found.{" "}
          <Link href="/" className="text-brand underline">
            Back to projects
          </Link>
        </p>
      </div>
    );
  }

  const phase = detail.timeline.find((e) => e.id === params.phase);
  if (!phase) {
    return (
      <div className="mx-auto max-w-md px-8 py-16 text-center">
        <p className="text-muted">
          Phase not found on this project&apos;s critical path.{" "}
          <Link
            href={`/projects/${params.id}`}
            className="text-brand underline"
          >
            Back to project
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-surface-2 py-8">
      <div className="mx-auto max-w-[760px] px-6">
        <Link
          href={`/projects/${params.id}`}
          className="text-[12.5px] text-muted hover:text-ink"
        >
          ← Back to project
        </Link>

        <PhaseHeader phase={phase} />
        <SubTimeline timeline={detail.timeline} currentId={phase.id} />
        <PhaseProcedures
          phase={phase}
          report={report}
          projectId={params.id}
        />
        <ReportContext phase={phase} report={report} />
      </div>
    </div>
  );
}

/* ------------------------------ Phase header ----------------------------- */

function PhaseHeader({ phase }: { phase: TimelineEvent }) {
  return (
    <div className="mt-4 rounded-[5px] border border-hairline bg-canvas px-5 py-4 shadow-card">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 flex-none rounded-full"
          style={{ backgroundColor: bandColorVar[phase.band] }}
        />
        <span
          className={clsx(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            bandPillClass[phase.band],
          )}
        >
          {bandLabel[phase.band]}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-faint">
          {phase.kind === "deadline" ? "Deadline" : "Milestone"}
        </span>
      </div>
      <h1 className="mt-2 text-[20px] font-semibold leading-snug text-ink">
        {phase.label}
      </h1>
      <div className="mt-1 text-[12.5px] text-muted">
        {phase.dateDisplay ?? phase.date}
      </div>
    </div>
  );
}

/* ------------------- Sub-timeline: the phase in context ------------------- */

function SubTimeline({
  timeline,
  currentId,
}: {
  timeline: TimelineEvent[];
  currentId: string;
}) {
  const ordered = useMemo(
    () =>
      timeline
        .slice()
        .sort(
          (a, b) =>
            Date.parse(a.date) - Date.parse(b.date) || a.position - b.position,
        ),
    [timeline],
  );

  return (
    <section className="mt-6">
      <SectionTitle>Critical path in context</SectionTitle>
      <ol className="rounded-[5px] border border-hairline bg-canvas shadow-card">
        {ordered.map((e) => {
          const isCurrent = e.id === currentId;
          return (
            <li
              key={e.id}
              className={clsx(
                "flex items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0",
                isCurrent && "bg-surface-2",
              )}
            >
              <span
                className={clsx(
                  "h-2 w-2 flex-none rounded-full",
                  e.kind === "deadline" && "rounded-[2px]",
                )}
                style={{
                  backgroundColor:
                    e.kind === "deadline"
                      ? "var(--color-risk)"
                      : bandColorVar[e.band],
                }}
              />
              <span className="w-32 flex-none text-[12px] text-faint">
                {e.dateDisplay ?? e.date}
              </span>
              <span
                className={clsx(
                  "min-w-0 truncate text-[12.5px]",
                  isCurrent ? "font-semibold text-ink" : "text-muted",
                )}
              >
                {e.label}
                {e.kind === "deadline" ? " (deadline)" : ""}
              </span>
              {isCurrent && (
                <span className="ml-auto flex-none rounded-full bg-brand/10 px-2 py-0.5 text-[10.5px] font-semibold text-brand">
                  This phase
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* --------------------- Forms & procedures for the phase -------------------- */

function PhaseProcedures({
  phase,
  report,
  projectId,
}: {
  phase: TimelineEvent;
  report: AgentReport | null | undefined;
  projectId: string;
}) {
  const tokens = useMemo(() => strongTokens(phase.label), [phase.label]);

  if (report === undefined) {
    return (
      <section className="mt-6">
        <SectionTitle>Forms &amp; procedures</SectionTitle>
        <div className="animate-pulse rounded-[5px] border border-hairline bg-canvas px-4 py-6 text-[12.5px] text-faint shadow-card">
          Checking the report…
        </div>
      </section>
    );
  }

  if (!report) {
    return (
      <section className="mt-6">
        <SectionTitle>Forms &amp; procedures</SectionTitle>
        <EmptyCard>
          This is a seeded example project — there is no agent report behind
          it, so no phase-specific procedures can be listed.
        </EmptyCard>
      </section>
    );
  }

  const pack = report.action_pack;
  const agencyActions = pack.agency_actions.filter((a) =>
    matchesAny(`${a.agency} ${a.action} ${a.why}`, tokens),
  );
  const rfis = pack.rfis.filter((r) => matchesAny(r, tokens));
  const verifications = pack.verification_requests.filter((v) =>
    matchesAny(v, tokens),
  );
  const conditions = pack.conditions_precedent.filter((c) =>
    matchesAny(c, tokens),
  );
  const total =
    agencyActions.length + rfis.length + verifications.length + conditions.length;

  const counts = [
    pack.rfis.length > 0 && `${pack.rfis.length} RFI${pack.rfis.length === 1 ? "" : "s"}`,
    pack.agency_actions.length > 0 &&
      `${pack.agency_actions.length} agency action${pack.agency_actions.length === 1 ? "" : "s"}`,
    pack.verification_requests.length > 0 &&
      `${pack.verification_requests.length} verification request${pack.verification_requests.length === 1 ? "" : "s"}`,
    pack.conditions_precedent.length > 0 &&
      `${pack.conditions_precedent.length} condition${pack.conditions_precedent.length === 1 ? "" : "s"} precedent`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="mt-6">
      <SectionTitle>Forms &amp; procedures for this phase</SectionTitle>
      {total === 0 ? (
        <EmptyCard>
          The report lists no phase-specific procedures for &ldquo;
          {phase.label}&rdquo;.
          {counts && (
            <>
              {" "}
              The full action pack holds {counts} —{" "}
              <Link
                href={`/projects/${projectId}`}
                className="text-brand underline"
              >
                see the project page
              </Link>
              .
            </>
          )}
        </EmptyCard>
      ) : (
        <div className="space-y-4">
          {agencyActions.length > 0 && (
            <ProcedureGroup title="Agency actions">
              {agencyActions.map((a, i) => (
                <ProcedureCard key={`${a.agency}-${i}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-semibold text-ink">
                      {a.agency}
                    </span>
                    {a.deadline && (
                      <span className="flex-none text-[11px] font-medium text-risk">
                        due {a.deadline}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[12.5px] font-medium text-ink">
                    {a.action}
                  </div>
                  <p className="mt-0.5 text-[12px] leading-[1.6] text-muted">
                    {a.why}
                  </p>
                </ProcedureCard>
              ))}
            </ProcedureGroup>
          )}
          {rfis.length > 0 && (
            <ProcedureGroup title="RFIs">
              {rfis.map((r, i) => (
                <ProcedureCard key={i}>
                  <p className="text-[12px] leading-[1.6] text-muted">{r}</p>
                </ProcedureCard>
              ))}
            </ProcedureGroup>
          )}
          {verifications.length > 0 && (
            <ProcedureGroup title="Verification requests">
              {verifications.map((v, i) => (
                <ProcedureCard key={i}>
                  <p className="text-[12px] leading-[1.6] text-muted">{v}</p>
                </ProcedureCard>
              ))}
            </ProcedureGroup>
          )}
          {conditions.length > 0 && (
            <ProcedureGroup title="Conditions precedent">
              {conditions.map((c, i) => (
                <ProcedureCard key={i}>
                  <p className="text-[12px] leading-[1.6] text-muted">{c}</p>
                </ProcedureCard>
              ))}
            </ProcedureGroup>
          )}
        </div>
      )}
    </section>
  );
}

/* ----------------------- Report context for the phase ---------------------- */

function ReportContext({
  phase,
  report,
}: {
  phase: TimelineEvent;
  report: AgentReport | null | undefined;
}) {
  const tokens = useMemo(() => strongTokens(phase.label), [phase.label]);

  const flags = useMemo(() => {
    if (!report || tokens.length === 0) return [];
    const red = report.red_flags
      .filter((f) =>
        matchesAny(`${f.title} ${f.component} ${f.evidence}`, tokens),
      )
      .map((f) => ({
        title: f.title,
        text: f.evidence,
        severity: f.severity,
        origin: `Red flag · ${f.component}`,
      }));
    const dim = report.dimensions.flatMap((d) =>
      d.flags
        .filter((fl) => matchesAny(fl, tokens))
        .map((fl) => ({
          title: d.name,
          text: fl,
          severity: d.rag === "red" ? "high" : d.rag === "amber" ? "medium" : "low",
          origin: `${d.name} dimension`,
        })),
    );
    return [...red, ...dim];
  }, [report, tokens]);

  const hasDescription = !!phase.description;
  if (!hasDescription && flags.length === 0) return null;

  return (
    <section className="mt-6">
      <SectionTitle>Report context</SectionTitle>
      <div className="space-y-3">
        {hasDescription && (
          <ProcedureCard>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
              About this phase
            </div>
            <p className="mt-1 text-[12.5px] leading-[1.6] text-muted">
              {phase.description}
            </p>
          </ProcedureCard>
        )}
        {flags.map((f, i) => (
          <ProcedureCard key={i}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] font-semibold text-ink">
                {f.title}
              </span>
              <span
                className={clsx(
                  "flex-none rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase",
                  f.severity === "critical" || f.severity === "high"
                    ? "bg-risk-soft text-risk-ink"
                    : f.severity === "medium"
                      ? "bg-watch-soft text-watch-ink"
                      : "bg-surface-2 text-muted",
                )}
              >
                {f.severity}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-[1.6] text-muted">
              {f.text}
            </p>
            <div className="mt-1 text-[11px] text-faint">{f.origin}</div>
          </ProcedureCard>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------- Primitives ------------------------------- */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
      {children}
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[5px] border border-hairline bg-canvas px-4 py-5 text-[12.5px] leading-[1.6] text-muted shadow-card">
      {children}
    </div>
  );
}

function ProcedureGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold text-ink">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ProcedureCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[5px] border border-hairline bg-canvas px-4 py-3 shadow-card">
      {children}
    </div>
  );
}
