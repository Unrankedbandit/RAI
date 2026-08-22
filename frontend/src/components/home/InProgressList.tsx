import Link from "next/link";
import type { RecentDocument } from "@/lib/types";
import { ProcessPill } from "./ProcessPill";

/**
 * Short list of projects with documents still moving through the pipeline —
 * distinct from the full portfolio on Current projects.
 */
export function InProgressList({ docs }: { docs: RecentDocument[] }) {
  if (docs.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing in the queue. Every document has been analyzed.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {docs.map((doc) => (
        <li
          key={`${doc.project}-${doc.title}`}
          className="flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm text-ink">{doc.project}</p>
            <p className="truncate text-xs text-muted">{doc.title}</p>
          </div>
          <ProcessPill status={doc.status} />
        </li>
      ))}
      <li className="border-t border-hairline pt-3">
        <Link href="/projects" className="text-sm font-medium text-vista">
          View current projects
        </Link>
      </li>
    </ul>
  );
}
