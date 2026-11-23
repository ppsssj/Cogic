// P11 real-world benchmark worker (derived from P9 worker-p9.cjs; P9 file unchanged).
// One process = one (project, condition, scenario) block.
// Panel-equivalent steps mirror src/panel/CodeGraphPanel.ts @ v0.0.6 at Depth 1 (graph = base result, no pruning):
//   [cache ON] result-cache key/lookup -> analyzeWorkspaceActive -> payload JSON serialisation.
// Invalidation mirrors the panel: a document change/save clears the result cache and invalidates that file's
// SourceFile entry (invalidateCachesForFiles). It happens before the request and is timed separately.
// Not in this process: 350 ms debounce, VS Code findFiles, postMessage, webview layout/paint (UI harness).
"use strict";
const { performance } = require("node:perf_hooks");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const tModStart = performance.now();
const VARIANT = process.env.P11_VARIANT_DIR;
const A = require(path.join(VARIANT, "out", "analyzer"));
const moduleLoadMs = performance.now() - tModStart;

const [targetJson, cacheMode, scenario, warmupStr, runsStr, snapDir] = process.argv.slice(2);
const target = JSON.parse(fs.readFileSync(targetJson, "utf8"));
const cacheOn = cacheMode === "on";
const coldStart = scenario === "cold-start";
const warmup = coldStart ? 0 : Number(warmupStr);
const runs = coldStart ? 1 : Number(runsStr);
const total = warmup + runs;
const RESULT_CACHE_LIMIT = 40; // MAX_ANALYSIS_RESULT_CACHE_ENTRIES in CodeGraphPanel.ts
const GRAPH_DEPTH = 1;

const norm = (p) => p.replace(/\\/g, "/").toLowerCase();
const sha1 = (t) => crypto.createHash("sha1").update(t).digest("hex");
const clone = (r) => JSON.parse(JSON.stringify(r));
const langOf = (f) => ({ ".ts": "typescript", ".tsx": "typescriptreact", ".js": "javascript", ".jsx": "javascriptreact" })[path.extname(f).toLowerCase()] || "typescript";
const filesHash = sha1(target.filePaths.map(norm).sort().join("\n"));

function cacheKey(file, code) {
  return JSON.stringify({ version: 1, fileName: norm(file), languageId: langOf(file), codeHash: sha1(code), graphDepth: GRAPH_DEPTH, traceMode: false, traceScope: "single-file", workspaceRoot: norm(target.root), workspaceFilesHash: filesHash });
}
const resultCache = new Map();
function cacheGet(key) { const e = resultCache.get(key); if (!e) return null; e.lastAccessedAt = Date.now(); return clone(e.result); }
function cacheSet(key, result) {
  resultCache.set(key, { result: clone(result), lastAccessedAt: Date.now() });
  if (resultCache.size <= RESULT_CACHE_LIMIT) return;
  const sorted = [...resultCache.entries()].sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
  for (const [k] of sorted.slice(0, resultCache.size - RESULT_CACHE_LIMIT)) resultCache.delete(k);
}
function invalidate(files) { resultCache.clear(); A.invalidateAnalyzerFileCaches(files); }

// Canonical JSON: object keys sorted; array order kept (strict). Pre-registered exclusions: none needed —
// v0.0.6 results carry no timestamps/durations (meta = mode, rootFiles, usedTsconfig, projectRoot).
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function hashes(result) {
  const g = result.graph || { nodes: [], edges: [] };
  return {
    strict: sha1(canon(result)),
    graphSet: sha1(canon({ n: [...g.nodes].sort(byId), e: [...g.edges].sort(byId) })),
    ids: sha1(JSON.stringify({ n: g.nodes.map((n) => n.id).sort(), e: g.edges.map((e) => `${e.source}>${e.target}:${e.kind}`).sort() })),
    parts: Object.fromEntries(["imports", "exports", "calls", "diagnostics", "trace", "meta"].map((k) => [k, sha1(canon(result[k] ?? null))])),
  };
}
const hist = (arr, k) => { const h = {}; for (const x of arr) h[x[k]] = (h[x[k]] || 0) + 1; return h; };
const mem = () => { const m = process.memoryUsage(); return { heapUsedMB: m.heapUsed / 1048576, heapTotalMB: m.heapTotal / 1048576, rssMB: m.rss / 1048576, externalMB: m.external / 1048576 }; };

const appendFn = (code, i, tag) => `${code}\n\nexport function __cogicP11${tag}${i}(input${i}: number): number {\n  const doubled${i} = input${i} * 2;\n  return doubled${i} + ${i};\n}\n`;
const activeBase = fs.readFileSync(target.activeFile, "utf8");
const crossBase = target.crossFile ? fs.readFileSync(target.crossFile) : null;

