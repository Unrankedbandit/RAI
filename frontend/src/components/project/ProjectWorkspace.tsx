"use client";

import { useState } from "react";
import { clsx } from "@/lib/clsx";
import { ProjectHeader } from "./ProjectHeader";
import { SubNav, type ProjectTab } from "./SubNav";
import { TimelineStrip } from "./TimelineStrip";
import { AskRail } from "./AskRail";
import { ShareModal } from "./ShareModal";
import { OverviewTab } from "./OverviewTab";
import { ReportsTab } from "./ReportsTab";
import { DocumentsTab } from "./DocumentsTab";
import { MapTab } from "./MapTab";

/**
 * The project workspace shell: a persistent two-region layout —
 * an independently scrolling left column (sticky header + timeline strip +
 * sub-nav tabs + tab content) and a full-height, edge-to-edge right rail.
 * Collapsing the rail widens the left column (a deliberate space trade-off,
 * per the reference).
 */
export function ProjectWorkspace() {
  const [tab, setTab] = useState<ProjectTab>("overview");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div
          className={clsx(
            "px-8 pb-[60px] transition-[max-width] duration-200 ease-out",
            railCollapsed ? "max-w-[1400px]" : "max-w-[960px]",
          )}
        >
          <div className="sticky top-0 z-[15] bg-canvas pb-[18px] pt-[26px]">
            <ProjectHeader onShare={() => setShareOpen(true)} />
            <TimelineStrip />
            <SubNav active={tab} onChange={setTab} />
          </div>

          {tab === "overview" && <OverviewTab />}
          {tab === "reports" && <ReportsTab />}
          {tab === "documents" && <DocumentsTab />}
          {tab === "map" && <MapTab />}
        </div>
      </div>

      <AskRail
        collapsed={railCollapsed}
        onToggle={() => setRailCollapsed((c) => !c)}
      />

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}
