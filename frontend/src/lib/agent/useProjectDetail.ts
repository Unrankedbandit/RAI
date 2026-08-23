"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getProjectDetail } from "@/lib/mockData";
import type { ProjectDetail } from "@/lib/types";
import { toSentinel } from "./adapter";
import { getReport, listProjects } from "./client";
import { subscribeLiveRuns, type LiveRun } from "./liveStore";
import { getLiveRunRaw, slugify } from "./liveStore";

export type DetailSource = "live" | "mock" | "missing";

export interface ProjectDetailState {
  detail: ProjectDetail | undefined;
  source: DetailSource;
  /** True while a backend report fetch for this id is still in flight —
   *  the page shows a neutral loading state, never a premature "not found". */
  loading: boolean;
}

/**
 * Resolves the ProjectDetail for a route.
 *
 * Precedence: a live agent report for this id in sessionStorage (a scan that
 * just finished) wins; then a live fetch of the backend's stored report —
 * portfolio ids are job ids, and the route id may also be the project slug,
 * so match both (this makes /projects/<slug> a public permalink on the
 * public deployment); the curated mock entry is the final fallback. That
 * fallback is deliberate — the demo must survive the backend being down,
 * and every seeded project still renders.
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

  const mock = id ? getProjectDetail(id) : undefined;
  const shouldFetch = Boolean(id && !raw && !mock);

  // Share-link path: a report this browser didn't run isn't in sessionStorage.
  // detail=null records that the fetch SETTLED without a live report, so the
  // page can leave the loading state.
  const [fetched, setFetched] = useState<{
    forId: string;
    detail: ProjectDetail | null;
  } | null>(null);
  useEffect(() => {
    if (!id || !shouldFetch) return;
    let cancelled = false;
    (async () => {
      const rows = await listProjects();
      const row = rows.find((r) => r.id === id || slugify(r.project) === id);
      if (!row) {
        if (!cancelled) setFetched({ forId: id, detail: null });
        return;
      }
      const report = await getReport(row.id);
      if (cancelled) return;
      setFetched({ forId: id, detail: toSentinel(report, { id }) });
    })().catch(() => {
      // No backend entry — the mock/missing fallback stands.
      if (!cancelled) setFetched({ forId: id, detail: null });
    });
    return () => {
      cancelled = true;
    };
  }, [id, raw, shouldFetch]);

  // A stale fetch result for a previous route id is ignored at read time, so
  // the effect never needs to synchronously reset state (react-hooks rule).
  const settled = fetched && fetched.forId === id ? fetched : null;
  const fetchedDetail = settled ? settled.detail : null;

  return useMemo(() => {
    if (!id)
      return { detail: undefined, source: "missing" as const, loading: false };

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
          loading: false,
        };
      } catch {
        // Corrupt entry: fall through to the mock rather than blanking the page.
      }
    }

    if (fetchedDetail)
      return { detail: fetchedDetail, source: "live" as const, loading: false };

    if (mock)
      return { detail: mock, source: "mock" as const, loading: false };

    // No session run, no mock, no fetched report: still waiting on the
    // backend when this id is fetchable, otherwise honestly missing.
    return {
      detail: undefined,
      source: "missing" as const,
      loading: shouldFetch && !settled,
    };
  }, [id, raw, mock, fetchedDetail, shouldFetch, settled]);
}
