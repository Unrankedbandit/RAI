"use client";

import { useMemo, useState } from "react";
import { PortfolioShell } from "@/components/portfolio/PortfolioShell";
import { AskLauncher } from "@/components/ui/AskLauncher";
import { ProjectLane } from "@/components/findings/queue/ProjectLane";
import { QuickLookPane } from "@/components/findings/queue/QuickLookPane";
import {
  QueueToolbar,
  type QueueFilter,
} from "@/components/findings/queue/QueueToolbar";
import { severityOrder, statusOrder } from "@/lib/findings";
import { findings, projects, qualitativeScoreLabel } from "@/lib/mockData";
import type { Finding } from "@/lib/types";

/** Mock-local owner rotation for the Reassign action. */
const REASSIGN_CYCLE = ["JR", "AK", "MS"];

/** mock-only state: per-finding overrides applied by Reassign/Mark resolved. */
type FindingOverride = Partial<Pick<Finding, "status" | "ownerInitials">>;

type Lane = {
  projectId: string;
  projectName: string;
  bandLabel: string;
  openCount: number;
  items: Finding[];
};

export default function FindingsPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // mock-only state: Reassign/Mark resolved patch findings locally, nothing persists.
  const [overrides, setOverrides] = useState<Record<string, FindingOverride>>(
    {},
  );

  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [],
  );

  const applyOverrides = useMemo(
    () => (f: Finding): Finding =>
      overrides[f.id] ? { ...f, ...overrides[f.id] } : f,
    [overrides],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return findings.map(applyOverrides).filter((f) => {
      if (
        filter === "needs-action" &&
        f.status !== "Open" &&
        f.status !== "Blocked"
      ) {
        return false;
      }
      if (filter === "high" && f.severity !== "High") return false;
      if (q) {
        const hay =
          `${f.title} ${f.id} ${f.workstream} ${projectNameById.get(f.projectId) ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [query, filter, applyOverrides, projectNameById]);

  const lanes = useMemo(() => {
    const byProject = new Map<string, Finding[]>();
    for (const f of visible) {
      const list = byProject.get(f.projectId);
      if (list) list.push(f);
      else byProject.set(f.projectId, [f]);
    }

    const out: Lane[] = [];
    for (const p of projects) {
      const items = (byProject.get(p.id) ?? []).sort(
        (a, b) =>
          statusOrder[a.status] - statusOrder[b.status] ||
          severityOrder[a.severity] - severityOrder[b.severity],
      );
      if (items.length === 0) continue; // skip lanes with zero visible findings
      const openCount = items.filter(
        (f) => f.status === "Open" || f.status === "Blocked",
      ).length;
      out.push({
        projectId: p.id,
        projectName: p.name,
        bandLabel: qualitativeScoreLabel(p.activationScore),
        openCount,
        items,
      });
    }

    // Lanes needing action first, then open-count desc, then name for stability.
    out.sort((a, b) => {
      const activeA = a.openCount > 0 ? 0 : 1;
      const activeB = b.openCount > 0 ? 0 : 1;
      if (activeA !== activeB) return activeA - activeB;
      if (a.openCount !== b.openCount) return b.openCount - a.openCount;
      return a.projectName.localeCompare(b.projectName);
    });
    return out;
  }, [visible]);

  const selected = useMemo(() => {
    if (!selectedId) return undefined;
    const base = findings.find((f) => f.id === selectedId);
    return base ? applyOverrides(base) : undefined;
  }, [selectedId, applyOverrides]);

  // mock-only state: cycles ownerInitials through REASSIGN_CYCLE.
  function reassignSelected() {
    if (!selected) return;
    const current = selected.ownerInitials[0];
    const idx = current ? REASSIGN_CYCLE.indexOf(current) : -1;
    const next = REASSIGN_CYCLE[(idx + 1) % REASSIGN_CYCLE.length];
    setOverrides((prev) => ({
      ...prev,
      [selected.id]: { ...prev[selected.id], ownerInitials: [next] },
    }));
  }

  // mock-only state: sets status to "Resolved" locally.
  function markSelectedResolved() {
    if (!selected) return;
    setOverrides((prev) => ({
      ...prev,
      [selected.id]: { ...prev[selected.id], status: "Resolved" },
    }));
  }

  return (
    <PortfolioShell>
      <div className="flex items-center gap-2">
        <div className="text-2xl font-semibold text-ink">Findings</div>
        <AskLauncher context={{ scope: "queue" }} />
      </div>
      <p className="mt-1 mb-[22px] text-[15px] text-muted">
        Every contradiction and gap across the portfolio, in one queue.
      </p>

      <div className="mb-[18px]">
        <QueueToolbar
          query={query}
          onQueryChange={setQuery}
          filter={filter}
          onFilterChange={setFilter}
          resultCount={visible.length}
        />
      </div>

      {/* flex-wrap + a minimum lane width: when the content column is too
          narrow for queue rows beside the 380px pane (e.g. 1280px viewport
          with the Ask rail open), the pane drops below instead of clipping
          the rows' fixed columns. */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[460px] flex-1 space-y-3">
          {lanes.length === 0 ? (
            <div className="rounded-[11px] border border-hairline bg-canvas px-5 py-[18px] text-sm text-faint shadow-card">
              No findings match the current filters.
            </div>
          ) : (
            lanes.map((lane) => (
              <ProjectLane
                key={lane.projectId}
                projectName={lane.projectName}
                bandLabel={lane.bandLabel}
                openCount={lane.openCount}
                items={lane.items}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ))
          )}
        </div>

        <div className="w-[380px] max-w-full shrink-0">
          <QuickLookPane
            finding={selected}
            projectName={
              selected ? projectNameById.get(selected.projectId) : undefined
            }
            onReassign={reassignSelected}
            onMarkResolved={markSelectedResolved}
          />
        </div>
      </div>
    </PortfolioShell>
  );
}
