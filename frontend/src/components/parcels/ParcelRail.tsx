"use client";

import { useEffect, useState, useState, type JSX, type ReactNode } from "react";

import { ViabilityPreview } from "@/components/parcels/ViabilityPreview";
import { clsx } from "@/lib/clsx";
import type { ParcelResult } from "@/lib/parcels/counties";
import {
  removeRecent,
  toSavedParcel,
  unwatchParcel,
  useRecent,
  useWatching,
  watchParcel,
  type SavedParcel,
} from "@/lib/parcels/watchlist";

/**
 * ParcelRail — the parcels page's right-side inventory sidebar, always
 * visible. Top to bottom: the selected-parcel at-a-glance card (while a
 * lookup is active), the watched-parcels list, and recent lookups. The
 * parent positions/sizes the rail (absolute right, w-[360px]); this fills
 * it and scrolls as a single column.
 */
const digits = (s: string) => s.replace(/\D/g, "");
function matchReportId(
  parcel: ParcelResult | null,
  researched: { id: string; name: string }[],
): string | null {
  if (!parcel) return null;
  const apn = digits(parcel.apn ?? "");
  const addr = (parcel.address ?? "").toLowerCase();
  for (const r of researched) {
    const rd = digits(r.name);
    if (apn.length >= 6 && rd.includes(apn)) return r.id;
    if (rd.length >= 6 && apn.includes(rd)) return r.id;
    if (addr && r.name.toLowerCase().includes(addr)) return r.id;
  }
  return null;
}

export function ParcelRail(props: {
  selected: ParcelResult | null;
  panelStatus: "idle" | "loading" | "found" | "empty" | "error";
  onCloseSelected: () => void;
  onResearch: (p: ParcelResult) => void;
  onFlyTo: (lng: number, lat: number) => void;
}): JSX.Element {
  const { selected, panelStatus, onCloseSelected, onResearch, onFlyTo } = props;
  const [researched, setResearched] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let live = true;
    void import("@/lib/agent/researched").then((m) =>
      m.loadResearchedParcels().then((rows) => {
        if (live) setResearched(rows.map((r) => ({ id: r.id, name: r.name })));
      }),
    );
    return () => {
      live = false;
    };
  }, []);
  const reportId = matchReportId(selected, researched);
  const watching = useWatching();
  const recent = useRecent();
  const [justWatched, setJustWatched] = useState(false);

  const handleWatch = () => {
    if (!selected) return;
    // No lng/lat: the geometry centroid isn't computed in the rail.
    watchParcel(toSavedParcel(selected));
    setJustWatched(true);
    window.setTimeout(() => setJustWatched(false), 1500);
  };

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto">
      {panelStatus !== "idle" && (
        <section className="flex-none rounded-[11px] border border-hairline bg-canvas p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-faint">
              Selected parcel
            </span>
            <button
              type="button"
              aria-label="Close parcel details"
              onClick={onCloseSelected}
              className="text-faint hover:text-ink"
            >
              <CloseIcon />
            </button>
          </div>

          {panelStatus === "loading" && (
            <div className="space-y-2">
              <div className="h-2 w-full animate-pulse rounded-full bg-surface-2" />
              <div className="h-2 w-[85%] animate-pulse rounded-full bg-surface-2" />
              <div className="h-2 w-[60%] animate-pulse rounded-full bg-surface-2" />
            </div>
          )}

          {panelStatus === "empty" && (
            <p className="text-[12.5px] text-muted">
              No parcel matched — try zooming in or another county.
            </p>
          )}

          {panelStatus === "error" && (
            <p className="text-[12.5px] text-muted">
              Lookup failed — check your connection and retry.
            </p>
          )}

          {panelStatus === "found" && selected && (
            <SelectedParcel
              parcel={selected}
            reportId={reportId}
              justWatched={justWatched}
              onWatch={handleWatch}
              onResearch={onResearch}
            />
          )}
        </section>
      )}

      {/* Watching / Recent are hidden below md: on phones the rail overlays
          the map full-width, so these lists covered it — mobile keeps only
          the selected-parcel card. Desktop renders both, unchanged. */}
      <div className="hidden md:block">
        <ParcelList
          label="Watching"
          parcels={watching}
          emptyText="Save parcels to keep an eye on them."
          removeLabel="Remove from watching"
          onRemove={unwatchParcel}
          onFlyTo={onFlyTo}
        />
      </div>

      <div className="hidden md:block">
        <ParcelList
          label="Recent"
          parcels={recent}
          emptyText="Parcels you look up will land here."
          removeLabel="Remove from recent"
          onRemove={removeRecent}
          onFlyTo={onFlyTo}
        />
      </div>
    </div>
  );
}

