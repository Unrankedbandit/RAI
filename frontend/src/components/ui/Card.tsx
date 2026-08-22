import { clsx } from "@/lib/clsx";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  as?: "div" | "section" | "article";
  padded?: boolean;
};

/**
 * Base surface: white, 18px radius, soft two-layer elevation, hairline-free.
 * Every panel in the app sits on one of these.
 */
export function Card({
  className,
  as: Tag = "div",
  padded = true,
  ...props
}: CardProps) {
  return (
    <Tag
      className={clsx(
        "rounded-[11px] border border-hairline bg-canvas shadow-card",
        padded && "p-5",
        className,
      )}
      {...props}
    />
  );
}
