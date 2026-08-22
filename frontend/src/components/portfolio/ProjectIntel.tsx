"use client";

import { useEffect, useState } from "react";
import type { Project } from "@/lib/types";

/** Mirrors the API route's IntelItem (structural typing — shared contract). */
export type IntelItem = {
  title: string;
  link: string;
  snippet?: string;
};

/**
 * "Live intel" strip inside the portfolio map popup: up to 3 recent web/news
 * snippets about the project's region, served by /api/intel. Renders nothing
 * when no intel is available so the popup stays clean.
 */
export function ProjectIntel({ project }: { project: Project }) {
  const [result, setResult] = useState<{ id: string; items: IntelItem[] } | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/intel?project=${encodeURIComponent(project.id)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data: { items?: IntelItem[] }) =>
        setResult({ id: project.id, items: data.items ?? [] }),
      )
      .catch(() => setResult({ id: project.id, items: [] }));

    return () => controller.abort();
  }, [project.id]);

  // null while the fetch for the current project is in flight.
  const items = result?.id === project.id ? result.items : null;

  if (items === null) {
    return (
      <div className="mt-2 space-y-1.5 border-t border-hairline pt-2.5">
        <div className="h-2 w-full animate-pulse rounded-full bg-surface-2" />
        <div className="h-2 w-[85%] animate-pulse rounded-full bg-surface-2" />
        <div className="h-2 w-[60%] animate-pulse rounded-full bg-surface-2" />
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="mt-2 border-t border-hairline pt-2">
      <div className="flex items-center gap-1.5">
        <span className="h-[6px] w-[6px] flex-none rounded-full bg-brand" />
        <span className="text-xs uppercase tracking-wide text-faint">
          Live intel
        </span>
      </div>

      <div className="mt-1.5 divide-y divide-hairline">
        {items.slice(0, 3).map((item) => (
          <a
            key={item.link}
            href={item.link}
            target="_blank"
            rel="noreferrer"
            className="group block py-1.5"
          >
            <div className="line-clamp-2 text-[12.5px] font-medium text-ink transition-colors group-hover:text-brand">
              {item.title}
            </div>
            {item.snippet && (
              <div className="mt-0.5 line-clamp-2 text-xs text-faint">
                {item.snippet}
              </div>
            )}
          </a>
        ))}
      </div>

      <div className="mt-1 text-xs text-faint/70">via Bright Data</div>
    </section>
  );
}
