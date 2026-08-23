"use client";

import {
  useCallback,
  useEffect,
  useId,
  useState,
  type JSX,
} from "react";
import { createPortal } from "react-dom";
import { Layer, Source } from "react-map-gl/maplibre";

import {
  BASEMAP_LABELS,
  BASEMAP_STYLES,
  type BasemapId,
} from "@/components/maps/basemaps";
import { MAP_OVERLAYS } from "@/components/maps/overlays";

/**
 * MapLayersControl — basemap switcher + optional GIS overlay toggles,
 * rendered as a CHILD of a react-map-gl <Map>.
 *
 * - Enabled overlays the user has toggled on render as declarative
 *   <Source>/<Layer> children (ParcelViewer pattern): react-map-gl re-adds
 *   them automatically when the basemap style swaps via setStyle, so the
 *   overlays survive basemap changes with no imperative re-adding.
 * - The trigger is the standard top-right pill (PortfolioMapView precedent).
 *   The panel is an absolute card below it on md+; on mobile it's a
 *   portal-mounted bottom sheet (backdrop + Esc + ✕ to close), because the
 *   map container's overflow-hidden would clip a fixed sheet otherwise.
 * - State comes from useMapLayers(storageKey), which persists
 *   {basemap, overlays} to localStorage under `rai.mapLayers.${storageKey}`
 *   — one key per page/map surface. Writes happen inside the event handlers,
 *   never in an effect (react-hooks/set-state-in-effect).
 * Client-only — consumers load their map via next/dynamic with ssr:false;
 * the one localStorage read is still window-guarded.
 */

interface MapLayersState {
  basemap: BasemapId;
  overlays: Record<string, boolean>;
}

const DEFAULT_STATE: MapLayersState = { basemap: "satellite", overlays: {} };

function storageKeyFor(key: string): string {
  return `rai.mapLayers.${key}`;
}

/** Parse persisted state; anything malformed falls back to the defaults. */
function readStored(key: string): MapLayersState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(storageKeyFor(key));
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<MapLayersState>;
    const basemap =
      typeof parsed.basemap === "string" && parsed.basemap in BASEMAP_STYLES
        ? (parsed.basemap as BasemapId)
        : DEFAULT_STATE.basemap;
    const overlays: Record<string, boolean> = {};
    if (parsed.overlays && typeof parsed.overlays === "object") {
      for (const def of MAP_OVERLAYS) {
        const v = parsed.overlays[def.id];
        if (typeof v === "boolean") overlays[def.id] = v;
      }
    }
    return { basemap, overlays };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeStored(key: string, state: MapLayersState): void {
  try {
    window.localStorage.setItem(storageKeyFor(key), JSON.stringify(state));
  } catch {
    // Private-mode / quota failures just lose persistence.
  }
}

/**
 * Per-map-surface layer state: satellite basemap + all overlays off by
 * default, hydrated from (and persisted to) localStorage. storageKey is
 * treated as a per-page constant — changing it does not re-hydrate.
 */
