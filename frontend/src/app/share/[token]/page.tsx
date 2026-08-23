"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toSentinel } from "@/lib/agent/adapter";
import type { AgentReport } from "@/lib/agent/report";
import { AgentApiError } from "@/lib/agent/client";
import {
  claimShare,
  fetchSharedReport,
  type ClaimResult,
} from "@/lib/agent/shareApi";
import { bandColorVar } from "@/lib/band";

/**
 * Public read-only view of a shared report (target of the ShareModal link).
 * The token alone authorizes the fetch — viewers without the gate cookie
 * still see the report; claiming into one's portfolio is best-effort in
 * parallel and quietly degrades to a sign-in hint for anonymous viewers.
 */
export default function SharedReportPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [report, setReport] = useState<AgentReport | null>(null);
  const [claim, setClaim] = useState<ClaimResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Fetch and claim run in parallel: the claim outcome only decorates the
    // page, and a 401 claim (anonymous public viewer) is the normal case.
    fetchSharedReport(token)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((error) => {
        if (!cancelled && error instanceof AgentApiError) setFailed(true);
      });
    claimShare(token)
      .then((c) => {
        if (!cancelled && c) setClaim(c);
      })
      .catch(() => {
        // Claim is best-effort — the read-only view still stands.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (failed) {
    return (
      <div className="mx-auto max-w-md px-8 py-16 text-center">
        <p className="text-muted">
          This share link is invalid or the report was removed.{" "}
          <Link href="/" className="text-brand underline">
            Back to portfolio
          </Link>
        </p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mx-auto max-w-[760px] px-6 py-16">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-32 rounded-[5px] bg-surface-2" />
          <div className="h-7 w-2/3 rounded-[5px] bg-surface-2" />
          <div className="h-24 rounded-[5px] bg-surface-2" />
          <div className="h-40 rounded-[5px] bg-surface-2" />
        </div>
      </div>
    );
  }

  const detail = toSentinel(report, { id: token.slice(0, 12) });
  const { project } = detail;

  return (
    <div className="min-h-full bg-surface-2 py-8">
      <div className="mx-auto max-w-[760px] px-6">
        {/* Claim outcome + badge */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="rounded-full border border-hairline bg-canvas px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
            Shared read-only view
          </span>
          {claim ? (
            <span className="text-[12.5px] text-muted">
              Added to your profile ·{" "}
              <Link href={`/projects/${claim.reportId}`} className="text-brand underline">
                Open in your workspace
              </Link>
            </span>
          ) : (
            <span className="text-[12px] text-faint">
              Sign in through the team gate to add this report to your profile
            </span>
          )}
        </div>

        <div className="bg-canvas px-10 py-9 text-ink shadow-card">
          {/* Score header */}
          <div className="border-b-2 border-ink pb-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              RED FLAG REPORT
            </div>
            <h1 className="text-[22px] font-semibold leading-snug">{project.name}</h1>
            <div className="mt-1.5 text-[12px] text-muted">{project.location}</div>
          </div>

          <div className="mt-5 flex items-center gap-3 rounded-[5px] border border-hairline bg-surface-2 px-4 py-3">
            <span
              className="h-2.5 w-2.5 flex-none rounded-full"
              style={{ backgroundColor: bandColorVar[project.band] }}
            />
            <span className="text-[13px] font-semibold">
              Readiness {Math.round(project.activationScore)}/100 — {report.decision}
            </span>
          </div>

          {/* Key findings */}
          {detail.report.findings.length > 0 && (
            <Section title={`Key findings (${detail.report.findings.length})`}>
              <div className="space-y-3">
                {detail.report.findings.map((f) => (
                  <div key={f.title}>
                    <div className="text-[12.5px] font-semibold">{f.title}</div>
                    <p className="mt-0.5 text-[12px] leading-[1.6] text-muted">{f.text}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Recommended actions */}
          {detail.report.recommendedActions.length > 0 && (
            <Section title="Recommended next actions">
              <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-[1.7] text-muted">
                {detail.report.recommendedActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ol>
            </Section>
          )}

          <div className="mt-7 border-t border-hairline pt-4 text-[11px] leading-[1.6] text-faint">
            Generated from the live RAI report — shared read-only link.
          </div>
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
