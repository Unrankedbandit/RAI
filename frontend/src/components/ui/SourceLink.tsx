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

/**
 * Citation linker (2026-08-23): the pipeline cites statutes by NAME ("Public
 * Resources Code §25545", "PUC §399.11", "42 USC §4321") — real sources, but
 * not links, so they rendered as "unverified". Map the common authorities to
 * their official section URLs. Only patterns whose URL shape was verified to
 * resolve (HTTP 200, 2026-08-23) become links; anything else stays plain text
 * with the unverified tag — never a guessed URL.
 */
const CITATION_RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/(?:PRC|Public Resources Code)\s*§+\s*([\d.]+)/i,
   (m) => `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PRC&sectionNum=${m[1]}`],
  [/(?:PUC|Public Utilities Code)\s*§+\s*([\d.]+)/i,
   (m) => `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PUC&sectionNum=${m[1]}`],
  [/(?:GOV|Government Code)\s*§+\s*([\d.]+)/i,
   (m) => `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=${m[1]}`],
  [/(?:WAT|Water Code)\s*§+\s*([\d.]+)/i,
   (m) => `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=WAT&sectionNum=${m[1]}`],
  [/(?:HSC|Health and Safety Code)\s*§+\s*([\d.]+)/i,
   (m) => `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=HSC&sectionNum=${m[1]}`],
  [/\b(\d+)\s*USC\s*§+\s*([\d.]+)/i,
   (m) => `https://www.law.cornell.edu/uscode/text/${m[1]}/${m[2]}`],
];

export function citationToUrl(s: string): string | null {
  for (const [re, build] of CITATION_RULES) {
    const m = s.match(re);
    if (m) return build(m);
  }
  return null;
}

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
  const internal = sources.filter((s) => !isExternalUrl(s) && !citationToUrl(s));
  const cited = sources.filter((s) => !isExternalUrl(s) && citationToUrl(s));
  return (
    <span className={clsx("inline-flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      {external.map((url) => (
        <SourceLink key={url} url={url} tone={tone} />
      ))}
      {cited.map((s) => (
        <SourceLink key={s} url={citationToUrl(s) as string} label={s.length > 42 ? s.slice(0, 42) + "…" : s} tone={tone} />
      ))}
      {internal.length > 0 && (
        <span className={tone === "dark" ? "text-white/60" : "text-faint"}>
          {internal.join(" · ")}
        </span>
      )}
      {external.length === 0 && cited.length === 0 && <UnverifiedTag tone={tone} />}
    </span>
  );
}
