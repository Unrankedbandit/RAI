import type { TopBarProps } from "../../contracts/types";

function BookmarkGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/**
 * Slim top chrome. Sits on the screen's canvas gradient scrim, so no divider
 * or background of its own. iOS gets extra top padding (safe-area feel);
 * android runs slightly tighter.
 */
export function TopBar({ platform, savedCount, onOpenSaved }: TopBarProps) {
  const ios = platform === "ios";
  const hasSaved = savedCount > 0;
  return (
    <header
      className={`flex items-center justify-between px-4 ${ios ? "pb-2 pt-5" : "pb-1.5 pt-3"}`}
    >
      {/* wordmark */}
      <span className="flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tracking-tight text-ink">
          RAI<span className="text-brand">.</span>
        </span>
        <span className="text-sm text-muted">Parcels</span>
      </span>

      {/* saved */}
      <button
        type="button"
        onClick={onOpenSaved}
        aria-label={`Open saved parcels, ${savedCount} saved`}
        className="flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-3 text-sm text-ink transition-colors hover:bg-select active:bg-select"
      >
        <BookmarkGlyph className="h-4 w-4" />
        <span>Saved</span>
        <span
          className={`min-w-5 rounded-full px-1 py-0.5 text-center font-jetbrains text-[11px] leading-none ${
            hasSaved ? "bg-brand-soft font-medium text-brand" : "text-faint"
          }`}
        >
          {savedCount}
        </span>
      </button>
    </header>
  );
}
