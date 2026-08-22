"use client";

import { createContext, useContext } from "react";
import type { ProjectDetail } from "@/lib/types";

const ProjectContext = createContext<ProjectDetail | null>(null);

export function ProjectProvider({
  detail,
  children,
}: {
  detail: ProjectDetail;
  children: React.ReactNode;
}) {
  return (
    <ProjectContext.Provider value={detail}>{children}</ProjectContext.Provider>
  );
}

/** Access the current project's full detail from any tab. */
export function useProject(): ProjectDetail {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return ctx;
}
