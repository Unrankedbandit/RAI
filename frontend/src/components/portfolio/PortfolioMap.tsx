"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

import { bandColorVar } from "@/lib/band";
import { clsx } from "@/lib/clsx";
import type { Project, RiskFactorDefinition } from "@/lib/types";
import { RiskFactorLegend } from "./RiskFactorLegend";

/**
 * Portfolio map card: a working Map/List toggle, a real geolocated MapLibre
 * map (client-only) with one pin per project coloured by risk band, and the
 * risk-factor legend beneath.
 */

// MapLibre needs the browser — the dynamic() + ssr:false pair must live in
// this Client Component (it is not allowed in Server Components).
const PortfolioMapView = dynamic(() => import("./PortfolioMapView"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-surface-2" />,
});

export function PortfolioMap({
  projects,
  factors,
}: {
  projects: Project[];
  factors: RiskFactorDefinition[];
}) {
  const [view, setView] = useState<"map" | "list">("map");

  return (
    <div className="flex-[1_1_300px] rounded-[11px] border border-hairline bg-canvas p-4 shadow-card">
      <div className="mb-3 flex justify-end gap-1.5">
        <ToggleButton active={view === "map"} onClick={() => setView("map")}>
          Map
        </ToggleButton>
        <ToggleButton active={view === "list"} onClick={() => setView("list")}>
          List
        </ToggleButton>
      </div>

      {view === "map" ? (
        <div className="relative h-[360px] overflow-hidden rounded-[5px] bg-surface-2">
          <PortfolioMapView projects={projects} />
        </div>
      ) : (
        <div className="h-[360px] overflow-y-auto rounded-[5px] border border-hairline">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="flex items-center gap-2.5 border-b border-hairline px-3 py-2.5 last:border-b-0 hover:bg-surface-2"
            >
              <span
                className="block size-[9px] shrink-0 rounded-full border-2 border-canvas"
                style={{
                  backgroundColor: bandColorVar[p.band],
                  boxShadow: "0 0 0 1px var(--color-hairline)",
                }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[12px] font-medium text-ink"
                  title={p.name}
                >
                  {p.name}
                </span>
                <span className="block truncate text-[12.5px] text-faint">
                  {p.location}
                </span>
              </span>
              <span className="shrink-0 text-[12px] font-semibold text-ink tabular-nums">
                {p.activationScore}
              </span>
            </Link>
          ))}
        </div>
      )}

      <RiskFactorLegend factors={factors} />
    </div>
  );
}

function ToggleButton({
  active = false,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-full px-3 py-1.5 text-xs font-medium",
        active ? "bg-oxford text-white" : "bg-surface-2 text-muted",
      )}
    >
      {children}
    </button>
  );
}
