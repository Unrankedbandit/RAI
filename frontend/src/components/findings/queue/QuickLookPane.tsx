import Link from "next/link";
import { Button } from "@/components/ui/Button";
import type { Finding } from "@/lib/types";
import { OwnerAvatars, SeverityFlag, StatusLozenge } from "./FindingBits";

type QuickLookPaneProps = {
  /** Effective finding (with mock-local overrides applied), if selected. */
  finding?: Finding;
  projectName?: string;
  onReassign: () => void;
  onMarkResolved: () => void;
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-[6px] text-[12.5px] font-medium uppercase tracking-wide text-faint">
      {children}
    </div>
  );
}

/**
 * Right-side quick-look preview. Sticky, ~380px, no default selection —
 * clicking queue rows swaps the content in place (no navigation).
 */
export function QuickLookPane({
  finding,
  projectName,
  onReassign,
  onMarkResolved,
}: QuickLookPaneProps) {
  if (!finding) {
    return (
      <div className="sticky top-[22px] rounded-[11px] border border-hairline bg-canvas p-5 shadow-card">
        <div className="text-sm font-medium text-ink">Select a finding</div>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-faint">
          Click a row in the queue to preview it here.
        </p>
      </div>
    );
  }

  return (
    <div className="sticky top-[22px] rounded-[11px] border border-hairline bg-canvas p-5 shadow-card">
      {/* Key + status + severity */}
      <div className="flex items-center gap-2">
        <span className="font-jetbrains text-[12.5px] text-faint">
          {finding.id}
        </span>
        <StatusLozenge status={finding.status} />
        <span className="ml-auto flex items-center gap-1.5 text-[12.5px] text-muted">
          <SeverityFlag severity={finding.severity} />
          {finding.severity}
        </span>
      </div>

      {/* Title */}
      <div className="mt-[10px] text-[15px] font-semibold leading-[1.35] text-ink">
        {finding.title}
      </div>

      {/* Meta row: project / owner / updated */}
      <div className="mt-2 flex items-center gap-2 text-[12.5px] text-faint">
        <span className="truncate">{projectName ?? finding.projectId}</span>
        <span aria-hidden="true">·</span>
        <OwnerAvatars initials={finding.ownerInitials} />
        <span aria-hidden="true">·</span>
        <span className="shrink-0">{finding.updatedAt}</span>
      </div>

      {/* Evidence banner — only for contradiction findings with a pair */}
      {finding.evidence && (
        <div className="mt-4 rounded-[7px] bg-surface-2 px-[14px] py-3">
          <div className="flex items-center gap-2.5">
            <div className="min-w-0 flex-1">
              <div className="font-jetbrains text-sm font-semibold text-ink">
                {finding.evidence.left.value}
              </div>
              <div className="mt-[3px] text-[12.5px] leading-[1.4] text-faint">
                {finding.evidence.left.source}
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-risk-ink">
              conflicts with
            </span>
            <div className="min-w-0 flex-1 text-right">
              <div className="font-jetbrains text-sm font-semibold text-ink">
                {finding.evidence.right.value}
              </div>
              <div className="mt-[3px] text-[12.5px] leading-[1.4] text-faint">
                {finding.evidence.right.source}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Resolution — the primary text block (dark ink) */}
      <div className="mt-[18px]">
        <SectionLabel>Resolution</SectionLabel>
        <p className="text-sm leading-[1.55] text-ink">
          {finding.recommendedAction}
        </p>
      </div>

      {/* Why it matters */}
      <div className="mt-4">
        <SectionLabel>Why it matters</SectionLabel>
        <p className="text-sm leading-[1.55] text-muted">
          {finding.whyItMatters}
        </p>
      </div>

      {/* Actions (mock-local state) */}
      <div className="mt-[18px] flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onReassign}>
          Reassign
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onMarkResolved}
          disabled={finding.status === "Resolved"}
        >
          Mark resolved
        </Button>
      </div>

      <Link
        href={`/findings/${finding.id}`}
        className="mt-[14px] inline-block text-sm font-medium text-ink underline underline-offset-2 hover:text-oxford"
      >
        Open full finding →
      </Link>
    </div>
  );
}
