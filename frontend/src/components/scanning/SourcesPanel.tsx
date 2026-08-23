"use client";

import type { SourceRow } from "@/lib/scan/scanState";

const DOT_CLASS: Record<SourceRow["status"], string> = {
  fetching: "bg-watch animate-pulse",
  fetched: "bg-strong",
  repaired: "bg-vista",
  failed: "bg-risk",
  skipped: "bg-faint",
};

/** `1.2k`-style char count; blank when the backend didn't report one. */
function formatChars(chars: number | undefined): string {
  if (chars === undefined) return "";
  return chars < 1000 ? String(chars) : `${(chars / 1000).toFixed(1)}k`;
}

/** hostname + path for display; falls back to the raw string on bad URLs. */
function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, "") || u.host;
  } catch {
    return url;
  }
}

/**
 * Live sources — one row per URL the backend scrapers touched, updated in
 * place as fetch/repair/fail events stream in. Renders nothing until the
 * first scraper event arrives, so the mock and generic-SSE demos (which
 * never emit scraper frames) are unchanged.
 */
export function SourcesPanel({ sources }: { sources: SourceRow[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-5 border-t border-hairline pt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-faint">Live sources</p>
        <p className="text-xs text-faint tabular-nums">{sources.length}</p>
      </div>
      <div>
        {sources.map((s, i) => (
          <div
            key={s.url}
            className={`flex items-center gap-3 py-2${
              i > 0 ? " border-t border-hairline" : ""
            }`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[s.status]}`}
            />
            <span
              className="min-w-0 flex-1 truncate text-[12.5px] text-ink"
              title={s.url}
            >
              {displayUrl(s.url)}
            </span>
            <span className="hidden w-36 shrink-0 truncate text-[12px] text-faint sm:block">
              {s.agent ?? ""}
            </span>
            <span className="w-16 shrink-0 text-right font-jetbrains text-[11px] text-faint">
              {formatChars(s.chars)}
            </span>
            <span className="w-16 shrink-0 text-right text-[12px] text-muted">
              {s.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
