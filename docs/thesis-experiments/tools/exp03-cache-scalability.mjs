#!/usr/bin/env node
// EXP-03 SourceFile cache capacity & scalability (exp03-cache-scalability/1).
//
// Reuses the EXP-02 tool (exp02-cache-benchmark.mjs 1.2) without changing it: synthetic workspace
// generation, workspace listing, analyzePanelEquivalent (the same timed region), active-edit scenario
// code, canonical result hash, statistics helpers, environment record and historical-artifact integrity.
//
// Capacity injection (experimental-design.md §5, plan B): the compiled out/analyzer of the fixed analyzer
// (bbe4cbf) is copied OUTSIDE the repository and only the numeric literal of the single declaration
//   const MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = 800;
// is replaced (400, 800 = unchanged copy, 1600). The TypeScript source, the cache logic and every other
// byte stay the same. node_modules of the copies is a junction to the analyzer worktree, so `typescript`
// resolves to the same files. The OFF baseline loads the original build.
//
// The process cwd decides the automatic @types roots (the analyzer passes no configFileName to
// parseJsonConfigFileContent), so every command must run with cwd = --analyzer-root (checked).
//
// Usage (cwd = analyzer worktree):
//   node <tool> prepare   --analyzer-root <w> --run-root <dir>
//   node <tool> workloads --analyzer-root <w> --run-root <dir> --work-dir <dir>
//   node <tool> phase --name correctness|time|repeated|boundary|trace|memory|microbench
//        --analyzer-root <w> --run-root <dir> --work-dir <dir> [--blocks k] [--warmup n] [--runs n]
//        [--seed s] [--only id,id] [--label pilot] [--min-free-mb 400]
//   node <tool> integrity --exp02-zip <zip>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { performance, PerformanceObserver } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import * as X from "./exp02-cache-benchmark.mjs";

export const TOOL_VERSION = "exp03-cache-scalability/1";
const TOOL_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = X.REPO_ROOT;
export const ANALYZER_COMMIT = X.GROUPS.B.commit;
export const CAPACITIES = [400, 800, 1600];
export const MAIN_N = [100, 500, 1000, 2000];
export const DEFAULT_SEED = 20261103;
export const EXP02_ZIP_SHA256 = "fea7da4646e16c9d97aded527c8efa43c2dcaca25df08afd60bdb2d9f46d02dc";
const ORIGINAL_CAPACITY = "800";
const isWin = process.platform === "win32";
const EV = Object.fromEntries(["hit", "miss", "stale", "bypass", "disabled", "store", "clear"].map((k) => [k, `analyzer.sourceFileCache.${k}`]));

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const writeJson = (f, d) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(d, null, 2)}\n`);
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const git = (args, cwd) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const samePathCI = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const relPosix = (from, to) => path.relative(from, to).split(path.sep).join("/");

// ===========================================================================
// Capacity injection (plan B)

// Exactly one declaration, exactly the original literal; only that literal changes.
export function injectCapacity(text, capacity) {
  const anyDecl = [...text.matchAll(/\b(?:const|let|var)\s+MAX_DISK_SOURCE_FILE_CACHE_ENTRIES\b/g)];
  const exact = [...text.matchAll(/^const MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = (\d+);(?=\r?$)/gm)];
  const identifierOccurrences = (text.match(/\bMAX_DISK_SOURCE_FILE_CACHE_ENTRIES\b/g) ?? []).length;
  if (anyDecl.length !== 1 || exact.length !== 1) return { ok: false, reason: `declarations ${anyDecl.length}, exact-form declarations ${exact.length}`, identifierOccurrences };
  if (exact[0][1] !== ORIGINAL_CAPACITY) return { ok: false, reason: `original value ${exact[0][1]} != ${ORIGINAL_CAPACITY}`, identifierOccurrences };
  if (!Number.isInteger(capacity) || capacity < 1) return { ok: false, reason: `invalid capacity ${capacity}`, identifierOccurrences };
  const m = exact[0];
  const replacement = `const MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = ${capacity};`;
  const out = text.slice(0, m.index) + replacement + text.slice(m.index + m[0].length);
  const a = text.split("\n");
  const b = out.split("\n");
  const changed = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) changed.push({ line: i + 1, before: a[i], after: b[i] });
  const roundTrip = out.slice(0, m.index) + m[0] + out.slice(m.index + replacement.length) === text;
  const expectChanged = String(capacity) === ORIGINAL_CAPACITY ? 0 : 1;
  const checks = {
    sameLineCount: a.length === b.length,
    changedLineCount: changed.length === expectChanged,
    identifierOccurrencesUnchanged: (out.match(/\bMAX_DISK_SOURCE_FILE_CACHE_ENTRIES\b/g) ?? []).length === identifierOccurrences,
    roundTripRestoresOriginal: roundTrip,
    byteLengthDelta: Buffer.byteLength(out) - Buffer.byteLength(text) === String(capacity).length - ORIGINAL_CAPACITY.length,
  };
  return { ok: Object.values(checks).every(Boolean), out, declarationLine: text.slice(0, m.index).split("\n").length, declaration: m[0], replacement, changedLines: changed, identifierOccurrences, checks };
}

export function unifiedDiff(fileLabelA, fileLabelB, changedLines) {
  const L = [`--- ${fileLabelA}`, `+++ ${fileLabelB}`];
  for (const c of changedLines) L.push(`@@ -${c.line},1 +${c.line},1 @@`, `-${c.before}`, `+${c.after}`);
  return `${L.join("\n")}\n`;
}

const listFiles = (dir, rel = "") =>
  fs
    .readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listFiles(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`]))
    .sort();

export function buildDir(runRoot, buildId, analyzerRoot) {
  return buildId === "original" ? analyzerRoot : path.join(runRoot, "builds", buildId);
}
export const buildCapacity = (buildId) => (buildId === "original" ? Number(ORIGINAL_CAPACITY) : Number(buildId.slice(1)));

