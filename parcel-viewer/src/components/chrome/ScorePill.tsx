import type { ScorePillProps } from "../../contracts/types";
import { scoreColor, scoreVerdict } from "../../contracts/colors";

type Size = NonNullable<ScorePillProps["size"]>;

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-3 py-1 text-sm",
  lg: "px-4 py-2 text-lg",
};

const DOT_CLASSES: Record<Size, string> = {
  sm: "h-2 w-2",
  md: "h-2.5 w-2.5",
  lg: "h-3 w-3",
};

/**
 * Compact score readout, resolved by other components through the registry —
 * intentionally dependency-free (contracts only). Leading dot + numeral come
 * straight from the frozen ramp; the muted verdict label appears at size lg.
 */
export function ScorePill({ score, size = "md" }: ScorePillProps) {
  const display = Math.round(score);
  return (
    <span
      aria-label={`Solar development score ${display} out of 100, ${scoreVerdict(score)}`}
      className={`inline-flex items-center gap-1.5 rounded-full bg-canvas text-ink ring-1 ring-hairline ${SIZE_CLASSES[size]}`}
    >
      <span
        className={`shrink-0 rounded-full ${DOT_CLASSES[size]}`}
        style={{ backgroundColor: scoreColor(score) }}
        aria-hidden="true"
      />
      <span className="font-jetbrains font-semibold leading-none">{display}</span>
      {size === "lg" && (
        <span className="text-xs font-medium text-muted">{scoreVerdict(score)}</span>
      )}
    </span>
  );
}
