import { useState } from "react";
import type {
  FindingDetailScreenProps,
  MockFinding,
  MobileFindingStatus,
} from "../../contracts/types";
import { SeverityLozenge, StatusLozenge } from "./findings/lozenges";

/** Mock-local reassignment cycle — real ownership wiring comes from the host app. */
const OWNER_CYCLE = ["JR", "AK", "MS"] as const;

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-[12.5px] text-ink">{value}</dd>
    </div>
  );
}

function ConflictCard({ evidence }: { evidence: NonNullable<MockFinding["evidence"]> }) {
  return (
    <section className="mt-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-hairline">
      <h2 className="text-[10px] font-semibold uppercase tracking-wide text-faint">Conflict</h2>
      <div className="mt-2.5 flex items-start gap-2">
        <div className="min-w-0 flex-1 text-center">
          <div className="font-jetbrains text-[15px] font-semibold text-ink">
            {evidence.left.value}
          </div>
          <div className="mt-1 text-[10px] leading-snug text-faint">{evidence.left.source}</div>
        </div>
        <span className="mt-1 shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[9.5px] font-semibold text-risk">
          conflicts with
        </span>
        <div className="min-w-0 flex-1 text-center">
          <div className="font-jetbrains text-[15px] font-semibold text-ink">
            {evidence.right.value}
          </div>
          <div className="mt-1 text-[10px] leading-snug text-faint">{evidence.right.source}</div>
        </div>
      </div>
    </section>
  );
}

export function FindingDetailScreen({ platform, finding, onBack }: FindingDetailScreenProps) {
  // Mock-local state only — no persistence; resets when the overlay closes.
  const [owner, setOwner] = useState<string | undefined>(finding.owner);
  const [status, setStatus] = useState<MobileFindingStatus>(finding.status);

  const cycleOwner = () => {
    const idx = owner ? OWNER_CYCLE.indexOf(owner as (typeof OWNER_CYCLE)[number]) : -1;
    setOwner(OWNER_CYCLE[(idx + 1) % OWNER_CYCLE.length]);
  };

  return (
    <div className="flex h-full flex-col bg-canvas" data-platform={platform}>
      {/* top bar — back affordance, 44px target */}
      <div className="flex flex-none items-center border-b border-hairline px-2 py-1.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to findings"
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors active:bg-surface-2"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 3 5 8l5 5" />
          </svg>
        </button>
        <span className="ml-auto pr-3 font-jetbrains text-[11px] text-faint">{finding.id}</span>
      </div>

      {/* scrollable body (overlay container does not scroll) */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <h1 className="text-[17px] font-semibold leading-snug text-ink">{finding.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusLozenge status={status} />
          <SeverityLozenge severity={finding.severity} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-hairline">
          <MetaItem label="Project" value={finding.project} />
          <MetaItem label="Workstream" value={finding.workstream} />
          <MetaItem label="Owner" value={owner ?? "Unassigned"} />
          <MetaItem label="Updated" value={finding.updatedAt} />
        </dl>

        {finding.evidence ? (
          <ConflictCard evidence={finding.evidence} />
        ) : (
          <div className="mt-3 rounded-2xl bg-surface-2 p-3.5 text-[12px] text-muted">
            Gap — no counter-evidence in the dossier.
          </div>
        )}

        {/* impact strip */}
        <div className="mt-3 rounded-xl bg-risk-soft px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-risk">
            If unresolved
          </div>
          <div className="mt-0.5 text-[12px] text-ink">{finding.impact}</div>
        </div>

        <section className="mt-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-hairline">
          <h2 className="text-[12px] font-semibold text-ink">Why it matters</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{finding.whyItMatters}</p>
        </section>

        <section className="mt-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-hairline">
          <h2 className="text-[12px] font-semibold text-ink">Recommended action</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            {finding.recommendedAction}
          </p>
        </section>
      </div>

      {/* bottom-anchored action bar */}
      <div className="flex flex-none gap-2 border-t border-hairline bg-canvas px-4 py-3">
        <button
          type="button"
          onClick={cycleOwner}
          className="min-h-11 flex-1 rounded-full text-[13px] font-semibold text-ink ring-1 ring-hairline transition-colors active:bg-surface-2"
        >
          Reassign{owner ? ` · ${owner}` : ""}
        </button>
        <button
          type="button"
          onClick={() => setStatus("Resolved")}
          disabled={status === "Resolved"}
          className="min-h-11 flex-1 rounded-full bg-oxford text-[13px] font-semibold text-white transition-opacity disabled:opacity-40"
        >
          {status === "Resolved" ? "Resolved" : "Mark resolved"}
        </button>
      </div>
    </div>
  );
}
