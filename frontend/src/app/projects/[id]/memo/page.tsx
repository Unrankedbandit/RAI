"use client";

import { useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useProjectDetail } from "@/lib/agent/useProjectDetail";
import { bandColorVar } from "@/lib/band";
import { clsx } from "@/lib/clsx";
import { eventDateLabel } from "@/lib/timeline";

/**
 * Print-optimized due-diligence memo — the target of the Reports tab's
 * "Export PDF" flow. Browsers' print dialog saves as PDF natively, so this
 * page is the exporter: clean single-column typography, app chrome hidden via
 * the #memo-print print rules in globals.css.
 *
 * Query params: ?print=1 auto-opens the print dialog once the report has
 * resolved; ?map=0 omits the site section (the popover's map checkbox).
 */
export default function MemoPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const wantPrint = search.get("print") === "1";
  const wantMap = search.get("map") !== "0";
  const { detail } = useProjectDetail(params.id);

  useEffect(() => {
    if (!wantPrint || !detail) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [wantPrint, detail]);

  if (!detail) {
    return (
      <div className="mx-auto max-w-md px-8 py-16 text-center">
        <p className="text-muted">
          Loading memo…{" "}
          <Link href={`/projects/${params.id}`} className="text-brand underline">
            Back to project
          </Link>
        </p>
      </div>
    );
  }

  const { project, report, timeline } = detail;
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-full bg-surface-2 py-8 print:bg-canvas print:py-0">
      {/* On-screen toolbar — never prints */}
      <div className="mx-auto mb-4 flex max-w-[760px] items-center justify-between px-6 print:hidden">
        <Link
          href={`/projects/${project.id}`}
          className="text-[12.5px] text-muted hover:text-ink"
        >
          ← Back to project
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="cursor-pointer rounded-full bg-oxford px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          Print / Save as PDF
        </button>
      </div>

      <div
        id="memo-print"
        className="mx-auto max-w-[760px] bg-canvas px-10 py-9 text-ink shadow-card print:max-w-none print:shadow-none"
      >
        {/* Header */}
        <div className="border-b-2 border-ink pb-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            {report.badge}
          </div>
          <h1 className="text-[22px] font-semibold leading-snug">{report.title}</h1>
          <div className="mt-1.5 text-[12px] text-muted">
            {report.preparedBy} · {today}
          </div>
        </div>

        {/* Decision line */}
        <div className="mt-5 flex items-center gap-3 rounded-[5px] border border-hairline bg-surface-2 px-4 py-3 print:bg-canvas">
          <span
            className="h-2.5 w-2.5 flex-none rounded-full"
            style={{ backgroundColor: bandColorVar[project.band] }}
          />
          <span className="text-[13px] font-semibold">
            Activation score {Math.round(project.activationScore)}/100 — {project.status}
          </span>
          <span className="text-[12px] text-muted">{project.location}</span>
        </div>

        {/* Executive summary */}
        <Section title="Executive summary">
          <p className="text-[12.5px] leading-[1.7] text-muted">{report.summary}</p>
        </Section>

        {/* Scores by component */}
        <Section title="Scores by component">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-faint">
                <th className="border-b border-hairline pb-1.5 font-medium">Pillar</th>
                <th className="border-b border-hairline pb-1.5 font-medium">Score</th>
                <th className="border-b border-hairline pb-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {project.pillars.map((p) => (
                <tr key={p.name}>
                  <td className="border-b border-hairline py-1.5 font-semibold">{p.name}</td>
                  <td
                    className="border-b border-hairline py-1.5 font-semibold"
                    style={{ color: bandColorVar[p.band] }}
                  >
                    {p.score}
                  </td>
                  <td className="border-b border-hairline py-1.5 text-muted">{p.statusText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* Key findings */}
        <Section title={`Key findings (${report.findings.length})`}>
          <div className="space-y-3">
            {report.findings.map((f) => (
              <div key={f.title}>
                <div className="text-[12.5px] font-semibold">{f.title}</div>
                <p className="mt-0.5 text-[12px] leading-[1.6] text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Critical path */}
        {timeline.length > 0 && (
          <Section title="Critical path">
            <ul className="space-y-1 text-[12px] text-muted">
              {timeline.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="w-24 flex-none font-medium text-ink">
                    {eventDateLabel(e)}
                  </span>
                  <span>
                    {e.label}
                    {e.kind === "deadline" ? " (deadline)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Recommended actions */}
        <Section title="Recommended next actions">
          <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-[1.7] text-muted">
            {report.recommendedActions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        </Section>

        {/* Site */}
        {wantMap && (
          <Section title="Site">
            <p className="text-[12px] leading-[1.6] text-muted">
              {project.location}
              {project.capacityMW > 0 ? ` · ${project.capacityMW} MW` : ""}
              {project.latitude !== 0 || project.longitude !== 0
                ? ` · ${project.latitude.toFixed(4)}, ${project.longitude.toFixed(4)}`
                : ""}
            </p>
          </Section>
        )}

        {/* Source basis + disclaimer */}
        <div className="mt-7 border-t border-hairline pt-4 text-[11px] leading-[1.6] text-faint">
          <p>{report.sourceBasis}</p>
          <p className={clsx("mt-1")}>
            Generated from the live RAI report — draft for internal diligence use.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
        {title}
      </div>
      {children}
    </div>
  );
}
