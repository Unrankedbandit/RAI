import { severityToFlagColor } from "@/lib/findings";
import type { Finding } from "@/lib/types";

/**
 * Wrap the asserted value in <mark> inside the excerpt. When the exact
 * value string doesn't appear literally (e.g. "$199–211M" vs "$199.4M"),
 * fall back to highlighting the numeric tokens in the excerpt. The
 * highlight is bg-brand-soft — token-based, with a dark-mode override.
 */
function HighlightedExcerpt({
  excerpt,
  value,
}: {
  excerpt: string;
  value: string;
}) {
  const markClass = "bg-brand-soft text-ink px-0.5 rounded";
  const idx = excerpt.indexOf(value);

  if (idx >= 0) {
    return (
      <>
        {excerpt.slice(0, idx)}
        <mark className={markClass}>{value}</mark>
        {excerpt.slice(idx + value.length)}
      </>
    );
  }

  const tokens = excerpt.split(/(\$[\d,.]+[A-Za-z%]?|\d+(?:\.\d+)?%?)/g);
  return (
    <>
      {tokens.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className={markClass}>
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * Side-by-side evidence for a contradiction finding, rendered as
 * recessed inner panels (surface-2, hairline, severity-tinted left
 * accent, NO shadow) inside the unified detail surface. Gap findings
 * have no pair — render a plain note instead of the panels.
 */
export function EvidencePanels({ finding }: { finding: Finding }) {
  if (!finding.evidence) {
    return (
      <div className="text-sm text-muted">
        Gap — no counter-evidence in the dossier.
      </div>
    );
  }

  const { left, right } = finding.evidence;

  return (
    <div>
      <span className="mb-2 inline-flex items-center rounded-full bg-brand-soft px-2.5 py-1 text-[12.5px] font-medium text-risk-ink">
        conflicts with
      </span>
      <div className="flex flex-col gap-3 lg:flex-row">
        {[left, right].map((side) => (
          <div
            key={side.source}
            className="min-w-0 flex-1 rounded-[5px] border border-hairline border-l-2 bg-surface-2 p-4"
            style={{ borderLeftColor: severityToFlagColor[finding.severity] }}
          >
            <div
              className="mono truncate text-[12.5px] font-medium text-ink"
              title={side.source}
            >
              {side.source}
            </div>
            {side.excerpt && (
              <blockquote className="mt-2 border-l-2 border-hairline pl-3 text-sm leading-[1.6] text-muted">
                <HighlightedExcerpt excerpt={side.excerpt} value={side.value} />
              </blockquote>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
