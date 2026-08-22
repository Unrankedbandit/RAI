import { useMemo, useState } from "react";
import type { MockProject, ProjectsScreenProps } from "../../contracts/types";

type Band = MockProject["band"];

/* NOTE: theme.css defines no -ink variants for strong/watch/risk, so pill +
 * numeral text uses the base band tokens (text-strong/watch/risk). */
const bandPillClass: Record<Band, string> = {
  strong: "bg-strong-soft text-strong",
  watch: "bg-watch-soft text-watch",
  risk: "bg-risk-soft text-risk",
};

const bandBarClass: Record<Band, string> = {
  strong: "bg-strong",
  watch: "bg-watch",
  risk: "bg-risk",
};

export function ProjectsScreen({ projects, onOpenProject, onOpenProjectFindings, onAddDocuments }: ProjectsScreenProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? projects.filter((p) =>
          [p.name, p.tech, p.location].some((f) => f.toLowerCase().includes(q)),
        )
      : projects;
    // Worst score first — what needs attention floats to the top.
    return [...matches].sort((a, b) => a.score - b.score);
  }, [projects, query]);

  const avgScore = projects.length
    ? Math.round(projects.reduce((sum, p) => sum + p.score, 0) / projects.length)
    : 0;
  const onTrack = projects.filter((p) => p.band === "strong").length;
  const needsReview = projects.length - onTrack;

  return (
    <div className="px-4 pb-6 pt-5">
      {/* sticky header: title + sub + search stay pinned while cards scroll */}
      <div className="sticky top-0 z-10 -mx-4 bg-canvas/95 px-4 pb-3 backdrop-blur-sm">
        {/* header */}
        <h1 className="text-[20px] font-semibold leading-tight text-ink">Current projects</h1>
        <p className="mt-1 text-[11.5px] text-muted">
          {projects.length} active · flagged before the 2030 ITC deadline
        </p>

        {/* search pill */}
        <div className="relative mt-4">
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
            className="h-11 w-full rounded-full bg-white pl-11 pr-11 text-[13px] text-ink shadow-none outline-none ring-1 ring-hairline placeholder:text-faint focus:ring-brand"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-faint"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* portfolio summary strip */}
      <div className="mt-1 flex divide-x divide-hairline rounded-2xl bg-white py-3 shadow-sm ring-1 ring-hairline">
        <div className="flex-1 px-3 text-center">
          <div className="font-jetbrains text-[16px] font-semibold leading-tight text-ink">{avgScore}</div>
          <div className="mt-0.5 text-[10px] font-medium text-faint">Avg score</div>
        </div>
        <div className="flex-1 px-3 text-center">
          <div className="font-jetbrains text-[16px] font-semibold leading-tight text-strong">{onTrack}</div>
          <div className="mt-0.5 text-[10px] font-medium text-faint">On track</div>
        </div>
        <div className="flex-1 px-3 text-center">
          <div className="font-jetbrains text-[16px] font-semibold leading-tight text-risk">{needsReview}</div>
          <div className="mt-0.5 text-[10px] font-medium text-faint">Needs review</div>
        </div>
      </div>

      {/* project cards */}
      {filtered.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {filtered.map((p) => (
            <li key={p.id}>
              {/* div+role instead of <button> so the nested add-docs button is valid HTML */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => onOpenProject(p.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenProject(p.id);
                  }
                }}
                className="block w-full cursor-pointer rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-hairline transition-colors active:bg-select"
              >
                {/* row 1: name + status pill + add-docs */}
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[14px] font-semibold leading-snug text-ink">{p.name}</span>
                  <span className="flex flex-none items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10.5px] font-medium ${bandPillClass[p.band]}`}
                    >
                      {p.statusLabel}
                    </span>
                    <button
                      type="button"
                      aria-label={`Add documents to ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddDocuments(p.id);
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-muted ring-1 ring-hairline transition-colors active:bg-select"
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M8 3.5v9M3.5 8h9" />
                      </svg>
                    </button>
                  </span>
                </div>

                {/* row 2: meta */}
                <div className="mt-1 text-[11.5px] text-muted">
                  {p.tech} · {p.capacityMW} MW · {p.location}
                </div>

                {/* row 3: score bar + numeral */}
                <div className="mt-3 flex items-center gap-2.5">
                  <div className="h-1.5 flex-1 rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${bandBarClass[p.band]}`}
                      style={{ width: `${p.score}%` }}
                    />
                  </div>
                  <span className="flex-none font-jetbrains text-[12px] leading-none">
                    <span className="font-semibold text-ink">{p.score}</span>
                    <span className="text-faint">/100</span>
                  </span>
                </div>

                {/* row 4: footer affordances */}
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-[11.5px] font-medium text-faint">Open project →</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenProjectFindings(p.id);
                    }}
                    className="-my-1 flex min-h-11 items-center rounded-full px-2 text-[11.5px] font-medium text-ink active:bg-select"
                  >
                    View findings →
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-16 text-center text-[12.5px] text-faint">No projects match.</p>
      )}
    </div>
  );
}
