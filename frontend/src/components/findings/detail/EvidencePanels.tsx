import { Card } from "@/components/ui/Card";
import type { Finding } from "@/lib/types";

/**
 * Wrap the asserted value in <mark> inside the excerpt. When the exact
 * value string doesn't appear literally (e.g. "$199–211M" vs "$199.4M"),
 * fall back to highlighting the numeric tokens in the excerpt.
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
 * Side-by-side evidence panels for a contradiction finding. Gap findings
 * have no pair — render a plain note instead of the panels.
 */
export function EvidencePanels({ finding }: { finding: Finding }) {
  if (!finding.evidence) {
    return (
      <Card>
        <div className="text-sm text-muted">
          Gap — no counter-evidence in the dossier.
        </div>
      </Card>
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
          <Card key={side.source} className="flex-1">
            <div className="text-[12.5px] font-medium text-ink">
              {side.source}
            </div>
            {side.excerpt && (
              <blockquote className="mt-2 border-l-2 border-hairline pl-3 text-sm leading-[1.6] text-muted">
                <HighlightedExcerpt excerpt={side.excerpt} value={side.value} />
              </blockquote>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