/** At-a-glance selected-parcel layout — title, stat grid, research CTA, watch. */
function SelectedParcel({
  parcel,
  justWatched,
  onWatch,
  onResearch,
  reportId,
}: {
  parcel: ParcelResult;
  justWatched: boolean;
  onWatch: () => void;
  onResearch: (p: ParcelResult) => void;
  reportId?: string | null;
}) {
  const title = parcel.address ?? parcel.apn ?? "Unnamed parcel";
  return (
    <div>
      <div className="text-sm font-semibold text-ink">{title}</div>
      {parcel.address && parcel.apn && (
        <div className="mono mt-0.5 text-[12.5px] text-faint">{parcel.apn}</div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {typeof parcel.acres === "number" && (
          <StatCell label="Acres" title={`${formatAcres(parcel.acres)} ac`}>
            {formatAcres(parcel.acres)}{" "}
            <span className="text-xs font-normal text-faint">ac</span>
          </StatCell>
        )}
        {parcel.landUse && (
          <StatCell label="Land use" title={parcel.landUse}>
            {parcel.landUse}
          </StatCell>
        )}
        <StatCell label="County" title={parcel.county}>
          {parcel.county}
        </StatCell>
        {parcel.owner && (
          <StatCell label="Owner" title={parcel.owner}>
            {parcel.owner}
          </StatCell>
        )}
      </div>

      <ViabilityPreview parcel={parcel} />

      {reportId && (
        <a
          href={`/projects/${reportId}`}
          className="mt-3 block w-full rounded-full border border-brand py-2 text-center text-[12.5px] font-semibold text-brand hover:bg-brand/5"
        >
          View report → (already researched)
        </a>
      )}
      <button
        type="button"
        onClick={() => onResearch(parcel)}
        className="mt-3 w-full rounded-full bg-brand py-2 text-[12.5px] font-medium text-white hover:opacity-90"
      >
        Research this parcel
      </button>
      <p className="mt-1.5 text-center text-xs text-faint">
        Deep-dive viability + developer interest
      </p>

      <div className="mt-2">
        <button
          type="button"
          onClick={onWatch}
          className="text-[12.5px] text-muted hover:text-ink"
        >
          {justWatched ? "Watching ✓" : "＋ Watch"}
        </button>
      </div>
    </div>
  );
}

function StatCell({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-[5px] bg-surface-2 px-2.5 py-2">
      <div className="text-xs text-faint">{label}</div>
      <div
        className="mt-0.5 truncate text-sm font-semibold text-ink"
        title={title}
      >
        {children}
      </div>
    </div>
  );
}

/** One saved-parcel list section (Watching / Recent): header + count, rows. */
function ParcelList({
  label,
  parcels,
  emptyText,
  removeLabel,
  onRemove,
  onFlyTo,
}: {
  label: string;
  parcels: SavedParcel[];
  emptyText: string;
  removeLabel: string;
  onRemove: (key: string) => void;
  onFlyTo: (lng: number, lat: number) => void;
}) {
  return (
    <section className="rounded-[11px] border border-hairline bg-canvas p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-faint">
          {label}
        </span>
        <span className="rounded-full bg-surface-2 px-1.5 py-px text-xs text-faint">
          {parcels.length}
        </span>
      </div>
      {parcels.length === 0 ? (
        <p className="mt-2 text-xs text-faint">{emptyText}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {parcels.map((parcel) => (
            <ParcelRow
              key={parcel.key}
              parcel={parcel}
              removeLabel={removeLabel}
              onRemove={onRemove}
              onFlyTo={onFlyTo}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ParcelRow({
  parcel,
  removeLabel,
  onRemove,
  onFlyTo,
}: {
  parcel: SavedParcel;
  removeLabel: string;
  onRemove: (key: string) => void;
  onFlyTo: (lng: number, lat: number) => void;
}) {
  const { lng, lat } = parcel;
  const coords =
    typeof lng === "number" && typeof lat === "number" ? { lng, lat } : null;
  const label = parcel.address ?? parcel.apn ?? "Unnamed parcel";
  const sub = [
    parcel.county,
    typeof parcel.acres === "number" ? `${formatAcres(parcel.acres)} ac` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const text = (
    <>
      <span
        className="block truncate text-[12.5px] font-medium text-ink"
        title={label}
      >
        {label}
      </span>
      <span className="mt-0.5 block truncate text-xs text-faint">{sub}</span>
    </>
  );

  return (
    <li
      className={clsx(
        "flex items-center gap-2 rounded-[5px] border border-hairline px-2.5 py-2",
        coords && "transition-colors hover:bg-surface-2",
      )}
    >
      {coords ? (
        <button
          type="button"
          onClick={() => onFlyTo(coords.lng, coords.lat)}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          {text}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{text}</div>
      )}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(parcel.key);
        }}
        className="flex-none text-faint hover:text-ink"
      >
        <CloseIcon />
      </button>
    </li>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
      <path
        d="M2 2l8 8M10 2l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Acres display: thousands separators, up to 2 decimals, no trailing zeros. */
function formatAcres(acres: number): string {
  return acres.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
