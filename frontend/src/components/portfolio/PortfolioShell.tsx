"use client";

import { useState } from "react";
import { PortfolioRail } from "./PortfolioRail";

/**
 * Two-region layout for the portfolio-level pages (Home, Current Projects):
 * an independently scrolling left column plus the full-height, collapsible
 * Ask Questions rail. The content column is FLUID — it fills the space beside
 * the rail instead of leaving a dead gutter on wide screens.
 */
export function PortfolioShell({ children }: { children: React.ReactNode }) {
  // Always starts collapsed — every fresh page load shows the slim 44px
  // strip; the user expands manually (not persisted on purpose).
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="w-full px-8 pb-[60px] pt-[26px]">{children}</div>
      </div>
      <PortfolioRail
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />
    </div>
  );
}
