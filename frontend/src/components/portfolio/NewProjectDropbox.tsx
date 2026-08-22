"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "@/lib/clsx";
import { analyze } from "@/lib/agent/client";
import { slugify } from "@/lib/agent/liveStore";

const DEFAULT_PROJECT = { name: "Project Alpha", location: "West Texas" };

/**
 * Horizontal dashed drop zone that starts a new project from one or several
 * documents at once. Starts a real pipeline run; falls back to the scripted
 * scan when the agent backend is unreachable.
 */
export function NewProjectDropbox() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  async function start(files?: FileList | null) {
    const names =
      files && files.length > 0 ? Array.from(files).map((f) => f.name) : [];
    try {
      const { jobId } = await analyze({ ...DEFAULT_PROJECT, docs: names });
      router.push(
        `/scanning?job=${jobId}&project=${slugify(DEFAULT_PROJECT.name)}`,
      );
    } catch {
      router.push("/scanning");
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void start(e.dataTransfer.files);
      }}
      className={clsx(
        "flex flex-wrap items-center justify-between gap-4 rounded-[11px] border border-dashed p-5 transition-colors",
        dragging ? "border-hairline bg-select" : "border-hairline bg-surface-2",
      )}
    >
      <div>
        <div className="mb-[3px] text-[13.5px] font-semibold text-ink">
          Start a new project
        </div>
        <div className="text-[11.5px] text-faint">
          Drag in one or multiple documents to begin analysis
        </div>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-full border border-hairline bg-canvas px-4 py-2 text-[12.5px] font-medium text-muted hover:text-ink"
      >
        Browse files
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => void start(e.target.files)}
      />
    </div>
  );
}
