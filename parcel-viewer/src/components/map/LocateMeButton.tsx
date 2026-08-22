import type { LocateMeButtonProps } from "../../contracts/types";

/**
 * 44px circular canvas button with hairline ring + shadow. Idle shows an
 * inline-SVG crosshair; while locating, a brand-orange ping ring pulses
 * (Tailwind animate-ping — no libraries) and the glyph tints brand.
 */
export function LocateMeButton({ locating, onLocate }: LocateMeButtonProps) {
  return (
    <button
      type="button"
      onClick={onLocate}
      aria-label="Locate me"
      aria-busy={locating}
      className="relative flex h-11 w-11 items-center justify-center rounded-full bg-canvas shadow-md ring-1 ring-hairline"
    >
      {locating && (
        <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-brand/40" />
      )}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        className={`h-5 w-5 ${locating ? "text-brand" : "text-ink"}`}
      >
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
    </button>
  );
}
