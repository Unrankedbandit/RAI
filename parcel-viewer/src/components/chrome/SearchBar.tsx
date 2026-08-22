import type { SearchBarProps } from "../../contracts/types";

function MagnifierGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ClearGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/**
 * Floating search pill. iOS = fully rounded with a lighter shadow;
 * android = slightly squarer (rounded-2xl) with a touch more elevation.
 */
export function SearchBar({ platform, value, onChange, placeholder }: SearchBarProps) {
  const ios = platform === "ios";
  return (
    <div
      role="search"
      className={`group flex items-center gap-2 bg-canvas pl-3.5 ring-1 ring-hairline transition-shadow focus-within:ring-2 focus-within:ring-vista ${
        ios ? "rounded-full shadow-sm" : "rounded-2xl shadow-md"
      } ${value ? "pr-2" : "pr-3.5"}`}
    >
      <MagnifierGlyph className="h-4 w-4 shrink-0 text-faint transition-colors group-focus-within:text-vista" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Address, APN, or county…"}
        aria-label="Search parcels"
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="w-full bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-faint"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-muted active:bg-select"
        >
          <ClearGlyph className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
