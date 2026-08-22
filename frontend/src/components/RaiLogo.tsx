/**
 * RAI wordmark — geometric "R A I" with a dark R/I (ink) and an orange A,
 * drawn as inline SVG so it stays crisp and on-palette in the top bar.
 */
export function RaiLogo({ height = 22 }: { height?: number }) {
  // viewBox is 85 wide × 32 tall; scale by height.
  const width = (height * 85) / 32;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 85 32"
      role="img"
      aria-label="RAI"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* R — ink. Stem + bowl (with counter) + leg. evenodd cuts the counter. */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0 0H18C25.18 0 30 4.7 30 11.3C30 16.2 27.2 19.7 22.8 21L31 32H19.6L12.4 21.9H9.4V32H0V0ZM9.4 7.6V14.9H16.6C19.2 14.9 20.6 13.4 20.6 11.25C20.6 9.1 19.2 7.6 16.6 7.6H9.4Z"
        fill="var(--color-ink)"
      />
      {/* A — orange. Solid chevron with a triangular counter and a crossbar. */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M45.2 0H56.8L72 32H61.2L58.7 26.4H43.3L40.8 32H30L45.2 0ZM51 10.2L46.9 19.4H55.1L51 10.2Z"
        fill="var(--color-brand)"
      />
      {/* A crossbar — short orange bar low on the A. */}
      <rect x="46.5" y="20.6" width="9" height="4.2" fill="var(--color-brand)" />
      {/* I — ink bar. */}
      <rect x="75.6" y="0" width="9.4" height="32" fill="var(--color-ink)" />
    </svg>
  );
}
