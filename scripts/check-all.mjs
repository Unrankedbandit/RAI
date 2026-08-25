#!/usr/bin/env node
/**
 * check-all — the local mirror of CI. Run this BEFORE you push
 * (or let your local agent run it) and green here = green in CI.
 *
 *   node scripts/check-all.mjs          # full local gate
 *   node scripts/check-all.mjs --quick  # node-only checks (skip python)
 *
 * What it runs:
 *   1. [python] agent reports validate against the pydantic agent schema
 *   2. [python] Sentinel fixtures regenerated + freshness diff (CI gate)
 *   3. [node]   Sentinel outputs conform to frontend/src/lib/types.ts (CI gate)
 *   4. [node]   TS adapter parity with Python adapter (lockstep check)
 *   5. [git]    advisory: warns if you touched contract/schema surfaces
 *   6. [git]    advisory: warns if your changed files overlap other local branches
 *
 * Python steps SKIP (with instructions) if python/pydantic is unavailable —
 * CI enforces them server-side regardless. Everything else is zero-dependency.
 */
import { execFileSync, execSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const QUICK = process.argv.includes("--quick");
let failures = 0;
let skipped = 0;

const ok = (msg) => console.log(`  ✅ ${msg}`);
const fail = (msg) => { failures++; console.log(`  ❌ ${msg}`); };
const skip = (msg) => { skipped++; console.log(`  ⏭️  ${msg}`); };
const step = (msg) => console.log(`\n▸ ${msg}`);

function run(cmd, args, opts = {}) {
  try {
    execFileSync(cmd, args, { cwd: ROOT, stdio: "pipe", ...opts });
    return { ok: true };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

function pythonCmd() {
  for (const c of ["python", "python3", "py"]) {
    if (run(c, ["--version"]).ok) return c;
  }
  return null;
}

console.log("🚦 check-all — local pre-push gate (mirror of CI)");

// ---------- python-dependent gates ----------
const py = QUICK ? null : pythonCmd();
if (!py) {
  step("Agent schema validation + fixture freshness (python)");
  skip(QUICK ? "--quick mode: skipped" : "python not found — skipped locally; CI enforces these server-side");
} else {
  const hasPydantic = run(py, ["-c", "import pydantic"]).ok;
  if (!hasPydantic) {
    step("Agent schema validation + fixture freshness (python)");
    skip("pydantic not installed for " + py + " — run: pip install -r agent_backend/requirements.txt");
  } else {
    step("Agent reports validate against pydantic agent schema");
    const r1 = run(py, ["-c",
      "import pathlib; from agent_backend.schemas import Report; " +
      "files = sorted(pathlib.Path('agent_backend/reports').glob('*.json')); " +
      "[Report.model_validate_json(p.read_text(encoding='utf-8')) for p in files]; " +
      "print(len(files), 'reports valid')"]);
    r1.ok ? ok("agent reports conform to agent schema") : fail("report schema violation:\n" + r1.out);

    step("Sentinel fixture freshness (CI blocking gate)");
    run(py, ["-m", "agent_backend.sentinel_adapter"]);
    const diff = run("git", ["diff", "--exit-code", "--stat", "agent_backend/sentinel-samples"]);
    diff.ok
      ? ok("sentinel-samples in sync with reports")
      : fail("stale fixtures — regenerated locally; commit the changes in agent_backend/sentinel-samples");

    step("Unit tests (offline, no LLM) — CI blocking");
    const ru = run(py, ["scripts/test_unit.py"]);
    ru.ok ? ok("unit tests pass") : fail("unit test failure:\n" + ru.out);

    step("Integration tests (API contract, in-process) — CI blocking");
    const ri = run(py, ["scripts/test_integration.py"]);
    ri.ok ? ok("integration tests pass") : fail("integration test failure:\n" + ri.out);
  }
}

// ---------- node gates ----------
step("Sentinel outputs conform to frontend schema (CI blocking gate)");
const r3 = run(process.execPath, ["scripts/validate-sentinel.mjs"]);
r3.ok ? ok("all ProjectDetail outputs conform") : fail("schema violation:\n" + r3.out);

step("TS adapter parity with Python adapter");
const r4 = run(process.execPath, ["scripts/test-adapter-parity.mjs"]);
r4.ok ? ok("adapters in lockstep") : fail("adapter drift:\n" + r4.out);

// ---------- git advisories ----------
step("Contract-surface check (advisory)");
const CONTRACT = [
  "frontend/src/lib/types.ts", "frontend/src/lib/mockData.ts",
  "agent_backend/schemas.py", "agent_backend/sentinel_adapter.py",
  "scripts/validate-sentinel.mjs",
];
let changed = [];
try {
  changed = execSync("git diff --name-only origin/main...HEAD", { cwd: ROOT, encoding: "utf-8" })
    .split("\n").filter(Boolean);
} catch {
  changed = execSync("git diff --name-only HEAD", { cwd: ROOT, encoding: "utf-8" }).split("\n").filter(Boolean);
}
const touched = changed.filter((f) =>
  CONTRACT.includes(f) || f.startsWith("agent_backend/reports/") ||
  f.startsWith("agent_backend/sentinel-samples/") || f.startsWith("research/"));
touched.length
  ? console.log(`  ⚠️  you touched contract surfaces — expect the bot to flag your PR:\n${touched.map((f) => `      ${f}`).join("\n")}`)
  : ok("no contract surfaces touched");

step("Local branch overlap (advisory)");
try {
  const branches = execSync("git branch --format='%(refname:short)'", { cwd: ROOT, encoding: "utf-8" })
    .split("\n").map((b) => b.trim().replace(/^'|'$/g, "")).filter((b) => b && b !== "main" && b !== currentBranch());
  function currentBranch() {
    return execSync("git branch --show-current", { cwd: ROOT, encoding: "utf-8" }).trim();
  }
  let any = false;
  for (const b of branches) {
    let theirs = [];
    try {
      theirs = execSync(`git diff --name-only main...${b}`, { cwd: ROOT, encoding: "utf-8" }).split("\n").filter(Boolean);
    } catch { /* branch may not have merged base */ }
    const both = changed.filter((f) => theirs.includes(f));
    if (both.length) {
      any = true;
      console.log(`  ⚠️  overlaps branch '${b}': ${both.slice(0, 8).join(", ")}${both.length > 8 ? ` (+${both.length - 8})` : ""}`);
    }
  }
  if (!any) ok("no overlap with other local branches");
} catch {
  skip("could not enumerate branches");
}

// ---------- summary ----------
console.log("\n" + "─".repeat(56));
if (failures) {
  console.log(`❌ ${failures} check(s) failed — fix before pushing (CI will go red).`);
  process.exit(1);
}
console.log(`✅ all local gates pass${skipped ? ` (${skipped} skipped — CI covers them)` : ""} — safe to push.`);
