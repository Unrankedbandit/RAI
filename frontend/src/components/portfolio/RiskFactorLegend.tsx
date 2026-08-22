import type { PillarName, RiskFactorDefinition } from "@/lib/types";

/**
 * The five risk factors are CATEGORY identifiers, not statuses, so they carry
 * their own fixed palette (distinct from the grey / near-black / orange status
 * system) and a short one-line descriptor each.
 */
const CATEGORY_COLOR: Record<PillarName, string> = {
  Land: "#3E8E8A",
  Law: "#2C3E66",
  Finance: "#1E1E26",
  Materials: "#C46B3F",
  Demand: "#5B8C4C",
};

const CATEGORY_SUB: Record<PillarName, string> = {
  Land: "Site control, interconnection",
  Law: "Permitting, zoning",
  Finance: "CAPEX, financing terms",
  Materials: "Suppliers, lead times",
  Demand: "Offtake, grid capacity",
};

export function RiskFactorLegend({
  factors,
}: {
  factors: RiskFactorDefinition[];
}) {
  return (
    <div className="mt-3.5">
      <div className="mb-2.5 text-[11px] font-medium text-faint">
        Risk factors evaluated
      </div>
      <div className="grid grid-cols-2 gap-x-3.5 gap-y-2">
        {factors.map((f) => (
          <div key={f.name} className="flex items-start gap-[7px]">
            <span
              className="mt-1 block size-[7px] shrink-0 rounded-full"
              style={{ backgroundColor: CATEGORY_COLOR[f.name] }}
              aria-hidden
            />
            <div>
              <div className="text-[11.5px] font-medium text-ink">{f.name}</div>
              <div className="text-[10px] text-faint">{CATEGORY_SUB[f.name]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
