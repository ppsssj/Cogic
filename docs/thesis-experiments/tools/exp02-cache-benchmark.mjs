#!/usr/bin/env node
// EXP-02 cache performance benchmark (exp02-cache-benchmark/1).
//
// Section A of this file is a COPY of the measurement logic of scripts/benchmark-analysis-cache.mjs at
// fed34a0 (LF-normalized SHA-256 4495a5964ef8a824d72b07c9095ba0a4aadb1228f1ca050a925286475ab87c5e).
// The timed region (performance.now() around analyzePanelEquivalent), scenario code, cache-reset rules,
// result cache, workspace listing, synthetic generation and nearest-rank statistics are unchanged.
// Every addition (per-iteration samples, event counts, result hashes, memory, identity, integrity, output
// guards, extra statistics) happens OUTSIDE the timed region. Differences: exp02-diff-from-original.md.
//
// The original script is never executed (it rewrites docs/benchmarks/analysis-cache/).
//
// Usage:
//   node exp02-cache-benchmark.mjs run --group A|B --analyzer-root <worktree> --cogic-workload <worktree>
//        --work-dir <dir> --out-root <dir> --run-id <id> [--protocol orig|robust] [--targets a,b]
//        [--scenarios a,b] [--modes a,b] [--warmup 5] [--runs 30] [--blocks 3] [--seed 20261102]
//        [--node-label v22.16.0] [--pilot]
//   node exp02-cache-benchmark.mjs publish --run <runDir> --to <repo data dir>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

export const TOOL_VERSION = "exp02-cache-benchmark/1.2";
const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");
const isWin = process.platform === "win32";

// ===========================================================================
// Section A — copied from scripts/benchmark-analysis-cache.mjs (fed34a0). Do not edit.
// The analyzer functions are bound after the identity check (the original bound them at import time
// from ../out/analyzer; the call sites below are identical).
let analyzeWorkspaceActive = null;
let clearAnalyzerCaches = null;
export function bindAnalyzer(mod) {
  analyzeWorkspaceActive = mod.analyzeWorkspaceActive;
  clearAnalyzerCaches = mod.clearAnalyzerCaches;
}

const DEFAULT_WARMUP = 5;
const DEFAULT_RUNS = 30;
const SYNTHETIC_SIZES = [100, 500, 1000, 2000];
const MAX_WORKSPACE_FILES = 4000;
const RESULT_CACHE_LIMIT = 40;

export const cacheModes = [
  { id: "off", label: "OFF", sourceFileCache: false, resultCache: false },
  { id: "sourcefile", label: "SourceFile only", sourceFileCache: true, resultCache: false },
  { id: "full", label: "Full result", sourceFileCache: true, resultCache: true },
];

export const scenarios = [
  { id: "cold", label: "Cold Analysis" },
  { id: "repeated", label: "Repeated Identical Analysis" },
  { id: "active-edit", label: "Active-file Edit Analysis" },
];

function selectCogicActiveFile(rootDir) {
  const candidates = [path.join(rootDir, "src", "panel", "CodeGraphPanel.ts"), path.join(rootDir, "src", "analyzer", "analyze.ts")];
  const found = candidates.find((filePath) => fs.existsSync(filePath));
  if (!found) throw new Error("Could not find a Cogic active file candidate.");
  return found;
}

export function makeRepositoryTarget(id, label, root, activeFile, extra = {}) {
  const filePaths = listWorkspaceFiles(root);
  if (!filePaths.some((filePath) => samePath(filePath, activeFile))) {
    filePaths.unshift(activeFile);
  }
  const code = fs.readFileSync(activeFile, "utf8");
  const probe = analyzeWorkspaceActive({
    active: { code, fileName: activeFile, languageId: guessLanguageId(activeFile) },
    workspaceRoot: root,
    filePaths,
    cacheEnabled: false,
  });
  return { id, label, root, activeFile, activeCode: code, languageId: guessLanguageId(activeFile), filePaths, commit: getGitSha(root), usedTsconfig: Boolean(probe.meta?.usedTsconfig), ...extra };
}

export function listWorkspaceFiles(root) {
  const files = [];
  const ignoredDirs = new Set([".git", "node_modules", "dist", "build", "out", ".next", ".vscode-test", ".vscode-test-web", "coverage", ".turbo", ".cache", ".benchmark-workspaces", ".benchmark-external", "benchmark-results"]);
  const allowed = new Set([".ts", ".tsx", ".js", ".jsx"]);
  const visit = (dir) => {
    if (files.length >= MAX_WORKSPACE_FILES) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_WORKSPACE_FILES) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) visit(fullPath);
      } else if (entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  };
  visit(root);
  return files;
}