function cmdPrepare(a) {
  const analyzerRoot = path.resolve(a["analyzer-root"]);
  const runRoot = path.resolve(a["run-root"]);
  const identity = X.analyzerIdentity("B", analyzerRoot);
  if (!identity.ok) throw new Error(`analyzer identity: ${identity.problems.join("; ")}`);
  const builds = path.join(runRoot, "builds");
  if (fs.existsSync(builds)) throw new Error(`refusing to overwrite ${builds}`);
  const srcDir = path.join(analyzerRoot, "out", "analyzer");
  const files = listFiles(srcDir);
  const originalFiles = Object.fromEntries(files.map((f) => [f, sha256(fs.readFileSync(path.join(srcDir, f)))]));
  const originalText = fs.readFileSync(path.join(srcDir, "analyze.js"), "utf8");
  const report = { schema: "exp03-capacity-injection/1", method: "B (experimental-design.md §5): copy of compiled out/analyzer, one numeric literal replaced", tool: TOOL_VERSION, analyzer: { head: identity.head, buildHash: identity.buildHash, typescript: identity.typescript, srcAnalyzerTree: identity.srcAnalyzerTree }, sourceDir: "<analyzer-root>/out/analyzer", originalFiles, constant: null, builds: [], status: "RUNNING" };
  const probe = injectCapacity(originalText, 800);
  if (!probe.ok) {
    report.status = "BLOCKED";
    report.blockedReason = probe.reason ?? JSON.stringify(probe.checks);
    writeJson(path.join(runRoot, "capacity-injection.json"), report);
    throw new Error(`capacity injection BLOCKED: ${report.blockedReason}`);
  }
  report.constant = { file: "out/analyzer/analyze.js", line: probe.declarationLine, declaration: probe.declaration, identifierOccurrences: probe.identifierOccurrences };
  for (const capacity of CAPACITIES) {
    const id = `c${capacity}`;
    const dir = path.join(builds, id);
    const dst = path.join(dir, "out", "analyzer");
    const inj = injectCapacity(originalText, capacity);
    if (!inj.ok) throw new Error(`injection ${id} failed: ${JSON.stringify(inj.checks ?? inj.reason)}`);
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(dst, f)), { recursive: true });
      if (f === "analyze.js") fs.writeFileSync(path.join(dst, f), inj.out);
      else fs.copyFileSync(path.join(srcDir, f), path.join(dst, f));
    }
    fs.symlinkSync(path.join(analyzerRoot, "node_modules"), path.join(dir, "node_modules"), "junction");
    const variantFiles = Object.fromEntries(listFiles(dst).map((f) => [f, sha256(fs.readFileSync(path.join(dst, f)))]));
    const changedFiles = Object.keys({ ...originalFiles, ...variantFiles }).filter((f) => originalFiles[f] !== variantFiles[f]);
    const diff = unifiedDiff("original/out/analyzer/analyze.js", `${id}/out/analyzer/analyze.js`, inj.changedLines);
    fs.writeFileSync(path.join(builds, `${id}.diff`), diff);
    // load in a separate process: module shape, resolved typescript (same realpath as the analyzer worktree)
    const load = spawnSync(process.execPath, [TOOL_FILE, "child-load", "--build-dir", dir, "--analyzer-root", analyzerRoot], { cwd: analyzerRoot, encoding: "utf8" });
    let loadInfo = null;
    try {
      loadInfo = JSON.parse(load.stdout.trim().split("\n").pop());
    } catch {
      loadInfo = { ok: false, stderr: String(load.stderr).slice(-1000).replace(/[A-Za-z]:[\\/][^\s"']*/g, "<path>") };
    }
    const expectedChanged = capacity === 800 ? [] : ["analyze.js"];
    const okFiles = JSON.stringify(changedFiles) === JSON.stringify(expectedChanged) && Object.keys(variantFiles).length === files.length;
    report.builds.push({ id, capacity, dir: `builds/${id}`, files: variantFiles, changedFiles, changedLines: inj.changedLines, checks: inj.checks, diffFile: `builds/${id}.diff`, diffSha256: sha256(diff), nodeModules: "junction -> <analyzer-root>/node_modules", load: loadInfo, ok: okFiles && Boolean(loadInfo?.ok) });
  }
  report.status = report.builds.every((b) => b.ok) ? "OK" : "FAILED";
  report.preparedAt = new Date().toISOString();
  writeJson(path.join(runRoot, "capacity-injection.json"), report);
  if (report.status !== "OK") throw new Error("capacity injection verification failed (see capacity-injection.json)");
  return report;
}

function cmdChildLoad(a) {
  const dir = path.resolve(a["build-dir"]);
  const analyzerRoot = path.resolve(a["analyzer-root"]);
  const req = createRequire(path.join(dir, "out", "analyzer", "index.js"));
  const mod = createRequire(TOOL_FILE)(path.join(dir, "out", "analyzer"));
  const tsResolved = fs.realpathSync(req.resolve("typescript"));
  const tsExpected = fs.realpathSync(createRequire(path.join(analyzerRoot, "out", "analyzer", "index.js")).resolve("typescript"));
  const analyzeResolved = fs.realpathSync(req.resolve("./analyze.js"));
  const info = { ok: typeof mod.analyzeWorkspaceActive === "function" && typeof mod.clearAnalyzerCaches === "function" && tsResolved === tsExpected && samePathCI(analyzeResolved, path.join(dir, "out", "analyzer", "analyze.js")), exports: Object.keys(mod).sort(), typescriptSameAsAnalyzerRoot: tsResolved === tsExpected, typescriptVersion: req("typescript").version, analyzeJsLoadedFromBuild: samePathCI(analyzeResolved, path.join(dir, "out", "analyzer", "analyze.js")) };
  console.log(JSON.stringify(info));
}

// Load a build and verify its files against capacity-injection.json
export function loadBuild(runRoot, buildId, analyzerRoot) {
  const inj = readJson(path.join(runRoot, "capacity-injection.json"));
  const dir = buildDir(runRoot, buildId, analyzerRoot);
  const want = buildId === "original" ? inj.originalFiles : inj.builds.find((b) => b.id === buildId)?.files;
  if (!want) throw new Error(`unknown build ${buildId}`);
  const got = Object.fromEntries(listFiles(path.join(dir, "out", "analyzer")).map((f) => [f, sha256(fs.readFileSync(path.join(dir, "out", "analyzer", f)))]));
  if (X.stableStringify(got) !== X.stableStringify(want)) throw new Error(`build ${buildId} files differ from capacity-injection.json`);
  const mod = createRequire(TOOL_FILE)(path.join(dir, "out", "analyzer"));
  X.bindAnalyzer(mod);
  return { mod, analyzeJsSha256: want["analyze.js"] };
}

// ===========================================================================
// Workloads

export function workloadRoot(workDir, id) {
  return path.join(workDir, "synthetic", id);
}
// "types": [] variant (H3-4): the same generator output; only compilerOptions.types is added to tsconfig.json
export function generateWorkload(workDir, { id, n, types }) {
  const root = workloadRoot(workDir, id);
  X.generateSyntheticWorkspace(root, n);
  if (types === "none") {
    const f = path.join(root, "tsconfig.json");
    const cfg = JSON.parse(fs.readFileSync(f, "utf8"));
    cfg.compilerOptions.types = [];
    fs.writeFileSync(f, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  }
  return root;
}

export function requestLabel(p, wsRoot) {
  const n = String(p).split(path.sep).join("/");
  const w = wsRoot.split(path.sep).join("/");
  if (n.toLowerCase().startsWith(`${w.toLowerCase()}/`)) return `ws:${n.slice(w.length + 1)}`;
  const i = n.lastIndexOf("/node_modules/");
  if (i >= 0) return `nm:${n.slice(i + 14)}`;
  return `other:${path.basename(n)}`;
}
export function requestCategory(label) {
  if (label.startsWith("ws:")) return "workspace";
  if (label.startsWith("nm:typescript/lib/")) return "typescript-lib";
  if (label.startsWith("nm:@types/")) return "@types";
  if (label.startsWith("nm:")) return "other-node_modules";
  return "other";
}

function contentManifest(root, filePaths) {
  const files = [...filePaths, path.join(root, "tsconfig.json")].map((f) => `${sha256(fs.readFileSync(f))}  ${relPosix(root, f)}\n`);
  return sha256(files.join(""));
}

export function makeTarget(workDir, w) {
  const root = workloadRoot(workDir, w.id);
  const t = X.makeRepositoryTarget(w.id, w.id, root, path.join(root, "entry.ts"));
  return t;
}

// One OFF analysis with request recording (outside any measurement)
function probeRequests(mod, t, code = t.activeCode) {
  const events = [];
  mod.clearAnalyzerCaches();
  const result = mod.analyzeWorkspaceActive({ active: { code, fileName: t.activeFile, languageId: t.languageId }, workspaceRoot: t.root, filePaths: t.filePaths, cacheEnabled: false, debug: (e, d) => events.push({ e, f: d?.filePath }) });
  const paths = events.filter((x) => x.e === EV.disabled).map((x) => x.f);
  return { result, paths, labels: paths.map((p) => requestLabel(p, t.root)) };
}

function cwdTypes(analyzerRoot) {
  const dir = path.join(analyzerRoot, "node_modules", "@types");
  const pk = (d) => {
    try {
      return readJson(path.join(d, "package.json")).version;
    } catch {
      return null;
    }
  };
  return { typesPackages: fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((p) => ({ name: `@types/${p}`, version: pk(path.join(dir, p)) })) : [], undiciTypes: pk(path.join(analyzerRoot, "node_modules", "undici-types")), typescript: pk(path.join(analyzerRoot, "node_modules", "typescript")) };
}

function assertCwd(analyzerRoot) {
  if (!samePathCI(process.cwd(), analyzerRoot)) throw new Error(`cwd must be --analyzer-root (automatic @types roots follow the process cwd); cwd=${process.cwd()}`);
}

export function boundaryNs(C, L) {
  return [C - L - 1, C - L, C - L + 1];
}

function cmdWorkloads(a) {
  const analyzerRoot = path.resolve(a["analyzer-root"]);
  assertCwd(analyzerRoot);
  const runRoot = path.resolve(a["run-root"]);
  const workDir = path.resolve(a["work-dir"]);
  const out = path.join(runRoot, "workloads.json");
  if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${out}`);
  const { mod } = loadBuild(runRoot, "original", analyzerRoot);
  // 1) L probe with N = 100 (default tsconfig) and with "types": []
  const probeL = (types) => {
    const id = types === "none" ? "probe-n100-notypes" : "probe-n100";
    generateWorkload(workDir, { id, n: 100, types });
    const t = makeTarget(workDir, { id });
    const W = probeRequests(mod, t).paths.length;
    return { id, n: 100, types, W, L: W - 100 };
  };
  const pDefault = probeL("default");
  const pNone = probeL("none");
  const L = pDefault.L;
  const Lnone = pNone.L;
  // 2) workload list, fixed before any measurement
  const list = [];
  const add = (n, types, role) => {
    const id = `n${n}${types === "none" ? "-notypes" : ""}`;
    const ex = list.find((x) => x.id === id);
    if (ex) ex.roles.push(role);
    else list.push({ id, n, types, roles: [role] });
  };
  for (const n of MAIN_N) add(n, "default", "main");
  for (const C of CAPACITIES) boundaryNs(C, L).forEach((n, i) => add(n, "default", `boundary:C${C}:${["C-1", "C", "C+1"][i]}`));
  boundaryNs(800, Lnone).forEach((n, i) => add(n, "none", `h3-4:C800:${["C-1", "C", "C+1"][i]}`));
  boundaryNs(800, L).slice(1).forEach((n, i) => add(n, "none", `h3-4:sameN:${["C", "C+1"][i]}`));
  const workloads = [];
  fs.mkdirSync(path.join(runRoot, "workloads"), { recursive: true });
  for (const w of list) {
    generateWorkload(workDir, w);
    const t = makeTarget(workDir, w);
    const p = probeRequests(mod, t);
    const byCat = {};
    for (const l of p.labels) byCat[requestCategory(l)] = (byCat[requestCategory(l)] ?? 0) + 1;
    const norm = X.normalizeAnalysisResult(p.result);
    const reqFile = `workloads/requests-${w.id}.txt`;
    fs.writeFileSync(path.join(runRoot, reqFile), `${p.labels.join("\n")}\n`);
    const W = p.paths.length;
    workloads.push({ ...w, fileCount: t.filePaths.length, W, L: W - w.n, predictedW: w.n + (w.types === "none" ? Lnone : L), distinctRequests: new Set(p.paths.map((x) => x.toLowerCase())).size, requestsByCategory: byCat, requestOrderSha256: sha256(p.labels.join("\n")), requestsFile: reqFile, contentSha256: contentManifest(t.root, t.filePaths), tsconfigSha256: sha256(fs.readFileSync(path.join(t.root, "tsconfig.json"))), usedTsconfig: t.usedTsconfig, programRootFiles: p.result.meta?.rootFiles ?? null, activeFile: relPosix(t.root, t.activeFile), offResultHash: X.canonicalHash(p.result).hash, offCounts: norm.counts, hitPrediction: Object.fromEntries(CAPACITIES.map((C) => [`C${C}`, W <= C ? "hit" : "miss"])) });
  }
  const doc = { schema: "exp03-workloads/1", tool: TOOL_VERSION, fixedAt: new Date().toISOString(), cwd: "<analyzer-root>", cwdNodeModules: cwdTypes(analyzerRoot), generator: "exp02-cache-benchmark.mjs generateSyntheticWorkspace (copy of scripts/benchmark-analysis-cache.mjs fed34a0); notypes variant adds compilerOptions.types = []", probes: [pDefault, pNone], L, Lnotypes: Lnone, boundaryRule: "N = C - L - 1, C - L, C - L + 1 (W = N + L)", priorTable: { L: 159, W: { 100: 259, 500: 659, 1000: 1159, 2000: 2159 } }, workloads };
  writeJson(out, doc);
  return doc;
}

// ===========================================================================
// Measurement loop (one condition per process)

// Derive per-analysis counts from the debug events. The store event is emitted after pruning, so its
// `entries` is the size after eviction; a miss inserts a new key (size + 1), a stale entry replaces one.
export function deriveIteration(events, occupancyStart) {
  let occ = occupancyStart;
  const r = { sfHit: 0, sfMiss: 0, sfStale: 0, sfBypass: 0, sfDisabled: 0, sfStore: 0, evictDerived: 0, occupancyStart, occupancyEnd: occupancyStart, maxEntries: occupancyStart, derivationAnomalies: 0 };
  let last = null;
  for (const { event, detail } of events) {
    if (event === EV.hit) r.sfHit++;
    else if (event === EV.miss) {
      r.sfMiss++;
      last = "miss";
    } else if (event === EV.stale) {
      r.sfStale++;
      last = "stale";
    } else if (event === EV.bypass) r.sfBypass++;
    else if (event === EV.disabled) r.sfDisabled++;
    else if (event === EV.store) {
      r.sfStore++;
      const before = last === "miss" ? occ + 1 : occ;
      const ev = before - detail.entries;
      if (ev < 0 || last === null) r.derivationAnomalies++;
      else r.evictDerived += ev;
      occ = detail.entries;
      if (occ > r.maxEntries) r.maxEntries = occ;
      last = null;
    }
  }
  r.occupancyEnd = occ;
  r.statCalls = r.sfHit + r.sfMiss + r.sfStale;
  return r;
}

export const SAMPLE_COLUMNS = ["phase", "workload", "N", "W", "types", "build", "capacity", "mode", "scenario", "block", "process", "iteration", "isWarmup", "elapsedMs", "sfHit", "sfMiss", "sfStale", "sfBypass", "sfDisabled", "sfStore", "evictDerived", "occupancyStart", "occupancyEnd", "maxEntries", "derivationAnomalies", "statCalls", "resultHash", "variantReflected", "heapUsed", "rss", "freeMem", "gcMsInAnalysis", "gcCountInAnalysis", "gcMajorInAnalysis", "heapUsedAfterGc", "rssAfterGc", "timestamp"];
export const SEQUENCE_COLUMNS = ["iteration", "seq", "kind", "label", "entries"];

const variantReflected = (result, scenarioId, iteration) => (scenarioId !== "active-edit" ? "" : (result.graph?.nodes ?? []).some((n) => n.name === `__cogicBenchmarkVariant${iteration}`) ? "1" : "0");

// Same loop as EXP-02 runScenarioSamples for one mode (clearAnalyzerCaches once at mode start, a new
// result cache, warm-up then measured iterations, the same timed region around analyzePanelEquivalent).
// kind "trace" additionally keeps the request sequence (outside the timed region).
export function measureCondition({ mod, target, w, build, capacity, modeId, scenarioId, warmupRuns, measuredRuns, block, processLabel, phase, kind = "time" }) {
  const mode = X.cacheModes.find((m) => m.id === modeId);
  const rows = [];
  const sequence = [];
  const resultCache = new X.PanelEquivalentResultCache();
  mod.clearAnalyzerCaches();
  let occ = 0;
  for (let iteration = 0; iteration < warmupRuns + measuredRuns; iteration++) {
    const activeCode = X.getScenarioCode(target.activeCode, scenarioId, iteration);
    const debugEvents = [];
    const debug = (event, detail) => debugEvents.push({ event, detail });
    const started = performance.now();
    const { result } = X.analyzePanelEquivalent({ target, activeCode, mode, resultCache, debug });
    const elapsedMs = performance.now() - started;
    // ---- outside the timed region ----
    const d = deriveIteration(debugEvents, occ);
    occ = d.occupancyEnd;
    const mem = process.memoryUsage();
    rows.push({ phase, workload: w.id, N: w.n, W: w.W, types: w.types, build, capacity: modeId === "off" ? "" : capacity, mode: modeId, scenario: scenarioId, block, process: processLabel, iteration, isWarmup: iteration < warmupRuns ? 1 : 0, elapsedMs, ...d, resultHash: X.canonicalHash(result).hash, variantReflected: variantReflected(result, scenarioId, iteration), heapUsed: mem.heapUsed, rss: mem.rss, freeMem: os.freemem(), timestamp: new Date().toISOString() });
    if (kind === "trace") {
      let seq = 0;
      for (const { event, detail } of debugEvents) {
        const k = event.startsWith("analyzer.sourceFileCache.") ? event.slice(25) : null;
        if (!k) continue;
        sequence.push({ iteration, seq: seq++, kind: k, label: detail?.filePath ? requestLabel(detail.filePath, target.root) : "", entries: k === "store" ? detail.entries : "" });
      }
    }
  }
  const endEvents = [];
  mod.clearAnalyzerCaches((e, d) => endEvents.push({ e, d }));
  return { rows, sequence, occupancyDirect: endEvents.find((x) => x.e === EV.clear)?.d?.sourceFiles ?? null };
}

// One analysis for the memory kind. Returns primitives only, so nothing of the analysis (Program,
// SourceFiles of the OFF path, result) stays reachable from the caller's frame when GC is forced.
function analyzeOnceForMemory(target, mode, resultCache, scenarioId, iteration, occ) {
  const activeCode = X.getScenarioCode(target.activeCode, scenarioId, iteration);
  const debugEvents = [];
  const debug = (event, detail) => debugEvents.push({ event, detail });
  const started = performance.now();
  const { result } = X.analyzePanelEquivalent({ target, activeCode, mode, resultCache, debug });
  const elapsedMs = performance.now() - started;
  const d = deriveIteration(debugEvents, occ);
  const mem = process.memoryUsage();
  return { started, elapsedMs, d, heapUsed: mem.heapUsed, rss: mem.rss, resultHash: X.canonicalHash(result).hash, variant: variantReflected(result, scenarioId, iteration) };
}
// Before every forced GC the memory kind waits for a 50 ms timer. Pilot 2 (exploratory check): with only
// setImmediate before gc(), the heap after GC of an OFF analysis was sometimes ~95 MB higher (the size of
// its SourceFile set); after a 50 ms timer the same gc() released it. The mechanism was not identified.
const tick = () => new Promise((r) => setTimeout(r, 50));

// Memory kind (node --expose-gc): after each analysis, yield to the event loop, force a full GC and read
// memoryUsage(); natural GC during the analysis is collected with a PerformanceObserver. Separate from
// the time runs because forced GC changes the timing.
export async function measureMemoryCondition({ mod, target, w, build, capacity, modeId, scenarioId, warmupRuns, measuredRuns, block, processLabel, phase }) {
  if (typeof global.gc !== "function") throw new Error("memory kind requires --expose-gc");
  const mode = X.cacheModes.find((m) => m.id === modeId);
  const gcEntries = [];
  const obs = new PerformanceObserver((list) => gcEntries.push(...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration, kind: e.detail?.kind ?? e.kind }))));
  obs.observe({ entryTypes: ["gc"] });
  const resultCache = new X.PanelEquivalentResultCache();
  mod.clearAnalyzerCaches();
  let occ = 0;
  const rows = [];
  const windows = [];
  for (let iteration = 0; iteration < warmupRuns + measuredRuns; iteration++) {
    const one = analyzeOnceForMemory(target, mode, resultCache, scenarioId, iteration, occ);
    occ = one.d.occupancyEnd;
    windows.push({ iteration, start: one.started, end: one.started + one.elapsedMs });
    await tick();
    global.gc();
    global.gc();
    const after = process.memoryUsage();
    rows.push({ phase, workload: w.id, N: w.n, W: w.W, types: w.types, build, capacity: modeId === "off" ? "" : capacity, mode: modeId, scenario: scenarioId, block, process: processLabel, iteration, isWarmup: iteration < warmupRuns ? 1 : 0, elapsedMs: one.elapsedMs, ...one.d, resultHash: one.resultHash, variantReflected: one.variant, heapUsed: one.heapUsed, rss: one.rss, freeMem: os.freemem(), heapUsedAfterGc: after.heapUsed, rssAfterGc: after.rss, timestamp: new Date().toISOString() });
  }
  await tick();
  global.gc();
  global.gc();
  const full = process.memoryUsage().heapUsed;
  const endEvents = [];
  mod.clearAnalyzerCaches((e, d) => endEvents.push({ e, d }));
  resultCache.clear();
  await tick();
  global.gc();
  global.gc();
  const cleared = process.memoryUsage();
  await new Promise((r) => setTimeout(r, 200)); // let the observer deliver the buffered gc entries
  obs.disconnect();
  attachGc(rows, windows, gcEntries);
  return { rows, gcEntries, occupancyDirect: endEvents.find((x) => x.e === EV.clear)?.d?.sourceFiles ?? null, tail: { heapUsedAfterGcWithCache: full, heapUsedAfterClearGc: cleared.heapUsed, rssAfterClearGc: cleared.rss, cacheRetainedEstimate: full - cleared.heapUsed } };
}

// assign natural GC entries to analyses (entries that started inside the timed window)
export function attachGc(rows, windows, gcEntries) {
  for (const r of rows) {
    const win = windows.find((x) => x.iteration === r.iteration);
    if (!win) continue;
    const inside = gcEntries.filter((g) => g.start >= win.start && g.start < win.end);
    r.gcMsInAnalysis = inside.reduce((s, g) => s + g.duration, 0);
    r.gcCountInAnalysis = inside.length;
    r.gcMajorInAnalysis = inside.filter((g) => g.kind === 4 || g.kind === "major").length;
  }
}

// ===========================================================================
// Reuse distance (LRU stack distance) — Fenwick tree over last-occurrence positions

export function reuseDistances(keys) {
  const n = keys.length;
  const tree = new Int32Array(n + 1);
  const add = (i, v) => {
    for (i += 1; i <= n; i += i & -i) tree[i] += v;
  };
  const sum = (i) => {
    let s = 0;
    for (i += 1; i > 0; i -= i & -i) s += tree[i];
    return s;
  };
  const last = new Map();
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = last.get(keys[i]);
    if (p === undefined) out[i] = null;
    else {
      out[i] = sum(i - 1) - sum(p); // distinct keys accessed strictly between p and i
      add(p, -1);
    }
    add(i, 1);
    last.set(keys[i], i);
  }
  return out;
}
// pure LRU with capacity C hits exactly the accesses whose reuse distance is < C
export function lruHits(distances, C) {
  return distances.reduce((s, d) => s + (d !== null && d < C ? 1 : 0), 0);
}
// direct simulation (used in tests to confirm the stack-distance rule)
export function simulateLru(keys, C) {
  const m = new Map();
  let hits = 0;
  for (const k of keys) {
    if (m.has(k)) {
      hits++;
      m.delete(k);
    } else if (m.size >= C) m.delete(m.keys().next().value);
    m.set(k, true);
  }
  return hits;
}

export function traceSummary(sequence, capacity, measuredFrom) {
  const req = sequence.filter((s) => s.kind === "hit" || s.kind === "miss" || s.kind === "stale");
  const keys = req.map((s) => s.label.toLowerCase());
  const dist = reuseDistances(keys);
  const iters = [...new Set(req.map((s) => s.iteration))].sort((x, y) => x - y);
  const rows = [];
  let prevOrder = null;
  for (const it of iters) {
    const idx = req.map((s, i) => (s.iteration === it ? i : -1)).filter((i) => i >= 0);
    const ds = idx.map((i) => dist[i]).filter((d) => d !== null);
    const sorted = [...ds].sort((x, y) => x - y);
    const order = sha256(idx.map((i) => keys[i]).join("\n"));
    rows.push({
      iteration: it,
      measured: it >= measuredFrom ? 1 : 0,
      requests: idx.length,
      firstAccess: idx.length - ds.length,
      reuseMin: sorted.length ? sorted[0] : "",
      reuseMedian: sorted.length ? X.quantile7(sorted, 0.5) : "",
      reuseMax: sorted.length ? sorted[sorted.length - 1] : "",
      reuseBelowC: ds.filter((d) => d < capacity).length,
      reuseAtLeastC: ds.filter((d) => d >= capacity).length,
      observedHits: idx.filter((i) => req[i].kind === "hit").length,
      lruPredictedHits: idx.filter((i) => dist[i] !== null && dist[i] < capacity).length,
      lruHitsC400: idx.filter((i) => dist[i] !== null && dist[i] < 400).length,
      lruHitsC800: idx.filter((i) => dist[i] !== null && dist[i] < 800).length,
      lruHitsC1600: idx.filter((i) => dist[i] !== null && dist[i] < 1600).length,
      orderSha256: order,
      orderSameAsPrevious: prevOrder === null ? "" : order === prevOrder ? 1 : 0,
    });
    prevOrder = order;
  }
  return rows;
}

// ===========================================================================
// Child process: one condition

async function cmdChild(a) {
  const analyzerRoot = path.resolve(a["analyzer-root"]);
  assertCwd(analyzerRoot);
  const runRoot = path.resolve(a["run-root"]);
  const workDir = path.resolve(a["work-dir"]);
  const out = path.resolve(a.out);
  if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${out}`);
  const wl = readJson(path.join(runRoot, "workloads.json"));
  const w = wl.workloads.find((x) => x.id === a.workload);
  const build = a.build;
  const capacity = buildCapacity(build);
  const { mod } = loadBuild(runRoot, build, analyzerRoot);
  const t = makeTarget(workDir, w);
  if (contentManifest(t.root, t.filePaths) !== w.contentSha256) throw new Error(`workload ${w.id} content changed since workloads.json`);
  const kind = a.kind;
  const args = { mod, target: t, w, build, capacity, modeId: a.mode, scenarioId: a.scenario, warmupRuns: Number(a.warmup), measuredRuns: Number(a.runs), block: Number(a.block), processLabel: a.process, phase: a.phase };
  const r = kind === "memory" ? await measureMemoryCondition(args) : measureCondition({ ...args, kind });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, X.toCsv(r.rows, SAMPLE_COLUMNS));
  if (kind === "trace") {
    fs.writeFileSync(out.replace(/\.csv$/, ".sequence.csv.gz"), zlib.gzipSync(X.toCsv(r.sequence, SEQUENCE_COLUMNS)));
    const ts = traceSummary(r.sequence, capacity, Number(a.warmup));
    fs.writeFileSync(out.replace(/\.csv$/, ".reuse.csv"), X.toCsv(ts, Object.keys(ts[0] ?? { iteration: 0 })));
  }
  writeJson(out.replace(/\.csv$/, ".meta.json"), { workload: w.id, build, capacity, mode: a.mode, scenario: a.scenario, kind, occupancyDirectAtEnd: r.occupancyDirect, memoryTail: r.tail ?? null, gcEntries: kind === "memory" ? r.gcEntries.length : null, pid: process.pid, execArgv: process.execArgv });
}

