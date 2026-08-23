"use client";

import { clsx } from "@/lib/clsx";

export type ProjectTab =
  | "overview"
  | "findings"
  | "reports"
  | "documents"
  | "submittals"
  | "map";

const tabs: { id: ProjectTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "findings", label: "Findings" },
  { id: "reports", label: "Reports" },
  { id: "documents", label: "Documents" },
  { id: "submittals", label: "Submittals" },
  { id: "map", label: "Map" },
];

/** Pill-group sub-nav (Overview / Findings / Reports / Documents / Map). */
export function SubNav({
  active,
  onChange,
}: {
  active: ProjectTab;
  onChange: (tab: ProjectTab) => void;
}) {
  return (
    <div className="mb-[22px] flex w-fit gap-1 rounded-full bg-surface-2 p-1">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={clsx(
              "whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-canvas text-ink shadow-card"
                : "text-muted hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
