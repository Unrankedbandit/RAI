import { clsx } from "@/lib/clsx";
import { severityToFlagColor, statusToLozengeClass } from "@/lib/findings";
import type { FindingSeverity, FindingStatus } from "@/lib/types";

/**
 * Status lozenge — the queue's pill. Colors resolve exclusively through
 * lib/findings.ts (never hardcoded hex).
 */
export function StatusLozenge({ status }: { status: FindingStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10.5px] font-medium",
        statusToLozengeClass[status],
      )}
    >
      {status}
    </span>
  );
}

/** Small severity flag glyph — colored via CSS var from lib/findings.ts. */
export function SeverityFlag({
  severity,
  className,
}: {
  severity: FindingSeverity;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 12 14"
      aria-hidden="true"
      className={clsx("h-3 w-[11px] shrink-0", className)}
      style={{ color: severityToFlagColor[severity] }}
      fill="currentColor"
    >
      <path d="M1.4 0h1.7v14H1.4z" />
      <path d="M3.9 1.2h7.4l-2.2 2.8 2.2 2.8H3.9z" />
    </svg>
  );
}

/**
 * Stacked 28px owner-initial circles. Empty owner list renders as an
 * "Unassigned" faint label instead of an empty stack.
 */
export function OwnerAvatars({ initials }: { initials: string[] }) {
  if (initials.length === 0) {
    return <span className="text-[11px] text-faint">Unassigned</span>;
  }
  return (
    <span className="flex items-center">
      {initials.map((ini, i) => (
        <span
          key={`${ini}-${i}`}
          className={clsx(
            "flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-ink ring-1 ring-hairline",
            i > 0 && "-ml-2",
          )}
        >
          {ini}
        </span>
      ))}
    </span>
  );
}
