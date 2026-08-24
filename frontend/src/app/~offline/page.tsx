import Link from "next/link";

/**
 * Offline fallback — precached by the service worker and served when a
 * navigation can't be satisfied from the network or the page cache.
 * Styled to the same tokens as ui/OfflineBanner (watch band, 5px radius).
 */
export default function OfflinePage() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-[420px] rounded-[11px] border border-hairline bg-canvas p-6 shadow-card">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
          <span
            aria-hidden
            className="inline-block h-[7px] w-[7px] flex-none rounded-full"
            style={{ backgroundColor: "var(--color-watch)" }}
          />
          You&rsquo;re offline
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          This page isn&rsquo;t in the offline cache yet. Pages you&rsquo;ve
          already visited stay available — reconnect to load anything new.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-[7px] bg-ink px-4 py-2 text-[13px] font-semibold text-canvas"
        >
          Back to start
        </Link>
      </div>
    </div>
  );
}
