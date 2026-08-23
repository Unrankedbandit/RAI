"use client";

// Shared live-portfolio store for the Home and Current Projects pages.
//
// Both pages must agree on whether the backend answered, so the fetch lives
// here in one module-level cached promise (same pattern as ./researched):
// every mount shares one GET /api/projects, and unmount/remount cycles never
// re-hit the network. A failure is NOT cached — the next mount retries.
//
// The contract for pages: render `projects` only when status is "live".
// "loading" gets a neutral skeleton (never mock data), "offline" gets the
// mock set shown under the explicit OfflineBanner — mock rows are a labelled
// placeholder, never silently mixed into a live view.

import { useEffect, useState } from "react";

import type { Project, RiskBand } from "../types";
import { band, toPortfolioProject } from "./adapter";
import { listProjects } from "./client";

export type LiveStatus = "loading" | "live" | "offline";

export interface LiveProjectsState {
  status: LiveStatus;
  /** Real portfolio rows as Project view models. Empty unless live. */
  projects: Project[];
}

let cache: Promise<Project[]> | null = null;

function loadProjects(): Promise<Project[]> {
  if (!cache) {
    cache = listProjects().then((rows) => rows.map(toPortfolioProject));
    // A rejected cache entry would stick forever — drop it so the next
    // mount retries a backend that may have come up since.
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}

/** Live portfolio rows, or a loading/offline signal. Never throws. */
export function useLiveProjects(): LiveProjectsState {
  const [state, setState] = useState<LiveProjectsState>({
    status: "loading",
    projects: [],
  });
  useEffect(() => {
    let live = true;
    loadProjects().then(
      (projects) => {
        if (live) setState({ status: "live", projects });
      },
      () => {
        if (live) setState({ status: "offline", projects: [] });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** Portfolio stat summary over any Project set — the same shape mockData's
 *  portfolioSummary() returns, so pages can compute it over live rows and
 *  the offline mock fallback identically. */
export function summarizeProjects(projects: Project[]): {
  count: number;
  avgScore: number;
  avgBand: RiskBand;
  onTrack: number;
  needsReview: number;
  atRisk: number;
} {
  const count = projects.length;
  const avgScore = count
    ? Math.round(projects.reduce((sum, p) => sum + p.activationScore, 0) / count)
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
