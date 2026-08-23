"use client";

import { useState } from "react";
import { useProject } from "./ProjectContext";
import { useAgentReport } from "@/lib/agent/useAgentReport";
import { parseCounty } from "./overview/CountyCodesPanel";
import {
  getJurisdiction,
  PHASE_LABELS,
  PHASE_ORDER,
  type JurisdictionPack,
  type JurisdictionResource,
  type SubmittalPhase,
} from "@/lib/jurisdiction";
import type { AgentAgencyAction, AgentReport } from "@/lib/agent/report";

const NO_PUBLIC_FORM = "Contact the county planner — no public form";

function storageKey(projectId: string): string {
  return `solarhack.submittals.${projectId}`;
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
 * Map an action_pack agency action onto a filing phase by the agency/action
 * text. Fire/CEQA/interconnection are checked first — "Planning Division
 * (CEQA lead agency)" belongs to environmental, not entitlement. Anything
 * unmatched is honest "other".
 */
const PHASE_MATCH: [SubmittalPhase, RegExp][] = [
  ["fire", /\bfire\b/i],
  [
    "environmental",
    /ceqa|environmental|fish|wildlife|biological|conservation/i,
  ],
  [
    "interconnection",
    /edison|\bsce\b|caiso|interconnection|utilities commission|\bcpuc\b|\bferc\b/i,
  ],
  ["building", /building|grading/i],
  ["entitlement", /planning|zoning|resource management/i],
];

function phaseFor(action: AgentAgencyAction): SubmittalPhase | null {
  const hay = `${action.agency} ${action.action}`;
  for (const [phase, re] of PHASE_MATCH) {
    if (re.test(hay)) return phase;
  }
  return null;
}

const URLISH = /^https?:\/\/\S+$/i;

/** URL-shaped strings the research agents collected (acquired_data), grouped
 *  by phase when the URL mentions one. Curated links win on URL equality —
 *  these are surfaced unverified, exactly as collected. */
function researchLinks(
  report: AgentReport | null,
  curated: JurisdictionResource[],
): { phase: SubmittalPhase | null; url: string }[] {
  if (!report) return [];
  const curatedUrls = new Set(
    curated.map((r) => r.url.replace(/\/+$/, "").toLowerCase()),
  );
  const out: { phase: SubmittalPhase | null; url: string }[] = [];
  const seen = new Set<string>();
  for (const pack of report.acquired_data ?? []) {
    for (const raw of [...pack.sources, ...pack.data_points]) {
      const first = raw.trim().split(/\s+/)[0] ?? "";
      if (!URLISH.test(first)) continue;
      const norm = first.replace(/\/+$/, "").toLowerCase();
      if (seen.has(norm) || curatedUrls.has(norm)) continue;
      seen.add(norm);
      let phase: SubmittalPhase | null = null;
      for (const [p, re] of PHASE_MATCH) {
        if (re.test(first) || re.test(pack.component)) {
          phase = p;
          break;
        }
      }
      out.push({ phase, url: first });
    }
  }
  return out;
}

function ResourceRow({ resource }: { resource: JurisdictionResource }) {
  return (
    <div className="py-2.5">
      <a
        href={resource.url}
        target="_blank"
        rel="noreferrer"
        className="text-[12.5px] font-medium text-brand hover:underline"
      >
        {resource.title} <span aria-hidden>↗</span>
      </a>
      <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">
        {resource.kind}
      </span>
      <div className="mt-0.5 text-xs leading-[1.5] text-faint">
        {resource.whatFor}
      </div>
    </div>
  );
}

/**
 * "Submittal package" tab — pairs the report's action_pack agency actions
 * with the jurisdiction's REAL submittal documents (forms, checklists,
 * portals) per filing phase. Checked state persists per project in
 * localStorage. Counties without a curated pack fall back to the verified
 * planning-page root and say so; items without a verified document say
 * "contact the county planner — no public form" rather than inventing a link.
 */
export function SubmittalsTab() {
  const { project } = useProject();
  const { report } = useAgentReport(project.id);
  const [checked, setChecked] = useState<Record<string, true>>(() =>
    readChecked(project.id),
  );

  const location = report?.location ?? project.location;
  const county = parseCounty(location);
  const state = (() => {
    const tail = location.split(",").pop()?.trim() ?? "";
    if (/^[A-Z]{2}$/.test(tail)) return tail;
    const named = tail.match(/^(California|Nevada|Texas)$/i);
    return named
      ? ({ california: "CA", nevada: "NV", texas: "TX" }[
          named[1].toLowerCase()
        ] ?? null)
      : null;
  })();

  const { pack, planningRoot } = county
    ? getJurisdiction(county, state)
    : { pack: null, planningRoot: null };

  const actions = report?.action_pack?.agency_actions ?? [];
  const byPhase = new Map<SubmittalPhase, AgentAgencyAction[]>();
  const other: AgentAgencyAction[] = [];
  for (const action of actions) {
    const phase = phaseFor(action);
    if (phase) {
      byPhase.set(phase, [...(byPhase.get(phase) ?? []), action]);
    } else {
      other.push(action);
    }
  }

  const extra = researchLinks(report, pack?.resources ?? []);

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

  const total = actions.length;
  const done = actions.filter((a) => checked[`agency:${a.agency}:${a.action}`]).length;

  const renderAction = (action: AgentAgencyAction, withDoc: boolean) => {
    const key = `agency:${action.agency}:${action.action}`;
    const isDone = Boolean(checked[key]);
    return (
      <label key={key} className="flex cursor-pointer items-start gap-2.5 py-2">
        <input
          type="checkbox"
          checked={isDone}
          onChange={() => toggle(key)}
          className="mt-[3px] h-3.5 w-3.5 flex-none accent-brand"
        />
        <span className="min-w-0">
          <span
            className={`block text-[12.5px] leading-[1.45] ${
              isDone ? "text-faint line-through" : "font-medium text-ink"
            }`}
          >
            {action.agency} — {action.action}
          </span>
          <span className="mt-0.5 block text-xs text-faint">
            {[
              action.why,
              action.deadline ? `Deadline: ${action.deadline}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {!withDoc && (
            <span className="mt-0.5 block text-xs italic text-faint">
              {NO_PUBLIC_FORM}
            </span>
          )}
        </span>
      </label>
    );
  };

  const renderPhase = (pack: JurisdictionPack, phase: SubmittalPhase) => {
    const resources = pack.resources.filter((r) => r.phase === phase);
    const phaseActions = byPhase.get(phase) ?? [];
    const phaseExtra = extra.filter((e) => e.phase === phase);
    if (resources.length === 0 && phaseActions.length === 0 && !pack.notes[phase])
      return null;
    return (
      <div
        key={phase}
        className="rounded-[11px] border border-hairline bg-canvas p-[16px_18px] shadow-card"
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
          {PHASE_LABELS[phase]}
        </div>

        {resources.length > 0 && (
          <div className="mt-1 divide-y divide-hairline">
            {resources.map((r) => (
              <ResourceRow key={r.url} resource={r} />
            ))}
          </div>
        )}

        {phaseExtra.length > 0 && (
          <div className="mt-1 border-t border-hairline pt-2">
            {phaseExtra.map((e) => (
              <div key={e.url} className="py-1 text-[12.5px]">
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-brand hover:underline"
                >
                  {e.url} <span aria-hidden>↗</span>
                </a>
                <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                  from project research — unverified
                </span>
              </div>
            ))}
          </div>
        )}

        {pack.notes[phase] && (
          <div className="mt-2 rounded-[5px] bg-surface-2 p-[8px_10px] text-xs leading-[1.5] text-muted">
            {pack.notes[phase]}
          </div>
        )}

        {phaseActions.length > 0 && (
          <div className="mt-2 border-t border-hairline pt-1">
            <div className="mt-1 text-[12px] font-semibold text-muted">
              Checklist items for this phase
            </div>
            <div className="divide-y divide-hairline">
              {phaseActions.map((a) => renderAction(a, resources.length > 0))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-[14px]">
      {/* Header */}
      <div className="rounded-[11px] border border-hairline bg-canvas p-7 shadow-card">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[15px] font-semibold text-ink">
            Submittal package{county ? ` — ${county}` : ""}
          </div>
          {total > 0 && (
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] text-muted">
              {done}/{total} filings done
            </span>
          )}
        </div>
        <div className="text-[12.5px] leading-[1.5] text-faint">
          {pack
            ? `The actual forms, checklists, and portals to file with ${county}${state ? `, ${state}` : ""} authorities — every link verified ${pack.verifiedAt}. Check items off as you file; state persists in this browser.`
            : county
              ? `We have not verified the submittal documents for ${county} yet — start at the county planning page below. Checklist items from the report still track here.`
              : "County not identified in the report — no jurisdiction documents to pair."}
        </div>
        {pack?.portal && (
          <div className="mt-3">
            <a
              href={pack.portal.url}
              target="_blank"
              rel="noreferrer"
              className="group inline-block rounded-[5px] border border-hairline bg-surface-2 p-[10px_12px]"
            >
              <div className="text-[12.5px] font-medium text-ink transition-colors group-hover:text-brand">
                {pack.portal.title} <span aria-hidden>↗</span>
              </div>
              <div className="mt-0.5 text-xs text-faint">
                {pack.portal.whatFor}
              </div>
            </a>
          </div>
        )}
        {!pack && planningRoot && (
          <div className="mt-3">
            <a
              href={planningRoot.url}
              target="_blank"
              rel="noreferrer"
              className="group inline-block rounded-[5px] border border-hairline bg-surface-2 p-[10px_12px]"
            >
              <div className="text-[12.5px] font-medium text-ink transition-colors group-hover:text-brand">
                {planningRoot.label} <span aria-hidden>↗</span>
              </div>
              <div className="mt-0.5 text-xs text-faint">
                County planning page root — this county&apos;s forms are not
                curated yet
              </div>
            </a>
          </div>
        )}
      </div>

      {/* Phase cards (curated pack) */}
      {pack && PHASE_ORDER.map((phase) => renderPhase(pack, phase))}

      {/* Other / unpaired agency actions */}
      {(other.length > 0 || (!pack && actions.length > 0)) && (
        <div className="rounded-[11px] border border-hairline bg-canvas p-[16px_18px] shadow-card">
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
            {pack ? "Other agency actions" : "Agency actions from the report"}
          </div>
          <div className="divide-y divide-hairline">
            {(pack ? other : actions).map((a) => renderAction(a, false))}
          </div>
        </div>
      )}

      {/* Research-collected links that matched no phase */}
      {extra.some((e) => e.phase === null) && (
        <div className="rounded-[11px] border border-hairline bg-canvas p-[16px_18px] shadow-card">
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
            Also found in project research — unverified
          </div>
          <div className="mt-2 space-y-1 text-[12.5px]">
            {extra
              .filter((e) => e.phase === null)
              .map((e) => (
                <a
                  key={e.url}
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all text-brand hover:underline"
                >
                  {e.url} <span aria-hidden>↗</span>
                </a>
              ))}
          </div>
        </div>
      )}

      {!report && (
        <div className="rounded-[11px] border border-hairline bg-canvas p-[16px_18px] text-[12.5px] text-faint shadow-card">
          No agent report for this project — checklist items appear here after
          a run. The jurisdiction documents above still apply.
        </div>
      )}
    </div>
  );
}
