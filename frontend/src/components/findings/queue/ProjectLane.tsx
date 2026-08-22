import type { Finding } from "@/lib/types";
import { QueueRow } from "./QueueRow";

type ProjectLaneProps = {
  projectName: string;
  /** Qualitative band label only (e.g. "Investigate") — never the raw score. */
  bandLabel: string;
  /** Count of visible Open/Blocked findings in this lane. */
  openCount: number;
  items: Finding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/** One project swimlane: header (name + band label + open count) + rows. */
export function ProjectLane({
  projectName,
  bandLabel,
  openCount,
  items,
  selectedId,
  onSelect,
}: ProjectLaneProps) {
  return (
    <section className="overflow-hidden rounded-[11px] border border-hairline bg-canvas shadow-card">
      <header className="flex items-baseline gap-2.5 border-b border-hairline px-5 py-[14px]">
        <span className="text-sm font-semibold text-ink">{projectName}</span>
        <span className="text-[12.5px] text-muted">{bandLabel}</span>
        <span className="ml-auto text-[12.5px] text-faint">
          {openCount} open
        </span>
      </header>
      <div className="divide-y divide-hairline">
        {items.map((f) => (
          <QueueRow
            key={f.id}
            finding={f}
            selected={f.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
