"use client";

import { useProject } from "./ProjectContext";
import { useAgentReport } from "@/lib/agent/useAgentReport";
import type { AcquiredPack } from "@/lib/types";

const URLISH = /^https?:\/\//i;

function docMeta(doc: {
  kind: string;
  size?: string;
  pages?: number;
  uploadedAt?: string;
}): string {
  return [
    doc.kind,
    doc.pages !== undefined ? `${doc.pages} pp` : null,
    doc.size ?? null,
    doc.uploadedAt ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One source line: an external link when it is a URL, plain text otherwise. */
function SourceLine({ source }: { source: string }) {
  if (URLISH.test(source)) {
    return (
      <a
        href={source}
        target="_blank"
        rel="noreferrer"
        className="break-all text-brand hover:underline"
      >
        {source} <span aria-hidden>↗</span>
      </a>
    );
  }
  return <span>{source}</span>;
}

/**
 * Documents tab — the submitted/uploaded documents from the report, then the
 * agent's acquired research: every acquired_data pack with its data points,
 * still-missing items, and sources (linked when they are URLs). Empty state
 * is honest — no mock content.
 */
export function DocumentsTab() {
  const { project, documents, acquiredData } = useProject();
  const { report } = useAgentReport(project.id);

  // Adapted packs win; the raw report's acquired_data is the fallback for
  // routes whose detail never carried them through the adapter.
  const packs: AcquiredPack[] =
    acquiredData && acquiredData.length > 0
      ? acquiredData
      : (report?.acquired_data ?? []).map((a) => ({
          component: a.component,
          dataPoints: a.data_points,
          sources: a.sources,
          stillMissing: a.still_missing,
        }));

  return (
    <div className="space-y-[14px]">
      {/* Submitted documents */}
      <div className="rounded-[11px] border border-hairline bg-canvas p-7 shadow-card">
        <div className="mb-2 text-[15px] font-semibold text-ink">Documents</div>
        {documents.length === 0 ? (
          <div className="py-3 text-sm text-faint">
            {packs.length === 0
              ? "No documents in this report"
              : "No submitted documents in this report"}
          </div>
        ) : (
          documents.map((doc, i) => (
            <div
              key={doc.id}
              className={`flex items-center justify-between gap-4 py-3 text-sm ${
                i === 0 ? "" : "border-t border-hairline"
              }`}
            >
              <span className="min-w-0 font-medium text-ink">{doc.title}</span>
              <span className="flex-none text-[12.5px] text-faint">
                {docMeta(doc)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Acquired research */}
      {packs.length > 0 && (
        <div className="rounded-[11px] border border-hairline bg-canvas p-7 shadow-card">
          <div className="mb-2 text-[15px] font-semibold text-ink">
            Acquired research
          </div>
          <div className="divide-y divide-hairline">
            {packs.map((pack) => (
              <div key={pack.component} className="py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
                  {pack.component}
                </div>

                {pack.dataPoints.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] leading-[1.5] text-ink">
                    {pack.dataPoints.map((dp, i) => (
                      <li key={i}>{dp}</li>
                    ))}
                  </ul>
                )}

                {pack.stillMissing.length > 0 && (
                  <div className="mt-2 text-[12.5px]">
                    <span className="font-medium text-muted">
                      Still missing:{" "}
                    </span>
                    <span className="text-faint">
                      {pack.stillMissing.join(" · ")}
                    </span>
                  </div>
                )}

                {pack.sources.length > 0 && (
                  <div className="mt-2 space-y-0.5 text-[12.5px] text-muted">
                    {pack.sources.map((source, i) => (
                      <div key={i}>
                        <SourceLine source={source} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
