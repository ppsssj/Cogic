// P11 step-1 correctness pass. node run-corr.cjs <RUN_ID>
// (a) repeated scenario, 1 block per condition per project, with worker-p11b (adds the JSON-semantics hash), to check that
//     result-cache hits equal fresh analyses under JSON semantics.
// (b) diagnostic: excalidraw active-edit with variant adaptive-sk (cache-path script kind inferred from the extension)
//     cache ON vs OFF, to test the .json-parsed-as-TS hypothesis. adaptive-sk is a diagnostic copy, not product code.
// Durable writes, memory gate 1,500 MB (stop on SKIP), work copy checked before each block.
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const P11 = path.resolve(__dirname, "..");
const RUN_ID = process.argv[2];
const OUT = path.join(P11, "data", RUN_ID); fs.mkdirSync(OUT, { recursive: true });
const OUTF = path.join(OUT, "blocks.jsonl");
const log = (s) => { const l = `[${new Date().toISOString()}] ${s}`; console.log(l); fs.appendFileSync(path.join(OUT, "run.log"), l + "\n"); };
const avail = () => parseInt(spawnSync("powershell", ["-NoProfile", "-Command", "[int](Get-Counter '\\Memory\\Available MBytes').CounterSamples[0].CookedValue"], { encoding: "utf8" }).stdout, 10);
const done = new Set(fs.existsSync(OUTF) ? fs.readFileSync(OUTF, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.exit === 0 && !r.error).map((r) => r.key) : []);
const jobs = [];
for (const p of ["hono", "excalidraw", "vite", "typeorm", "query"]) for (const [label, variant, mode] of [["off", "adaptive", "off"], ["fixed800", "fixed800", "on"], ["adaptive", "adaptive", "on"]]) jobs.push({ key: `a|${p}|${label}`, project: p, label, variant, mode, scen: "repeated", warm: 3, runs: 15 });
for (const [label, variant, mode] of [["off", "adaptive-sk", "off"], ["adaptive-sk", "adaptive-sk", "on"], ["adaptive", "adaptive", "on"]]) jobs.push({ key: `b|excalidraw|${label}`, project: "excalidraw", label, variant, mode, scen: "active-edit", warm: 1, runs: 5 });
for (const j of jobs) {
  if (done.has(j.key)) { log(`resume: ${j.key}`); continue; }
  const root = JSON.parse(fs.readFileSync(path.join(P11, "targets", `${j.project}.json`), "utf8")).root;
  if (spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).stdout.trim()) { log(`work copy not clean for ${j.project}; stopping`); process.exit(4); }
  let a = avail(), w = 0; while (a < 1000 && w < 20) { log(`gate wait ${a}MB`); spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep 30"]); a = avail(); w++; }
  if (a < 1000) { fs.appendFileSync(OUTF, JSON.stringify({ ...j, skipped: "memory-gate" }) + "\n"); log(`SKIP ${j.key}; stopping`); process.exit(3); }
  const t = Date.now();
  const r = spawnSync(process.execPath, ["--expose-gc", path.join(__dirname, "worker-p11b.cjs"), path.join(P11, "targets", `${j.project}.json`), j.mode, j.scen, String(j.warm), String(j.runs), path.join(OUT, "snap", j.project, j.label)], { env: { ...process.env, P11_VARIANT_DIR: path.join(P11, "variants", j.variant) }, encoding: "utf8", maxBuffer: 1 << 30 });
  let p = null; try { p = JSON.parse(r.stdout); } catch { /* recorded */ }
  fs.appendFileSync(OUTF, JSON.stringify({ ...j, availBeforeMB: a, wallMs: Date.now() - t, exit: r.status, stderrTail: (r.stderr || "").slice(-800), ...(p || { parseError: true }) }) + "\n");
  log(`${j.key} exit=${r.status} n=${p ? p.samples.length : 0} err=${p && p.error ? p.error.slice(0, 100) : ""}`);
}
log("done");
