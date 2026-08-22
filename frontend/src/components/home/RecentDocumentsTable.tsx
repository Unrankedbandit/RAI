import type { RecentDocument } from "@/lib/types";
import { ProcessPill } from "./ProcessPill";

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Recently added documents across the portfolio, with their pipeline state. */
export function RecentDocumentsTable({ docs }: { docs: RecentDocument[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-faint">
            <th className="pb-2 pr-4 font-medium">Document</th>
            <th className="pb-2 pr-4 font-medium">Project</th>
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 font-medium">Added</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <tr
              key={`${doc.project}-${doc.title}`}
              className="border-t border-hairline"
            >
              <td className="max-w-[18rem] truncate py-3 pr-4 text-ink">
                {doc.title}
              </td>
              <td className="py-3 pr-4 text-muted">{doc.project}</td>
              <td className="py-3 pr-4">
                <ProcessPill status={doc.status} />
              </td>
              <td className="py-3 text-muted tabular-nums">
                {formatDate(doc.addedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
