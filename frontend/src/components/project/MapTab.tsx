"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

import { useProject } from "./ProjectContext";
import { getLiveRun } from "@/lib/agent/liveStore";
import { getReport } from "@/lib/agent/client";
import type { AgentReport } from "@/lib/agent/report";

/**
 * Map tab — a real satellite site map (SiteMapView) fed by the raw agent
 * report: geocoded site point, zoning legend when the report mentions one,
 * and report-derived area-of-interest markers that click through to their
 * finding cards. Mock/demo projects have no raw report; the map still renders
 * the geocoded site from project.location with no AoI layer.
 */

// MapLibre needs the browser — the dynamic() + ssr:false pair must live in
// a Client Component (same wrapper as portfolio/PortfolioMap.tsx).
const SiteMapView = dynamic(() => import("./SiteMapView"), {
  ssr: false,
  loading: () => (
    <div className="h-[380px] w-full animate-pulse rounded-[5px] bg-surface-2" />
  ),
});

// A 12-hex route id is the agent job id — the report is fetchable directly.
const JOB_ID_RE = /^[0-9a-f]{12}$/i;

export function MapTab() {
  const { project } = useProject();
  const [report, setReport] = useState<AgentReport | null>(null);

  useEffect(() => {
    let live2 = true;
    // A run this browser just completed is in sessionStorage. Even that sync
    // read resolves through a microtask — synchronous setState in an effect
    // body cascades renders (react-hooks/set-state-in-effect).
    const live = getLiveRun(project.id);
    if (live) {
      void Promise.resolve().then(() => {
        if (live2) setReport(live.report);
      });
      return () => {
        live2 = false;
      };
    }
    // A permalink to a real run (route id == job id) can fetch its report.
    if (!JOB_ID_RE.test(project.id)) return;
    getReport(project.id)
      .then((r) => {
        if (live2) setReport(r);
      })
      .catch(() => {
        // Backend down/unknown id — the map still renders the geocoded site.
      });
    return () => {
      live2 = false;
    };
  }, [project.id]);

  return (
    <div className="rounded-[11px] border border-hairline bg-canvas p-5 shadow-card">
      <SiteMapView
        projectId={project.id}
        name={project.name}
        location={project.location}
        capacityMW={project.capacityMW}
        latitude={project.latitude}
        longitude={project.longitude}
        report={report}
      />
    </div>
  );
}
