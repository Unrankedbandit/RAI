"use client";

import { IntakeDropzone } from "@/components/intake/IntakeDropzone";

/**
 * Portfolio intake: slim horizontal drop bar that expands into the staged
 * review card. All behavior lives in the shared IntakeDropzone — including
 * uploading the file bytes before the run starts.
 */
export function NewProjectDropbox() {
  return <IntakeDropzone variant="compact" />;
}
