/**
 * Parity test: the TypeScript adapter (frontend/src/lib/agent/adapter.ts)
 * must produce output identical to the Python adapter
 * (agent_backend/sentinel-samples/*.sentinel.json) for every agent report.
 *
 * Usage: node scripts/test-adapter-parity.mjs
 * Exit 0 = adapters are in lockstep. Exit 1 = drift (diff printed).
 */
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import assert from "assert/strict";
import { toSentinel } from "../frontend/src/lib/agent/adapter.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORTS = join(ROOT, "agent_backend", "reports");
const SAMPLES = join(ROOT, "agent_backend", "sentinel-samples");

const META = {
  "solar-alpha.json": { id: "solar-alpha", latitude: 38.31, longitude: -121.94, capacityMW: 250 },
  "parcel-a-boulder-city.json": { id: "parcel-a", latitude: 35.9056, longitude: -114.9345, capacityMW: 180 },
  "parcel-b-sloan-canyon.json": { id: "parcel-b", latitude: 35.9167, longitude: -115.126, capacityMW: 180 },
};

let failed = 0;
for (const f of readdirSync(REPORTS).filter((f) => f.endsWith(".json"))) {
  const report = JSON.parse(readFileSync(join(REPORTS, f), "utf-8"));
  const meta = META[f] ?? { id: f.replace(".json", "") };
  const tsOut = toSentinel(report, meta);
  const pyOut = JSON.parse(
    readFileSync(join(SAMPLES, f.replace(".json", ".sentinel.json")), "utf-8"),
  );
  try {
    assert.deepEqual(tsOut, pyOut);
    console.log(`PARITY  ${f} — TS adapter output identical to Python adapter`);
  } catch (e) {
    failed++;
    console.log(`DRIFT   ${f} — adapters disagree:`);
    console.log(String(e.message).split("\n").slice(0, 20).join("\n"));
  }
}
if (failed) process.exit(1);
console.log("\nTS and Python adapters are in lockstep on all fixtures.");
