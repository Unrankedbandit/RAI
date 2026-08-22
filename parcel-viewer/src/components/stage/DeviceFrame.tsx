import type { DeviceFrameProps } from "../../contracts/types";

/**
 * DeviceFrame — presentation-stage device chrome for the side-by-side mockup.
 * Pure CSS/Tailwind glyphs only: no image assets, no icon libraries.
 * All status-bar/home-indicator chrome is a pointer-events-none overlay so the
 * app rendered inside the screen receives every interaction uninterrupted.
 */

/* ---------- pure-CSS status glyphs (shared, per-platform sizing) ---------- */

/** Ascending cellular-signal bars. */
function SignalGlyph({ compact = false }: { compact?: boolean }) {
  const bars = compact
    ? ["h-[3px]", "h-[5px]", "h-[7px]", "h-[9px]"]
    : ["h-[4px]", "h-[6px]", "h-[8px]", "h-[11px]"];
  return (
    <span className={`inline-flex items-end ${compact ? "gap-[1.5px]" : "gap-[2px]"}`}>
      {bars.map((h) => (
        <span
          key={h}
          className={`${h} ${compact ? "w-[2px]" : "w-[3px]"} rounded-[1px] bg-ink`}
        />
      ))}
    </span>
  );
}

/** Wifi fan: two concentric quarter-arcs (border-top of clipped circles) + source dot. */
function WifiGlyph({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`relative inline-block overflow-hidden ${
        compact ? "h-[10px] w-[13px]" : "h-[12px] w-[16px]"
      }`}
    >
      <span
        className={`absolute left-1/2 top-[2px] -translate-x-1/2 rounded-full border-2 border-transparent border-t-ink ${
          compact ? "h-[11px] w-[11px]" : "h-[14px] w-[14px]"
        }`}
      />
      <span
        className={`absolute left-1/2 -translate-x-1/2 rounded-full border-2 border-transparent border-t-ink ${
          compact ? "top-[5px] h-[7px] w-[7px]" : "top-[6px] h-[8px] w-[8px]"
        }`}
      />
      <span
        className={`absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-ink ${
          compact ? "h-[2px] w-[2px]" : "h-[3px] w-[3px]"
        }`}
      />
    </span>
  );
}

/** Outline battery with nub and ~72% fill. */
function BatteryGlyph({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`relative inline-flex ${compact ? "h-[10px] w-[18px]" : "h-[12px] w-[24px]"}`}>
      <span
        className={`block h-full w-full border border-ink/50 p-[1.5px] ${
          compact ? "rounded-[2px]" : "rounded-[3px]"
        }`}
      >
        <span className="block h-full w-[72%] rounded-[1.5px] bg-ink" />
      </span>
      <span
        className={`absolute top-1/2 -translate-y-1/2 rounded-r-full bg-ink/50 ${
          compact ? "-right-[2.5px] h-[3px] w-[1.5px]" : "-right-[3px] h-[4px] w-[2px]"
        }`}
      />
    </span>
  );
}

/* ---------- per-platform screen overlays ---------- */

function IosChrome() {
  return (
    <>
      {/* Dynamic Island — floats over the status area */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[12px] z-30 h-[30px] w-[110px] -translate-x-1/2 rounded-full bg-ink"
      />
      {/* Status bar */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-[54px] items-start justify-between px-8 pt-[20px]"
      >
        <span className="text-[15px] leading-none font-semibold text-ink">9:41</span>
        <span className="flex items-center gap-[6px]">
          <SignalGlyph />
          <WifiGlyph />
          <BatteryGlyph />
        </span>
      </div>
      {/* Home indicator */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center"
      >
        <div className="h-[4px] w-[130px] rounded-full bg-ink" />
      </div>
    </>
  );
}

function AndroidChrome() {
  return (
    <>
      {/* Status bar with centered punch-hole camera */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-[36px] items-center justify-between px-5"
      >
        <span className="text-[13px] leading-none font-medium text-ink">9:41</span>
        <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" />
        <span className="flex items-center gap-[5px]">
          <WifiGlyph compact />
          <SignalGlyph compact />
          <BatteryGlyph compact />
        </span>
      </div>
      {/* Gesture pill */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-[6px] z-20 flex justify-center"
      >
        <div className="h-[4px] w-[110px] rounded-full bg-ink/30" />
      </div>
    </>
  );
}

/* ---------- frame ---------- */

export function DeviceFrame({ platform, label, children }: DeviceFrameProps) {
  const ios = platform === "ios";
  return (
    <div className="flex w-fit flex-col items-center">
      <div className="mb-3 text-center text-xs font-medium text-muted">{label}</div>
      <div className={`bg-oxford shadow-2xl ${ios ? "rounded-[54px] p-[10px]" : "rounded-[38px] p-[6px]"}`}>
        <div
          className={`relative overflow-hidden bg-canvas ring-1 ring-inset ring-hairline ${
            ios ? "h-[820px] w-[390px] rounded-[44px]" : "h-[840px] w-[400px] rounded-[32px]"
          }`}
        >
          {children}
          {ios ? <IosChrome /> : <AndroidChrome />}
        </div>
      </div>
    </div>
  );
}
