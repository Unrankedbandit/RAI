import { registry } from "../../registry";
import { scoreColor, scoreVerdict } from "../../contracts/colors";
import type { ParcelSheetProps, SheetState } from "../../contracts/types";

/** Detent heights — peek ≈ 110px, half ≈ 46% of container, full ≈ 88%. */
const HEIGHTS: Record<Exclude<SheetState, "closed">, string> = {
  peek: "110px",
  half: "46%",
  full: "88%",
};

/** Grabber tap cycles peek → half → full → closed. */
const NEXT: Record<Exclude<SheetState, "closed">, SheetState> = {
  peek: "half",
  half: "full",
  full: "closed",
};

const DRIVERS = [
  { key: "openSpace", label: "Open space" },
  { key: "buildingFreedom", label: "Building-free" },
  { key: "acreageFit", label: "Acreage fit" },
] as const;

function MetaRow({
  label,
  value,
  mono = false,
  faint = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  faint?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs text-muted">{label}</span>
      <span
        className={`text-xs ${mono ? "font-jetbrains" : ""} ${
          faint ? "text-faint" : "text-ink"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function BookmarkGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M4 2.25h8v11.5l-4-3-4 3z" strokeLinejoin="round" />
    </svg>
  );
}

export function ParcelSheet({
  platform,
  parcel,
  state,
  onStateChange,
  saved,
  onToggleSave,
  onRunDueDiligence,
}: ParcelSheetProps) {
  if (!parcel || state === "closed") return null;

  const ScorePill = registry.scorePill;
  const elevated = state === "half" || state === "full";

  return (
    <>
      {/* Scrim — half/full only, ink at 20%, tap to close */}
      {elevated && (
        <button
          aria-label="Close parcel sheet"
          onClick={() => onStateChange("closed")}
          className="absolute inset-0 z-30 cursor-default bg-ink/20"
        />
      )}

      <section
        aria-label="Parcel details"
        className="absolute inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-t-3xl bg-canvas shadow-2xl ring-1 ring-hairline transition-[height] duration-300 ease-out"
        style={{ height: HEIGHTS[state] }}
      >
        {/* Score-color strip — map data-viz accent re-expressed on the sheet */}
        <div
          className="h-[3px] w-full shrink-0"
          style={{ backgroundColor: scoreColor(parcel.score) }}
        />

        {/* Grabber — tap cycles detents */}
        <button
          onClick={() => onStateChange(NEXT[state])}
          aria-label="Resize parcel sheet"
          className="flex min-h-11 w-full shrink-0 items-center justify-center"
        >
          <span
            className={`rounded-full bg-hairline ${
              platform === "ios" ? "h-1 w-9" : "h-1.5 w-12"
            }`}
          />
        </button>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/* PEEK — score, verdict, address */}
          <div className="flex items-center gap-3">
            <ScorePill score={parcel.score} size="md" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
                {scoreVerdict(parcel.score)}
              </div>
              <div className="truncate text-sm font-semibold text-ink">
                {parcel.address}
              </div>
              <div className="text-xs text-muted">
                <span className="font-jetbrains">{parcel.acres}</span> ac ·{" "}
                {parcel.county} County
              </div>
            </div>
            {state === "peek" && (
              <button
                type="button"
                aria-label="Close parcel sheet"
                onClick={() => onStateChange("closed")}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-faint transition-colors active:bg-select"
              >
                <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>

          {/* HALF — why this score + meta + save */}
          {state !== "peek" && (
            <>
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Why this score
                </h3>
                <div className="mt-2 space-y-2">
                  {DRIVERS.map(({ key, label }) => {
                    const pct = Math.round(parcel.drivers[key] * 100);
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <span className="w-24 shrink-0 text-xs text-muted">
                          {label}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-vista-soft">
                          <div
                            className="h-full rounded-full bg-vista"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-7 shrink-0 text-right font-jetbrains text-xs text-ink">
                          {pct}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 divide-y divide-hairline border-y border-hairline">
                <MetaRow label="APN" value={parcel.apn} mono />
                <MetaRow label="Zoning" value={parcel.zoning} />
                <MetaRow
                  label="Owner"
                  value={parcel.owner ?? "On file — hidden"}
                  faint={parcel.owner === undefined}
                />
              </div>

              <button
                onClick={onToggleSave}
                className={`mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition-colors ${
                  saved
                    ? "bg-brand-soft text-brand"
                    : "bg-canvas text-ink ring-1 ring-hairline"
                }`}
              >
                <BookmarkGlyph filled={saved} />
                {saved ? "Saved" : "Save parcel"}
              </button>

              {/* The seam — single CTA, reachable at half and full */}
              <button
                type="button"
                onClick={onRunDueDiligence}
                className="mt-2 w-full rounded-full bg-oxford py-3 text-sm font-semibold text-canvas transition-opacity active:opacity-80"
              >
                Run full due diligence →
              </button>
            </>
          )}

          {/* FULL — vintage stamp, disclaimer, CTA */}
          {state === "full" && (
            <>
              <div className="mt-4 space-y-1">
                <div className="font-jetbrains text-[11px] text-faint">
                  Score as of {parcel.scoredAt}
                </div>
                <p className="text-[11px] text-faint">
                  Probabilistic estimate — not an appraisal.
                </p>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