export function useMapLayers(storageKey: string): {
  basemap: BasemapId;
  setBasemap: (b: BasemapId) => void;
  isOverlayOn: (id: string) => boolean;
  toggleOverlay: (id: string) => void;
} {
  const [state, setState] = useState<MapLayersState>(() =>
    readStored(storageKey),
  );

  // Persistence writes live inside the updaters so they always carry the
  // full next state; the write is idempotent, so StrictMode's double-invoked
  // updaters are harmless.
  const setBasemap = useCallback(
    (basemap: BasemapId) => {
      setState((prev) => {
        if (prev.basemap === basemap) return prev;
        const next = { ...prev, basemap };
        writeStored(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const toggleOverlay = useCallback(
    (id: string) => {
      setState((prev) => {
        const next = {
          ...prev,
          overlays: { ...prev.overlays, [id]: !prev.overlays[id] },
        };
        writeStored(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const isOverlayOn = useCallback(
    (id: string) => state.overlays[id] === true,
    [state.overlays],
  );

  return { basemap: state.basemap, setBasemap, isOverlayOn, toggleOverlay };
}

// Radio order follows the Record's insertion order: satellite, light, dark.
const BASEMAP_ORDER = Object.keys(BASEMAP_STYLES) as BasemapId[];

/** Shared body of the desktop card and the mobile sheet. */
function PanelContents({
  state,
  idBase,
}: {
  state: ReturnType<typeof useMapLayers>;
  idBase: string;
}) {
  return (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
        Basemap
      </div>
      <div role="radiogroup" aria-label="Basemap" className="mt-0.5">
        {BASEMAP_ORDER.map((id) => {
          const inputId = `${idBase}-basemap-${id}`;
          return (
            <label
              key={id}
              htmlFor={inputId}
              className="flex cursor-pointer items-center gap-2 py-1.5"
            >
              <input
                id={inputId}
                type="radio"
                name={`${idBase}-basemap`}
                checked={state.basemap === id}
                onChange={() => state.setBasemap(id)}
                className="accent-oxford"
              />
              <span className="text-[12.5px] text-ink">
                {BASEMAP_LABELS[id]}
              </span>
            </label>
          );
        })}
      </div>

      <div className="my-2 border-t border-hairline" />

      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
        Overlays
      </div>
      <div className="mt-0.5">
        {MAP_OVERLAYS.filter((def) => def.enabled).map((def) => {
          const inputId = `${idBase}-overlay-${def.id}`;
          return (
            <label
              key={def.id}
              htmlFor={inputId}
              className="flex cursor-pointer items-start gap-2 py-1.5"
            >
              <input
                id={inputId}
                type="checkbox"
                checked={state.isOverlayOn(def.id)}
                onChange={() => state.toggleOverlay(def.id)}
                className="mt-[3px] accent-oxford"
              />
              <span className="min-w-0">
                <span className="block text-[12.5px] text-ink">
                  {def.label}
                </span>
                <span className="block text-[11px] text-faint">
                  {def.attribution}
                </span>
                {def.note && (
                  <span className="block text-[11px] italic text-faint">
                    {def.note}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-faint">
        Extra GIS layers over the basemap.
      </p>
    </>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close map layers"
      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
        <path
          d="M2 2l8 8M10 2l-8 8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

export function MapLayersControl({
  state,
}: {
  state: ReturnType<typeof useMapLayers>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  // useId keeps the radio group name + input ids unique per mounted control,
  // so two map surfaces never cross-link their radios/labels.
  const idBase = useId();
  const close = useCallback(() => setOpen(false), []);

  // Esc closes the panel; the listener exists only while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Active overlays. Declarative children of <Map>: react-map-gl re-adds
          them after a basemap setStyle, so they survive style swaps. One
          Source per tile set — extraTileSets stack under the same checkbox
          (e.g. reference = boundaries/places + transportation); attribution
          rides on the first set only so the credit isn't duplicated. */}
      {MAP_OVERLAYS.map(
        (def) =>
          def.enabled &&
          state.isOverlayOn(def.id) &&
          [def.tiles, ...(def.extraTileSets ?? [])].map((tiles, i) => (
            <Source
              key={i === 0 ? def.id : `${def.id}-${i}`}
              id={i === 0 ? `ovl-${def.id}` : `ovl-${def.id}-${i}`}
              type="raster"
              tiles={tiles}
              tileSize={256}
              {...(i === 0 ? { attribution: def.attribution } : {})}
              {...(def.minzoom ? { minzoom: def.minzoom } : {})}
              {...(def.maxzoom ? { maxzoom: def.maxzoom } : {})}
            >
              <Layer
                id={i === 0 ? `ovl-${def.id}` : `ovl-${def.id}-${i}`}
                type="raster"
                paint={{ "raster-opacity": def.opacity }}
              />
            </Source>
          )),
      )}

      {/* 44px-tall hit area (WCAG target size) around the compact pill —
          the wrapper's transparent flex box takes the tap, desktop appearance
          is unchanged (same pattern as the marker hit areas in
          PortfolioMapView). */}
      <div className="absolute right-3 top-3 z-10 flex h-11 items-center">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Map layers"
          className="flex items-center gap-1.5 rounded-full border border-hairline bg-canvas/90 px-3 py-1 text-[11px] font-semibold text-ink shadow-card backdrop-blur transition-colors hover:bg-surface-2"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 2.2l5.5 2.75L8 7.7 2.5 4.95 8 2.2z" />
            <path d="M2.5 8L8 10.75 13.5 8" />
            <path d="M2.5 11.05L8 13.8l5.5-2.75" />
          </svg>
          Layers
        </button>
      </div>

      {/* Desktop panel: absolute card below the trigger, inside the map
          container (overflow-hidden clipping is acceptable here). */}
      {open && (
        <div
          role="dialog"
          aria-label="Map layers"
          className="absolute right-3 top-14 z-20 hidden w-[264px] rounded-[11px] border border-hairline bg-canvas p-3 shadow-card md:block"
        >
          <PanelContents state={state} idBase={`${idBase}-d`} />
          <CloseButton onClose={close} />
        </div>
      )}

      {/* Mobile panel: bottom sheet + backdrop, portaled to document.body so
          the map container's overflow-hidden cannot clip it. Mounted only
          while open — open can only become true via a click, so document is
          guaranteed to exist here. */}
      {open &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40 bg-ink/30"
              onClick={close}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-label="Map layers"
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-[11px] border-t border-hairline bg-canvas p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-card md:hidden"
            >
              <PanelContents state={state} idBase={`${idBase}-m`} />
              <CloseButton onClose={close} />
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
