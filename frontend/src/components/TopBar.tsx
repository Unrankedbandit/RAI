import Link from "next/link";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

/**
 * Slim top bar: navigation moved to the left sidebar, so the top strip carries
 * only the theme switch and the app's primary action — start a new project
 * (upload/scan flow).
 */
export function TopBar() {
  return (
    <div className="flex h-[57px] flex-none items-center justify-end gap-3 border-b border-hairline bg-canvas px-8">
      <ThemeToggle />
      <Link
        href="/scanning"
        className="inline-flex items-center gap-2 rounded-full bg-oxford px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M6 1.5v9M1.5 6h9" />
        </svg>
        Start new project
      </Link>
    </div>
  );
}
