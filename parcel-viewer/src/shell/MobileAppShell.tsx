/**
 * ORCHESTRATOR-OWNED mobile app shell: tab navigation + overlay stack.
 * All state lives here; screens resolve through the registry. One shell
 * instance per device frame (or full-screen on real phone viewports).
 *
 * Overlays form a stack: project detail → finding detail → scan can layer,
 * and Back pops exactly one level.
 */
import { useEffect, useState } from "react";
import { registry } from "../registry";
import { MapScreen } from "../screen/MapScreen";
import { mockProjects } from "../data/mockProjects";
import { mockFindings } from "../data/mockFindings";
import {
  fetchProjects,
  fetchReport,
  projectRowToMock,
  reportToFindings,
  subscribeFeed,
} from "../data/raiApi";
import type { MobileTab, MockFinding, MockProject, Platform } from "../contracts/types";

type Overlay =
  | { kind: "finding"; id: string }
  | { kind: "project"; id: string }
  | { kind: "scan" }
  | { kind: "settings" };

/** Five tabs, Ask centered. Settings is an overlay from the Home header gear. */
const TABS: { id: MobileTab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "M2.5 7 8 2.5 13.5 7v6.5a1 1 0 0 1-1 1H9.5v-4h-3v4H3.5a1 1 0 0 1-1-1z" },
  { id: "discover", label: "Discover", icon: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z M10.2 5.8l-1.2 3.2-3.2 1.2 1.2-3.2z" },
  { id: "ask", label: "Ask", icon: "M2 3.5A1.5 1.5 0 0 1 3.5 2h7A1.5 1.5 0 0 1 12 3.5v4a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V9H3.5A1.5 1.5 0 0 1 2 7.5z" },
  { id: "projects", label: "Projects", icon: "M2.5 4.5a1 1 0 0 1 1-1h3l1.5 2h5.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z" },
  { id: "findings", label: "Findings", icon: "M3 13.5v-11h3l7 3-7 3H3" },
];

export function MobileAppShell({ platform }: { platform: Platform }) {
  const [tab, setTab] = useState<MobileTab>("home");
  const [stack, setStack] = useState<Overlay[]>([]);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  /* Portfolio state — initialized to the mocks so the demo works offline,
   * replaced by live RAI backend data as soon as it answers. */
  const [projects, setProjects] = useState<MockProject[]>(mockProjects);
  const [findings, setFindings] = useState<MockFinding[]>(mockFindings);

  useEffect(() => {
    let cancelled = false;

    /* Swap in the live portfolio: project rows first, then every report in
     * parallel — a failed report just contributes no findings. On total
     * failure the mocks stay, silently. */
    async function loadLive() {
      try {
        const rows = await fetchProjects();
        const reports = await Promise.allSettled(rows.map((row) => fetchReport(row.id)));
        if (cancelled) return;
        setProjects(rows.map(projectRowToMock));
        setFindings(
          reports.flatMap((res, i) =>
            res.status === "fulfilled" ? reportToFindings(res.value, rows[i].id) : [],
          ),
        );
      } catch {
        // Backend unreachable — the mock portfolio stays on screen.
      }
    }

    void loadLive();
    // A finished analysis means a new report row exists — refresh the portfolio.
    const unsubscribe = subscribeFeed((frame) => {
      if (frame.kind === "done") void loadLive();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const Home = registry.home;
  const Projects = registry.projects;
  const Findings = registry.findings;
  const FindingDetail = registry.findingDetail;
  const Settings = registry.settings;
  const Scan = registry.scan;
  const Ask = registry.ask;
  const ProjectDetail = registry.projectDetail;

  const push = (o: Overlay) => setStack((s) => [...s, o]);
  const pop = () => setStack((s) => s.slice(0, -1));

  const openProjectFindings = (projectId: string) => {
    setProjectFilter(projectId);
    setTab("findings");
  };

  // Any layer may sit under a finding — resolve each overlay type independently.
  const projectOverlay = stack.find((o) => o.kind === "project");
  const findingOverlay = [...stack].reverse().find((o) => o.kind === "finding");
  const scanOpen = stack.some((o) => o.kind === "scan");
  const settingsOpen = stack.some((o) => o.kind === "settings");

  const overlayProject = projectOverlay
    ? projects.find((p) => p.id === projectOverlay.id) ?? null
    : null;
  const overlayFinding = findingOverlay?.kind === "finding"
    ? findings.find((f) => f.id === findingOverlay.id) ?? null
    : null;

  return (
    <div className="relative flex h-full w-full flex-col bg-canvas">
      {/* status-bar safe area — screen content starts below the OS chrome */}
      <div className="h-11 flex-none" aria-hidden="true" />
      {/* screen content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "home" && (
          <Home
            platform={platform}
            projects={projects}
            findings={findings}
            onOpenFindings={() => setTab("findings")}
            onOpenFinding={(id) => push({ kind: "finding", id })}
            onStartProject={() => push({ kind: "scan" })}
            onOpenSettings={() => push({ kind: "settings" })}
          />
        )}
        {tab === "discover" && <MapScreen platform={platform} />}
        {tab === "ask" && <Ask platform={platform} findings={findings} projects={projects} />}
        {tab === "projects" && (
          <Projects
            platform={platform}
            projects={projects}
            onOpenProject={(id) => push({ kind: "project", id })}
            onOpenProjectFindings={openProjectFindings}
            onAddDocuments={() => push({ kind: "scan" })}
          />
        )}
        {tab === "findings" && (
          <Findings
            platform={platform}
            findings={findings}
            projectFilter={projectFilter}
            onClearFilter={() => setProjectFilter(null)}
            onOpenFinding={(id) => push({ kind: "finding", id })}
          />
        )}
      </div>

      {/* bottom tab bar — thumb-zone primary navigation */}
      <nav className="flex flex-none items-stretch border-t border-hairline bg-canvas px-2 pb-4 pt-1.5">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 transition-colors ${
                active ? "bg-select text-ink" : "text-faint"
              }`}
            >
              <svg viewBox="0 0 16 16" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                <path d={t.icon} />
              </svg>
              <span className="text-[9.5px] font-medium">{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* overlay stack — project under finding under scan/settings */}
      {overlayProject && (
        <div className="absolute inset-0 z-40 bg-canvas">
          <ProjectDetail
            platform={platform}
            project={overlayProject}
            findings={findings.filter((f) => f.projectId === overlayProject.id)}
            onBack={pop}
            onOpenFinding={(id) => push({ kind: "finding", id })}
            onAddDocuments={() => push({ kind: "scan" })}
          />
        </div>
      )}
      {overlayFinding && (
        <div className="absolute inset-0 z-40 bg-canvas">
          <FindingDetail platform={platform} finding={overlayFinding} onBack={pop} />
        </div>
      )}
      {scanOpen && (
        <div className="absolute inset-0 z-40 bg-canvas">
          <Scan platform={platform} onClose={pop} />
        </div>
      )}
      {settingsOpen && (
        <div className="absolute inset-0 z-40 flex flex-col bg-canvas">
          <div className="flex h-12 flex-none items-center px-2">
            <button
              type="button"
              onClick={pop}
              className="flex h-11 w-11 items-center justify-center rounded-full text-muted active:bg-select"
              aria-label="Close settings"
            >
              <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Settings platform={platform} />
          </div>
        </div>
      )}
    </div>
  );
}
