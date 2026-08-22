import { useState } from "react";
import type {
  FindingsScreenProps,
  MockFinding,
  MobileSeverity,
} from "../../contracts/types";
import { SeverityDot, StatusLozenge } from "./findings/lozenges";

type ChipId = "All" | "Open" | "In review" | "Resolved";

const CHIPS: { id: ChipId; label: string }[] = [
  { id: "All", label: "All" },
  { id: "Open", label: "Open" },
  { id: "In review", label: "In review" },
  { id: "Resolved", label: "Resolved" },
];

const SEVERITY_RANK: Record<MobileSeverity, number> = { High: 0, Medium: 1, Low: 2 };

const isActionable = (f: MockFinding) => f.status === "Open" || f.status === "Blocked";
const bySeverity = (a: MockFinding, b: MockFinding) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];

/** Most severe Open/Blocked finding; Blocked outranks Open at equal severity. */
function pickStartHere(list: MockFinding[]): MockFinding | null {
  const actionable = list.filter(isActionable);
  if (actionable.length === 0) return null;
  return [...actionable].sort((a, b) => {
    const sev = bySeverity(a, b);
    if (sev !== 0) return sev;
    return (a.status === "Blocked" ? 0 : 1) - (b.status === "Blocked" ? 0 : 1);
  })[0];
}

/** Visual triage grouping: Open/Blocked → In review → Resolved. */
function groupRows(rows: MockFinding[]): { label: string; rows: MockFinding[] }[] {
  return [
    { label: "Open & blocked", rows: rows.filter(isActionable).sort(bySeverity) },
    { label: "In review", rows: rows.filter((f) => f.status === "In review").sort(bySeverity) },
    { label: "Resolved", rows: rows.filter((f) => f.status === "Resolved").sort(bySeverity) },
  ].filter((g) => g.rows.length > 0);
}

function FindingRow({
  finding,
  onOpen,
}: {
  finding: MockFinding;
  onOpen: (id: string) => void;
}) {
  const resolved = finding.status === "Resolved";
  return (
    <button
      type="button"
      onClick={() => onOpen(finding.id)}
      className={`flex min-h-11 w-full items-center gap-3 px-3 py-3 text-left transition-colors active:bg-surface-2 ${
        resolved ? "opacity-55" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <SeverityDot severity={finding.severity} />
          <span className="font-jetbrains text-[10px] text-faint">{finding.id}</span>
          <StatusLozenge status={finding.status} />
        </div>
        <div className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-ink">
          {finding.title}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted">{finding.resolutionSummary}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {finding.owner ? (
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-ink ring-1 ring-hairline">
            {finding.owner}
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-risk">Assign →</span>
        )}
        <span className="text-[10px] text-faint">{finding.updatedAt}</span>
      </div>
    </button>
  );
}

export function FindingsScreen({
  platform,
  findings,
  projectFilter,
  onClearFilter,
  onOpenFinding,
}: FindingsScreenProps) {
  const [chip, setChip] = useState<ChipId>("All");

  const scoped = projectFilter ? findings.filter((f) => f.projectId === projectFilter) : findings;
  const projectName = projectFilter ? (scoped[0]?.project ?? projectFilter) : null;
  const needsDecision = scoped.filter(isActionable).length;

  const filtered = chip === "All" ? scoped : scoped.filter((f) => f.status === chip);
  const startHere = pickStartHere(filtered);
  const groups = groupRows(filtered.filter((f) => f.id !== startHere?.id));

  return (
    <div className="flex min-h-full flex-col bg-canvas" data-platform={platform}>
      {/* sticky toolbar — title + filter banner + chips stay pinned while rows scroll */}
      <div className="sticky top-0 z-10 bg-canvas/95 px-4 backdrop-blur-sm">
        <header className="pt-5">
          <h1 className="text-[20px] font-semibold text-ink">Findings</h1>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {needsDecision} need a decision — start where it costs most
          </p>
        </header>

        {projectFilter && (
          <div className="pt-3">
            <div className="flex items-center justify-between gap-2 rounded-xl bg-vista-soft px-3 py-2 text-[12px] text-ink">
              <span className="min-w-0 truncate">Filtered to {projectName}</span>
              <button
                type="button"
                onClick={onClearFilter}
                className="-my-2 flex min-h-11 shrink-0 items-center px-2 font-semibold text-ink"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* filter chips — horizontal scroll, hidden scrollbar */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CHIPS.map((c) => {
            const active = chip === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setChip(c.id)}
                aria-pressed={active}
                className={`flex min-h-11 shrink-0 items-center rounded-full px-4 text-[12.5px] font-medium transition-colors ${
                  active ? "bg-ink text-white" : "bg-surface-2 text-muted"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 pb-6 pt-3">
        {startHere && (
          <button
            type="button"
            onClick={() => onOpenFinding(startHere.id)}
            className="mb-4 block w-full rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-hairline transition-colors active:bg-surface-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-risk">
                Start here — highest open exposure
              </span>
              <StatusLozenge status={startHere.status} />
            </div>
            <div className="mt-1.5 text-[14px] font-medium leading-snug text-ink">
              {startHere.title}
            </div>
            <div className="mt-1 text-[12px] text-risk">{startHere.impact}</div>
          </button>
        )}

        {groups.map((g) => (
          <section key={g.label} className="mb-4">
            <h2 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
              {g.label}
            </h2>
            <div className="divide-y divide-hairline overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-hairline">
              {g.rows.map((f) => (
                <FindingRow key={f.id} finding={f} onOpen={onOpenFinding} />
              ))}
            </div>
          </section>
        ))}

        {groups.length === 0 && !startHere && (
          <div className="rounded-2xl bg-surface-2 p-6 text-center text-[12.5px] text-muted">
            Nothing here — no findings match this filter.
          </div>
        )}
      </div>
    </div>
  );
}
