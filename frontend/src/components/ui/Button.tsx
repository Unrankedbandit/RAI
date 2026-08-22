import { clsx } from "@/lib/clsx";

type Variant = "primary" | "secondary" | "ghost";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
};

const variantClass: Record<Variant, string> = {
  primary: "bg-brand text-white hover:brightness-95",
  secondary: "bg-canvas text-ink shadow-card hover:bg-surface-2",
  ghost: "bg-transparent text-ink hover:bg-surface-2",
};

/** Fully-rounded button. Sentence case, no icons. */
export function Button({
  className,
  variant = "secondary",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex items-center justify-center rounded-full font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" ? "px-3.5 py-1.5 text-sm" : "px-4 py-2 text-sm",
        variantClass[variant],
        className,
      )}
      {...props}
    />
  );
}
