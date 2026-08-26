#!/usr/bin/env node
/**
 * check-jurisdiction-links — advisory liveness re-check for every curated
 * jurisdiction URL (frontend/src/lib/jurisdiction/*.ts).
 *
 * Parses the pack files directly (regex over the TS literals — the data files
 * stay the single source of truth, nothing is duplicated here), probes each
 * URL with HEAD then GET fallback (browser-like User-Agent, 15s timeout), and
 * compares the observation against the link's declared verifyStatus:
 *
 *   ok                 declared ok, observed ok
 *   STALE-ok           declared ok but the link is now failing  ← problem
 *   still-bot-blocked  declared bot-blocked, still 403 to scripted fetch
 *   recovered          declared bot-blocked/dead but now 200 → flip it to ok
 *   undeclared         no per-link record yet (observed status shown)
 *
 * Advisory only: always exits 0. Prints "LINK CHECK: N problems" at the end.
 *
 *   node scripts/check-jurisdiction-links.mjs
 */
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACK_DIR = join(ROOT, "frontend/src/lib/jurisdiction");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const HEADERS = {
  "user-agent": UA,
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,application/pdf,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
};
const TIMEOUT_MS = 15_000;
const DELAY_MS = 300;

/** Flat object literals in these files carry at most one url: each. */
function extractLinks() {
  const links = [];
  for (const file of readdirSync(PACK_DIR).filter((f) => f.endsWith(".ts"))) {
    if (file === "types.ts") continue;
    const src = readFileSync(join(PACK_DIR, file), "utf-8");
    for (const m of src.matchAll(/\{[^{}]*\}/g)) {
      const block = m[0];
      const url = block.match(/\burl:\s*"(https?:\/\/[^"]+)"/)?.[1];
      if (!url) continue;
      links.push({
        file,
        url,
        declared: block.match(/\bverifyStatus:\s*"(ok|bot-blocked|dead)"/)?.[1] ?? null,
        verifiedAt: block.match(/\bverifiedAt:\s*"([^"]+)"/)?.[1] ?? null,
      });
    }
  }
  return links;
}

/**
 * HEAD is a cheap pre-check only — WAFs routinely 403 HEAD while serving GET
 * (observed on fire.venturacounty.gov and the VCFD CDN). GET is authoritative
 * for liveness; the HEAD result is still reported because a link declared
 * "bot-blocked" only counts as recovered when it serves HEAD cleanly too.
 */
async function probe(url) {
  const opts = {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: HEADERS,
  };
  let headStatus = null;
  try {
    const res = await fetch(url, { ...opts, method: "HEAD" });
    headStatus = res.status;
    await res.body?.cancel();
    if (res.status >= 200 && res.status < 400) {
      return { status: res.status, headStatus, via: "HEAD" };
    }
  } catch {
    // HEAD failed outright — GET decides.
  }
  try {
    const res = await fetch(url, { ...opts, method: "GET" });
    await res.body?.cancel();
    return { status: res.status, headStatus, via: "GET" };
  } catch (e) {
    return { status: 0, headStatus, error: String(e?.cause ?? e) };
  }
}

const classify = ({ status }) =>
  status >= 200 && status < 400 ? "ok" : status === 403 ? "bot-blocked" : "dead";

function verdict(declared, observed, headStatus) {
  if (declared === "ok")
    return observed === "ok" ? { v: "ok", problem: false } : { v: "STALE-ok", problem: true };
  if (declared === "bot-blocked") {
    if (observed === "ok")
      return headStatus === 403 || headStatus === null
        ? { v: "still-bot-blocked (HEAD 403, GET ok)", problem: false }
        : { v: "recovered — flip to ok", problem: false, recovered: true };
    return observed === "bot-blocked"
      ? { v: "still-bot-blocked", problem: false }
      : { v: "STALE-bot-blocked (now dead?)", problem: true };
  }
  if (declared === "dead")
    return observed === "ok"
      ? { v: "recovered — flip to ok", problem: false, recovered: true }
      : { v: "still-dead", problem: false };
  return observed === "ok"
    ? { v: "ok (undeclared)", problem: false }
    : { v: "UNDECLARED + failing", problem: true };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const links = extractLinks();
console.log(`🔗 check-jurisdiction-links — probing ${links.length} curated URLs (advisory)\n`);
console.log(
  "url".padEnd(92) + "declared".padEnd(13) + "observed".padEnd(20) + "VERDICT",
);
console.log("─".repeat(150));

let problems = 0;
let recovered = 0;
for (const link of links) {
  const probeResult = await probe(link.url);
  const observed =
    probeResult.status === 0
      ? `dead (err)`
      : `${classify(probeResult)} (${probeResult.status})`;
  const { v, problem, recovered: rec } = verdict(
    link.declared,
    classify(probeResult),
    probeResult.headStatus,
  );
  if (problem) problems++;
  if (rec) recovered++;
  const short = link.url.length > 90 ? link.url.slice(0, 87) + "..." : link.url;
  console.log(
    short.padEnd(92) +
      (link.declared ?? "—").padEnd(13) +
      observed.padEnd(20) +
      (problem ? "❌ " : "") +
      v,
  );
  await sleep(DELAY_MS);
}

console.log("─".repeat(150));
console.log(
  `LINK CHECK: ${problems} problem${problems === 1 ? "" : "s"}` +
    (recovered ? `, ${recovered} recovered (flip to ok)` : "") +
    ` across ${links.length} links`,
);
process.exit(0); // advisory — never fails the gate
