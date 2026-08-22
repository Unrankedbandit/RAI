import { clsx } from "@/lib/clsx";
import { bandPillClass } from "@/lib/band";
import type { RiskBand } from "@/lib/types";

type StatusPillProps = {
  band: RiskBand;
  label: string;
  size?: "sm" | "md";
  /** Show a small filled dot before the label. */
  dot?: boolean;
  className?: string;
};

/**
 * Fully-rounded status pill. The only place risk color meets text.
 * Sentence case, no icons — the dot is a plain colored circle, not a glyph.
 */
export function StatusPill({
  band,
  label,
  size = "md",
  dot = true,
  className,
}: StatusPillProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm",
        bandPillClass[band],
        className,
      )}
    >
      {dot && (
        <span
          className="inline-block rounded-full"
          style={{
            width: size === "sm" ? 6 : 7,
            height: size === "sm" ? 6 : 7,
            backgroundColor:
              band === "strong"
                ? "var(--color-strong)"
                : band === "watch"
                  ? "var(--color-watch)"
                  : "var(--color-risk)",
          }}
        />
      )}
      {label}
    </span>
  );
}
