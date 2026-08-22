import Link from "next/link";
import { clsx } from "@/lib/clsx";
import { statusToLozengeClass } from "@/lib/findings";
import type { LinkedFinding } from "@/lib/types";

/**
 * Caused by / Blocks relations — hairline-separated rows inside the
 * unified detail surface (no individual cards or shadows). Each row is
 * a Link; hover uses the bg-select fill, never a border change.
 */
export function LinkedFindings({ links }: { links: LinkedFinding[] }) {
  if (links.length === 0) return null;

  return (
    <div className="mt-1 divide-y divide-hairline">
      {links.map((link) => (
        <Link
          key={link.findingId}
          href={`/findings/${link.findingId}`}
          className="block py-3 hover:bg-select"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12.5px] text-faint">
                {link.relation} ·{" "}
                <span className="mono">{link.findingId}</span>
              </div>
              <div className="mt-1 truncate text-sm font-medium text-ink">
                {link.title}
              </div>
            </div>
            <span
              className={clsx(
                "inline-flex flex-none items-center rounded-full px-2.5 py-0.5 text-[12.5px] font-medium",
                statusToLozengeClass[link.status],
              )}
            >
              {link.status}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