// ===========================================================================
// Correctness child: one build, all workloads

export const CORRECTNESS_COLUMNS = ["build", "capacity", "workload", "N", "W", "types", "run", "sfHit", "sfMiss", "sfStale", "sfBypass", "sfStore", "evictDerived", "occupancyEnd", "maxEntries", "requestsOff", "hashEqualsOff", "variantReflected", "invariant", "occupancyWithinC", "capacityApplied", "hitRatio", "hitExpected", "pass", "occupancyDirect", "hash", "offHash"];

function cmdCorrectnessChild(a) {
  const analyzerRoot = path.resolve(a["analyzer-root"]);
  assertCwd(analyzerRoot);
  const runRoot = path.resolve(a["run-root"]);
  const workDir = path.resolve(a["work-dir"]);
  const out = path.resolve(a.out);
  if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${out}`);
  const build = a.build;
  const capacity = buildCapacity(build);
  const { mod } = loadBuild(runRoot, build, analyzerRoot);
  const wl = readJson(path.join(runRoot, "workloads.json"));
  const only = a.only ? String(a.only).split(",") : null;
  const rows = [];
  const off = X.cacheModes[0];
  const sf = X.cacheModes[1];
  for (const w of wl.workloads.filter((x) => !only || only.includes(x.id))) {
    const t = makeTarget(workDir, w);
    if (contentManifest(t.root, t.filePaths) !== w.contentSha256) throw new Error(`workload ${w.id} content changed`);
    const codes = [0, 1, 2].map((k) => X.getScenarioCode(t.activeCode, "active-edit", k));
    const offHash = [];
    let requestsOff = null;
    for (const [k, code] of codes.entries()) {
      mod.clearAnalyzerCaches();
      const ev = [];
      const r = X.analyzePanelEquivalent({ target: t, activeCode: code, mode: off, resultCache: new X.PanelEquivalentResultCache(), debug: (e, d) => ev.push({ event: e, detail: d }) });
      offHash.push({ hash: X.canonicalHash(r.result).hash, variant: variantReflected(r.result, "active-edit", k) });
      if (k === 0) requestsOff = ev.filter((x) => x.event === EV.disabled).length;
    }
    mod.clearAnalyzerCaches();
    const cache = new X.PanelEquivalentResultCache();
    let occ = 0;
    const runs = [];
    for (const [k, code] of codes.entries()) {
      const ev = [];
      const r = X.analyzePanelEquivalent({ target: t, activeCode: code, mode: sf, resultCache: cache, debug: (e, d) => ev.push({ event: e, detail: d }) });
      const d = deriveIteration(ev, occ);
      occ = d.occupancyEnd;
      runs.push({ k, d, hash: X.canonicalHash(r.result).hash, variant: variantReflected(r.result, "active-edit", k) });
    }
    const endEv = [];
    mod.clearAnalyzerCaches((e, d) => endEv.push({ e, d }));
    const occupancyDirect = endEv.find((x) => x.e === EV.clear)?.d?.sourceFiles ?? null;
    for (const { k, d, hash, variant } of runs) {
      const invariant = d.sfHit + d.sfMiss + d.sfStale + d.sfBypass === requestsOff ? 1 : 0;
      const occupancyWithinC = d.maxEntries <= capacity && (occupancyDirect === null || occupancyDirect <= capacity) ? 1 : 0;
      // W > C: the cache saturates at exactly C; W <= C: nothing is evicted and all W files stay cached
      const capacityApplied = (requestsOff > capacity ? d.maxEntries === capacity && occupancyDirect === capacity : d.evictDerived === 0 && d.occupancyEnd === requestsOff && occupancyDirect === requestsOff) ? 1 : 0;
      const hitExpected = k === 0 ? "first" : requestsOff <= capacity ? "all" : "none";
      const hitRatio = d.sfHit / Math.max(1, d.sfHit + d.sfMiss + d.sfStale);
      const hashEqualsOff = hash === offHash[k].hash ? 1 : 0;
      rows.push({ build, capacity, workload: w.id, N: w.n, W: w.W, types: w.types, run: k, ...d, requestsOff, hashEqualsOff, variantReflected: variant, invariant, occupancyWithinC, capacityApplied, hitRatio, hitExpected, pass: invariant && occupancyWithinC && capacityApplied && hashEqualsOff && variant === "1" && offHash[k].variant === "1" && requestsOff === w.W ? 1 : 0, occupancyDirect, hash, offHash: offHash[k].hash });
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, X.toCsv(rows, CORRECTNESS_COLUMNS));
}

// ===========================================================================
// Microbenchmarks (harness re-implementations, NOT the analyzer's internal execution)

// text-identical to pruneDiskSourceFileCache in src/analyzer/analyze.ts (bbe4cbf), with the capacity as argument
function pruneReimpl(cache, max) {
  if (cache.size <= max) {
    return;
  }

  const sorted = [...cache.entries()].sort(
    (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt,
  );
  const removeCount = cache.size - max;
  for (const [cacheKey] of sorted.slice(0, removeCount)) {
    cache.delete(cacheKey);
  }
}
export function pruneMicrobench(C, { reps = 1000, repeats = 5, tiesPerMs = 3 } = {}) {
  const out = [];
  for (let r = 0; r < repeats; r++) {
    const cache = new Map();
    let clock = 1e12;
    let k = 0;
    for (; k < C; k++) cache.set(`key-${k}`, { lastAccessedAt: clock + Math.floor(k / tiesPerMs) });
    const t0 = performance.now();
    for (let i = 0; i < reps; i++, k++) {
      cache.set(`key-${k}`, { lastAccessedAt: clock + Math.floor(k / tiesPerMs) });
      pruneReimpl(cache, C);
    }
    const t1 = performance.now();
    if (cache.size !== C) throw new Error("prune reimplementation size");
    out.push(((t1 - t0) * 1000) / reps);
  }
  return out;
}
export function statMicrobench(paths, { passes = 20 } = {}) {
  const out = [];
  for (let p = 0; p < passes; p++) {
    const t0 = performance.now();
    for (const f of paths) fs.statSync(f);
    out.push(((performance.now() - t0) * 1000) / paths.length);
  }
  return out;
}
export function keyMicrobench(paths, { passes = 20 } = {}) {
  const out = [];
  let sink = 0;
  for (let p = 0; p < passes; p++) {
    const t0 = performance.now();
    for (const f of paths) sink += (isWin ? path.resolve(f).toLowerCase() : path.resolve(f)).length;
    out.push(((performance.now() - t0) * 1000) / paths.length);
  }
  if (sink < 0) throw new Error("unreachable");
  return out;
}

function runMicrobench(phaseDir, wl, analyzerRoot, runRoot, workDir) {
  const { mod } = loadBuild(runRoot, "original", analyzerRoot);
  const rows = [];
  for (const C of CAPACITIES) {
    pruneMicrobench(C, { reps: 200, repeats: 1 }); // warm-up
    for (const [i, us] of pruneMicrobench(C).entries()) rows.push({ bench: "prune-sort", capacity: C, workload: "", N: "", W: "", repeat: i, usPerOp: us, ops: 1000, note: "harness re-implementation of pruneDiskSourceFileCache; Map of C entries, insert + prune per op" });
  }
  for (const n of MAIN_N) {
    const w = wl.workloads.find((x) => x.id === `n${n}`);
    const t = makeTarget(workDir, w);
    const paths = probeRequests(mod, t).paths;
    statMicrobench(paths, { passes: 3 });
    for (const [i, us] of statMicrobench(paths).entries()) rows.push({ bench: "statSync", capacity: "", workload: w.id, N: n, W: paths.length, repeat: i, usPerOp: us, ops: paths.length, note: "fs.statSync over the W requested files (warm OS cache)" });
    keyMicrobench(paths, { passes: 3 });
    for (const [i, us] of keyMicrobench(paths).entries()) rows.push({ bench: "cache-key", capacity: "", workload: w.id, N: n, W: paths.length, repeat: i, usPerOp: us, ops: paths.length, note: "path.resolve + toLowerCase (normalizeCachePath)" });
  }
  fs.writeFileSync(path.join(phaseDir, "overhead-microbench.csv"), X.toCsv(rows, ["bench", "capacity", "workload", "N", "W", "repeat", "usPerOp", "ops", "note"]));
  return { conditions: rows.length };
}

// ===========================================================================
// Phases (parent)

export function phaseConditions(name, wl) {
  const byId = (id) => wl.workloads.find((x) => x.id === id);
  const main = MAIN_N.map((n) => byId(`n${n}`));
  const sfMain = main.flatMap((w) => CAPACITIES.map((C) => ({ workload: w.id, build: `c${C}`, mode: "sourcefile" })));
  const offMain = main.map((w) => ({ workload: w.id, build: "original", mode: "off" }));
  const boundary = wl.workloads.flatMap((w) => w.roles.filter((r) => r.startsWith("boundary:") || r.startsWith("h3-4:")).map((r) => ({ workload: w.id, build: `c${r.startsWith("h3-4:") ? 800 : r.split(":")[1].slice(1)}`, mode: "sourcefile", role: r })));
  if (name === "time") return [...offMain, ...sfMain].map((c) => ({ ...c, scenario: "active-edit" }));
  if (name === "repeated") return [...offMain, ...sfMain].map((c) => ({ ...c, scenario: "repeated" }));
  if (name === "boundary") return boundary.map((c) => ({ ...c, scenario: "active-edit" }));
  if (name === "trace") return [...sfMain, ...boundary].map((c) => ({ ...c, scenario: "active-edit" }));
  if (name === "memory") return [...offMain, ...sfMain].map((c) => ({ ...c, scenario: "active-edit" }));
  throw new Error(`no conditions for ${name}`);
}
export const PHASE_DEFAULTS = {
  time: { kind: "time", warmup: 5, runs: 30, blocks: 3 },
  repeated: { kind: "time", warmup: 5, runs: 30, blocks: 1 },
  boundary: { kind: "time", warmup: 3, runs: 15, blocks: 3 },
  trace: { kind: "trace", warmup: 2, runs: 3, blocks: 1 },
  memory: { kind: "memory", warmup: 3, runs: 10, blocks: 1 },
};
const PHASE_SEED_OFFSET = { time: 0, repeated: 100, boundary: 200, trace: 300, memory: 400 };

export function previousDataIntegrity(repoRoot, exp02Zip) {
  const paths = ["docs/benchmarks", "docs/thesis-experiments/data/exp-02", "docs/thesis-experiments/data/p0", "docs/thesis-experiments/fixtures", "docs/thesis-experiments/evidence", "scripts/benchmark-analysis-cache.mjs"];
  const status = git(["status", "--porcelain", "--untracked-files=all", "--", ...paths], repoRoot);
  const diffHead = spawnSync("git", ["-C", repoRoot, "diff", "--quiet", "HEAD", "--", ...paths]).status === 0;
  const lsFiles = git(["ls-files", "-s", "--", ...paths], repoRoot);
  // working-tree content of every tracked file must equal its HEAD blob
  const manifest = sha256(lsFiles);
  const zip = exp02Zip ? { file: "exp02-runs-20261030.zip", expected: EXP02_ZIP_SHA256, actual: fs.existsSync(exp02Zip) ? sha256(fs.readFileSync(exp02Zip)) : null } : null;
  if (zip) zip.ok = zip.actual === zip.expected;
  const historical = X.integrityCheck(repoRoot);
  return { ok: !status && diffHead && historical.ok && (!zip || zip.ok), trackedFiles: lsFiles.split("\n").filter(Boolean).length, trackedManifestSha256: manifest, workingTreeEqualsHead: diffHead && !status, historicalBenchmark: historical, exp02RawZip: zip };
}

function analyzerCheck(analyzerRoot, runRoot) {
  const identity = X.analyzerIdentity("B", analyzerRoot);
  const inj = readJson(path.join(runRoot, "capacity-injection.json"));
  const builds = ["original", ...CAPACITIES.map((C) => `c${C}`)].map((id) => {
    const dir = path.join(buildDir(runRoot, id, analyzerRoot), "out", "analyzer");
    const got = Object.fromEntries(listFiles(dir).map((f) => [f, sha256(fs.readFileSync(path.join(dir, f)))]));
    const want = id === "original" ? inj.originalFiles : inj.builds.find((b) => b.id === id).files;
    return { id, ok: X.stableStringify(got) === X.stableStringify(want) };
  });
  return { ok: identity.ok && identity.buildHash === inj.analyzer.buildHash && builds.every((b) => b.ok), identity: { head: identity.head, buildHash: identity.buildHash, srcAnalyzerTree: identity.srcAnalyzerTree, typescript: identity.typescript, problems: identity.problems }, builds };
}

function cmdPhase(a) {
  const name = a.name;
  const analyzerRoot = path.resolve(a["analyzer-root"]);
  assertCwd(analyzerRoot);
  const runRoot = path.resolve(a["run-root"]);
  const workDir = path.resolve(a["work-dir"]);
  const label = a.label ? `-${a.label}` : "";
  const phaseDir = path.join(runRoot, "phases", `${name}${label}`);
  X.assertOutputAllowed(phaseDir);
  const repoDirty = git(["status", "--porcelain"], REPO_ROOT);
  if (repoDirty && !a["allow-dirty-tool"]) throw new Error("tool repository has uncommitted changes; commit the tool before measuring");
  const integrityBefore = previousDataIntegrity(REPO_ROOT, a["exp02-zip"] ? path.resolve(a["exp02-zip"]) : null);
  if (!integrityBefore.ok) throw new Error("previous data / historical artifacts changed");
  const analyzerBefore = analyzerCheck(analyzerRoot, runRoot);
  if (!analyzerBefore.ok) throw new Error(`analyzer/build check failed: ${JSON.stringify(analyzerBefore)}`);
  const wl = readJson(path.join(runRoot, "workloads.json"));
  fs.mkdirSync(phaseDir, { recursive: true });
  const seed = Number(a.seed ?? DEFAULT_SEED);
  const minFree = Number(a["min-free-mb"] ?? 400) * 1048576;
  const phase = { schema: "exp03-phase/1", tool: TOOL_VERSION, toolCommit: git(["rev-parse", "HEAD"], REPO_ROOT), toolSha256: X.sha256Lf(TOOL_FILE), exp02ToolSha256: X.sha256Lf(path.join(path.dirname(TOOL_FILE), "exp02-cache-benchmark.mjs")), name, label: a.label ?? null, pilot: Boolean(a.label), seed, startedAt: new Date().toISOString(), envStart: X.environment(), nodeExeSha256: sha256(fs.readFileSync(process.execPath)), cwd: "<analyzer-root>", analyzerBefore, integrityBefore, command: `node ${relPosix(REPO_ROOT, TOOL_FILE)} ${process.argv.slice(2).map((x) => (path.isAbsolute(x) ? "<path>" : x)).join(" ")}`, status: "RUNNING", failures: [], processes: [] };
  writeJson(path.join(phaseDir, "phase.json"), phase);
  const only = a.only ? String(a.only).split(",") : null;
  try {
    if (name === "microbench") {
      Object.assign(phase, runMicrobench(phaseDir, wl, analyzerRoot, runRoot, workDir));
    } else if (name === "correctness") {
      for (const build of ["original", ...CAPACITIES.map((C) => `c${C}`)]) {
        const out = path.join(phaseDir, "builds", `${build}.csv`);
        const t0 = Date.now();
        const child = spawnSync(process.execPath, [TOOL_FILE, "correctness-child", "--build", build, "--analyzer-root", analyzerRoot, "--run-root", runRoot, "--work-dir", workDir, "--out", out, ...(only ? ["--only", only.join(",")] : [])], { cwd: analyzerRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        phase.processes.push({ build, status: child.status, wallMs: Date.now() - t0, freeMemAfter: os.freemem() });
        if (child.status !== 0) phase.failures.push({ build, status: child.status, stderr: String(child.stderr).slice(-2000) });
      }
      const all = fs.readdirSync(path.join(phaseDir, "builds")).filter((f) => f.endsWith(".csv")).sort().flatMap((f) => X.parseCsv(fs.readFileSync(path.join(phaseDir, "builds", f), "utf8")));
      fs.writeFileSync(path.join(phaseDir, "correctness.csv"), X.toCsv(all, CORRECTNESS_COLUMNS));
    } else {
      const def = PHASE_DEFAULTS[name];
      const warmup = Number(a.warmup ?? def.warmup);
      const runs = Number(a.runs ?? def.runs);
      const blocks = Number(a.blocks ?? def.blocks);
      Object.assign(phase, { kind: def.kind, warmupRuns: warmup, measuredRuns: runs, blocks });
      const conds = phaseConditions(name, wl).filter((c) => !only || only.includes(c.workload));
      phase.conditions = conds.length;
      phase.order = [];
      let aborted = false;
      for (let b = 1; b <= blocks && !aborted; b++) {
        const seq = X.shuffled(conds, seed + PHASE_SEED_OFFSET[name] + b);
        phase.order.push({ block: b, conditions: seq.map((c) => `${c.workload}:${c.build}:${c.mode}:${c.scenario}`) });
        for (const [k, c] of seq.entries()) {
          const free = os.freemem();
          if (free < minFree) {
            phase.failures.push({ block: b, condition: c, reason: `ABORTED_LOW_MEMORY free ${free} < ${minFree}` });
            aborted = true;
            break;
          }
          const proc = `b${b}-${String(k + 1).padStart(2, "0")}`;
          const out = path.join(phaseDir, "blocks", `b${b}`, `${c.workload}.${c.build}.${c.mode}.${c.scenario}.csv`);
          const t0 = Date.now();
          const args = [...(def.kind === "memory" ? ["--expose-gc"] : []), TOOL_FILE, "child", "--kind", def.kind, "--phase", name, "--workload", c.workload, "--build", c.build, "--mode", c.mode, "--scenario", c.scenario, "--warmup", String(warmup), "--runs", String(runs), "--block", String(b), "--process", proc, "--analyzer-root", analyzerRoot, "--run-root", runRoot, "--work-dir", workDir, "--out", out];
          const child = spawnSync(process.execPath, args, { cwd: analyzerRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
          phase.processes.push({ block: b, process: proc, condition: `${c.workload}:${c.build}:${c.mode}:${c.scenario}`, status: child.status, wallMs: Date.now() - t0, freeMemBefore: free, freeMemAfter: os.freemem() });
          if (child.status !== 0) phase.failures.push({ block: b, condition: c, status: child.status, stderr: String(child.stderr).slice(-2000) });
          writeJson(path.join(phaseDir, "phase.json"), phase);
        }
        phase.order[phase.order.length - 1].freeMemAfterBlock = os.freemem();
      }
      if (aborted) phase.aborted = true;
      const files = walk(path.join(phaseDir, "blocks")).filter((f) => f.endsWith(".csv") && !f.endsWith(".reuse.csv"));
      const samples = files.flatMap((f) => X.parseCsv(fs.readFileSync(f, "utf8")));
      fs.writeFileSync(path.join(phaseDir, "samples.csv"), X.toCsv(samples, SAMPLE_COLUMNS));
      const metas = walk(path.join(phaseDir, "blocks")).filter((f) => f.endsWith(".meta.json")).map((f) => ({ file: relPosix(phaseDir, f), ...readJson(f) }));
      writeJson(path.join(phaseDir, "process-meta.json"), metas);
      if (name === "trace") {
        const reuse = walk(path.join(phaseDir, "blocks")).filter((f) => f.endsWith(".reuse.csv")).flatMap((f) => {
          const [workload, build] = path.basename(f).split(".");
          return X.parseCsv(fs.readFileSync(f, "utf8")).map((r) => ({ workload, build, capacity: buildCapacity(build), ...r }));
        });
        fs.writeFileSync(path.join(phaseDir, "reuse-distance.csv"), X.toCsv(reuse, Object.keys(reuse[0] ?? { workload: "" })));
      }
    }
  } catch (e) {
    phase.failures.push({ error: e?.message ?? String(e), stack: e?.stack });
  }
  phase.envEnd = X.environment();
  phase.analyzerAfter = analyzerCheck(analyzerRoot, runRoot);
  phase.integrityAfter = previousDataIntegrity(REPO_ROOT, a["exp02-zip"] ? path.resolve(a["exp02-zip"]) : null);
  phase.finishedAt = new Date().toISOString();
  phase.status = phase.aborted ? "ABORTED" : phase.failures.length ? "PARTIAL" : phase.analyzerAfter.ok && phase.integrityAfter.ok ? "COMPLETE" : "INTEGRITY_FAILED";
  writeJson(path.join(phaseDir, "phase.json"), phase);
  return phase;
}

function walk(d) {
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])).sort();
}

// ===========================================================================

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith("--")) {
      const k = x.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[k] = v;
    } else out._.push(x);
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === "prepare") console.log(JSON.stringify(cmdPrepare(a).builds.map((b) => ({ id: b.id, ok: b.ok, changedFiles: b.changedFiles, changedLines: b.changedLines.length })), null, 1));
  else if (cmd === "child-load") cmdChildLoad(a);
  else if (cmd === "workloads") {
    const d = cmdWorkloads(a);
    console.log(JSON.stringify({ L: d.L, Lnotypes: d.Lnotypes, workloads: d.workloads.map((w) => `${w.id} N=${w.n} W=${w.W} pred=${w.predictedW} roles=${w.roles.join("|")}`) }, null, 1));
  } else if (cmd === "child") await cmdChild(a);
  else if (cmd === "correctness-child") cmdCorrectnessChild(a);
  else if (cmd === "phase") {
    const p = cmdPhase(a);
    console.log(`${p.name}${p.label ? `-${p.label}` : ""}: ${p.status} (processes ${p.processes.length}, failures ${p.failures.length})`);
    process.exitCode = p.status === "COMPLETE" ? 0 : 3;
  } else if (cmd === "integrity") {
    const r = previousDataIntegrity(REPO_ROOT, a["exp02-zip"] ? path.resolve(a["exp02-zip"]) : null);
    console.log(JSON.stringify({ ok: r.ok, trackedFiles: r.trackedFiles, workingTreeEqualsHead: r.workingTreeEqualsHead, historical: r.historicalBenchmark.ok, zip: r.exp02RawZip }, null, 1));
    process.exitCode = r.ok ? 0 : 1;
  } else throw new Error("command: prepare | workloads | phase | integrity");
}

if (process.argv[1] && path.resolve(process.argv[1]) === TOOL_FILE) await main();
