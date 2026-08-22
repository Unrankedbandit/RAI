import { clsx } from "@/lib/clsx";

/** Standard page width and padding wrapper. */
export function PageContainer({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx("mx-auto w-full max-w-6xl px-6 py-8", className)}>
      {children}
    </div>
  );
}
