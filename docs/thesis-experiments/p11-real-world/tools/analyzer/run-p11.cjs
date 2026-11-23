// P11 orchestrator. node run-p11.cjs <RUN_ID> <project,...> [scenario,...]
// Conditions: off (v0.0.6, cache disabled), fixed800 (v0.0.6 + pre-P9 analyzer cache policy), adaptive (v0.0.6).
// P9-comparable scenarios: warm-up 3 + 15 measured, 2 blocks, condition order rotated per block.
// cold-start: independent processes (COLD_N per condition, round-robin, rotated). warm-cleared: warm-up 1 + 5, 2 blocks.
// Memory gate: a process starts only if available physical memory >= GATE_MB (waits up to 10 min); on SKIP the run
// stops (exit 3) with everything so far on disk. Resume: blocks already in blocks.jsonl with exit 0 are not re-run, so an
// interrupted project continues with the same block plan (the scenario list and rotation are always the full design).
// Before every block the work copy is checked; tracked files left modified by an interrupted block are restored (logged).
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const P11 = path.resolve(__dirname, "..");
const [RUN_ID, PROJ, SCEN] = process.argv.slice(2);
const OUT = path.join(P11, "data", RUN_ID); fs.mkdirSync(OUT, { recursive: true });
const GATE_MB = Number(process.env.P11_GATE_MB || 1000) // 1,500 MB until 2026-11-23 (user decision: relaxed to 1,000 MB), COLD_N = Number(process.env.P11_COLD_N || 5);
const CONDS = [["off", "adaptive", "off"], ["fixed800", "fixed800", "on"], ["adaptive", "adaptive", "on"]];
const SCENARIOS = "cold-start,warm-cleared,repeated,active-edit,cross-file,file-switch".split(",");
const ONLY = SCEN ? new Set(SCEN.split(",")) : null; // optional subset to RUN; rotation still uses the full list
const plan = { "warm-cleared": [1, 5], repeated: [3, 15], "active-edit": [3, 15], "cross-file": [3, 15], "file-switch": [3, 15] };
const log = (s) => { const line = `[${new Date().toISOString()}] ${s}`; console.log(line); fs.appendFileSync(path.join(OUT, "run.log"), line + "\n"); };
function availMB() {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", "[int](Get-Counter '\\Memory\\Available MBytes').CounterSamples[0].CookedValue"], { encoding: "utf8" });
  const v = parseInt(r.stdout, 10); return Number.isFinite(v) ? v : Math.round(os.freemem() / 1048576);
}
function gate() { for (let i = 0; i < 20; i++) { const a = availMB(); if (a >= GATE_MB) return a; log(`gate wait avail=${a}MB`); spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep 30"]); } return null; }
const procs = spawnSync("powershell", ["-NoProfile", "-Command", "Get-Process | Group-Object ProcessName | ForEach-Object { '{0}={1}' -f $_.Name, [int](($_.Group | Measure-Object WorkingSet64 -Sum).Sum/1MB) } | Sort-Object { [int]($_ -split '=')[1] } -Descending | Select-Object -First 12"], { encoding: "utf8" }).stdout.trim().split(/\r?\n/);
fs.writeFileSync(path.join(OUT, `env-${Date.now()}.json`), JSON.stringify({ RUN_ID, availAtStartMB: availMB(), topProcessesMB: procs, startedAt: new Date().toISOString(), node: process.version, cpu: os.cpus()[0].model, cores: os.cpus().length, totalMemMB: Math.round(os.totalmem() / 1048576), gateMB: GATE_MB, coldN: COLD_N, conditions: CONDS, plan }, null, 2));
// synchronous append: each block is on disk as soon as it finishes (spawnSync blocks the event loop, so a stream would only flush at exit)
const BLOCKS = path.join(OUT, "blocks.jsonl");
const done = new Set(fs.existsSync(BLOCKS) ? fs.readFileSync(BLOCKS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.exit === 0 && !r.error && r.samples).map((r) => `${r.project}|${r.scenario}|${r.condition}|${r.block}`) : []);
function ensureClean(project) {
  const root = JSON.parse(fs.readFileSync(path.join(P11, "targets", `${project}.json`), "utf8")).root;
  const st = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).stdout.trim();
  if (!st) return;
  const files = st.split("\n").filter((l) => l.startsWith(" M") || l.startsWith("M ")).map((l) => l.slice(3));
  log(`work copy not clean before block (${st.replace(/\n/g, "; ")}); restoring tracked files: ${files.join(", ")}`);
  if (files.length) spawnSync("git", ["-C", root, "checkout", "--", ...files]);
  fs.appendFileSync(path.join(OUT, "restores.jsonl"), JSON.stringify({ at: new Date().toISOString(), project, status: st, restored: files }) + "\n");
}
const rows = { write: (s) => fs.appendFileSync(path.join(OUT, "blocks.jsonl"), s), end: () => {} };
function runOne(project, scen, cond, block, warm, runs, seq) {
  const [label, variant, mode] = cond;
  if (ONLY && !ONLY.has(scen)) return;
  if (done.has(`${project}|${scen}|${label}|${block}`)) { log(`resume: ${project} ${scen} ${label} b${block} already recorded`); return; }
  ensureClean(project);
  const avail = gate();
  const base = { project, scenario: scen, condition: label, block, seq, availBeforeMB: avail, at: new Date().toISOString() };
  if (avail === null) { rows.write(JSON.stringify({ ...base, skipped: "memory-gate" }) + "\n"); log(`SKIP ${project} ${scen} ${label} b${block}: memory gate not met for 10 min — stopping; data so far is on disk`); process.exit(3); }
  const snap = block === 0 && seq === 0 ? path.join(OUT, "snap", project) : "";
  const t = Date.now();
  const r = spawnSync(process.execPath, ["--expose-gc", path.join(__dirname, "worker-p11.cjs"), path.join(P11, "targets", `${project}.json`), mode, scen, String(warm), String(runs), snap], { env: { ...process.env, P11_VARIANT_DIR: path.join(P11, "variants", variant) }, encoding: "utf8", maxBuffer: 1 << 30, timeout: 45 * 60 * 1000 });
  let p = null; try { p = JSON.parse(r.stdout); } catch { /* recorded below */ }
  const rec = { ...base, wallMs: Date.now() - t, exit: r.status, signal: r.signal, stderrTail: (r.stderr || "").slice(-1500), ...(p || { parseError: true }) };
  rows.write(JSON.stringify(rec) + "\n");
  const med = p && p.samples.length ? p.samples.map((s) => s.extensionSideMs).sort((a, b) => a - b)[Math.floor(p.samples.length / 2)] : null;
  log(`${project} ${scen} ${label} b${block}${seq ? " s" + seq : ""} exit=${r.status} n=${p ? p.samples.length : 0} med=${med && med.toFixed(1)}ms err=${p && p.error ? p.error.slice(0, 120) : ""} wall=${Date.now() - t}`);
}
for (const project of PROJ.split(",")) {
  SCENARIOS.forEach((scen, si) => {
    if (scen === "cold-start") {
      for (let k = 0; k < COLD_N; k++) for (let j = 0; j < CONDS.length; j++) runOne(project, scen, CONDS[(j + k) % CONDS.length], k, 0, 1, 0);
      return;
    }
    const [warm, runs] = plan[scen];
    for (let block = 0; block < 2; block++) {
      const order = CONDS.map((_, i) => CONDS[(i + block * 2 + si) % CONDS.length]);
      for (const c of order) runOne(project, scen, c, block, warm, runs, 0);
    }
  });
}
rows.end(); log("done");
