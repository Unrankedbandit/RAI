import { clsx } from "@/lib/clsx";
import type { Finding } from "@/lib/types";
import { OwnerAvatars, SeverityFlag, StatusLozenge } from "./FindingBits";

type QueueRowProps = {
  finding: Finding;
  selected: boolean;
  onSelect: (id: string) => void;
};

/**
 * One queue row. Clicking selects in place (drives the quick-look pane) —
 * it never navigates. Selection is a bg-select fill, never a border change.
 */
export function QueueRow({ finding, selected, onSelect }: QueueRowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(finding.id)}
      aria-pressed={selected}
      className={clsx(
        "flex w-full items-center gap-3 px-5 py-[13px] text-left transition-colors",
        selected ? "bg-select" : "hover:bg-surface-2",
      )}
    >
      <SeverityFlag severity={finding.severity} />
      <span className="w-[58px] shrink-0 font-jetbrains text-[11px] text-faint">
        {finding.id}
      </span>
      <StatusLozenge status={finding.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">
          {finding.title}
        </span>
        <span className="mt-[2px] block truncate text-[11.5px] text-faint">
          {finding.resolutionSummary}
        </span>
      </span>
      <span className="shrink-0">
        <OwnerAvatars initials={finding.ownerInitials} />
      </span>
      <span className="w-[64px] shrink-0 text-right text-[11px] text-faint">
        {finding.updatedAt}
      </span>
    </button>
  );
}
