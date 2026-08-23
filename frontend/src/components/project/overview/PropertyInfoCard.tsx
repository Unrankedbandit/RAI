"use client";

import { useProject } from "../ProjectContext";
import { useAgentReport } from "@/lib/agent/useAgentReport";
import { parseCounty } from "./CountyCodesPanel";

const NOT_IN_REPORT = "Not in the report";

/** First data point matching `test`, from the raw report's acquired_data. */
function findDataPoint(
  dataPoints: string[],
  test: RegExp,
): string | undefined {
  return dataPoints.find((dp) => test.test(dp));
}

/**
 * Property info card — APN, county, parcel size, zoning. Values come ONLY
 * from the raw report's acquired_data data points plus the project's
 * location; anything the report never surfaced reads "Not in the report".
 * Nothing here is synthesized.
 */
export function PropertyInfoCard() {
  const { project } = useProject();
  const { report } = useAgentReport(project.id);

  const dataPoints = (report?.acquired_data ?? []).flatMap(
    (a) => a.data_points,
  );

  // APN: a data point naming an assessor parcel number. Prefer the explicit
  // "APN …" token; otherwise quote the data point itself — both are verbatim.
  const apnPoint = findDataPoint(dataPoints, /\bAPN\b|assessor(?:'s)? parcel/i);
  const apn = apnPoint
    ? (apnPoint.match(/\bAPN[:\s#]*([0-9][0-9\-\s]{4,}[0-9])\b/i)?.[1].trim() ??
      apnPoint)
    : null;

  // Parcel size: a data point citing acreage.
  const sizePoint = findDataPoint(dataPoints, /\bacres?\b/i);
  const acreage = sizePoint
    ? (sizePoint.match(/[\d,]+(?:\.\d+)?\s*(?:developable\s+)?acres?/i)?.[0] ??
      sizePoint)
    : null;

  // Zoning: a data point mentioning a zoning designation/district.
  const zoningPoint = findDataPoint(
    dataPoints,
    /zoning|zoned|land[- ]use designation/i,
  );

  const county = parseCounty(report?.location ?? project.location);

  const rows: { label: string; value: string; found: boolean }[] = [
    { label: "APN", value: apn ?? NOT_IN_REPORT, found: apn !== null },
    {
      label: "County",
      value: county ?? NOT_IN_REPORT,
      found: county !== null,
    },
    {
      label: "Parcel size",
      value: acreage ?? NOT_IN_REPORT,
      found: acreage !== null,
    },
    {
      label: "Zoning",
      value: zoningPoint ?? NOT_IN_REPORT,
      found: zoningPoint !== undefined,
    },
  ];

  return (
    <div className="rounded-[11px] border border-hairline bg-canvas p-[16px_18px] shadow-card">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
        Property info
      </div>
      <div className="mt-3 divide-y divide-hairline">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline gap-3 py-2">
            <span className="w-[86px] flex-none text-[12.5px] text-faint">
              {row.label}
            </span>
            <span
              className={`min-w-0 text-[12.5px] leading-[1.45] ${
                row.found ? "font-medium text-ink" : "text-faint"
              }`}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
