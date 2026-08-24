"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
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
import { GRID_LAYERS } from "@/components/maps/gridOverlay";

/**
 * MapLayersControl — basemap switcher + optional GIS overlay toggles,
 * rendered as a CHILD of a react-map-gl <Map>.
 *
 * - Enabled overlays the user has toggled on render as declarative
 *   <Source>/<Layer> children (ParcelViewer pattern): react-map-gl re-adds
 *   them automatically when the basemap style swaps via setStyle, so the
 *   overlays survive basemap changes with no imperative re-adding.
 * - The trigger is the bottom-left icon button. The panel is an absolute
 *   card above it — but only when the MAP CONTAINER is wide enough to hold
 *   it (~420px+): embedded maps (project tab, portfolio cards) can be far
 *   narrower than the viewport, and a 264px card clipped by the map's
 *   overflow-hidden is unusable there. Narrow containers (and sub-md
 *   viewports) get the portal-mounted bottom sheet instead (backdrop + Esc
 *   + ✕ to close) — portaled to document.body, so overflow-hidden can never
 *   clip it. Container width is measured with a ResizeObserver on the
 *   control's parent (react-map-gl renders children into a full-size div
 *   inside the map container).
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

/**
 * Overlay that only makes sense over the raster-only satellite basemap —
 * the light/dark CARTO vector basemaps draw their own roads/labels, so
 * leaving it on there renders doubled, mismatched labels. It is force-off
 * (and its panel row disabled) on any other basemap.
 */
const SATELLITE_ONLY_OVERLAY = "reference";

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
        // Drop stale enables (written before the satellite-only rule) so a
        // persisted reference-on-vector state never reaches the UI.
        if (def.id === SATELLITE_ONLY_OVERLAY && basemap !== "satellite") {
          continue;
        }
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
        // The satellite-only overlay (roads/labels) must not ride onto a
        // vector basemap that draws its own — drop it when leaving
        // satellite. Switching back to satellite does NOT re-enable it;
        // the user re-checks it.
        const overlays =
          basemap !== "satellite" && prev.overlays[SATELLITE_ONLY_OVERLAY]
            ? { ...prev.overlays, [SATELLITE_ONLY_OVERLAY]: false }
            : prev.overlays;
        const next = { ...prev, basemap, overlays };
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
          // Satellite-only overlay: locked off on the vector basemaps,
          // which draw their own roads/labels.
          const locked =
            def.id === SATELLITE_ONLY_OVERLAY &&
            state.basemap !== "satellite";
          return (
            <label
              key={def.id}
              htmlFor={inputId}
              className={`flex items-start gap-2 py-1.5 ${
                locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              }`}
            >
              <input
                id={inputId}
                type="checkbox"
                checked={state.isOverlayOn(def.id)}
                disabled={locked}
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
                {locked && (
                  <span className="block text-[11px] italic text-faint">
                    Satellite basemap only
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

// Map containers narrower than this get the bottom sheet, not the 264px card.
const COMPACT_CONTAINER_PX = 420;
// Tailwind's md breakpoint — sub-md viewports always get the bottom sheet.
const MOBILE_VIEWPORT_QUERY = "(max-width: 767px)";

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

  // Container-aware panel path: the 264px absolute card only fits when the
  // map itself is wide enough. Viewport width says nothing about an embedded
  // map's size, so measure the container (the trigger wrapper's parent —
  // react-map-gl's full-size child container) with a ResizeObserver.
  const triggerWrapRef = useRef<HTMLDivElement | null>(null);
  const [compactContainer, setCompactContainer] = useState(false);
  const [mobileViewport, setMobileViewport] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(MOBILE_VIEWPORT_QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    const onChange = () => setMobileViewport(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const wrap = triggerWrapRef.current;
    const container = wrap?.parentElement ?? wrap;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setCompactContainer(width > 0 && width < COMPACT_CONTAINER_PX);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Sheet for narrow containers / mobile viewports; absolute card otherwise.
  const useSheet = compactContainer || mobileViewport;

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
          def.kind !== "vector-grid" &&
          state.isOverlayOn(def.id) &&
          // Never render the satellite-only overlay over a vector basemap,
          // even from stale persisted state (guards the hydration window).
          (def.id !== SATELLITE_ONLY_OVERLAY ||
            state.basemap === "satellite") &&
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

      {/* Vector overlays (kind "vector-grid"): one pmtiles vector Source per
          entry, layer styles from maps/gridOverlay.ts (kv-scaled ink/violet
          transmission lines + substation dots, zoom-gated per the GRID V1
          contract). Same declarative re-add-on-style-swap behavior as the
          raster branch above. */}
      {MAP_OVERLAYS.map(
        (def) =>
          def.kind === "vector-grid" &&
          def.enabled &&
          def.pmtiles &&
          state.isOverlayOn(def.id) && (
            <Source
              key={def.id}
              id={`ovl-${def.id}`}
              type="vector"
              url={def.pmtiles}
              attribution={def.attribution}
            >
              {GRID_LAYERS.map((layer) => (
                <Layer key={layer.id} {...layer} />
              ))}
            </Source>
          ),
      )}

      {/* 44px-tall hit area (WCAG target size) around the compact pill —
          the wrapper's transparent flex box takes the tap, desktop appearance
          is unchanged (same pattern as the marker hit areas in
          PortfolioMapView). */}
      <div
        ref={triggerWrapRef}
        className="absolute bottom-3 left-3 z-10 flex items-center"
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Map layers"
          title="Map layers"
          className="flex h-11 w-11 items-center justify-center rounded-[9px] border border-hairline bg-canvas/90 text-ink shadow-card backdrop-blur transition-colors hover:bg-surface-2"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-5 w-5"
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
        </button>
      </div>

      {/* Roomy containers: absolute card above the trigger, inside the map
          container. Width is guaranteed by useSheet (container ≥ ~420px);
          height is capped to the container with internal scroll, so even a
          360px-tall embedded map never clips the panel (its overflow-hidden
          would swallow the overflow otherwise). */}
      {open && !useSheet && (
        <div
          role="dialog"
          aria-label="Map layers"
          className="absolute bottom-14 left-3 z-20 max-h-[calc(100%-68px)] w-[264px] overflow-y-auto rounded-[11px] border border-hairline bg-canvas p-3 shadow-card"
        >
          <PanelContents state={state} idBase={`${idBase}-d`} />
          <CloseButton onClose={close} />
        </div>
      )}

      {/* Narrow containers + mobile viewports: bottom sheet + backdrop,
          portaled to document.body so the map container's overflow-hidden
          cannot clip it. Mounted only while open — open can only become true
          via a click, so document is guaranteed to exist here. */}
      {open &&
        useSheet &&
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
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-[11px] border-t border-hairline bg-canvas p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-card"
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
