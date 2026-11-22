// P6 non-UI benchmark worker. One process = one (target, cache mode, scenario) block.
// Loads the analyzer compiled from the restored P4 commit (<COGIC_REPO>\out) read-only.
// Panel-equivalent steps mirror src/panel/CodeGraphPanel.ts @ 9126f354:
//   result-cache key/lookup (cache ON only) -> analyzeWorkspaceActive -> pruneGraphToFile (depth 0)
//   -> payload JSON serialisation (proxy for webview postMessage cost).
// The 350 ms debounce, VS Code findFiles, postMessage transport, webview layout and paint are NOT
// in this process; they are measured (or left unmeasured) by the UI harness and reported separately.
"use strict";
const t0Process = Number(process.env.P6_SPAWN_EPOCH_MS || 0);
const { performance } = require("node:perf_hooks");
const tModStart = performance.now();
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const REPO = process.env.COGIC_REPO || "<COGIC_REPO>";
const { analyzeWorkspaceActive, clearAnalyzerCaches } = require(path.join(REPO, "out", "analyzer"));
const moduleLoadMs = performance.now() - tModStart;

const [targetJson, cacheMode, scenario, warmupStr, runsStr] = process.argv.slice(2);
const target = JSON.parse(fs.readFileSync(targetJson, "utf8"));
const cacheOn = cacheMode === "on";
const warmup = Number(warmupStr);
const runs = Number(runsStr);
const RESULT_CACHE_LIMIT = 40; // MAX_ANALYSIS_RESULT_CACHE_ENTRIES in CodeGraphPanel.ts

const norm = (p) => p.replace(/\\/g, "/").toLowerCase();
const hashText = (t) => crypto.createHash("sha1").update(t).digest("hex");
const clone = (r) => JSON.parse(JSON.stringify(r));

function cacheKey(code) {
  return JSON.stringify({
    version: 1,
    fileName: norm(target.activeFile),
    languageId: "typescript",
    codeHash: hashText(code),
    graphDepth: 0,
    traceMode: false,
    traceScope: "single-file",
    workspaceRoot: norm(target.root),
    workspaceFilesHash: hashText(target.filePaths.map(norm).sort().join("\n")),
  });
}

const resultCache = new Map();
function cacheGet(key) {
  const e = resultCache.get(key);
  if (!e) return null;
  e.lastAccessedAt = Date.now();
  return clone(e.result);
}
function cacheSet(key, result) {
  resultCache.set(key, { result: clone(result), lastAccessedAt: Date.now() });
  if (resultCache.size <= RESULT_CACHE_LIMIT) return;
  const sorted = [...resultCache.entries()].sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
  for (const [k] of sorted.slice(0, resultCache.size - RESULT_CACHE_LIMIT)) resultCache.delete(k);
}

function pruneGraphToFile(graph, filePath) {
  const f = norm(filePath);
  const nodes = graph.nodes.filter((n) => norm(n.file) === f);
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

const baseCode = fs.readFileSync(target.activeFile, "utf8");
function codeFor(iteration) {
  if (scenario !== "active-edit") return baseCode;
  // same edit shape as the thesis benchmark (scripts/benchmark-analysis-cache.mjs)
  return `${baseCode}\n\nexport function __cogicBenchmarkVariant${iteration}() {\n  const value${iteration} = ${iteration};\n  return value${iteration} + 1;\n}\n`;
}

function edgeKinds(edges) {
  const k = {};
  for (const e of edges) k[e.kind] = (k[e.kind] || 0) + 1;
  return k;
}

const samples = [];
const total = scenario === "cold-start" ? 1 : warmup + runs;
for (let i = 0; i < total; i++) {
  if (scenario === "warm-cleared") { clearAnalyzerCaches(); resultCache.clear(); }
  const code = codeFor(i);
  let sfHit = 0, sfMiss = 0;
  const debug = (ev) => { if (ev === "analyzer.sourceFileCache.hit") sfHit++; else if (ev === "analyzer.sourceFileCache.miss") sfMiss++; };
  const tReq = performance.now();
  let key = null, result = null, resultHit = false;
  if (cacheOn) { key = cacheKey(code); result = cacheGet(key); resultHit = !!result; }
  const tKey = performance.now();
  if (!result) {
    result = analyzeWorkspaceActive({
      active: { code, fileName: target.activeFile, languageId: "typescript" },
      workspaceRoot: target.root,
      filePaths: target.filePaths,
      debug,
      cacheEnabled: cacheOn,
    });
    if (key) cacheSet(key, result);
  }
  const tAnalyzed = performance.now();
  const g1 = result.graph || { nodes: [], edges: [] };
  const g0 = pruneGraphToFile(g1, target.activeFile);
  const tPruned = performance.now();
  const payload = JSON.stringify({ graph: g0, imports: result.imports, exports: result.exports, calls: result.calls, diagnostics: result.diagnostics, meta: result.meta });
  const tSerialized = performance.now();
  if (i >= total - (scenario === "cold-start" ? 1 : runs)) {
    samples.push({
      iteration: i,
      cacheLookupMs: tKey - tReq,
      analysisMs: tAnalyzed - tKey,
      pruneMs: tPruned - tAnalyzed,
      serializeMs: tSerialized - tPruned,
      extensionSideMs: tSerialized - tReq,
      resultCacheHit: resultHit,
      sourceFileCacheHits: sfHit,
      sourceFileCacheMisses: sfMiss,
      depth0: { nodes: g0.nodes.length, edges: g0.edges.length, edgeKinds: edgeKinds(g0.edges) },
      depth1: { nodes: g1.nodes.length, edges: g1.edges.length, edgeKinds: edgeKinds(g1.edges) },
      payloadBytes: Buffer.byteLength(payload),
      graphHash: hashText(JSON.stringify({ n: g1.nodes.map((n) => n.id).sort(), e: g1.edges.map((e) => `${e.source}>${e.target}:${e.kind}`).sort() })),
    });
  }
}
const out = {
  target: target.id, fileCount: target.filePaths.length, cacheMode, scenario, warmup: scenario === "cold-start" ? 0 : warmup,
  moduleLoadMs,
  spawnToDoneMs: t0Process ? Date.now() - t0Process : null,
  pid: process.pid, node: process.version,
  samples,
};
process.stdout.write(JSON.stringify(out));
