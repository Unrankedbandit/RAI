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

  // Share-link path: a report this browser didn't run isn't in sessionStorage.
  // Fetch it from the backend — portfolio ids are job ids, and the route id is
  // the project slug, so match both. Makes /projects/<slug> a public permalink
  // on the public deployment (the API lane there is unauthenticated).
  const [fetched, setFetched] = useState<{ forId: string; detail: ProjectDetail } | null>(null);
  useEffect(() => {
    if (!id || raw || getProjectDetail(id)) return;
    let cancelled = false;
    (async () => {
      const rows = await listProjects();
      const row = rows.find((r) => r.id === id || slugify(r.project) === id);
      if (!row) return;
      const report = await getReport(row.id);
      if (cancelled) return;
      setFetched({ forId: id, detail: toSentinel(report, { id }) });
    })().catch(() => {
      // No backend entry — the mock/missing fallback stands.
    });
    return () => {
      cancelled = true;
    };
  }, [id, raw]);

  // A stale fetch result for a previous route id is ignored at read time, so
  // the effect never needs to synchronously reset state (react-hooks rule).
  const fetchedDetail = fetched && fetched.forId === id ? fetched.detail : null;

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

    if (fetchedDetail) return { detail: fetchedDetail, source: "live" as const };

    return { detail: mock, source: mock ? ("mock" as const) : ("missing" as const) };
  }, [id, raw, fetchedDetail]);
}
