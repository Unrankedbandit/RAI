import type { GradientLegendProps } from "../../contracts/types";
import { scoreColor, scoreVerdict } from "../../contracts/colors";

const TICKS = [0, 25, 50, 75, 100] as const;

/** Ramp gradient built strictly from scoreColor() — no hardcoded hex. */
const GRADIENT = `linear-gradient(90deg, ${TICKS.map((t) => `${scoreColor(t)} ${t}%`).join(", ")})`;

function ChevronUpGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

/**
 * Score legend card. The whole card is the toggle. Collapsed shows just the
 * 96px ramp + caption; expanded adds mono tick labels, No-go/Go endpoints,
 * a no-data swatch, and the luminance (colorblind-safety) note. Anchored in
 * the bottom-left rail, so the expand chevron points up.
 */
export function GradientLegend({ collapsed, onToggle }: GradientLegendProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Expand score legend" : "Collapse score legend"}
      className="block cursor-pointer rounded-2xl bg-canvas p-3 text-left shadow-md ring-1 ring-hairline"
    >
      {collapsed ? (
        <span className="flex flex-col gap-1.5">
          <span className="block h-2 w-24 rounded-full" style={{ background: GRADIENT }} />
          <span className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted">Score</span>
            <ChevronUpGlyph className="h-3 w-3 text-faint" />
          </span>
        </span>
      ) : (
        <span className="flex w-fit flex-col gap-1.5">
          <span
            className="block h-2 w-full min-w-44 rounded-full"
            style={{ background: GRADIENT }}
          />
          {/* tick labels aligned to the ramp stops */}
          <span className="relative block h-3">
            {TICKS.map((t) => (
              <span
                key={t}
                className="absolute top-0 font-jetbrains text-[10px] leading-none text-faint"
                style={{
                  left: `${t}%`,
                  transform:
                    t === 0 ? "none" : t === 100 ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {t}
              </span>
            ))}
          </span>
          <span className="flex justify-between text-[11px] font-medium text-muted">
            <span>{scoreVerdict(0)}</span>
            <span>{scoreVerdict(100)}</span>
          </span>
          <span className="mt-1 flex items-center gap-1.5 border-t border-hairline pt-2">
            <span className="block h-3 w-3 rounded-[4px] bg-nodata ring-1 ring-hairline" />
            <span className="text-[11px] text-muted">No data</span>
          </span>
          <span className="whitespace-nowrap text-[10px] text-faint">
            Luminance-encoded for colorblind safety
          </span>
        </span>
      )}
    </button>
  );
}
