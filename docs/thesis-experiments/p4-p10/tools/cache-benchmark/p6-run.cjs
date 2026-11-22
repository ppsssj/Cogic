// P6 non-UI benchmark orchestrator (P6-A analysis part, P6-C scale, P6-D cache ON/OFF).
// Usage: node run.cjs <RUN_ID> [--quick]
// Every block runs in a fresh Node process; ON/OFF blocks are counterbalanced (ABBA / BAAB) to
// reduce order bias. Raw output is appended to raw.jsonl immediately after each process exits.
"use strict";
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RUN_ID = process.argv[2];
if (!RUN_ID) throw new Error("RUN_ID required");
const QUICK = process.argv.includes("--quick");
const RESULTS = path.join("<RESULTS>\\p6-data\\nonui", RUN_ID);
if (fs.existsSync(RESULTS)) throw new Error(`exists: ${RESULTS}`);
fs.mkdirSync(RESULTS, { recursive: true });
const WS = "<RESULTS>\\scratch\\workspaces";
const REPO = "<COGIC_REPO>";
const BACKUP = process.env.P4_BACKUP_DIR || "<P4_BACKUP_DIR>"; // folder containing the P4 fixture copy
const WARMUP = QUICK ? 1 : 3;
const RUNS_PER_BLOCK = QUICK ? 2 : 15; // x2 blocks per mode = 30 samples
const COLD_PROCS = QUICK ? 1 : 10;     // per mode
const SIZES = process.env.P6_SIZES ? process.env.P6_SIZES.split(",").map(Number) : QUICK ? [100] : [100, 500, 1000, 2000];
const SKIP_REAL = process.env.P6_SKIP_REAL === "1"; // only synthetic targets
const SCENARIOS = ["warm-cleared", "repeated", "active-edit"];

// Same exclusions as the thesis benchmark (scripts/benchmark-analysis-cache.mjs listWorkspaceFiles).
const IGNORED = new Set([".git", "node_modules", "dist", "build", "out", ".next", ".vscode-test", ".vscode-test-web", "coverage", ".turbo", ".cache", ".benchmark-workspaces", ".benchmark-external", "benchmark-results", ".debug-dist"]);
function listFiles(root) {
  const files = [];
  const visit = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.length >= 4000) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORED.has(e.name)) visit(full); }
      else if (/\.(ts|tsx|js|jsx)$/i.test(e.name)) files.push(full);
    }
  };
  visit(root);
  return files;
}

