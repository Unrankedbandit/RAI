"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { scoreColor } from "@/lib/parcels/scoreRamp";
import type { ParcelResult } from "@/lib/parcels/counties";
import {
  previewScore,
  type PreviewDrivers,
  type PreviewScore,
} from "@/lib/parcels/previewScore";

/**
 * ViabilityPreview — the instant first-pass score for the selected parcel,
 * mounted inside the rail's selected-parcel card between the attributes and
 * the research CTA. Doctrine: this is a point-sampled ESTIMATE, honestly
 * degraded — the copy must never present it as the real diligence score.
 *
 * Data: previewScore() (frozen contract) with the parcel's bbox centroid.
 * Re-runs when the selected parcel's identity (county + APN/address) changes;
 * a sequence ref + cancellation flag guard against stale async responses.
 */
export function ViabilityPreview({ parcel }: { parcel: ParcelResult }) {
  const identityKey = `${parcel.county}:${parcel.apn ?? parcel.address ?? "?"}`;

  const centroid = useMemo(
    () => geometryCenter(parcel.geometry),
    // Parcel identity is the real trigger; geometry rides along with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identityKey],
  );

  // The last finished score, keyed by the parcel that produced it. When the
  // selected parcel changes, the key mismatch IS the loading state, derived
  // during render — the effect only completes asynchronously, so there is no
  // synchronous setState in an effect body (react-hooks lint) and no
  // cascading render.
  const [scored, setScored] = useState<{
    key: string;
    result: PreviewScore | null;
  } | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    let cancelled = false;
    previewScore(parcel, centroid)
      .then((result) => {
        if (cancelled || seq !== seqRef.current) return;
        setScored({ key: identityKey, result });
      })
      .catch(() => {
        // Contract promises previewScore never throws; stay defensive so a
        // mid-flight regression can never break the rail.
        if (cancelled || seq !== seqRef.current) return;
        setScored({ key: identityKey, result: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  const current = scored && scored.key === identityKey ? scored : null;

  return (
    <div className="mt-4 border-t border-hairline pt-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[10.5px] uppercase tracking-wide text-faint">
          Viability preview
        </span>
        <span className="text-[10px] text-faint">instant estimate</span>
      </div>

      {current === null ? (
        <p className="mt-2 animate-pulse text-[11px] text-faint">Scoring…</p>
      ) : current.result === null ? (
        <p className="mt-2 text-[11px] text-faint">
          Preview unavailable for this parcel — run full diligence.
        </p>
      ) : (
        <PreviewBody result={current.result} />
      )}
    </div>
  );
}

function PreviewBody({ result }: { result: PreviewScore }) {
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[12px] font-semibold text-ink">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: scoreColor(result.score) }}
          />
          {Math.round(result.score)}
        </span>
        <span className="text-[11px] text-muted">{result.verdict}</span>
      </div>

      <div className="mt-2.5 space-y-1.5">
        {DRIVER_ROWS.map(({ key, label }) => {
          const value = clamp01(result.drivers[key]);
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="w-20 flex-none text-[11px] text-muted">
                {label}
              </span>
              <span className="h-1.5 flex-1 rounded-full bg-vista-soft">
                <span
                  className="block h-full rounded-full bg-vista"
                  style={{ width: `${value * 100}%` }}
                />
              </span>
              <span className="w-7 flex-none text-right font-mono text-[11px] text-ink">
                {Math.round(value * 100)}
              </span>
            </div>
          );
        })}
      </div>

      {result.degraded.length > 0 && (
        <p className="mt-2 text-[10px] text-faint">
          Partial — {result.degraded.join(" · ")}
        </p>
      )}
      {result.sources.length > 0 && (
        <p className="mt-1 text-[10px] text-faint">
          From {result.sources.join(" + ")}
        </p>
      )}
      <p className="mt-1.5 text-[10px] text-faint">
        Instant estimate from public land data — run full diligence for the
        real score.
      </p>
    </div>
  );
}

const DRIVER_ROWS: Array<{ key: keyof PreviewDrivers; label: string }> = [
  { key: "openSpace", label: "Open land" },
  { key: "acreageFit", label: "Acreage" },
  { key: "slopeOk", label: "Terrain" },
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Bbox-center of any GeoJSON geometry. Duplicated from ParcelViewer.tsx,
 * whose local `geometryCenter` is not exported — keep the two in sync.
 */
function geometryCenter(
  geom: ParcelResult["geometry"],
): [number, number] | null {
  if (!geom) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const [x, y] = coords as [number, number];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    coords.forEach(walk);
  };
  walk((geom as { coordinates?: unknown }).coordinates);
  if (!Number.isFinite(minX)) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}
