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
      <div className="flex min-w-0 items-center gap-3.5">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={clsx(
            "shrink-0 transition-colors",
            dragging ? "text-brand" : "text-faint",
          )}
        >
          <path d="M16 16l-4-4-4 4" />
          <path d="M12 12v9" />
          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
        </svg>
        <div className="min-w-0">
          <div className="mb-[3px] text-[15px] font-semibold text-ink">
            Start a new project
          </div>
          <div className="text-[12.5px] text-faint">
            Drag in one or multiple documents to begin analysis
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-full border border-hairline bg-canvas px-4 py-2 text-sm font-medium text-muted hover:text-ink"
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