// Deterministic generator copied verbatim in shape from scripts/benchmark-analysis-cache.mjs
// (generateSyntheticWorkspace) so P6-C sizes are comparable to the thesis EXP numbers.
function generateSynthetic(targetRoot, fileCount) {
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(targetRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(targetRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", moduleResolution: "node", strict: true, skipLibCheck: true, noEmit: true }, include: ["**/*.ts"] }, null, 2) + "\n");
  const utilityCount = Math.min(20, Math.max(1, Math.floor(fileCount / 50)));
  const serviceCount = Math.max(1, Math.ceil((fileCount - 1 - utilityCount) / 11));
  const helperCount = fileCount - 1 - utilityCount - serviceCount;
  const entryImports = [], entryCalls = [];
  for (let s = 1; s <= serviceCount; s++) {
    const hs = [];
    for (let slot = 0; slot < 10; slot++) { const h = (s - 1) * 10 + slot + 1; if (h > helperCount) break; hs.push(h); }
    const imports = hs.map((h) => `import { helper${h}, type Helper${h}Input } from "./src/helper-${h}";`).join("\n");
    const body = hs.map((h) => `  total += helper${h}({ id: input.id + ${h}, label: input.label });`).join("\n");
    fs.writeFileSync(path.join(targetRoot, `service-${s}.ts`), `${imports}\n\nexport interface Service${s}Input { id: number; label: string; }\nexport function service${s}(input: Service${s}Input): number {\n  let total = 0;\n${body}\n  return total;\n}\n`);
    entryImports.push(`import { service${s} } from "./service-${s}";`);
    entryCalls.push(`  total += service${s}({ id: seed + ${s}, label: "service-${s}" });`);
  }
  for (let u = 1; u <= utilityCount; u++) {
    fs.writeFileSync(path.join(targetRoot, "src", `utility-${u}.ts`), `export interface Utility${u}Input { value: number; label: string; }\nexport function utility${u}(input: Utility${u}Input): number {\n  const weight = input.label.length + ${u};\n  return input.value + weight;\n}\n`);
  }
  for (let h = 1; h <= helperCount; h++) {
    const u = ((h - 1) % utilityCount) + 1;
    fs.writeFileSync(path.join(targetRoot, "src", `helper-${h}.ts`), `import { utility${u} } from "./utility-${u}";\n\nexport interface Helper${h}Input { id: number; label: string; }\nexport type Helper${h}Result = { value: number; source: string };\nexport function helper${h}Leaf(value: number): number {\n  return utility${u}({ value, label: "helper-${h}" });\n}\nexport function helper${h}(input: Helper${h}Input): number {\n  const base = input.id + input.label.length + ${h};\n  return helper${h}Leaf(base);\n}\n`);
  }
  fs.writeFileSync(path.join(targetRoot, "entry.ts"), `${entryImports.join("\n")}\n\nexport interface EntryInput { seed: number; }\nexport function runEntry(input: EntryInput): number {\n  const seed = input.seed;\n  let total = 0;\n${entryCalls.join("\n")}\n  return total;\n}\n`);
}

function prepareTargets() {
  fs.mkdirSync(WS, { recursive: true });
  const targets = [];
  // Small real fixture used by the P5 UI tests (fresh copy from the backup, never the original).
  const fx = path.join(WS, "fixture");
  if (!SKIP_REAL) {
    if (!fs.existsSync(fx)) fs.cpSync(path.join(BACKUP, "fixture"), fx, { recursive: true });
    targets.push({ id: "fixture", kind: "real-small", root: fx, activeFile: path.join(fx, "src", "demo.ts") });
    targets.push({ id: "cogic-repo", kind: "real-project", root: REPO, activeFile: path.join(REPO, "src", "panel", "CodeGraphPanel.ts") });
  }
  for (const n of SIZES) {
    const root = path.join(WS, `synthetic-${n}`);
    if (!fs.existsSync(path.join(root, "entry.ts"))) generateSynthetic(root, n);
    targets.push({ id: `synthetic-${n}`, kind: "synthetic", root, activeFile: path.join(root, "entry.ts") });
  }
  for (const t of targets) {
    t.filePaths = listFiles(t.root);
    const f = path.join(RESULTS, `target-${t.id}.json`);
    fs.writeFileSync(f, JSON.stringify(t));
    t.jsonPath = f;
  }
  return targets;
}

function runWorker(t, mode, scenario, warmup, runs, meta) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, "worker.cjs"), t.jsonPath, mode, scenario, String(warmup), String(runs)], {
    env: { ...process.env, P6_SPAWN_EPOCH_MS: String(started) }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  const wallMs = Date.now() - started;
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* recorded below */ }
  const rec = { runId: RUN_ID, at: new Date(started).toISOString(), wallMs, exit: r.status, ...meta, ...(parsed ?? { target: t.id, cacheMode: mode, scenario, error: (r.stderr || "").slice(-2000) }) };
  fs.appendFileSync(path.join(RESULTS, "raw.jsonl"), JSON.stringify(rec) + "\n");
  process.stdout.write(`${rec.at} ${t.id} ${scenario} ${mode} block=${meta.block} exit=${r.status} wall=${wallMs}ms\n`);
  return rec;
}

function main() {
  const commit = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-C", REPO, "status", "--porcelain"], { encoding: "utf8" }).trim();
  const env = {
    runId: RUN_ID, startedAt: new Date().toISOString(), quick: QUICK, node: process.version,
    platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length,
    memoryBytes: os.totalmem(), cogicCommit: commit, cogicWorktreeDirty: dirty.length > 0,
    warmup: WARMUP, runsPerBlock: RUNS_PER_BLOCK, blocksPerMode: 2, coldProcsPerMode: COLD_PROCS, sizes: SIZES,
    notes: "Concurrency rule: no UI automation runs while this benchmark runs (checked by operator; see progress.md).",
  };
  fs.writeFileSync(path.join(RESULTS, "env.json"), JSON.stringify(env, null, 2));
  const targets = prepareTargets();
  fs.writeFileSync(path.join(RESULTS, "targets.json"), JSON.stringify(targets.map(({ filePaths, ...t }) => ({ ...t, fileCount: filePaths.length })), null, 2));

  targets.forEach((t, ti) => {
    // Cold start: a fresh process per sample, ON/OFF alternating, starting mode alternates per target.
    for (let i = 0; i < COLD_PROCS * 2; i++) {
      const mode = (i + ti) % 2 === 0 ? "on" : "off";
      runWorker(t, mode, "cold-start", 0, 1, { block: i });
    }
    SCENARIOS.forEach((sc, si) => {
      const order = (ti + si) % 2 === 0 ? ["on", "off", "off", "on"] : ["off", "on", "on", "off"];
      order.forEach((mode, b) => runWorker(t, mode, sc, WARMUP, RUNS_PER_BLOCK, { block: b }));
    });
  });
  fs.writeFileSync(path.join(RESULTS, "DONE"), new Date().toISOString());
}
main();
