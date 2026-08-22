import { clsx } from "@/lib/clsx";
import type { RecentDocument } from "@/lib/types";

type ProcessStatus = RecentDocument["status"];

/**
 * Pill for document process state (Analyzed / Scanning / Queued). These are
 * pipeline states, not risk — so they stay in the structural palette (vista,
 * neutral grays) and never borrow the status scale (grey / near-black / orange)
 * or the reserved brand orange.
 */
const style: Record<
  ProcessStatus,
  { pill: string; dot: string }
> = {
  Analyzed: { pill: "bg-surface-2 text-muted", dot: "var(--color-muted)" },
  Scanning: { pill: "bg-vista-soft text-ink", dot: "var(--color-vista)" },
  Queued: { pill: "bg-surface-2 text-faint", dot: "var(--color-faint)" },
};

export function ProcessPill({ status }: { status: ProcessStatus }) {
  const s = style[status];
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        s.pill,
      )}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: s.dot }}
      />
      {status}
    </span>
  );
}