export function generateSyntheticWorkspace(targetRoot, fileCount) {
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(targetRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(targetRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", moduleResolution: "node", strict: true, skipLibCheck: true, noEmit: true }, include: ["**/*.ts"] }, null, 2) + "\n", "utf8");
  if (fileCount < 2) throw new Error("Synthetic workspace fileCount must be at least 2.");
  const utilityCount = Math.min(20, Math.max(1, Math.floor(fileCount / 50)));
  const serviceCount = Math.max(1, Math.ceil((fileCount - 1 - utilityCount) / 11));
  const helperCount = fileCount - 1 - utilityCount - serviceCount;
  const entryImports = [];
  const entryCalls = [];
  for (let service = 1; service <= serviceCount; service += 1) {
    const serviceFile = path.join(targetRoot, `service-${service}.ts`);
    const serviceHelpers = [];
    for (let slot = 0; slot < 10; slot += 1) {
      const helperIndex = (service - 1) * 10 + slot + 1;
      if (helperIndex > helperCount) break;
      serviceHelpers.push(helperIndex);
    }
    const imports = serviceHelpers.map((helperIndex) => `import { helper${helperIndex}, type Helper${helperIndex}Input } from "./src/helper-${helperIndex}";`).join("\n");
    const body = serviceHelpers.map((helperIndex) => `  total += helper${helperIndex}({ id: input.id + ${helperIndex}, label: input.label });`).join("\n");
    fs.writeFileSync(serviceFile, `${imports}\n\nexport interface Service${service}Input { id: number; label: string; }\nexport function service${service}(input: Service${service}Input): number {\n  let total = 0;\n${body}\n  return total;\n}\n`, "utf8");
    entryImports.push(`import { service${service} } from "./service-${service}";`);
    entryCalls.push(`  total += service${service}({ id: seed + ${service}, label: "service-${service}" });`);
  }
  for (let utility = 1; utility <= utilityCount; utility += 1) {
    fs.writeFileSync(path.join(targetRoot, "src", `utility-${utility}.ts`), `export interface Utility${utility}Input { value: number; label: string; }\nexport function utility${utility}(input: Utility${utility}Input): number {\n  const weight = input.label.length + ${utility};\n  return input.value + weight;\n}\n`, "utf8");
  }
  for (let helper = 1; helper <= helperCount; helper += 1) {
    const utility = ((helper - 1) % utilityCount) + 1;
    fs.writeFileSync(path.join(targetRoot, "src", `helper-${helper}.ts`), `import { utility${utility} } from "./utility-${utility}";\n\nexport interface Helper${helper}Input { id: number; label: string; }\nexport type Helper${helper}Result = { value: number; source: string };\nexport function helper${helper}Leaf(value: number): number {\n  return utility${utility}({ value, label: "helper-${helper}" });\n}\nexport function helper${helper}(input: Helper${helper}Input): number {\n  const base = input.id + input.label.length + ${helper};\n  return helper${helper}Leaf(base);\n}\n`, "utf8");
  }
  fs.writeFileSync(path.join(targetRoot, "entry.ts"), `${entryImports.join("\n")}\n\nexport interface EntryInput { seed: number; }\nexport function runEntry(input: EntryInput): number {\n  const seed = input.seed;\n  let total = 0;\n${entryCalls.join("\n")}\n  return total;\n}\n`, "utf8");
}

function pickExternalActiveFile(root, files) {
  const preferred = [path.join(root, "src", "index.ts"), path.join(root, "packages", "zod", "src", "index.ts"), path.join(root, "packages", "zod", "src", "v4", "classic", "schemas.ts")];
  const direct = preferred.find((filePath) => fs.existsSync(filePath));
  if (direct) return direct;
  const candidates = files.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")).filter((f) => !f.endsWith(".d.ts")).map((filePath) => ({ filePath, size: fs.statSync(filePath).size })).sort((a, b) => b.size - a.size);
  if (!candidates[0]) throw new Error("No TypeScript active file found in external repository.");
  return candidates[0].filePath;
}

export function analyzePanelEquivalent({ target, activeCode, mode, resultCache, debug }) {
  const request = { code: activeCode, fileName: target.activeFile, languageId: target.languageId, graphDepth: 1, traceMode: false, traceScope: "single-file" };
  const cacheKey = mode.resultCache ? getAnalysisCacheKey(request, target.root, target.filePaths) : null;
  if (cacheKey) {
    const cached = resultCache.get(cacheKey);
    if (cached) {
      debug("benchmark.analysisResultCache.hit", { entries: resultCache.size });
      return { result: cached, cacheHit: true };
    }
    debug("benchmark.analysisResultCache.miss", { entries: resultCache.size });
  }
  const result = analyzeWorkspaceActive({
    active: { code: activeCode, fileName: target.activeFile, languageId: target.languageId },
    workspaceRoot: target.root,
    filePaths: target.filePaths,
    debug,
    cacheEnabled: mode.sourceFileCache,
  });
  if (cacheKey) resultCache.set(cacheKey, result);
  return { result, cacheHit: false };
}

function getAnalysisCacheKey(args, workspaceRoot, filePaths) {
  const workspaceFilesHash = hashText(filePaths.map((filePath) => normalizeComparablePath(filePath)).sort().join("\n"));
  return JSON.stringify({ version: 1, fileName: normalizeComparablePath(args.fileName), languageId: args.languageId, codeHash: hashText(args.code), graphDepth: clampGraphDepth(args.graphDepth), traceMode: args.traceMode, traceScope: args.traceScope, workspaceRoot: workspaceRoot ? normalizeComparablePath(workspaceRoot) : null, workspaceFilesHash });
}

export class PanelEquivalentResultCache {
  constructor() {
    this.entries = new Map();
  }
  get size() {
    return this.entries.size;
  }
  clear() {
    this.entries.clear();
  }
  get(key) {
    const cached = this.entries.get(key);
    if (!cached) return null;
    cached.lastAccessedAt = Date.now();
    return cloneAnalysisResult(cached.result);
  }
  set(key, result) {
    this.entries.set(key, { result: cloneAnalysisResult(result), lastAccessedAt: Date.now() });
    if (this.entries.size <= RESULT_CACHE_LIMIT) return;
    const sorted = [...this.entries.entries()].sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
    for (const [cacheKey] of sorted.slice(0, this.entries.size - RESULT_CACHE_LIMIT)) this.entries.delete(cacheKey);
  }
}

export function getScenarioCode(baseCode, scenarioId, iteration) {
  if (scenarioId !== "active-edit") return baseCode;
  return `${baseCode}\n\nexport function __cogicBenchmarkVariant${iteration}() {\n  const value${iteration} = ${iteration};\n  return value${iteration} + 1;\n}\n`;
}

export function normalizeAnalysisResult(result) {
  const graphNodes = [...(result.graph?.nodes ?? [])].sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b)),
  );
  const graphEdges = [...(result.graph?.edges ?? [])].sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b)),
  );
  const imports = [...(result.imports ?? [])].sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b)),
  );
  const exports = [...(result.exports ?? [])].sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b)),
  );
  const calls = [...(result.calls ?? [])].sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b)),
  );
  const diagnostics = [...(result.diagnostics ?? [])].sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b)),
  );
  const normalized = { graphNodes, graphEdges, imports, exports, calls, diagnostics };
  return {
    hash: hashText(stableStringify(normalized)),
    counts: {
      nodes: graphNodes.length,
      edges: graphEdges.length,
      imports: imports.length,
      exports: exports.length,
      calls: calls.length,
      diagnostics: diagnostics.length,
    },
  };
}

// original stats(): population SD and nearest-rank percentile (kept for reference; summaries use describe())
export function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  return { mean, median: percentile(sorted, 0.5), p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), min: sorted[0], max: sorted[sorted.length - 1], standardDeviation: Math.sqrt(variance) };
}

export function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * p) - 1));
  return sortedValues[index];
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function cloneAnalysisResult(result) {
  return JSON.parse(JSON.stringify(result));
}
function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}
function normalizeComparablePath(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return isWin ? normalized.toLowerCase() : normalized;
}
function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function clampGraphDepth(depth) {
  if (!Number.isFinite(depth)) return 0;
  return Math.max(0, Math.min(3, Math.round(depth ?? 0)));
}
function guessLanguageId(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return "typescriptreact";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".jsx")) return "javascriptreact";
  if (lower.endsWith(".js")) return "javascript";
  return "typescript";
}
function getGitSha(dir) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
// ===========================================================================
// Section B — additions (outside the timed region)

const SF_EVENTS = ["hit", "miss", "stale", "bypass", "disabled"].map((k) => `analyzer.sourceFileCache.${k}`);
export const SAMPLE_COLUMNS = ["group", "target", "scenario", "mode", "process", "block", "iteration", "isWarmup", "elapsedMs", "sfHit", "sfMiss", "sfStale", "sfBypass", "sfDisabled", "resultHit", "resultMiss", "heapUsed", "rss", "freeMem", "resultHash", "variantReflected", "timestamp"];

function countEvents(events) {
  const c = Object.fromEntries(SF_EVENTS.map((e) => [e, 0]));
  let resultHit = 0;
  let resultMiss = 0;
  for (const e of events) {
    if (e.event in c) c[e.event] += 1;
    else if (e.event === "benchmark.analysisResultCache.hit") resultHit += 1;
    else if (e.event === "benchmark.analysisResultCache.miss") resultMiss += 1;
  }
  return { sfHit: c["analyzer.sourceFileCache.hit"], sfMiss: c["analyzer.sourceFileCache.miss"], sfStale: c["analyzer.sourceFileCache.stale"], sfBypass: c["analyzer.sourceFileCache.bypass"], sfDisabled: c["analyzer.sourceFileCache.disabled"], resultHit, resultMiss };
}

const variantReflected = (result, scenarioId, iteration) => (scenarioId !== "active-edit" ? "" : (result.graph?.nodes ?? []).some((n) => n.name === `__cogicBenchmarkVariant${iteration}`) ? "1" : "0");

// Same loop as the original runScenario (mode order, clearAnalyzerCaches once per mode, cold clears
// both caches every iteration, a new result cache per mode, warm-up then measured iterations, the same
// timed region). Per-iteration rows are recorded after the timer stops.
export function runScenarioSamples(target, scenario, { warmupRuns, measuredRuns, modes = cacheModes, group, processLabel = "p0", block = 0, hashIterations = true }) {
  const rows = [];
  for (const mode of modes) {
    const resultCache = new PanelEquivalentResultCache();
    clearAnalyzerCaches();
    for (let iteration = 0; iteration < warmupRuns + measuredRuns; iteration += 1) {
      if (scenario.id === "cold") {
        clearAnalyzerCaches();
        resultCache.clear();
      }
      const isMeasured = iteration >= warmupRuns;
      const activeCode = getScenarioCode(target.activeCode, scenario.id, iteration);
      const debugEvents = [];
      const debug = (event, detail) => debugEvents.push({ event, detail });
      const started = performance.now();
      const { result, cacheHit } = analyzePanelEquivalent({ target, activeCode, mode, resultCache, debug });
      const elapsedMs = performance.now() - started;
      // ---- outside the timed region ----
      const counts = countEvents(debugEvents);
      const mem = process.memoryUsage();
      rows.push({
        group,
        target: target.id,
        scenario: scenario.id,
        mode: mode.id,
        process: processLabel,
        block,
        iteration,
        isWarmup: isMeasured ? 0 : 1,
        elapsedMs,
        ...counts,
        resultHit: cacheHit ? 1 : 0,
        resultMiss: counts.resultMiss,
        heapUsed: mem.heapUsed,
        rss: mem.rss,
        resultHash: hashIterations ? canonicalHash(result).hash : "",
        freeMem: os.freemem(),
        variantReflected: variantReflected(result, scenario.id, iteration),
        timestamp: new Date().toISOString(),
      });
    }
  }
  return rows;
}

// Same hash as normalizeAnalysisResult(result).hash, computed with one stableStringify per item
// instead of one per comparison (the original form is too slow to run after every iteration).
// stableStringify(normalized) = {"calls":[..],"diagnostics":[..],"exports":[..],"graphEdges":[..],"graphNodes":[..],"imports":[..]}
export function fastNormalizedHash(result) {
  const part = (xs) => `[${(xs ?? []).map(stableStringify).sort((a, b) => a.localeCompare(b)).join(",")}]`;
  const edges = part(result.graph?.edges);
  const text = `{"calls":${part(result.calls)},"diagnostics":${part(result.diagnostics)},"exports":${part(result.exports)},"graphEdges":${edges},"graphNodes":${part(result.graph?.nodes)},"imports":${part(result.imports)}}`;
  return { hash: hashText(text), edgeHash: hashText(edges), counts: { nodes: (result.graph?.nodes ?? []).length, edges: (result.graph?.edges ?? []).length } };
}

// Result-cache hits return JSON clones (cloneAnalysisResult), which drop properties whose value is
// undefined (e.g. graph.edges[].label, graph.nodes[].sig). normalizeAnalysisResult serializes such a
// property as the text "undefined", so a clone and the analyzer output never hash alike. Comparisons
// across modes therefore use this canonical form: the same JSON round trip the result cache applies.
// (1.1; found in the Phase A pilot run with 1.0)
export function canonicalHash(result) {
  return fastNormalizedHash(cloneAnalysisResult(result));
}

// MAX_DISK_SOURCE_FILE_CACHE_ENTRIES in src/analyzer/analyze.ts (same in 43ace0f and bbe4cbf). When one
// analysis requests more files than this, the LRU evicts before reuse and a second run cannot hit; the
// hit requirement then does not apply (EXP-02 H2-4: synthetic-1000/2000 have SF hit 0). (1.2)
export const SOURCE_FILE_CACHE_CAPACITY = 800;

// Phase D hit-path correctness (outside any measurement)
export function correctnessChecks(target) {
  const out = [];
  const off = cacheModes[0];
  const sf = cacheModes[1];
  const full = cacheModes[2];
  const code0 = getScenarioCode(target.activeCode, "active-edit", 0);
  const run = (mode, cache, events) => analyzePanelEquivalent({ target, activeCode: code0, mode, resultCache: cache, debug: (e) => events.push({ event: e }) });
  clearAnalyzerCaches();
  const e0 = [];
  const h0 = canonicalHash(run(off, new PanelEquivalentResultCache(), e0).result);
  const W = countEvents(e0).sfDisabled;
  // SourceFile only: second run must hit and match
  clearAnalyzerCaches();
  const sfCache = new PanelEquivalentResultCache();
  const e1 = [];
  run(sf, sfCache, e1);
  const e2 = [];
  const r2 = run(sf, sfCache, e2);
  const c2 = countEvents(e2);
  const h2 = canonicalHash(r2.result);
  out.push({ target: target.id, check: "sourcefile-second-run", requests: W, sfHit: c2.sfHit, sfMiss: c2.sfMiss, sfStale: c2.sfStale, sfBypass: c2.sfBypass, resultHit: r2.cacheHit ? 1 : 0, hashEqualsOff: h2.hash === h0.hash ? 1 : 0, edgesEqualOff: h2.edgeHash === h0.edgeHash ? 1 : 0, invariant: c2.sfHit + c2.sfMiss + c2.sfStale + c2.sfBypass === W ? 1 : 0, hitExpected: W <= SOURCE_FILE_CACHE_CAPACITY ? 1 : 0, pass: (c2.sfHit > 0 || W > SOURCE_FILE_CACHE_CAPACITY) && h2.hash === h0.hash && c2.sfHit + c2.sfMiss + c2.sfStale + c2.sfBypass === W ? 1 : 0, offHash: h0.hash, candidateHash: h2.hash, nodes: h0.counts.nodes, edges: h0.counts.edges });
  // Full result: second run must be a result hit and match
  clearAnalyzerCaches();
  const fullCache = new PanelEquivalentResultCache();
  run(full, fullCache, []);
  const e4 = [];
  const r4 = run(full, fullCache, e4);
  const h4 = canonicalHash(r4.result);
  out.push({ target: target.id, check: "full-second-run", requests: W, sfHit: countEvents(e4).sfHit, sfMiss: countEvents(e4).sfMiss, sfStale: countEvents(e4).sfStale, sfBypass: countEvents(e4).sfBypass, resultHit: r4.cacheHit ? 1 : 0, hashEqualsOff: h4.hash === h0.hash ? 1 : 0, edgesEqualOff: h4.edgeHash === h0.edgeHash ? 1 : 0, invariant: "", pass: r4.cacheHit && h4.hash === h0.hash ? 1 : 0, offHash: h0.hash, candidateHash: h4.hash, nodes: h0.counts.nodes, edges: h0.counts.edges });
  // variant reflected in the active-edit code
  out.push({ target: target.id, check: "active-edit-variant-reflected", requests: W, sfHit: "", sfMiss: "", sfStale: "", sfBypass: "", resultHit: "", hashEqualsOff: "", edgesEqualOff: "", invariant: "", pass: variantReflected(run(off, new PanelEquivalentResultCache(), []).result, "active-edit", 0) === "1" ? 1 : 0, offHash: "", candidateHash: "", nodes: "", edges: "" });
  clearAnalyzerCaches();
  return { rows: out, requestsPerAnalysis: W, offCounts: h0.counts };
}
export const CORRECTNESS_COLUMNS = ["target", "check", "requests", "hitExpected", "sfHit", "sfMiss", "sfStale", "sfBypass", "resultHit", "hashEqualsOff", "edgesEqualOff", "invariant", "pass", "offHash", "candidateHash", "nodes", "edges"];

// ---------------------------------------------------------------------------
// Statistics (computed after the run from samples.csv rows)

export function quantile7(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function describe(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const ss = s.reduce((a, b) => a + (b - mean) ** 2, 0);
  return { n, medianType7: quantile7(s, 0.5), p50NearestRank: percentile(s, 0.5), p95NearestRank: percentile(s, 0.95), p95Type7: quantile7(s, 0.95), mean, sdSample: n > 1 ? Math.sqrt(ss / (n - 1)) : 0, sdPopulation: Math.sqrt(ss / n), q1: quantile7(s, 0.25), q3: quantile7(s, 0.75), iqr: quantile7(s, 0.75) - quantile7(s, 0.25), min: s[0], max: s[n - 1] };
}
// independent-sample bootstrap of the medians (type 7)
export function bootstrapReduction(off, cache, { resamples = 10000, seed = 20261102 } = {}) {
  const rand = mulberry32(seed);
  const draw = (xs) => {
    const r = new Array(xs.length);
    for (let i = 0; i < xs.length; i++) r[i] = xs[Math.floor(rand() * xs.length)];
    return quantile7(r.sort((a, b) => a - b), 0.5);
  };
  const ds = [];
  const rs = [];
  for (let b = 0; b < resamples; b++) {
    const mo = draw(off);
    const mc = draw(cache);
    ds.push(mo - mc);
    rs.push(1 - mc / mo);
  }
  ds.sort((a, b) => a - b);
  rs.sort((a, b) => a - b);
  return { resamples, seed, deltaLow: quantile7(ds, 0.025), deltaHigh: quantile7(ds, 0.975), rLow: quantile7(rs, 0.025), rHigh: quantile7(rs, 0.975) };
}
export function mannWhitney(a, b) {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[k] = r;
    const t = j - i + 1;
    tieTerm += t ** 3 - t;
    i = j + 1;
  }
  const n1 = a.length;
  const n2 = b.length;
  const r1 = all.reduce((s, x, i) => s + (x.g === 0 ? ranks[i] : 0), 0);
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const n = n1 + n2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
  const z = sigma === 0 ? 0 : (u1 - mu - Math.sign(u1 - mu) * 0.5) / sigma;
  const p = sigma === 0 ? 1 : 2 * (1 - normCdf(Math.abs(z)));
  return { u: u1, z, p };
}
function normCdf(x) {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * (x / Math.SQRT2));
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-((x / Math.SQRT2) ** 2));
  return 0.5 * (1 + erf);
}
export function cliffsDelta(a, b) {
  let gt = 0;
  let lt = 0;
  for (const x of a) for (const y of b) x > y ? gt++ : x < y ? lt++ : 0;
  return (gt - lt) / (a.length * b.length);
}
export function hodgesLehmann(a, b) {
  const d = [];
  for (const x of a) for (const y of b) d.push(x - y);
  return quantile7(d.sort((p, q) => p - q), 0.5);
}
export function holm(ps) {
  const idx = ps.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  const adj = new Array(ps.length);
  let running = 0;
  idx.forEach(({ p, i }, k) => {
    running = Math.max(running, Math.min(1, (ps.length - k) * p));
    adj[i] = running;
  });
  return adj;
}

export function summarize(samples, { resamples = 10000, seed = 20261102 } = {}) {
  const measured = samples.filter((s) => Number(s.isWarmup) === 0);
  const keys = [...new Set(measured.map((s) => `${s.target}|${s.scenario}|${s.mode}`))];
  const byKey = new Map(keys.map((k) => [k, measured.filter((s) => `${s.target}|${s.scenario}|${s.mode}` === k)]));
  const rows = [];
  for (const k of keys) {
    const [target, scenario, mode] = k.split("|");
    const xs = byKey.get(k);
    const t = xs.map((s) => Number(s.elapsedMs));
    const d = describe(t);
    const sum = (f) => xs.reduce((a, s) => a + Number(s[f] || 0), 0);
    const row = { target, scenario, mode, ...d, sfHit: sum("sfHit"), sfMiss: sum("sfMiss"), sfStale: sum("sfStale"), sfBypass: sum("sfBypass"), sfDisabled: sum("sfDisabled"), resultHit: sum("resultHit"), resultMiss: sum("resultMiss"), heapUsedMedian: quantile7(xs.map((s) => Number(s.heapUsed)).sort((a, b) => a - b), 0.5), rssMax: Math.max(...xs.map((s) => Number(s.rss))) };
    const offXs = byKey.get(`${target}|${scenario}|off`);
    if (mode !== "off" && offXs) {
      const o = offXs.map((s) => Number(s.elapsedMs));
      const od = describe(o);
      const bs = bootstrapReduction(o, t, { resamples, seed });
      const mw = mannWhitney(o, t);
      Object.assign(row, {
        deltaMedianType7: od.medianType7 - d.medianType7,
        reductionType7: 1 - d.medianType7 / od.medianType7,
        reductionNearestRank: 1 - d.p50NearestRank / od.p50NearestRank,
        ...bs,
        rHalfWidth: (bs.rHigh - bs.rLow) / 2,
        hodgesLehmannMs: hodgesLehmann(o, t),
        mannWhitneyU: mw.u,
        mannWhitneyP: mw.p,
        cliffsDelta: cliffsDelta(o, t),
      });
    }
    rows.push(row);
  }
  const cmp = rows.filter((r) => r.mannWhitneyP !== undefined);
  const adj = holm(cmp.map((r) => r.mannWhitneyP));
  cmp.forEach((r, i) => (r.mannWhitneyPHolm = adj[i]));
  return rows;
}
export const SUMMARY_COLUMNS = ["target", "scenario", "mode", "n", "medianType7", "p50NearestRank", "p95NearestRank", "p95Type7", "mean", "sdSample", "sdPopulation", "q1", "q3", "iqr", "min", "max", "sfHit", "sfMiss", "sfStale", "sfBypass", "sfDisabled", "resultHit", "resultMiss", "heapUsedMedian", "rssMax", "deltaMedianType7", "reductionType7", "reductionNearestRank", "deltaLow", "deltaHigh", "rLow", "rHigh", "rHalfWidth", "hodgesLehmannMs", "mannWhitneyU", "mannWhitneyP", "mannWhitneyPHolm", "cliffsDelta"];

// per-iteration invariants and hit-path hash agreement (from samples)
export function sampleInvariants(samples, requestsByTarget) {
  const problems = [];
  const offHash = new Map();
  for (const s of samples) if (s.mode === "off") offHash.set(`${s.target}|${s.scenario}|${s.iteration}|${s.block}|${s.process}`, s.resultHash);
  const offHashAny = new Map();
  for (const s of samples) if (s.mode === "off") offHashAny.set(`${s.target}|${s.scenario}|${s.iteration}`, s.resultHash);
  let hashCompared = 0;
  let hashMismatch = 0;
  for (const s of samples) {
    const W = requestsByTarget[s.target];
    const analyzerCalled = !(s.mode === "full" && Number(s.resultHit) === 1);
    if (s.mode === "off" && W !== undefined && Number(s.sfDisabled) !== W) problems.push(`${s.target}/${s.scenario}/off/${s.iteration}: disabled ${s.sfDisabled} != W ${W}`);
    if (s.mode !== "off" && analyzerCalled && W !== undefined) {
      const sum = Number(s.sfHit) + Number(s.sfMiss) + Number(s.sfStale) + Number(s.sfBypass);
      if (sum !== W) problems.push(`${s.target}/${s.scenario}/${s.mode}/${s.iteration}: hit+miss+stale+bypass ${sum} != W ${W}`);
    }
    if (s.scenario === "active-edit" && s.variantReflected === "0") problems.push(`${s.target}/${s.scenario}/${s.mode}/${s.iteration}: variant not reflected`);
    if (s.mode !== "off" && s.resultHash) {
      const ref = offHashAny.get(`${s.target}|${s.scenario}|${s.iteration}`);
      if (ref) {
        hashCompared += 1;
        if (ref !== s.resultHash) {
          hashMismatch += 1;
          problems.push(`${s.target}/${s.scenario}/${s.mode}/${s.iteration}: result hash differs from OFF`);
        }
      }
    }
  }
  const fullRep = samples.filter((s) => s.mode === "full" && s.scenario === "repeated" && Number(s.isWarmup) === 0);
  const fullEdit = samples.filter((s) => s.mode === "full" && s.scenario === "active-edit" && Number(s.isWarmup) === 0);
  return {
    problems,
    hashCompared,
    hashMismatch,
    fullRepeatedAllResultHit: fullRep.length > 0 && fullRep.every((s) => Number(s.resultHit) === 1),
    fullActiveEditResultHits: fullEdit.reduce((a, s) => a + Number(s.resultHit), 0),
  };
}

// ---------------------------------------------------------------------------
// Historical comparison (read-only use of docs/benchmarks/analysis-cache/raw/analysis-cache-results.json)

const HIST_TARGET = { cogic: "cogic", "synthetic-100": "synthetic-100", "synthetic-500": "synthetic-500", "synthetic-1000": "synthetic-1000", "synthetic-2000": "synthetic-2000", zod: "external-zod" };
export function historicalRows(repoRoot = REPO_ROOT) {
  const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs/benchmarks/analysis-cache/raw/analysis-cache-results.json"), "utf8"));
  return raw.rows.map((r) => ({ target: Object.keys(HIST_TARGET).find((k) => HIST_TARGET[k] === r.targetId) ?? r.targetId, scenario: r.scenarioId, mode: r.cacheMode, p50: r.stats.p50, p95: r.stats.p95, mean: r.stats.mean, fileCount: r.fileCount, sfHits: r.sourceFileCacheHits, sfMisses: r.sourceFileCacheMisses, resultHits: r.resultCacheHits, rHist: r.cacheMode === "off" ? null : r.p50ImprovementPct / 100 }));
}
export function compareToHistory(summaryRows, hist) {
  return summaryRows
    .filter((r) => r.mode !== "off")
    .map((r) => {
      const h = hist.find((x) => x.target === r.target && x.scenario === r.scenario && x.mode === r.mode);
      const hOff = hist.find((x) => x.target === r.target && x.scenario === r.scenario && x.mode === "off");
      const off = summaryRows.find((x) => x.target === r.target && x.scenario === r.scenario && x.mode === "off");
      if (!h) return { target: r.target, scenario: r.scenario, mode: r.mode, note: "no historical row" };
      const sign = Math.sign(h.rHist);
      // direction: the sign of the historical point estimate (0 counts as "no effect")
      let direction;
      if (sign > 0) direction = r.rLow > 0 ? "YES" : r.rHigh < 0 ? "REVERSED" : "NO";
      else if (sign < 0) direction = r.rHigh < 0 ? "YES" : r.rLow > 0 ? "REVERSED" : "NO";
      else direction = r.rLow <= 0 && r.rHigh >= 0 ? "YES" : "NO";
      const magnitude = direction !== "YES" ? "NOT_ASSESSED" : h.rHist >= r.rLow && h.rHist <= r.rHigh ? "COMPATIBLE" : "NOT_COMPATIBLE";
      return {
        target: r.target,
        scenario: r.scenario,
        mode: r.mode,
        histOffP50: hOff?.p50,
        histP50: h.p50,
        histR: h.rHist,
        newOffP50NearestRank: off?.p50NearestRank,
        newP50NearestRank: r.p50NearestRank,
        newRNearestRank: r.reductionNearestRank,
        newRType7: r.reductionType7,
        rLow: r.rLow,
        rHigh: r.rHigh,
        rHalfWidth: r.rHalfWidth,
        directionDefinition: sign > 0 ? "reduction (hist r > 0)" : sign < 0 ? "slowdown (hist r < 0)" : "no effect (hist r = 0)",
        effectDirection: direction,
        magnitude,
        precisionFlag: r.rHalfWidth > 0.05 ? "PRECISION_INSUFFICIENT(>5pp)" : "",
        histSfHits: h.sfHits,
        newSfHit: r.sfHit,
        histResultHits: h.resultHits,
        newResultHit: r.resultHit,
      };
    });
}
export const COMPARISON_COLUMNS = ["target", "scenario", "mode", "histOffP50", "histP50", "histR", "newOffP50NearestRank", "newP50NearestRank", "newRNearestRank", "newRType7", "rLow", "rHigh", "rHalfWidth", "directionDefinition", "effectDirection", "magnitude", "precisionFlag", "histSfHits", "newSfHit", "histResultHits", "newResultHit", "note"];

// ---------------------------------------------------------------------------
// Integrity, identity, environment

// reproducibility.md §3: LF-normalized SHA-256 of the historical artifacts
export const PROTECTED = {
  "docs/benchmarks/analysis-cache/README.md": "c4985f69e37f45f871d0b180c6a0b5be87ccbc5c5dafda2205121be5f660057b",
  "docs/benchmarks/analysis-cache/future-work.md": "7a1de248f5a45260b0265f176f12db4aee0f00678ab7029bd8edd6c3a44dcec6",
  "docs/benchmarks/analysis-cache/limitations.md": "ef3ba5e7d322c62853e64ed05c3a0e0b4ecbf55c1651acbc040486c3acee6f9a",
  "docs/benchmarks/analysis-cache/methodology.md": "5d334de85a68cd9ad3a99772d955178c2da938371925f44c734c09884d3c5004",
  "docs/benchmarks/analysis-cache/raw/analysis-cache-results.csv": "ad9a6b61e74c7030822a644cc1c03d04c830e9270c5e4da37ca7e9283f39ddc8",
  "docs/benchmarks/analysis-cache/raw/analysis-cache-results.json": "15b6b4a54999348fc09b4b956e09e6743fb27d1dd64b2b0076ad39b160cf6d37",
  "docs/benchmarks/analysis-cache/results.md": "dd0c5e4a9941743e044a88609e6a070521ff96570f0a4a4f64142d226ee42281",
  "scripts/benchmark-analysis-cache.mjs": "4495a5964ef8a824d72b07c9095ba0a4aadb1228f1ca050a925286475ab87c5e",
};
export const sha256Lf = (file) => crypto.createHash("sha256").update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"), "utf8").digest("hex");
export function integrityCheck(repoRoot = REPO_ROOT) {
  const files = Object.entries(PROTECTED).map(([f, want]) => {
    let got = null;
    try {
      got = sha256Lf(path.join(repoRoot, f));
    } catch {}
    return { file: f, expected: want, actual: got, ok: got === want };
  });
  return { ok: files.every((f) => f.ok), files };
}

export const GROUPS = {
  A: { name: "HISTORICAL_REPRODUCTION", commit: "43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77", srcAnalyzerTree: "33f97d7bb566937a0ea6e70759e1464c53bfde60", buildHash: "958dbf677b6085ddf478265b3cc2b64c5fb1452bf28cfb4c255ed5ef00566270" },
  B: { name: "CURRENT_ANALYZER_EVALUATION", commit: "bbe4cbf5b1f784d9223ca3d46d96058617687b12", srcAnalyzerTree: null, buildHash: null },
};
export const HISTORICAL_COMMIT = "d9faa0221760f6d1b345ae067a3b37362562e1a0";
const git = (args, cwd) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

export function buildHash(root) {
  const hashes = {};
  for (const dir of ["analyzer", "shared"]) {
    const srcDir = path.join(root, "src", dir);
    const walk = (d, rel) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]));
    for (const rel of walk(srcDir, "").filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).sort()) {
      const out = path.join(root, "out", dir, rel.replace(/\.ts$/, ".js"));
      hashes[`out/${dir}/${rel.replace(/\.ts$/, ".js")}`] = fs.existsSync(out) ? crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex") : null;
    }
  }
  return crypto.createHash("sha256").update(stableStringify(hashes)).digest("hex");
}

export function analyzerIdentity(group, analyzerRoot) {
  const spec = GROUPS[group];
  const problems = [];
  if (!spec) return { ok: false, problems: [`unknown group ${group}`] };
  const head = git(["rev-parse", "HEAD"], analyzerRoot);
  const tree = git(["rev-parse", "HEAD:src/analyzer"], analyzerRoot);
  const srcTree = git(["rev-parse", "HEAD:src"], analyzerRoot);
  const dirty = git(["status", "--porcelain", "--untracked-files=no"], analyzerRoot);
  const ts = JSON.parse(fs.readFileSync(path.join(analyzerRoot, "node_modules/typescript/package.json"), "utf8")).version;
  const bh = buildHash(analyzerRoot);
  if (head !== spec.commit) problems.push(`HEAD ${head} != ${spec.commit}`);
  if (dirty) problems.push("analyzer worktree has tracked changes");
  if (ts !== "5.9.3") problems.push(`typescript ${ts}`);
  if (spec.srcAnalyzerTree && tree !== spec.srcAnalyzerTree) problems.push(`src/analyzer tree ${tree}`);
  if (spec.buildHash && bh !== spec.buildHash) problems.push(`build hash ${bh}`);
  let srcEqualsHistorical = null;
  try {
    srcEqualsHistorical = git(["diff", "--quiet", HISTORICAL_COMMIT, head, "--", "src"], analyzerRoot) === "" ? true : false;
  } catch {
    srcEqualsHistorical = false;
  }
  if (group === "A" && !srcEqualsHistorical) problems.push(`src differs from ${HISTORICAL_COMMIT}`);
  return { ok: problems.length === 0, problems, group, groupName: spec.name, head, srcAnalyzerTree: tree, srcTree, buildHash: bh, typescript: ts, srcEqualsHistoricalD9faa02: srcEqualsHistorical };
}

function sh(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", timeout: 60000 });
  return r.status === 0 ? String(r.stdout).trim() : null;
}
export function environment() {
  const cpus = os.cpus();
  return {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    osVersion: os.version?.() ?? null,
    cpu: cpus[0]?.model ?? null,
    logicalCpus: cpus.length,
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    node: process.version,
    v8: process.versions.v8,
    npm: sh(`"${path.join(path.dirname(process.execPath), isWin ? "npm.cmd" : "npm")}" --version`) ?? sh("npm --version"),
    execArgv: process.execArgv,
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    powerScheme: isWin ? sh("powercfg /getactivescheme") : null,
  };
}

// ---------------------------------------------------------------------------
// Targets and workloads

const REQUEST_CATEGORY = (p) => {
  const n = String(p).replace(/\\/g, "/");
  if (n.includes("/node_modules/typescript/lib/")) return "typescript-lib";
  if (n.includes("/node_modules/@types/")) return "@types";
  if (n.includes("/node_modules/")) return "other-node_modules";
  return "workspace";
};

export function buildTargets({ cogicWorkload, workDir, targetIds }) {
  const out = [];
  const want = (id) => !targetIds || targetIds.includes(id);
  if (want("cogic")) out.push(makeRepositoryTarget("cogic", "Cogic repository", cogicWorkload, selectCogicActiveFile(cogicWorkload)));
  for (const size of SYNTHETIC_SIZES) {
    const id = `synthetic-${size}`;
    if (!want(id)) continue;
    const root = path.join(workDir, "synthetic", id);
    generateSyntheticWorkspace(root, size);
    out.push(makeRepositoryTarget(id, `Synthetic TypeScript workspace (${size} files)`, root, path.join(root, "entry.ts")));
  }
  if (want("zod")) {
    const root = path.join(workDir, "zod");
    const files = listWorkspaceFiles(root);
    out.push(makeRepositoryTarget("zod", "External real-world repository (zod)", root, pickExternalActiveFile(root, files)));
  }
  return out;
}

export function describeWorkload(t) {
  const rel = (f) => path.relative(t.root, f).split(path.sep).join("/");
  const files = t.filePaths.map((f) => ({ path: rel(f), sha256: crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") }));
  const events = [];
  clearAnalyzerCaches();
  const result = analyzeWorkspaceActive({ active: { code: t.activeCode, fileName: t.activeFile, languageId: t.languageId }, workspaceRoot: t.root, filePaths: t.filePaths, cacheEnabled: false, debug: (e, d) => events.push({ e, f: d?.filePath }) });
  const req = events.filter((x) => x.e === "analyzer.sourceFileCache.disabled");
  const byCat = {};
  for (const r of req) byCat[REQUEST_CATEGORY(r.f)] = (byCat[REQUEST_CATEGORY(r.f)] ?? 0) + 1;
  const n = normalizeAnalysisResult(result);
  const typesDir = path.join(t.root, "node_modules", "@types");
  return {
    id: t.id,
    commit: t.commit,
    activeFile: rel(t.activeFile),
    fileCount: t.filePaths.length,
    fileListSha256: crypto.createHash("sha256").update(files.map((f) => `${f.sha256}  ${f.path}\n`).join("")).digest("hex"),
    files,
    programRootFiles: result.meta?.rootFiles ?? null,
    usedTsconfig: t.usedTsconfig,
    sourceFileRequests: req.length,
    requestsByCategory: byCat,
    typesPackages: fs.existsSync(typesDir) ? fs.readdirSync(typesDir).sort() : [],
    resultCounts: n.counts,
    resultHash: n.hash,
  };
}

// ---------------------------------------------------------------------------
// IO

export function csvCell(v) {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows, cols) => `${[cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n")}\n`;
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const c = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) {
        if (ch === '"' && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") {
        c.push(cur);
        cur = "";
      } else cur += ch;
    }
    c.push(cur);
    return Object.fromEntries(head.map((h, i) => [h, c[i]]));
  });
}
export function assertOutputAllowed(dir, repoRoot = REPO_ROOT) {
  const abs = path.resolve(dir).toLowerCase();
  const bench = path.resolve(repoRoot, "docs/benchmarks").toLowerCase();
  if (abs === bench || abs.startsWith(`${bench}${path.sep}`)) throw new Error(`refusing to write under docs/benchmarks: ${dir}`);
  if (fs.existsSync(dir)) throw new Error(`refusing to overwrite existing run directory: ${dir}`);
}
const writeJson = (f, d) => fs.writeFileSync(f, `${JSON.stringify(d, null, 2)}\n`);

// ---------------------------------------------------------------------------
// Commands

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}
const list = (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);

export function loadAnalyzer(analyzerRoot) {
  bindAnalyzer(createRequire(import.meta.url)(path.join(analyzerRoot, "out", "analyzer")));
}

// One process: measure the given conditions (P-orig order: target -> scenario -> mode).
export function measureInProcess({ group, targets, scenarioIds, modeIds, warmupRuns, measuredRuns, processLabel = "p0", block = 0, conditionOrder = null }) {
  const samples = [];
  const modes = cacheModes.filter((m) => !modeIds || modeIds.includes(m.id));
  if (conditionOrder) {
    for (const c of conditionOrder) {
      const t = targets.find((x) => x.id === c.target);
      const s = scenarios.find((x) => x.id === c.scenario);
      samples.push(...runScenarioSamples(t, s, { warmupRuns, measuredRuns, modes: cacheModes.filter((m) => m.id === c.mode), group, processLabel, block }));
    }
    return samples;
  }
  for (const t of targets) for (const s of scenarios.filter((x) => !scenarioIds || scenarioIds.includes(x.id))) samples.push(...runScenarioSamples(t, s, { warmupRuns, measuredRuns, modes, group, processLabel, block }));
  return samples;
}

export const ROBUST_CONDITIONS = [
  ...["cogic", "synthetic-100", "synthetic-500", "synthetic-1000", "synthetic-2000", "zod"].flatMap((t) => cacheModes.map((m) => ({ target: t, scenario: "active-edit", mode: m.id }))),
  ...["cogic", "synthetic-500"].flatMap((t) => cacheModes.map((m) => ({ target: t, scenario: "repeated", mode: m.id }))),
  ...cacheModes.map((m) => ({ target: "cogic", scenario: "cold", mode: m.id })),
];
export function shuffled(items, seed) {
  const rand = mulberry32(seed);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cmdRun(a) {
  const group = a.group;
  const runDir = path.resolve(a["out-root"], a["run-id"]);
  assertOutputAllowed(runDir);
  const integrityBefore = integrityCheck();
  if (!integrityBefore.ok) throw new Error(`historical artifacts changed: ${integrityBefore.files.filter((f) => !f.ok).map((f) => f.file).join(", ")}`);
  const repoDirty = git(["status", "--porcelain"], REPO_ROOT);
  if (repoDirty && !a["allow-dirty-tool"]) throw new Error("tool repository has uncommitted changes; commit the tool before measuring");
  const identity = analyzerIdentity(group, path.resolve(a["analyzer-root"]));
  if (!identity.ok) throw new Error(`analyzer identity: ${identity.problems.join("; ")}`);
  const cogicWorkload = path.resolve(a["cogic-workload"]);
  const workloadHead = git(["rev-parse", "HEAD"], cogicWorkload);
  const workloadDirty = git(["status", "--porcelain"], cogicWorkload);
  if (workloadDirty) throw new Error("cogic workload worktree is not clean");
  const zodHead = git(["rev-parse", "HEAD"], path.join(path.resolve(a["work-dir"]), "zod"));
  if (zodHead !== "e6b6ab347675cd2bd54b1bdbed16f98c59be82a9") throw new Error(`zod at ${zodHead}`);
  fs.mkdirSync(runDir, { recursive: true });
  const warmupRuns = Number(a.warmup ?? DEFAULT_WARMUP);
  const measuredRuns = Number(a.runs ?? DEFAULT_RUNS);
  const protocol = a.protocol ?? "orig";
  const seed = Number(a.seed ?? 20261102);
  const targetIds = list(a.targets);
  const scenarioIds = list(a.scenarios);
  const modeIds = list(a.modes);
  const envStart = environment();
  const startedAt = new Date().toISOString();
  const run = {
    schema: "exp02-run/1",
    tool: TOOL_VERSION,
    toolCommit: git(["rev-parse", "HEAD"], REPO_ROOT),
    toolSha256: sha256Lf(fileURLToPath(import.meta.url)),
    originalScriptSha256: PROTECTED["scripts/benchmark-analysis-cache.mjs"],
    runId: a["run-id"],
    group,
    groupName: GROUPS[group].name,
    pilot: Boolean(a.pilot),
    protocol,
    nodeLabel: a["node-label"] ?? process.version,
    seed,
    warmupRuns,
    measuredRuns,
    blocks: protocol === "robust" ? Number(a.blocks ?? 3) : null,
    filters: { targets: targetIds, scenarios: scenarioIds, modes: modeIds },
    analyzer: identity,
    workloads: { cogicCommit: workloadHead, zodCommit: zodHead, historicalCommit: HISTORICAL_COMMIT },
    command: `node ${path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join("/")} ${process.argv.slice(2).map((x) => (/[\\/:]/.test(x) && path.isAbsolute(x) ? "<path>" : x)).join(" ")}`,
    startedAt,
    status: "RUNNING",
    failures: [],
  };
  writeJson(path.join(runDir, "run.json"), run);
  loadAnalyzer(path.resolve(a["analyzer-root"]));
  let samples = [];
  let workloads = [];
  let correctness = [];
  const requestsByTarget = {};
  try {
    const targets = buildTargets({ cogicWorkload, workDir: path.resolve(a["work-dir"]), targetIds });
    // as in the original main(): per target, the correctness analyses come first, then its scenarios
    for (const t of targets) {
      const w = describeWorkload(t);
      workloads.push(w);
      requestsByTarget[t.id] = w.sourceFileRequests;
      correctness.push(...correctnessChecks(t).rows);
      if (protocol === "orig") samples.push(...measureInProcess({ group, targets: [t], scenarioIds, modeIds, warmupRuns, measuredRuns }));
    }
    if (protocol !== "orig") {
      // P-robust: every condition in a new Node process; condition order shuffled per block
      const conds = ROBUST_CONDITIONS.filter((c) => (!targetIds || targetIds.includes(c.target)) && (!scenarioIds || scenarioIds.includes(c.scenario)) && (!modeIds || modeIds.includes(c.mode)));
      const blocks = Number(a.blocks ?? 3);
      const order = [];
      for (let b = 1; b <= blocks; b++) {
        const seq = shuffled(conds, seed + b);
        order.push({ block: b, conditions: seq });
        for (const [k, c] of seq.entries()) {
          const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "child", "--group", group, "--analyzer-root", path.resolve(a["analyzer-root"]), "--cogic-workload", cogicWorkload, "--work-dir", path.resolve(a["work-dir"]), "--condition", `${c.target}:${c.scenario}:${c.mode}`, "--block", String(b), "--process", `b${b}-${String(k + 1).padStart(2, "0")}`, "--warmup", String(warmupRuns), "--runs", String(measuredRuns), "--out", path.join(runDir, "blocks", `b${b}`, `${c.target}.${c.scenario}.${c.mode}.csv`)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
          if (child.status !== 0) run.failures.push({ block: b, condition: c, status: child.status, stderr: String(child.stderr).slice(-2000) });
        }
        const freeAfter = os.freemem();
        order[order.length - 1].freeMemAfterBlock = freeAfter;
      }
      run.robustOrder = order;
      for (const f of walkFiles(path.join(runDir, "blocks"))) samples.push(...parseCsv(fs.readFileSync(f, "utf8")));
    }
  } catch (e) {
    run.failures.push({ error: e?.message ?? String(e), stack: e?.stack });
  }
  const envEnd = environment();
  fs.writeFileSync(path.join(runDir, "samples.csv"), toCsv(samples, SAMPLE_COLUMNS));
  fs.writeFileSync(path.join(runDir, "correctness.csv"), toCsv(correctness, CORRECTNESS_COLUMNS));
  writeJson(path.join(runDir, "workloads.json"), { schema: "exp02-workloads/1", workloads });
  writeJson(path.join(runDir, "env.json"), { schema: "exp02-env/1", start: envStart, end: envEnd });
  finalize(runDir, run, { samples: parseCsv(fs.readFileSync(path.join(runDir, "samples.csv"), "utf8")), requestsByTarget, correctness, integrityBefore });
  return run;
}

function walkFiles(d) {
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(path.join(d, e.name)) : [path.join(d, e.name)])).sort();
}

// aggregates are always recomputed from samples.csv (not from in-memory values)
export function finalize(runDir, run, { samples, requestsByTarget, correctness, integrityBefore = null }) {
  const summary = summarize(samples);
  fs.writeFileSync(path.join(runDir, "summary.csv"), toCsv(summary, SUMMARY_COLUMNS));
  const comparison = compareToHistory(summary, historicalRows());
  fs.writeFileSync(path.join(runDir, "comparison-to-hist.csv"), toCsv(comparison, COMPARISON_COLUMNS));
  const inv = sampleInvariants(samples, requestsByTarget);
  const integrityAfter = integrityCheck();
  const expectedConditions = new Set(samples.map((s) => `${s.target}|${s.scenario}|${s.mode}`)).size;
  writeJson(path.join(runDir, "integrity.json"), { schema: "exp02-integrity/1", before: integrityBefore, after: integrityAfter, sampleInvariants: { ...inv, problems: inv.problems.slice(0, 200), problemCount: inv.problems.length }, correctnessPass: correctness.every((c) => Number(c.pass) === 1), conditions: expectedConditions });
  run.finishedAt = new Date().toISOString();
  run.conditionsMeasured = expectedConditions;
  run.status = run.failures.length ? "PARTIAL" : integrityAfter.ok ? "COMPLETE" : "INTEGRITY_FAILED";
  writeJson(path.join(runDir, "run.json"), run);
  fs.writeFileSync(path.join(runDir, "summary.md"), renderSummary(run, summary, comparison, inv, correctness));
}

const fmt = (x, d = 2) => (x === undefined || x === null || Number.isNaN(Number(x)) ? "" : Number(x).toFixed(d));
const pct = (x) => (x === undefined || x === null || x === "" ? "" : `${(Number(x) * 100).toFixed(1)}%`);
export function renderSummary(run, summary, comparison, inv, correctness) {
  const L = [];
  L.push(`# EXP-02 run ${run.runId}`, "", `- group: ${run.group} (${run.groupName})${run.pilot ? " — PILOT (excluded from final statistics)" : ""}`, `- protocol: ${run.protocol}, warm-up ${run.warmupRuns}, measured ${run.measuredRuns}${run.blocks ? `, blocks ${run.blocks}` : ""}`, `- node: ${run.nodeLabel}; analyzer ${run.analyzer.head} (build ${run.analyzer.buildHash.slice(0, 12)}…)`, `- tool: ${run.tool} @ ${run.toolCommit}`, `- status: ${run.status}, conditions ${run.conditionsMeasured}`, "");
  L.push("| target | scenario | mode | median (type7) ms | p50 nearest ms | p95 ms | r | 95% CI r | SF hit | result hit |", "|---|---|---|---:|---:|---:|---:|---|---:|---:|");
  for (const r of summary) L.push(`| ${r.target} | ${r.scenario} | ${r.mode} | ${fmt(r.medianType7)} | ${fmt(r.p50NearestRank)} | ${fmt(r.p95NearestRank)} | ${pct(r.reductionType7)} | ${r.rLow === undefined ? "" : `${pct(r.rLow)} – ${pct(r.rHigh)}`} | ${r.sfHit} | ${r.resultHit} |`);
  L.push("", `- hit-path correctness (Phase D): ${correctness.filter((c) => Number(c.pass) === 1).length}/${correctness.length} checks pass`, `- per-iteration result hashes compared with OFF: ${inv.hashCompared}, mismatches ${inv.hashMismatch}`, `- invariant/variant problems: ${inv.problems.length}`, `- Full repeated all result hit: ${inv.fullRepeatedAllResultHit}; Full active-edit result hits: ${inv.fullActiveEditResultHits}`, "");
  return `${L.join("\n")}\n`;
}

function cmdChild(a) {
  loadAnalyzer(path.resolve(a["analyzer-root"]));
  const [target, scenario, mode] = a.condition.split(":");
  const targets = buildTargets({ cogicWorkload: path.resolve(a["cogic-workload"]), workDir: path.resolve(a["work-dir"]), targetIds: [target] });
  const samples = measureInProcess({ group: a.group, targets, warmupRuns: Number(a.warmup), measuredRuns: Number(a.runs), processLabel: a.process, block: Number(a.block), conditionOrder: [{ target, scenario, mode }] });
  fs.mkdirSync(path.dirname(a.out), { recursive: true });
  if (fs.existsSync(a.out)) throw new Error(`refusing to overwrite ${a.out}`);
  fs.writeFileSync(a.out, toCsv(samples, SAMPLE_COLUMNS));
}

// Copy a run into the repository without local paths (samples/summary/comparison/correctness are path-free;
// run.json/env.json/workloads.json are re-emitted without absolute paths).
export function publish(runDir, to) {
  if (fs.existsSync(to)) throw new Error(`refusing to overwrite ${to}`);
  fs.mkdirSync(to, { recursive: true });
  for (const f of ["samples.csv", "correctness.csv", "summary.csv", "comparison-to-hist.csv", "integrity.json", "summary.md"]) fs.copyFileSync(path.join(runDir, f), path.join(to, f));
  const run = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
  if (run.robustOrder) run.robustOrder = run.robustOrder.map((b) => ({ ...b }));
  run.failures = run.failures.map((x) => ({ ...x, stack: undefined, stderr: x.stderr ? String(x.stderr).replace(/[A-Za-z]:[\\/][^\s"']*/g, "<path>") : undefined }));
  writeJson(path.join(to, "run.json"), run);
  const env = JSON.parse(fs.readFileSync(path.join(runDir, "env.json"), "utf8"));
  writeJson(path.join(to, "env.json"), env);
  const wl = JSON.parse(fs.readFileSync(path.join(runDir, "workloads.json"), "utf8"));
  writeJson(path.join(to, "workloads.json"), wl);
  const leaks = walkFiles(to).filter((f) => /[A-Za-z]:[\\/](?!\/)|\\Users\\|\/Users\//.test(fs.readFileSync(f, "utf8").replace(/https?:\/\//g, "")));
  if (leaks.length) throw new Error(`absolute paths remain in ${leaks.map((f) => path.basename(f)).join(", ")}`);
  return to;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === "run") {
    const r = cmdRun(a);
    console.log(`${r.runId}: ${r.status} (${r.conditionsMeasured} conditions)${r.failures.length ? ` failures ${r.failures.length}` : ""}`);
    process.exitCode = r.status === "COMPLETE" ? 0 : 3;
  } else if (cmd === "child") {
    cmdChild(a);
  } else if (cmd === "publish") {
    console.log(publish(path.resolve(a.run), path.resolve(a.to)));
  } else if (cmd === "integrity") {
    const r = integrityCheck();
    for (const f of r.files) console.log(`${f.ok ? "OK  " : "DIFF"} ${f.file}`);
    process.exitCode = r.ok ? 0 : 1;
  } else {
    throw new Error("command: run | child | publish | integrity");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
