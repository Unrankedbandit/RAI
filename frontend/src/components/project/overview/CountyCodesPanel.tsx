"use client";

import { useProject } from "../ProjectContext";
import { useAgentReport } from "@/lib/agent/useAgentReport";

/**
 * "X County" out of a report/location string ("Solano County, California",
 * "Kings County, CA"). Multi-word counties ("De Kalb County") are handled;
 * city-only locations ("Eldorado Valley, Boulder City, NV") yield null and
 * the panel says so rather than guessing a jurisdiction.
 */
export function parseCounty(location: string): string | null {
  const match = location.match(
    /([A-Z][A-Za-z.'-]*(?: [A-Z][A-Za-z.'-]*)* County)\b/,
  );
  return match ? match[1] : null;
}

type CountyLink = { url: string; label: string; caption: string };

/**
 * Deep links verified to resolve (HTTP 200 + search-indexed code page) at
 * build time. A county not in this table falls back to the verified library
 * ROOT — we never emit an unverified deep URL.
 *
 * Verified 2026-08-23:
 *  - https://library.municode.com/  → 200 (library root, the fallback)
 *  - https://library.municode.com/nv/clark_county/codes/code_of_ordinances
 *      → 200 and indexed as "Code of Ordinances | Clark County, NV"
 */
const VERIFIED_DEEP_LINKS: Record<string, CountyLink> = {
  "clark county|nv": {
    url: "https://library.municode.com/nv/clark_county/codes/code_of_ordinances",
    label: "Clark County, NV Code of Ordinances",
    caption: "Municode Library",
  },
};

const LIBRARY_ROOT = "https://library.municode.com/";

function stateToken(location: string): string | null {
  const tail = location.split(",").pop()?.trim() ?? "";
  if (/^[A-Z]{2}$/.test(tail)) return tail;
  const named = tail.match(/^(California|Nevada|Texas)$/i);
  if (!named) return null;
  const map: Record<string, string> = {
    california: "CA",
    nevada: "NV",
    texas: "TX",
  };
  return map[named[1].toLowerCase()] ?? null;
}

/**
 * County codes panel — links to the municipal/zoning code library for the
 * county named in the report's location. Only verified URLs are ever shown.
 */
export function CountyCodesPanel() {
  const { project } = useProject();
  const { report } = useAgentReport(project.id);
  const location = report?.location ?? project.location;
  const county = parseCounty(location);

  return (
    <div className="rounded-[11px] border border-hairline bg-canvas p-[16px_18px] shadow-card">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
        County codes
      </div>

      {county === null ? (
        <div className="mt-3 text-[12.5px] text-faint">
          County not identified in the report
        </div>
      ) : (
        <div className="mt-3">
          <div className="mb-2 text-[13px] font-semibold text-ink">{county}</div>
          {(() => {
            const deep =
              VERIFIED_DEEP_LINKS[
                `${county.toLowerCase()}|${stateToken(location) ?? ""}`
              ];
            const link: CountyLink = deep ?? {
              url: LIBRARY_ROOT,
              label: "Municode Library",
              caption: `Search the library for the ${county} code`,
            };
            return (
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="group block rounded-[5px] border border-hairline bg-surface-2 p-[10px_12px]"
              >
                <div className="text-[12.5px] font-medium text-ink transition-colors group-hover:text-brand">
                  {link.label} <span aria-hidden>↗</span>
                </div>
                <div className="mt-0.5 text-xs text-faint">{link.caption}</div>
              </a>
            );
          })()}
        </div>
      )}
    </div>
  );
}
