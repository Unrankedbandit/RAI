"use client";

import { useState } from "react";
import { clsx } from "@/lib/clsx";
import { PortfolioRail } from "./PortfolioRail";

/**
 * Two-region layout for the portfolio-level pages (Home, Current Projects):
 * an independently scrolling left column plus the full-height, collapsible
 * Ask Questions rail. Collapsing the rail widens the left column — the same
 * deliberate space trade-off as the project workspace.
 */
export function PortfolioShell({
  children,
  maxWidth = 1000,
  wideWidth = 1400,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  wideWidth?: number;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div
          className={clsx(
            "px-8 pb-[60px] pt-[26px] transition-[max-width] duration-200 ease-out",
          )}
          style={{ maxWidth: collapsed ? wideWidth : maxWidth }}
        >
          {children}
        </div>
      </div>
      <PortfolioRail
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />
    </div>
  );
}
