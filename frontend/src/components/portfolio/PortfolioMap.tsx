import { bandColorVar } from "@/lib/band";
import { clsx } from "@/lib/clsx";
import type { Project, RiskFactorDefinition } from "@/lib/types";
import { RiskFactorLegend } from "./RiskFactorLegend";

/**
 * Portfolio map card: a decorative Map/List toolbar, a stylized (non-geolocated)
 * panel with one pin per project coloured by risk band, and the risk-factor
 * legend beneath. Honestly labelled as a placeholder.
 */

// Fixed scatter positions, matching the reference, applied in project order.
const PIN_POSITIONS: { left: number; top: number }[] = [
  { left: 31, top: 58 },
  { left: 22, top: 44 },
  { left: 44, top: 66 },
  { left: 27, top: 70 },
  { left: 52, top: 38 },
];

export function PortfolioMap({
  projects,
  factors,
}: {
  projects: Project[];
  factors: RiskFactorDefinition[];
}) {
  return (
    <div className="flex-[1_1_300px] rounded-[11px] border border-hairline bg-white p-4 shadow-card">
      <div className="mb-3 flex justify-end gap-1.5">
        <ToggleButton active>Map</ToggleButton>
        <ToggleButton>List</ToggleButton>
      </div>

      <div className="relative h-[210px] overflow-hidden rounded-[5px] bg-surface-2">
        <div
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              "linear-gradient(to right, #ECEEF3 1px, transparent 1px), linear-gradient(to bottom, #ECEEF3 1px, transparent 1px)",
            backgroundSize: "30px 30px",
          }}
        />
        {projects.map((p, i) => {
          const pos = PIN_POSITIONS[i % PIN_POSITIONS.length];
          return (
            <span
              key={p.id}
              className="absolute size-[9px] rounded-full border-2 border-white"
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                backgroundColor: bandColorVar[p.band],
                boxShadow: "0 0 0 1px var(--color-hairline)",
              }}
              title={p.name}
            />
          );
        })}
        <div className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-[3px] text-[10px] text-faint">
          Placeholder — not geolocated
        </div>
      </div>

      <RiskFactorLegend factors={factors} />
    </div>
  );
}

function ToggleButton({
  active = false,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "rounded-full px-3 py-1.5 text-[11px] font-medium",
        active ? "bg-ink text-white" : "bg-surface-2 text-muted",
      )}
    >
      {children}
    </button>
  );
}
