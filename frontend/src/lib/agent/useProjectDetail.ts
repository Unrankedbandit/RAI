"use client";

import { useMemo, useSyncExternalStore } from "react";
import { getProjectDetail } from "@/lib/mockData";
import type { ProjectDetail } from "@/lib/types";
import { toSentinel } from "./adapter";
import { subscribeLiveRuns, type LiveRun } from "./liveStore";
import { getLiveRunRaw } from "./liveStore";

export type DetailSource = "live" | "mock" | "missing";

export interface ProjectDetailState {
  detail: ProjectDetail | undefined;
  source: DetailSource;
}

/**
 * Resolves the ProjectDetail for a route.
 *
 * A live agent report for this id wins; otherwise the curated mock entry is
 * used. The fallback is deliberate — the demo must survive the backend being
 * down, and every seeded project still renders.
 *
 * The live run is read through useSyncExternalStore rather than an effect:
 * sessionStorage is an external store that does not exist during the server
 * render, and this is the API React provides for exactly that. The server
 * snapshot is always null, so SSR renders the mock and hydration swaps in the
 * live report without a markup mismatch.
 */
export function useProjectDetail(id: string | undefined): ProjectDetailState {
  const raw = useSyncExternalStore(
    subscribeLiveRuns,
    () => (id ? getLiveRunRaw(id) : null),
    () => null, // server: never live
  );

  return useMemo(() => {
    if (!id) return { detail: undefined, source: "missing" as const };

    const mock = getProjectDetail(id);

    if (raw) {
      try {
        const live = JSON.parse(raw) as LiveRun;
        return {
          detail: toSentinel(live.report, {
            id,
            // Keep the map pin and nameplate from the seeded entry when there
            // is one — the agent report carries neither.
            latitude: mock?.project.latitude,
            longitude: mock?.project.longitude,
            capacityMW: mock?.project.capacityMW,
            uploadedAt: live.finishedAt.slice(0, 10),
          }),
          source: "live" as const,
        };
      } catch {
        // Corrupt entry: fall through to the mock rather than blanking the page.
      }
    }

    return { detail: mock, source: mock ? ("mock" as const) : ("missing" as const) };
  }, [id, raw]);
}
