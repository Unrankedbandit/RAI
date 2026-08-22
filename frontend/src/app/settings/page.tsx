"use client";

import { useState } from "react";
import { PageContainer } from "@/components/ui/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { clsx } from "@/lib/clsx";

/** Accessible switch — real checkbox, no icon glyphs, sentence case. */
function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-4">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-xs text-muted">{hint}</span>
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className={clsx(
            "h-5 w-9 rounded-full transition-colors",
            checked ? "bg-ink" : "bg-surface-2",
            "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2",
          )}
        />
        <span
          className={clsx(
            "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-card transition-transform",
            checked && "translate-x-4",
          )}
        />
      </span>
    </label>
  );
}

const bandOptions = [
  { band: "strong" as const, label: "Cleared" },
  { band: "watch" as const, label: "Watch" },
  { band: "risk" as const, label: "Flagged" },
];

export default function SettingsPage() {
  const [workspace, setWorkspace] = useState("RAI Capital");
  const [prefs, setPrefs] = useState({
    autoRun: true,
    contradictions: true,
    notify: false,
  });
  const [clearedAt, setClearedAt] = useState(70);
  const [watchAt, setWatchAt] = useState(40);

  const set = (key: keyof typeof prefs) => (v: boolean) =>
    setPrefs((p) => ({ ...p, [key]: v }));

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold text-ink">Settings</h1>
      <p className="mt-1 text-sm text-muted">
        Workspace and analysis preferences.
      </p>

      <div className="mt-6 space-y-6">
        {/* Workspace */}
        <Card>
          <h2 className="text-sm font-semibold text-ink">Workspace</h2>
          <p className="mt-0.5 text-xs text-muted">
            How this workspace is labelled across reports and exports.
          </p>
          <div className="mt-4 max-w-sm">
            <label
              htmlFor="workspace-name"
              className="block text-sm font-medium text-ink"
            >
              Workspace name
            </label>
            <input
              id="workspace-name"
              type="text"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              className="mt-2 w-full rounded-[5px] border border-hairline bg-white px-3 py-2 text-sm text-ink placeholder:text-faint"
              placeholder="Workspace name"
            />
          </div>
        </Card>

        {/* Analysis preferences */}
        <Card>
          <h2 className="text-sm font-semibold text-ink">
            Analysis preferences
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Control how RAI processes new documents.
          </p>
          <div className="mt-2 divide-y divide-hairline">
            <Switch
              checked={prefs.autoRun}
              onChange={set("autoRun")}
              label="Auto-run analysis on upload"
              hint="Start the risk analysis as soon as a document finishes uploading."
            />
            <Switch
              checked={prefs.contradictions}
              onChange={set("contradictions")}
              label="Flag cross-document contradictions"
              hint="Surface figures that disagree between two source documents."
            />
            <Switch
              checked={prefs.notify}
              onChange={set("notify")}
              label="Notify on new red flags"
              hint="Send a summary when a new high-impact flag is raised."
            />
          </div>
        </Card>

        {/* Risk-threshold bands */}
        <Card>
          <h2 className="text-sm font-semibold text-ink">Risk thresholds</h2>
          <p className="mt-0.5 text-xs text-muted">
            Set the activation-score cutoffs that define each band.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="cleared-at"
                className="flex items-center justify-between text-sm font-medium text-ink"
              >
                Cleared at or above
                <StatusPill band="strong" label="Cleared" size="sm" dot={false} />
              </label>
              <input
                id="cleared-at"
                type="number"
                min={0}
                max={100}
                value={clearedAt}
                onChange={(e) => setClearedAt(Number(e.target.value))}
                className="mt-2 w-full rounded-[5px] border border-hairline bg-white px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label
                htmlFor="watch-at"
                className="flex items-center justify-between text-sm font-medium text-ink"
              >
                Watch at or above
                <StatusPill band="watch" label="Watch" size="sm" dot={false} />
              </label>
              <input
                id="watch-at"
                type="number"
                min={0}
                max={100}
                value={watchAt}
                onChange={(e) => setWatchAt(Number(e.target.value))}
                className="mt-2 w-full rounded-[5px] border border-hairline bg-white px-3 py-2 text-sm text-ink"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[5px] bg-surface-2 px-4 py-3 text-xs text-muted">
            <span>Preview:</span>
            {bandOptions.map((o) => (
              <StatusPill key={o.band} band={o.band} label={o.label} size="sm" />
            ))}
            <span className="ml-1">
              Scores below {watchAt} are flagged.
            </span>
          </div>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="ghost">Reset</Button>
          <Button variant="primary">Save changes</Button>
        </div>
      </div>
    </PageContainer>
  );
}
