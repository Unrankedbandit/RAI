/**
 * 48×28 pill switch — oxford when on, hairline when off, sliding knob.
 * Presentational only: a11y (role="switch"/aria-checked) lives on the
 * wrapping row button so the whole row is a ≥44px touch target.
 */
export function Toggle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative flex h-7 w-12 flex-none items-center rounded-full px-0.5 transition-colors duration-200 ${
        on ? "bg-oxford" : "bg-hairline"
      }`}
    >
      <span
        className={`h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </span>
  );
}
