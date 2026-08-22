import type { ProjectDetailScreenProps } from "../../contracts/types";

/**
 * Mobile project workspace — the web /projects/[id] condensed to one scroll:
 * score + reason, findings needing attention, documents, add-docs action.
 */
const BAND_PILL: Record<string, string> = {
  strong: "bg-strong-soft text-strong",
  watch: "bg-watch-soft text-watch",
  risk: "bg-risk-soft text-risk",
};

const BAND_BAR: Record<string, string> = {
  strong: "bg-strong",
  watch: "bg-watch",
  risk: "bg-risk",
};

const STATUS_LOZENGE: Record<string, string> = {
  Open: "bg-brand-soft text-risk",
  "In review": "bg-watch-soft text-watch",
  Resolved: "bg-strong-soft text-strong",
  Blocked: "bg-risk text-white",
};

export function ProjectDetailScreen({
  project,
  findings,
  onBack,
  onOpenFinding,
  onAddDocuments,
}: ProjectDetailScreenProps) {
  const open = findings.filter((f) => f.status === "Open" || f.status === "Blocked");
  const rest = findings.filter((f) => f.status !== "Open" && f.status !== "Blocked");

  return (
    <div className="flex h-full flex-col bg-canvas" data-platform={undefined}>
      {/* top bar — pinned */}
      <div className="flex h-12 flex-none items-center gap-2 border-b border-hairline px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to projects"
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted active:bg-select"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M10 3 5 8l5 5" />
          </svg>
        </button>
        <span className="font-jetbrains text-[11px] text-faint">Project</span>
      </div>

      {/* scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {/* header */}
        <div className="pt-4">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[20px] font-semibold leading-snug text-ink">{project.name}</h1>
            <span className={`mt-1 flex-none rounded-full px-2.5 py-1 text-[10.5px] font-medium ${BAND_PILL[project.band]}`}>
              {project.statusLabel}
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {project.tech} · <span className="font-jetbrains">{project.capacityMW}</span> MW · {project.location}
          </p>
        </div>

        {/* score card */}
        <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-hairline shadow-sm">
          <div className="flex items-baseline gap-2">
            <span className="font-jetbrains text-[32px] font-semibold leading-none text-ink">{project.score}</span>
            <span className="text-[11px] text-faint">/ 100 activation</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full rounded-full ${BAND_BAR[project.band]}`} style={{ width: `${project.score}%` }} />
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted">{project.scoreReason}</p>
        </div>

        {/* findings needing attention */}
        <div className="mt-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
            Findings — {open.length} need attention
          </div>
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-hairline shadow-sm">
            {findings.length === 0 && (
              <p className="px-4 py-5 text-[12px] text-faint">No findings on this project — clean run.</p>
            )}
            {[...open, ...rest].map((f, i) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onOpenFinding(f.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left active:bg-select ${
                  i > 0 ? "border-t border-hairline" : ""
                } ${f.status === "Resolved" ? "opacity-55" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-jetbrains text-[10px] text-faint">{f.id}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-medium ${STATUS_LOZENGE[f.status]}`}>
                      {f.status}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[12.5px] font-medium text-ink">{f.title}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted">{f.resolutionSummary}</div>
                </div>
                <span className="flex-none text-faint">→</span>
              </button>
            ))}
          </div>
        </div>

        {/* documents */}
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">
              Documents — {project.documents.length}
            </span>
            <button
              type="button"
              onClick={() => onAddDocuments(project.id)}
              className="flex min-h-11 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-ink active:bg-select"
            >
              <span className="text-[14px] leading-none">+</span> Add docs
            </button>
          </div>
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-hairline shadow-sm">
            {project.documents.map((d, i) => (
              <div
                key={d.name}
                className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-hairline" : ""}`}
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4 flex-none text-faint" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                  <path d="M4 1.5h5.5L12 4v10.5H4z" strokeLinejoin="round" />
                  <path d="M9.5 1.5V4H12" strokeLinejoin="round" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{d.name}</span>
                <span className="flex-none font-jetbrains text-[10.5px] text-faint">{d.pages}p</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
