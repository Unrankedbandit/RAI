import { clsx } from "@/lib/clsx";

/**
 * Source attribution primitives — the honesty layer for every claim the UI
 * shows. Rules (hard):
 *  - A source is rendered as a real external link ONLY when it is an http(s)
 *    URL the pipeline actually returned. Never linkify anything else.
 *  - A claim with no external URL gets the visible "unverified — no external
 *    source" tag. Internal document names still render, as plain text.
 */

const URLISH = /^https?:\/\//i;

export function isExternalUrl(s: string): boolean {
  return URLISH.test(s.trim());
}

/** True when at least one entry is an external URL. */
export function hasExternalUrl(sources: readonly string[] | undefined): boolean {
  return !!sources?.some((s) => isExternalUrl(s));
}

/** One external source link: "<label> ↗", opens in a new tab. */
export function SourceLink({
  url,
  label,
  tone = "light",
  className,
}: {
  url: string;
  /** Anchor text; defaults to a compact "source". */
  label?: string;
  /** dark = rendered inside the oxford tooltip (white text). */
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={url}
      className={clsx(
        "break-all font-medium hover:underline underline-offset-2",
        tone === "dark" ? "text-[#9CC4FF]" : "text-brand",
        className,
      )}
    >
      {label ?? "source"} <span aria-hidden>↗</span>
    </a>
  );
}

/** The visible honesty tag for claims with no external source. */
export function UnverifiedTag({
  tone = "light",
  className,
}: {
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium",
        tone === "dark"
          ? "bg-white/10 text-[#FFD9A8]"
          : "bg-surface-2 text-faint ring-1 ring-hairline",
        className,
      )}
    >
      unverified — no external source
    </span>
  );
}

/**
 * Full attribution row for a list of source strings: URLs become "source ↗"
 * links, internal document names stay plain text, and when no external URL
 * exists at all the unverified tag is appended.
 */
export function SourceAttribution({
  sources,
  tone = "light",
  className,
}: {
  sources: readonly string[];
  tone?: "light" | "dark";
  className?: string;
}) {
  const external = sources.filter(isExternalUrl);
  const internal = sources.filter((s) => !isExternalUrl(s));
  return (
    <span className={clsx("inline-flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      {external.map((url) => (
        <SourceLink key={url} url={url} tone={tone} />
      ))}
      {internal.length > 0 && (
        <span className={tone === "dark" ? "text-white/60" : "text-faint"}>
          {internal.join(" · ")}
        </span>
      )}
      {external.length === 0 && <UnverifiedTag tone={tone} />}
    </span>
  );
}
