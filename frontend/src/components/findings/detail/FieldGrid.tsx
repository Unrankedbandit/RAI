import { clsx } from "@/lib/clsx";
import { severityToFlagColor, statusToLozengeClass } from "@/lib/findings";
import type { Finding } from "@/lib/types";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-faint">
        {label}
      </div>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

/**
 * Two-column meta grid — the top section of the unified detail surface
 * (no card chrome of its own; the page supplies padding and dividers).
 * Left: Type / Severity / Workstream. Right: Status / Owner / Detected.
 * All colors resolve through lib/findings helpers.
 */
export function FieldGrid({ finding }: { finding: Finding }) {
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Field label="Type">
          {finding.evidence ? "Contradiction" : "Gap"}
        </Field>
        <Field label="Severity">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: severityToFlagColor[finding.severity] }}
            />
            {finding.severity}
          </span>
        </Field>
        <Field label="Workstream">{finding.workstream}</Field>
      </div>
      <div className="flex flex-col gap-4">
        <Field label="Status">
          <span
            className={clsx(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-[12.5px] font-medium",
              statusToLozengeClass[finding.status],
            )}
          >
            {finding.status}
          </span>
        </Field>
        <Field label="Owner">
          {finding.ownerInitials.length > 0 ? (
            <span className="inline-flex items-center -space-x-1.5">
              {finding.ownerInitials.map((initials) => (
                <span
                  key={initials}
                  className="mono inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-[12.5px] font-medium text-muted ring-1 ring-hairline"
                >
                  {initials}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-muted">Unassigned</span>
          )}
        </Field>
        <Field label="Detected">
          <span className="mono text-[12.5px]">
            {finding.detectedAt}
            <span className="text-faint"> · {finding.updatedAt}</span>
          </span>
        </Field>
      </div>
    </div>
  );
}
