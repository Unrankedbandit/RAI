// Live intel route: fetches recent web/news snippets for a project's region
// via Bright Data's SERP API (server-side, so the token never ships to the
// client). Degrades gracefully — the client always gets 200 + { items: [] }
// when no token is configured or the upstream call fails.

import { projects } from "@/lib/mockData";

export type IntelItem = {
  title: string;
  link: string;
  snippet?: string;
};

export const dynamic = "force-dynamic";

const TTL_MS = 15 * 60 * 1000;
const MAX_ITEMS = 3;
const TIMEOUT_MS = 8_000;
const MAX_QUERY_LEN = 200;
const MAX_CACHE_ENTRIES = 100;

/** Per-instance response cache so popup re-opens don't re-hit the API. */
const cache = new Map<string, { at: number; items: IntelItem[] }>();

function cacheSet(key: string, items: IntelItem[]) {
  // Evict oldest entries once the cap is reached (Map iterates in insertion order).
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), items });
}

// Bright Data "parsed_light" (Light JSON) response shapes — see
// https://docs.brightdata.com/scraping-automation/serp-api/parsed-json-results/parsing-search-results
type SerpEntry = { title?: string; link?: string; description?: string };
type SerpLight = { organic?: SerpEntry[]; news?: SerpEntry[] };

function buildQuery(projectId: string | null, rawQ: string | null): string | null {
  if (projectId) {
    const p = projects.find((proj) => proj.id === projectId);
    if (p) {
      return `"${p.location}" solar project ${p.capacityMW} MW permitting OR interconnection OR construction`;
    }
  }
  const q = rawQ?.trim();
  if (!q || q.length > MAX_QUERY_LEN) return null;
  return q;
}

async function fetchIntel(query: string): Promise<IntelItem[]> {
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.BRIGHTDATA_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      zone: process.env.BRIGHTDATA_SERP_ZONE ?? "serp_api",
      url: "https://www.google.com/search?q=" + encodeURIComponent(query),
      format: "raw",
      data_format: "parsed_light",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as SerpLight;
  const entries = [...(data.organic ?? []), ...(data.news ?? [])];
  const seen = new Set<string>();
  const items: IntelItem[] = [];
  for (const e of entries) {
    if (!e.title || !e.link || seen.has(e.link)) continue;
    seen.add(e.link);
    items.push({ title: e.title, link: e.link, snippet: e.description });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = buildQuery(searchParams.get("project"), searchParams.get("q"));
  if (!query) {
    return Response.json({ items: [] satisfies IntelItem[] }, { status: 400 });
  }

  // No token configured — feature is silently off, never an error.
  if (!process.env.BRIGHTDATA_API_TOKEN) {
    return Response.json({ items: [] satisfies IntelItem[] });
  }

  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return Response.json({ items: hit.items });
  }

  try {
    const items = await fetchIntel(query);
    cacheSet(query, items);
    return Response.json({ items });
  } catch {
    // Upstream error/timeout — the popup simply hides the section.
    return Response.json({ items: [] satisfies IntelItem[] });
  }
}
