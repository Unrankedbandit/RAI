import Link from "next/link";
import { clsx } from "@/lib/clsx";
import { statusToLozengeClass } from "@/lib/findings";
import type { LinkedFinding } from "@/lib/types";

/**
 * Caused by / Blocks relation cards — each routes to the linked finding.
 * Hover uses the bg-select fill, never a border change.
 */
export function LinkedFindings({ links }: { links: LinkedFinding[] }) {
  if (links.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {links.map((link) => (
        <Link
          key={link.findingId}
          href={`/findings/${link.findingId}`}
          className="block rounded-[11px] border border-hairline bg-white p-4 shadow-card hover:bg-select"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] text-faint">
                {link.relation} ·{" "}
                <span className="font-jetbrains">{link.findingId}</span>
              </div>
              <div className="mt-1 text-[13px] font-medium text-ink">
                {link.title}
              </div>
            </div>
            <span
              className={clsx(
                "inline-flex flex-none items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-medium",
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
