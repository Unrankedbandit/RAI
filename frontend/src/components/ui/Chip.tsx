import { clsx } from "@/lib/clsx";

type ChipProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  tone?: "neutral" | "brand";
};

/**
 * Fully-rounded chip/button used for suggested questions, filters and
 * secondary actions. Sentence case, no icons.
 */
export function Chip({
  className,
  active,
  tone = "neutral",
  ...props
}: ChipProps) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
        "focus-visible:outline-2",
        active
          ? tone === "brand"
            ? "bg-brand text-white"
            : "bg-ink text-white"
          : "bg-surface-2 text-ink hover:bg-vista-soft",
        className,
      )}
      {...props}
    />
  );
}
