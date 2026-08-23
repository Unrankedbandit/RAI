"use client";

import { useState } from "react";
import { useProject } from "../ProjectContext";
import { useAgentReport } from "@/lib/agent/useAgentReport";

interface ChecklistItem {
  /** Stable identity — the persisted map key is the item text itself. */
  key: string;
  text: string;
  /** Secondary line (agency "why"/deadline), when the report carries one. */
  sub?: string;
}

interface ChecklistGroup {
  title: string;
  items: ChecklistItem[];
}

function storageKey(projectId: string): string {
  return `solarhack.checklist.${projectId}`;
}

function readChecked(projectId: string): Record<string, true> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(
      window.localStorage.getItem(storageKey(projectId)) ?? "{}",
    ) as Record<string, true>;
  } catch {
    return {};
  }
}

/**
 * The report's action_pack as an interactive checklist, grouped by kind.
 * Checked state persists per-project in localStorage. Mock projects have no
 * raw report — the checklist renders nothing rather than inventing actions.
 */
export function ActionChecklist() {
  const { project } = useProject();
  const { report } = useAgentReport(project.id);
  const [checked, setChecked] = useState<Record<string, true>>(() =>
    readChecked(project.id),
  );

  if (!report) return null;

  const pack = report.action_pack;
  const groups: ChecklistGroup[] = [
    {
      title: "Requests for information",
      items: (pack.rfis ?? []).map((text) => ({ key: `rfi:${text}`, text })),
    },
    {
      title: "Agency actions",
      items: (pack.agency_actions ?? []).map((a) => ({
        key: `agency:${a.agency}:${a.action}`,
        text: `${a.agency} — ${a.action}`,
        sub:
          [a.why, a.deadline ? `Deadline: ${a.deadline}` : null]
            .filter(Boolean)
            .join(" · ") || undefined,
      })),
    },
    {
      title: "Verification requests",
      items: (pack.verification_requests ?? []).map((text) => ({
        key: `verify:${text}`,
        text,
      })),
    },
    {
      title: "Conditions precedent",
      items: (pack.conditions_precedent ?? []).map((text) => ({
        key: `cond:${text}`,
        text,
      })),
    },
  ].filter((g) => g.items.length > 0);

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total === 0) return null;

  const toggle = (key: string) => {
    const next = { ...checked };
    if (next[key]) delete next[key];
    else next[key] = true;
    setChecked(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(storageKey(project.id), JSON.stringify(next));
      } catch {
        // Quota — the checklist still works for the session.
      }
    }
  };

  const done = groups.reduce(
    (n, g) => n + g.items.filter((i) => checked[i.key]).length,
    0,
  );

  return (
    <div className="mt-[14px] rounded-[11px] border border-hairline bg-canvas p-[16px_18px] shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
          Action checklist
        </span>
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] text-muted">
          {done}/{total} done
        </span>
      </div>

      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="mb-1.5 text-[12px] font-semibold text-muted">
              {group.title}
            </div>
            <div className="divide-y divide-hairline">
              {group.items.map((item) => {
                const isDone = Boolean(checked[item.key]);
                return (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-start gap-2.5 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={() => toggle(item.key)}
                      className="mt-[3px] h-3.5 w-3.5 flex-none accent-brand"
                    />
                    <span className="min-w-0">
                      <span
                        className={`block text-[12.5px] leading-[1.45] ${
                          isDone
                            ? "text-faint line-through"
                            : "font-medium text-ink"
                        }`}
                      >
                        {item.text}
                      </span>
                      {item.sub && (
                        <span className="mt-0.5 block text-xs text-faint">
                          {item.sub}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