function request(i) {
  // returns { file, code, invalidateMs }
  const t = performance.now();
  if (scenario === "warm-cleared") { A.clearAnalyzerCaches(); resultCache.clear(); return { file: target.activeFile, code: activeBase, invalidateMs: performance.now() - t }; }
  if (scenario === "active-edit") { invalidate([target.activeFile]); return { file: target.activeFile, code: appendFn(activeBase, i, "Edit"), invalidateMs: performance.now() - t }; }
  if (scenario === "cross-file") {
    fs.writeFileSync(target.crossFile, appendFn(crossBase.toString("utf8"), i, "Dep"));
    invalidate([target.crossFile]);
    return { file: target.activeFile, code: activeBase, invalidateMs: performance.now() - t };
  }
  if (scenario === "file-switch") { const f = target.switchFiles[i]; return { file: f, code: fs.readFileSync(f, "utf8"), invalidateMs: 0 }; }
  return { file: target.activeFile, code: activeBase, invalidateMs: 0 }; // repeated, cold-start
}

const samples = [];
let error = null;
try {
  for (let i = 0; i < total; i++) {
    const req = request(i);
    const c = { hit: 0, miss: 0, evict: 0, skipFull: 0, stale: 0, store: 0 };
    const debug = (ev) => { const k = ev.startsWith("analyzer.sourceFileCache.") ? ev.slice(25) : null; if (k && k in c) c[k]++; };
    const tReq = performance.now();
    let key = null, result = null, resultHit = false;
    if (cacheOn) { key = cacheKey(req.file, req.code); result = cacheGet(key); resultHit = !!result; }
    const tKey = performance.now();
    if (!result) {
      result = A.analyzeWorkspaceActive({ active: { code: req.code, fileName: req.file, languageId: langOf(req.file) }, workspaceRoot: target.root, filePaths: target.filePaths, debug, cacheEnabled: cacheOn });
      if (key) cacheSet(key, result);
    }
    const tAnalyzed = performance.now();
    const g = result.graph || { nodes: [], edges: [] };
    const payload = JSON.stringify({ graph: g, imports: result.imports, exports: result.exports, calls: result.calls, diagnostics: result.diagnostics, meta: result.meta });
    const tSerialized = performance.now();
    if (i >= warmup) {
      const h = hashes(result);
      const stats = A.getAnalyzerCacheStats ? A.getAnalyzerCacheStats() : null; // outside the timed region
      samples.push({
        iteration: i, file: path.relative(target.root, req.file).replace(/\\/g, "/"),
        invalidateMs: req.invalidateMs, cacheLookupMs: tKey - tReq, analysisMs: tAnalyzed - tKey, serializeMs: tSerialized - tAnalyzed, extensionSideMs: tSerialized - tReq,
        resultCacheHit: resultHit, sf: c, programSourceFiles: resultHit ? null : c.hit + c.miss, rootFiles: result.meta?.rootFiles ?? null, usedTsconfig: result.meta?.usedTsconfig ?? null,
        cacheStats: stats, mem: mem(),
        nodes: g.nodes.length, edges: g.edges.length, nodeKinds: hist(g.nodes, "kind"), edgeKinds: hist(g.edges, "kind"), payloadBytes: Buffer.byteLength(payload),
        hash: h,
      });
      if (snapDir && (i === warmup || i === total - 1)) {
        fs.mkdirSync(snapDir, { recursive: true });
        fs.writeFileSync(path.join(snapDir, `${scenario}-${cacheMode}-${path.basename(VARIANT)}-i${i}.json`), canon(result));
      }
    }
  }
} catch (e) { error = String(e && e.stack || e).slice(0, 2000); }
finally { if (crossBase) fs.writeFileSync(target.crossFile, crossBase); } // restore byte-exact

let retained = null;
if (global.gc) {
  global.gc(); global.gc(); const withCache = mem(); const stats = A.getAnalyzerCacheStats ? A.getAnalyzerCacheStats() : null;
  A.clearAnalyzerCaches(); resultCache.clear(); global.gc(); global.gc(); const afterClear = mem();
  retained = { withCache, afterClear, statsBeforeClear: stats, retainedHeapMB: withCache.heapUsedMB - afterClear.heapUsedMB, retainedRssMB: withCache.rssMB - afterClear.rssMB };
}
process.stdout.write(JSON.stringify({ variant: path.basename(VARIANT), target: target.id, cacheMode, scenario, warmup, runs, moduleLoadMs, pid: process.pid, node: process.version, error, retained, samples }));
