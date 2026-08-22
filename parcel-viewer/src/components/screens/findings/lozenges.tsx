import type { MobileFindingStatus, MobileSeverity } from "../../../contracts/types";

/*
 * NOTE: theme.css defines no `-ink` variants (risk-ink / watch-ink / strong-ink).
 * Fallbacks used (matching sibling screens): text-risk / text-watch / text-strong.
 */

const STATUS_CLASSES: Record<MobileFindingStatus, string> = {
  Open: "bg-brand-soft text-risk",
  "In review": "bg-watch-soft text-watch",
  Resolved: "bg-strong-soft text-strong",
  Blocked: "bg-risk text-white", // the one solid lozenge
};

export function StatusLozenge({ status }: { status: MobileFindingStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${STATUS_CLASSES[status]}`}
    >
      {status}
    </span>
  );
}

const DOT_CLASSES: Record<MobileSeverity, string> = {
  High: "bg-risk",
  Medium: "bg-watch",
  Low: "bg-faint",
};

export function SeverityDot({ severity }: { severity: MobileSeverity }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full ${DOT_CLASSES[severity]}`}
    />
  );
}

const SEVERITY_CLASSES: Record<MobileSeverity, string> = {
  High: "bg-risk-soft text-risk",
  Medium: "bg-watch-soft text-watch",
  Low: "bg-strong-soft text-strong",
};

export function SeverityLozenge({ severity }: { severity: MobileSeverity }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${SEVERITY_CLASSES[severity]}`}
    >
      <SeverityDot severity={severity} />
      {severity} severity
    </span>
  );
}
