import type { HomeScreenProps, MockFinding, MockProject } from "../../contracts/types";

/* Severity → status dot color (status palette: risk=orange, watch=ink, faint=grey). */
const SEVERITY_DOT: Record<MockFinding["severity"], string> = {
  High: "bg-risk",
  Medium: "bg-watch",
  Low: "bg-faint",
};

const BAND_BAR: Record<MockProject["band"], string> = {
  strong: "bg-strong",
  watch: "bg-watch",
  risk: "bg-risk",
};

const BAND_TEXT: Record<MockProject["band"], string> = {
  strong: "text-strong",
  watch: "text-watch",
  risk: "text-risk",
};

function todayLine(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** Pick the single most severe open finding (High > Medium > Low), stable order. */
function pickTopOpen(findings: MockFinding[]): MockFinding | undefined {
  const rank: Record<MockFinding["severity"], number> = { High: 0, Medium: 1, Low: 2 };
  return findings
    .filter((f) => f.status === "Open")
    .sort((a, b) => rank[a.severity] - rank[b.severity])[0];
}

export function HomeScreen({
  projects,
  findings,
  onOpenFindings,
  onOpenFinding,
  onStartProject,
  onOpenSettings,
}: HomeScreenProps) {
  const openCount = findings.filter((f) => f.status === "Open").length;
  const topFinding = pickTopOpen(findings);

  const avgScore =
    projects.length > 0
      ? Math.round(projects.reduce((sum, p) => sum + p.score, 0) / projects.length)
      : 0;

  const worstProjects = [...projects].sort((a, b) => a.score - b.score).slice(0, 3);

  return (
    <div className="px-4 pb-6">
      {/* 1 — Header (sticky: stays visible while content scrolls) */}
      <div className="sticky top-0 z-10 -mx-4 bg-canvas/95 px-4 pb-4 pt-4 backdrop-blur-sm">
        <header className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />
              <span className="text-[13px] font-semibold tracking-wide text-ink">RAI</span>
            </div>
            <div className="mt-0.5 text-[11px] text-faint">{todayLine()}</div>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-select"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </button>
        </header>
      </div>

      {/* 2 — Decision digest (hero) */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-hairline">
        <div className="text-[11px] uppercase tracking-wide text-faint">
          Needs your decision
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-jetbrains text-3xl font-semibold text-ink">{openCount}</span>
          <span className="text-[12px] text-muted">
            open finding{openCount === 1 ? "" : "s"}
          </span>
        </div>

        {topFinding && (
          <button
            type="button"
            onClick={() => onOpenFinding(topFinding.id)}
            className="mt-3 flex min-h-11 w-full items-start gap-2.5 rounded-xl bg-surface-2 p-3 text-left active:bg-select"
          >
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[topFinding.severity]}`}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-ink">
                {topFinding.title}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-risk">
                {topFinding.impact}
              </span>
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenFindings}
          className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl text-[13px] font-semibold text-ink ring-1 ring-hairline active:bg-select"
        >
          View all findings
        </button>
      </section>

      {/* 3 — New project (slim CTA; drop-zone idiom lives on the Scan takeover) */}
      <button
        type="button"
        onClick={onStartProject}
        className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-oxford text-[13px] font-semibold text-white active:opacity-90"
      >
        <span aria-hidden className="text-[15px] leading-none">+</span>
        New project
      </button>

      {/* 4 — Portfolio stats */}
      <section className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-hairline">
          <div className="font-jetbrains text-xl font-semibold text-ink">{projects.length}</div>
          <div className="mt-0.5 text-[11px] text-faint">Active projects</div>
        </div>
        <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-hairline">
          <div className="font-jetbrains text-xl font-semibold text-ink">{avgScore}</div>
          <div className="mt-0.5 text-[11px] text-faint">Avg activation</div>
        </div>
      </section>

      {/* 5 — Projects mini-list (worst first) */}
      {worstProjects.length > 0 && (
        <section className="mt-4">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-faint">Projects</div>
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-hairline">
            {worstProjects.map((p, i) => (
              <div
                key={p.id}
                className={`px-4 py-3 ${i > 0 ? "border-t border-hairline" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-ink">{p.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted">
                      {p.tech} · {p.capacityMW} MW
                    </div>
                  </div>
                  <span
                    className={`shrink-0 font-jetbrains text-[13px] font-semibold ${BAND_TEXT[p.band]}`}
                  >
                    {p.score}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${BAND_BAR[p.band]}`}
                    style={{ width: `${Math.min(100, Math.max(0, p.score))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 6 — Recent activity */}
      <section className="mt-4">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-faint">Recent activity</div>
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-hairline">
          <div className="px-4 py-3">
            <div className="truncate text-[12px] text-ink">vendor_proposal.pdf uploaded</div>
            <div className="mt-0.5 text-[11px] text-faint">Project Alpha · Yesterday</div>
          </div>
          <div className="border-t border-hairline px-4 py-3">
            <div className="truncate text-[12px] text-ink">Interconnection study parsed</div>
            <div className="mt-0.5 text-[11px] text-faint">Mesa Solar II · 2 days ago</div>
          </div>
          <div className="border-t border-hairline px-4 py-3">
            <div className="truncate text-[12px] text-ink">Finding marked In review</div>
            <div className="mt-0.5 text-[11px] text-faint">Ridge Line BESS · 3 days ago</div>
          </div>
        </div>
      </section>
    </div>
  );
}
