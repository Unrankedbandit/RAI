import { useState, type ReactNode } from "react";
import type { SettingsScreenProps } from "../../contracts/types";
import { Toggle } from "./settings/Toggle";

/** iOS grouped-list idiom: small uppercase group label over a rounded card. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">
        {label}
      </h2>
      <div className="divide-y divide-hairline overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-hairline">
        {children}
      </div>
    </section>
  );
}

/** Whole row is the switch target (min-h-14 ≈ 56px), toggle is the visual. */
function ToggleRow({
  label,
  sub,
  on,
  onChange,
}: {
  label: string;
  sub: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-surface-2"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-[10.5px] text-faint">{sub}</span>
      </span>
      <Toggle on={on} />
    </button>
  );
}

export function SettingsScreen({ platform }: SettingsScreenProps) {
  const [prefs, setPrefs] = useState({
    contradictionAlerts: true,
    weeklyDigest: true,
    savedScoreChanges: false,
    flagContradictions: true,
  });
  const set =
    (key: keyof typeof prefs) =>
    (v: boolean) =>
      setPrefs((p) => ({ ...p, [key]: v }));

  return (
    <div className="flex flex-col gap-5 px-4 pb-10 pt-5" data-platform={platform}>
      <h1 className="text-[20px] font-semibold text-ink">Settings</h1>

      {/* profile */}
      <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-hairline">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-oxford text-[12px] font-semibold text-white">
          JD
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink">Jordan Developer</div>
          <div className="mt-0.5 text-[11px] text-faint">jordan@rai.energy · Full access</div>
        </div>
      </div>

      <Group label="Notifications">
        <ToggleRow
          label="Contradiction alerts"
          sub="When claims conflict across project documents"
          on={prefs.contradictionAlerts}
          onChange={set("contradictionAlerts")}
        />
        <ToggleRow
          label="Weekly portfolio digest"
          sub="Monday summary of score movement across projects"
          on={prefs.weeklyDigest}
          onChange={set("weeklyDigest")}
        />
        <ToggleRow
          label="Saved parcel score changes"
          sub="When a saved parcel's readiness score moves"
          on={prefs.savedScoreChanges}
          onChange={set("savedScoreChanges")}
        />
      </Group>

      <Group label="Preferences">
        <ToggleRow
          label="Flag cross-document contradictions"
          sub="Highlight conflicting claims during project scans"
          on={prefs.flagContradictions}
          onChange={set("flagContradictions")}
        />
        <button
          type="button"
          onClick={() => {
            /* no-op in mockup */
          }}
          className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-surface-2"
        >
          <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">
            Score vintage display
          </span>
          <span className="text-[12px] text-muted">Always show</span>
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5 flex-none text-faint"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 3l5 5-5 5" />
          </svg>
        </button>
      </Group>

      <Group label="About">
        <div className="px-4 py-3.5">
          <div className="text-[13px] font-medium text-ink">RAI mobile mockup</div>
          <p className="mt-1 text-[11px] leading-relaxed text-faint">
            Scores are probabilistic estimates — not appraisals.
          </p>
          <div className="mt-2 font-jetbrains text-[10px] text-faint">v0.1.0-mock</div>
        </div>
      </Group>
    </div>
  );
}
