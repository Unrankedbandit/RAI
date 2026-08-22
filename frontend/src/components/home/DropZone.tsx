"use client";

import { IntakeDropzone } from "@/components/intake/IntakeDropzone";

/**
 * Home hero intake: staged document review (drop zone → file list + project
 * fields) before a real pipeline run starts. All behavior lives in the
 * shared IntakeDropzone.
 */
export function DropZone() {
  return <IntakeDropzone variant="hero" />;
}
