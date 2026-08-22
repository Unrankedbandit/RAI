"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useProject } from "./ProjectContext";
import { ReviewBar } from "./ReviewBar";
import { bandColorVar } from "@/lib/band";

/**
 * Reports tab — faithful port of the reference `#page-reports`: a single draft
 * "due diligence memo" document card with an export-preview popover, an
 * executive summary, a five-column score table, key findings, recommended
 * actions, and a source-basis footnote. All copy comes from the project report
 * content; scores are built from `project.pillars`.
 */
export function ReportsTab() {
  const { project, report } = useProject();
  const [exportOpen, setExportOpen] = useState(false);

  const btnPill =
    "rounded-full border border-hairline bg-canvas px-[15px] py-2 text-sm font-medium text-muted cursor-pointer";

  return (
    <div className="max-w-[820px]">
      {/* Human review gate — sits directly above the findings the reviewer
          is approving/rejecting. Renders nothing when the review endpoint
          doesn't track this report (e.g. mock mode). */}
      <ReviewBar />

      <div className="rounded-[11px] border border-hairline bg-canvas p-[26px_28px] shadow-card">
      {/* Report header */}
      <div className="mb-[18px] flex items-start justify-between border-b border-hairline pb-[18px]">
        <div>
          <div className="mb-[9px] inline-block rounded-full border border-hairline bg-surface-2 px-[11px] py-1 text-[12.5px] font-semibold text-muted">
            {report.badge}
          </div>
          <div className="mb-1 text-[18px] font-semibold text-ink">{report.title}</div>
          <div className="text-[12.5px] text-faint">{report.preparedBy}</div>
        </div>

        <div className="relative flex shrink-0 gap-2">
          <button
            type="button"
            className={btnPill}
            onClick={() => setExportOpen((v) => !v)}
          >
            Export PDF
          </button>
          <button type="button" className={btnPill}>
            Share
          </button>

          <AnimatePresence>
            {exportOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-[42px] z-20 w-[300px] rounded-[5px] border border-hairline bg-canvas p-4 shadow-pop"
              >
                <div className="mb-1.5 text-sm font-semibold text-ink">
                  Export this memo?
                </div>
                <div className="mb-3 text-[12.5px] leading-[1.55] text-muted">
                  Generates a PDF snapshot of the current findings and scores. This is a
                  draft — it won&apos;t be sent to anyone, only saved for you to share
                  manually.
                  <label className="mt-2.5 flex cursor-pointer items-center gap-[7px]">
                    <input type="checkbox" defaultChecked /> Include site map snapshot
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setExportOpen(false)}
                    className="flex-1 cursor-pointer rounded-[1px] border border-hairline bg-canvas p-2 text-[12.5px] text-ink"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportOpen(false)}
                    className="flex-1 cursor-pointer rounded-[1px] border border-oxford bg-oxford p-2 text-[12.5px] text-white"
                  >
                    Export
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Executive summary */}
      <div className="mb-[22px]">
        <div className="mb-[10px] text-[12.5px] font-semibold text-faint">
          Executive summary
        </div>
        <div className="text-sm leading-[1.65] text-muted">{report.summary}</div>
      </div>

      {/* Scores by component */}
      <div className="mb-[22px]">
        <div className="mb-[10px] text-[12.5px] font-semibold text-faint">
          Scores by component
        </div>
        <div className="grid grid-cols-5 gap-2">
          {project.pillars.map((p) => (
            <div
              key={p.name}
              className="rounded-[1px] border border-hairline p-[10px] text-center"
            >
              <div className="mb-1 text-[12.5px] font-semibold text-ink">{p.name}</div>
              <div
                className="mb-[3px] text-[16px] font-semibold"
                style={{ color: bandColorVar[p.band] }}
              >
                {p.score}
              </div>
              <div className="text-xs text-faint">{p.statusText}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Key findings */}
      <div className="mb-[22px]">
        <div className="mb-[10px] text-[12.5px] font-semibold text-faint">Key findings</div>
        {report.findings.map((finding, i) => (
          <div
            key={finding.title}
            className={`pb-[10px] ${i === 0 ? "" : "border-t border-hairline pt-[10px]"}`}
          >
            <div className="mb-[3px] text-sm font-semibold text-ink">
              {finding.title}
            </div>
            <div className="text-[12.5px] leading-[1.55] text-muted">{finding.text}</div>
          </div>
        ))}
      </div>

      {/* Recommended next actions */}
      <div className="mb-[22px]">
        <div className="mb-[10px] text-[12.5px] font-semibold text-faint">
          Recommended next actions
        </div>
        <ol className="list-decimal pl-[18px] text-sm leading-[1.85] text-muted">
          {report.recommendedActions.map((action) => {
            const dash = action.indexOf("—");
            return (
              <li key={action}>
                {dash === -1 ? (
                  action
                ) : (
                  <>
                    <strong className="text-ink">{action.slice(0, dash).trim()}</strong>{" "}
                    {action.slice(dash)}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Source basis */}
      <div>
        <div className="mb-[10px] text-[12.5px] font-semibold text-faint">Source basis</div>
        <div className="text-[12.5px] leading-[1.65] text-faint">{report.sourceBasis}</div>
      </div>
      </div>
    </div>
  );
}
