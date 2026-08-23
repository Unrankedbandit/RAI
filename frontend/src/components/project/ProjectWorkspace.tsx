"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ProjectHeader } from "./ProjectHeader";
import { SubNav, type ProjectTab } from "./SubNav";
import { TimelineStrip } from "./TimelineStrip";
import { AskRail } from "./AskRail";
import { ShareModal } from "./ShareModal";
import { OverviewTab } from "./OverviewTab";
import { FindingsTab } from "./FindingsTab";
import { ReportsTab } from "./ReportsTab";
import { DocumentsTab } from "./DocumentsTab";
import { MapTab } from "./MapTab";

const PROJECT_TABS: ProjectTab[] = [
  "overview",
  "findings",
  "reports",
  "documents",
  "map",
];

function parseTab(value: string | null): ProjectTab {
  return PROJECT_TABS.includes(value as ProjectTab)
    ? (value as ProjectTab)
    : "overview";
}

/**
 * The project workspace shell: a persistent two-region layout —
 * an independently scrolling left column (sticky header + timeline strip +
 * sub-nav tabs + tab content) and a full-height, edge-to-edge right rail.
 * The content column is FLUID — it fills the space beside the rail instead
 * of leaving a dead gutter on wide screens.
 *
 * The active tab is URL-aware: `?tab=<id>` initializes and drives it (so deep
 * links like `/projects/<id>?tab=findings#finding-x` open the right tab), and
 * SubNav clicks update the URL via router.replace — no history spam.
 */
function ProjectWorkspaceBody() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // The tab IS the URL (?tab=<id>, default "overview") — no local copy to
  // keep in sync: deep links (e.g. a Map-tab "View finding" link) open the
  // right tab, SubNav clicks router.replace without history spam.
  const tab = parseTab(params.get("tab"));

  const changeTab = (next: ProjectTab) => {
    router.replace(`${pathname}?tab=${next}`, { scroll: false });
  };

  // Always starts collapsed — every fresh page load shows the slim 44px
  // strip; the user expands manually (not persisted on purpose).
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="w-full px-4 pb-[60px] sm:px-8">
          {/* Sticky only from md up: on phones the header + timeline + subnav
              block is ~350px tall, and sticking it would leave half the small
              viewport as permanent chrome. Desktop sticky behaviour unchanged. */}
          <div className="z-[15] bg-canvas pb-[18px] pt-[26px] md:sticky md:top-0">
            <ProjectHeader onShare={() => setShareOpen(true)} />
            {/* The strip positions its dots absolutely by percentage — below
                its design width the labels would collide, so on phones it
                scrolls sideways at a fixed minimum width instead. */}
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <TimelineStrip />
              </div>
            </div>
            <SubNav active={tab} onChange={changeTab} />
          </div>

          {tab === "overview" && <OverviewTab />}
          {tab === "findings" && <FindingsTab />}
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

export function ProjectWorkspace() {
  // useSearchParams needs a Suspense boundary in prerendered pages (Next 16);
  // wrapped inside the component because projects/[id]/page.tsx renders
  // ProjectWorkspace directly.
  return (
    <Suspense fallback={null}>
      <ProjectWorkspaceBody />
    </Suspense>
  );
}
