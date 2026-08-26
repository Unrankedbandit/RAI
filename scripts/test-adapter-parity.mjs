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
// ---------- synthetic fixtures: branches the captured reports don't cover ----
// _synthetic-*.report.json inputs live in sentinel-samples/ (NOT reports/, so
// they never list in /api/projects); the expected .sentinel.json is generated
// by the Python adapter from the RAW stored JSON — matching production, where
// read paths validate but serve the stored bytes (legacy decisions reach the
// adapters unnormalized until the backend contract deploys).
const synthInputs = readdirSync(SAMPLES).filter((f) => f.endsWith(".report.json"));
for (const f of synthInputs) {
  const report = JSON.parse(readFileSync(join(SAMPLES, f), "utf-8"));
  const id = f.replace(/^_synthetic-/, "").replace(/\.report\.json$/, "");
  const tsOut = toSentinel(report, { id });
  const pyOut = JSON.parse(
    readFileSync(join(SAMPLES, f.replace(".report.json", ".sentinel.json")), "utf-8"),
  );
  try {
    assert.deepEqual(tsOut, pyOut);
    console.log(`PARITY  ${f} — synthetic fixture identical across adapters`);
  } catch (e) {
    failed++;
    console.log(`DRIFT   ${f} — adapters disagree:`);
    console.log(String(e.message).split("\n").slice(0, 20).join("\n"));
  }
}

// ---------- targeted branch assertions (TS side; Python mirrors these in
// scripts/test-adapter-contract.py against the same synthetic inputs) -------
function branchCheck(name, cond, detail) {
  if (cond) {
    console.log(`BRANCH  ${name}`);
  } else {
    failed++;
    console.log(`DRIFT   ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const precision = JSON.parse(
  readFileSync(join(SAMPLES, "_synthetic-precision.report.json"), "utf-8"),
);
const precisionOut = toSentinel(precision, { id: "synthetic-precision" });
const byLabel = Object.fromEntries(precisionOut.timeline.map((e) => [e.label, e]));
branchCheck("exact ISO date -> day precision, full display",
  byLabel["Exact ISO milestone"]?.datePrecision === "day"
  && byLabel["Exact ISO milestone"]?.dateDisplay === "Sep 15, 2027",
  JSON.stringify(byLabel["Exact ISO milestone"]));
branchCheck("'Sep 2027' -> month precision, honest 'Sep 2027' display (sort date 2027-09-01)",
  byLabel["Month-vague milestone"]?.date === "2027-09-01"
  && byLabel["Month-vague milestone"]?.datePrecision === "month"
  && byLabel["Month-vague milestone"]?.dateDisplay === "Sep 2027",
  JSON.stringify(byLabel["Month-vague milestone"]));
branchCheck("'Q3 2027' -> quarter precision, honest 'Q3 2027' display (sort date 2027-07-01)",
  byLabel["Quarter-vague deadline"]?.date === "2027-07-01"
  && byLabel["Quarter-vague deadline"]?.datePrecision === "quarter"
  && byLabel["Quarter-vague deadline"]?.dateDisplay === "Q3 2027",
  JSON.stringify(byLabel["Quarter-vague deadline"]));
branchCheck("bare '2028' -> year precision, honest '2028' display (sort date 2028-01-01)",
  byLabel["Year-vague milestone"]?.date === "2028-01-01"
  && byLabel["Year-vague milestone"]?.datePrecision === "year"
  && byLabel["Year-vague milestone"]?.dateDisplay === "2028",
  JSON.stringify(byLabel["Year-vague milestone"]));
branchCheck("undated entry dropped, not fabricated",
  !byLabel["Undated milestone"]);
branchCheck("pinned ITC deadline is day precision",
  byLabel["ITC deadline"]?.datePrecision === "day");

const legacy = JSON.parse(
  readFileSync(join(SAMPLES, "_synthetic-legacy.report.json"), "utf-8"),
);
const legacyOut = toSentinel(legacy, { id: "synthetic-legacy" });
branchCheck("legacy 'Do not proceed' -> needs-review (never on-track)",
  legacyOut.project.status === "needs-review", legacyOut.project.status);
const legacyByLabel = Object.fromEntries(legacyOut.timeline.map((e) => [e.label, e]));
branchCheck("fallback path (agency_actions) carries precision: 'Sep 2027' -> month",
  legacyByLabel["CDFW — Protocol surveys"]?.datePrecision === "month"
  && legacyByLabel["CDFW — Protocol surveys"]?.date === "2027-09-01",
  JSON.stringify(legacyByLabel["CDFW — Protocol surveys"]));
branchCheck("fallback path: 'Q1 2028, ...' -> quarter",
  legacyByLabel["County — CUP application"]?.datePrecision === "quarter"
  && legacyByLabel["County — CUP application"]?.date === "2028-01-01",
  JSON.stringify(legacyByLabel["County — CUP application"]));
branchCheck("fallback path: 'within 90 days' has no date -> dropped",
  !legacyByLabel["BLM — Undated action"]);

// Exact decision -> status mapping, incl. conservative fallback for
// unrecognized legacy strings (parity: Python asserts the same table).
for (const [decision, expected] of [
  ["Proceed", "on-track"],
  ["Investigate", "needs-review"],
  ["Hold", "at-risk"],
  ["proceed", "on-track"],          // case variant
  ["Do not proceed", "needs-review"], // the audit's substring-match bug
  ["Conditional", "needs-review"],   // unrecognized -> conservative
]) {
  const out = toSentinel({ ...precision, decision }, { id: "decision-probe" });
  branchCheck(`decision ${JSON.stringify(decision)} -> ${expected}`,
    out.project.status === expected, out.project.status);
}

if (failed) process.exit(1);
console.log("\nTS and Python adapters are in lockstep on all fixtures.");
