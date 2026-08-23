/**
 * "Backend offline — showing demo data" marker.
 *
 * The one honest place mock data is allowed to appear: a page may fall back
 * to the seeded demo rows only when the agent backend is unreachable, and
 * only ever beneath this banner. Never render mock rows without it.
 */
export function OfflineBanner() {
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-[5px] border border-hairline bg-watch-soft px-3.5 py-2.5 text-[12.5px] font-medium text-watch-ink"
    >
      <span
        aria-hidden
        className="inline-block h-[7px] w-[7px] flex-none rounded-full"
        style={{ backgroundColor: "var(--color-watch)" }}
      />
      Backend offline — showing demo data
    </div>
  );
}
