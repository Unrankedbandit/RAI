"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "@/lib/clsx";
import { apiUrl, analyze } from "@/lib/agent/client";
import { slugify } from "@/lib/agent/liveStore";

const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt";

type Phase = "idle" | "staged" | "starting";

/** Sends the actual file bytes to the backend before the run starts. */
async function uploadFiles(files: File[]): Promise<string[]> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await fetch(apiUrl("/api/uploads"), {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return ((await res.json()) as { files: string[] }).files;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short label for the extension glyph on each staged file row. */
function extLabel(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "PDF";
  if (ext === "doc" || ext === "docx") return "DOC";
  if (ext === "xls" || ext === "xlsx" || ext === "csv") return "XLS";
  if (ext === "txt") return "TXT";
  return "FILE";
}

/**
 * Staged-file intake: drop or browse documents, review the set, name the
 * project, then start a real pipeline run.
 *
 * State machine:
 * - idle     — dashed drop zone ("hero" for Home, "compact" for the
 *              portfolio bar). Clicking opens the file picker.
 * - staged   — card in the same footprint with the file list (removable rows,
 *              drop or "Add files" appends) plus required name/location
 *              fields. "Start analysis" stays disabled until all three are
 *              present; "Clear" resets to idle.
 * - starting — same card while the bytes upload and the run is queued.
 *
 * Failure returns to the staged card with an inline error and explicit
 * Retry / demo-scan buttons — never a silent fall back to the mock scan.
 * Success routes to the live scanning view.
 */
export function IntakeDropzone({
  variant = "hero",
  presentation = "inline",
  onStarted,
}: {
  variant?: "hero" | "compact";
  presentation?: "inline" | "modal";
  onStarted?: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>(
    presentation === "modal" ? "staged" : "idle",
  );
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "starting";
  const canStart =
    !busy &&
    name.trim().length > 0 &&
    location.trim().length > 0 &&
    files.length > 0;

  function openPicker() {
    if (!busy) inputRef.current?.click();
  }

  function addFiles(list: FileList | null) {
    if (busy || !list || list.length === 0) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
    setError(null);
    setPhase("staged");
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function reset() {
    setFiles([]);
    setName("");
    setLocation("");
    setError(null);
    // Modal presentation never returns to the hero zone — it resets to the
    // zero-files staged layout instead.
    setPhase(presentation === "modal" ? "staged" : "idle");
  }

  async function start() {
    const trimmedName = name.trim();
    const trimmedLocation = location.trim();
    if (busy || !trimmedName || !trimmedLocation || files.length === 0) return;
    setPhase("starting");
    setError(null);
    try {
      // Upload the bytes first; the pipeline then reads the real documents,
      // not just their names.
      setStatus(
        `Uploading ${files.length} document${files.length === 1 ? "" : "s"}…`,
      );
      const docs = await uploadFiles(files);
      setStatus("Starting the run…");
      const { jobId } = await analyze({
        name: trimmedName,
        location: trimmedLocation,
        docs,
      });
      router.push(`/scanning?job=${jobId}&project=${slugify(trimmedName)}`);
      // Fire-and-forget: let the host modal close itself after routing.
      onStarted?.();
    } catch (err) {
      setPhase("staged");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const dropTargetProps = {
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!busy) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      addFiles(e.dataTransfer.files);
    },
  };

  const picker = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={ACCEPT}
      className="hidden"
      onChange={(e) => {
        addFiles(e.target.files);
        // Reset so picking the same file twice still fires onChange.
        e.target.value = "";
      }}
    />
  );

  const zoneKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  };

  if (phase === "idle") {
    if (variant === "compact") {
      return (
        <>
          {picker}
          <div
            role="button"
            tabIndex={0}
            aria-label="Add documents to scan"
            onClick={openPicker}
            onKeyDown={zoneKeyDown}
            {...dropTargetProps}
            className={clsx(
              "flex cursor-pointer flex-wrap items-center justify-between gap-4 rounded-[11px] border-[1.5px] border-dashed p-5 transition-colors",
              dragging
                ? "border-hairline bg-select"
                : "border-hairline bg-surface-2 hover:bg-vista-soft",
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
            <span className="inline-flex items-center rounded-full border border-hairline bg-canvas px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-ink">
              Browse files
            </span>
          </div>
        </>
      );
    }

    return (
      <>
        {picker}
        <div
          role="button"
          tabIndex={0}
          aria-label="Add documents to scan"
          onClick={openPicker}
          onKeyDown={zoneKeyDown}
          {...dropTargetProps}
          className={clsx(
            "cursor-pointer rounded-[11px] border-[1.5px] border-dashed px-5 py-8 text-center transition-colors",
            dragging
              ? "border-hairline bg-select"
              : "border-hairline bg-surface-2 hover:bg-vista-soft",
          )}
        >
          <p className="text-[14px] font-semibold text-ink">
            Drag documents here to start a new project
          </p>
          <p className="mt-[5px] text-[12px] text-faint">
            PDF, DOCX, and XLSX supported — upload one or several at once
          </p>
          <span className="mt-[14px] inline-flex items-center rounded-full border border-hairline bg-canvas px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-ink">
            Browse files
          </span>
        </div>
      </>
    );
  }

  return (
    <>
      {picker}
      <div
        {...(presentation === "inline" ? dropTargetProps : {})}
        aria-busy={busy}
        className={clsx(
          presentation === "modal"
            ? // Flat — the modal panel provides the frame.
              ""
            : "rounded-[11px] border border-hairline bg-canvas p-5 shadow-card transition-colors",
          presentation === "inline" && dragging && "bg-select",
        )}
      >
        {presentation === "modal" && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Add documents"
            onClick={openPicker}
            onKeyDown={zoneKeyDown}
            {...dropTargetProps}
            className={clsx(
              "cursor-pointer rounded-[9px] border-[1.5px] border-dashed border-hairline px-4 py-4 text-center transition-colors",
              dragging ? "bg-select" : "hover:bg-vista-soft",
            )}
          >
            <span className="text-[13px] text-muted">
              Drop documents here or{" "}
              <button
                type="button"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  openPicker();
                }}
                className="underline underline-offset-2 transition-colors hover:text-ink disabled:opacity-40"
              >
                browse
              </button>
            </span>
          </div>
        )}

        {presentation === "modal" && files.length === 0 && (
          <p className="mt-2 text-center text-[12px] text-faint">
            No documents yet
          </p>
        )}

        <div className="mt-3 flex items-baseline justify-between gap-3 first:mt-0">
          <h3 className="text-[14px] font-semibold text-ink">
            Ready to analyze
          </h3>
          <span className="font-jetbrains text-[12px] text-faint">
            {files.length} file{files.length === 1 ? "" : "s"}
          </span>
        </div>

        <ul className="mt-3 divide-y divide-hairline">
          {files.map((file, i) => (
            <li key={i} className="flex items-center gap-3 py-2">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] bg-surface-2 font-jetbrains text-[10px] font-semibold text-muted ring-1 ring-hairline"
              >
                {extLabel(file.name)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                {file.name}
              </span>
              <span className="shrink-0 font-jetbrains text-[11px] text-faint">
                {formatSize(file.size)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                disabled={busy}
                onClick={() => removeFile(i)}
                className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:text-ink disabled:opacity-40"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={openPicker}
          disabled={busy}
          className="mt-2 text-[12px] font-medium text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          Add files
        </button>

        <div className="mt-4 flex flex-col gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-faint">
              Project name
            </span>
            <input
              type="text"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Suncrest Solar"
              className="w-full rounded-[7px] bg-canvas px-3 py-2 text-[13.5px] text-ink outline-none ring-1 ring-hairline placeholder:text-faint focus:ring-2 focus:ring-vista disabled:opacity-40"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-faint">
              Location
            </span>
            <input
              type="text"
              value={location}
              disabled={busy}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="County, State"
              className="w-full rounded-[7px] bg-canvas px-3 py-2 text-[13.5px] text-ink outline-none ring-1 ring-hairline placeholder:text-faint focus:ring-2 focus:ring-vista disabled:opacity-40"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void start()}
            disabled={!canStart}
            className="rounded-full bg-oxford px-5 py-2.5 text-[13.5px] font-medium text-white transition-opacity disabled:opacity-40"
          >
            Start analysis →
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="rounded-full px-4 py-2.5 text-[13.5px] font-medium text-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            Clear
          </button>
        </div>

        {busy && (
          <p role="status" className="mt-3 text-[12px] text-muted">
            {status}
          </p>
        )}

        {error && !busy && (
          <div
            role="alert"
            className="mt-3 rounded-[7px] bg-risk-soft px-3 py-2.5"
          >
            <p className="text-[12px] font-medium text-risk-ink">
              Couldn&apos;t reach the analysis backend
            </p>
            <p className="mt-0.5 break-words text-[12px] text-risk-ink">
              {error}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void start()}
                className="rounded-full bg-oxford px-4 py-1.5 text-[12px] font-medium text-white"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => router.push("/scanning")}
                className="rounded-full px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:text-ink"
              >
                Continue with demo scan
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
