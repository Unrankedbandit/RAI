"use client";

import { useState } from "react";
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
 * The content column is FLUID — it fills the space beside the rail instead
 * of leaving a dead gutter on wide screens.
 */
export function ProjectWorkspace() {
  const [tab, setTab] = useState<ProjectTab>("overview");
  // Always starts collapsed — every fresh page load shows the slim 44px
  // strip; the user expands manually (not persisted on purpose).
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="w-full px-4 pb-[60px] sm:px-8">
          <div className="sticky top-0 z-[15] bg-canvas pb-[18px] pt-[26px]">
            <ProjectHeader onShare={() => setShareOpen(true)} />
            {/* The strip positions its dots absolutely by percentage — below
                its design width the labels would collide, so on phones it
                scrolls sideways at a fixed minimum width instead. */}
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <TimelineStrip />
              </div>
            </div>
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
