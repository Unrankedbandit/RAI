"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectDetail } from "@/lib/agent/useProjectDetail";
import { ProjectProvider } from "@/components/project/ProjectContext";
import { ProjectWorkspace } from "@/components/project/ProjectWorkspace";

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const { detail } = useProjectDetail(params.id);

  if (!detail) {
    return (
      <div className="mx-auto max-w-md px-8 py-16 text-center">
        <p className="text-muted">
          Project not found.{" "}
          <Link href="/projects" className="text-brand underline">
            Back to current projects
          </Link>
        </p>
      </div>
    );
  }

  return (
    <ProjectProvider detail={detail}>
      <ProjectWorkspace />
    </ProjectProvider>
  );
}
