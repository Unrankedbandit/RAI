"use client";

import { useEffect, useState } from "react";
import { band } from "./adapter";
import { listProjects, type PortfolioRow } from "./client";
import type { PillarScore, Project, ProjectStatus } from "@/lib/types";

export type LiveProjectsState = {
  projects: Project[];
  loading: boolean;
  failed: boolean;
};

function statusFromDecision(decision: string): ProjectStatus {
  const d = decision.toLowerCase();
  if (d.includes("proceed")) return "on-track";
  if (d.includes("investigate")) return "needs-review";
  return "at-risk";
}

/** Backend portfolio row -> UI Project. Rows carry no capacity/coords (the
 *  pipeline doesn't extract them yet) — those fields render as 0/blank. */
export function toProject(row: PortfolioRow): Project {
  return {
    id: row.id,
    name: row.project,
    location: row.location,
    capacityMW: 0,
    latitude: 0,
    longitude: 0,
    activationScore: row.readiness,
    band: band(row.readiness),
    scoreReason: "",
    status: statusFromDecision(row.decision),
    pillars: row.dimensions.map(
      (d): PillarScore => ({
        name: d.name as PillarScore["name"],
        score: d.score,
        band: band(d.score),
        unlocked: d.score >= 70,
        statusText: "",
        subAgents: [],
        factors: [],
      }),
    ),
  };
}

/** Live equivalent of mockData.portfolioSummary() — safe on an empty board. */
export function summarize(projects: Project[]) {
  const count = projects.length;
  const avgScore = count
    ? Math.round(projects.reduce((s, p) => s + p.activationScore, 0) / count)
    : 0;
  return {
    count,
    avgScore,
    avgBand: band(avgScore),
    onTrack: projects.filter((p) => p.status === "on-track").length,
    needsReview: projects.filter((p) => p.status === "needs-review").length,
    atRisk: projects.filter((p) => p.status === "at-risk").length,
  };
}

/**
 * The portfolio as it actually is: backend rows only, fetched on every page
 * load — never baked-in mock projects. (Mock detail entries still backstop
 * /projects/<id> when the backend is unreachable; the listing stays real.)
 */
export function useLiveProjects(): LiveProjectsState {
  const [rows, setRows] = useState<PortfolioRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return {
    projects: (rows ?? []).map(toProject),
    loading: rows === null && !failed,
    failed,
  };
}
