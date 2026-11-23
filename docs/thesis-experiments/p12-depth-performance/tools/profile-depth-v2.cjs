// P12-A profiler v2 (Claude Code continuation of Codex's profile-depth.cjs).
// Diagnostic Node reproduction of CodeGraphPanel.analyzeWorkspaceWithDepth (src/panel/CodeGraphPanel.ts), NOT an
// extension-host timer. profile-depth.cjs (v1) is kept unchanged because the pilot data was produced with it.
//
// Additions over v1 (all opt-in or measurement-only; analysis semantics are unchanged unless --share-program 1):
//  * per-Program decomposition of ts.createProgram: time spent inside host callbacks
//    (getSourceFile = SourceFile cache lookup + parse on miss, fileExists/readFile/directoryExists/realpath/getDirectories
//    = mostly module resolution I/O). The remainder is TypeScript-internal CPU (resolution logic, program structure).
//  * process RSS / heapUsed sampled after every analysis (v1 only sampled heapUsed).
//  * --max-expand N: cap the Depth 2 frontier (for CPU-profiling / memory-limited runs; recorded in meta.capped*).
//  * --share-program 1: EXPERIMENT for P12-B candidate 1. Reuses the first ts.Program of a run for every later
//    analyzeWorkspaceActive call whose rootNames/options are identical. Only valid when the analyzed buffers equal the
//    disk contents (true in this Node harness). Used to measure the upper bound of the benefit and to compare graph
//    hashes against the unshared run. It is not product code.
//  * --share-program old: EXPERIMENT for the P12-B candidate "structure reuse + fresh checker". Every analysis still
//    builds its own ts.Program (so it gets a fresh TypeChecker), but passes the previous Program as `oldProgram` so
//    TypeScript can reuse module resolution and program structure (tryReuseStructureFromOldProgram).
//  * --share-program old-sf: like `old`, but non-active files are served from the previous Program, so a SourceFile cache
//    that is smaller than the program (P11 finding) cannot defeat TypeScript's structure reuse.
//  * checker wrapping is idempotent (a shared Program returns the same checker; v1 would double-wrap it).
//  * --instrument 0 skips every patch, giving an uninstrumented baseline for ON/OFF hash comparison.
"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto"), Module = require("node:module"), cp = require("node:child_process");
const opts = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, xs) => { if (i % 2 === 0) a.push([x.replace(/^--/, ""), xs[i + 1]]); return a; }, []));
if (!opts.root || !opts.file || !opts.out || !["0", "1", "2"].includes(opts.depth) || !["off", "cold", "warm"].includes(opts.cache)) {
  throw Error("--root <project> --file <relative> --depth 0|1|2 --cache off|cold|warm --instrument 0|1 --out <new.json> [--share-program 0|1|old|old-sf] [--max-expand N] [--dump-graph <file>] [--min-free-mb 500] [--max-ms 600000]");
}
if (fs.existsSync(opts.out)) throw Error("Output already exists");
const root = path.resolve(opts.root), file = path.resolve(root, opts.file), repo = path.resolve(__dirname, "../../../.."), instrument = opts.instrument === "1";
const shareMode = opts["share-program"] === "1" ? "checker" : opts["share-program"] === "old" ? "oldProgram" : opts["share-program"] === "old-sf" ? "oldProgramSourceFiles" : "none", shareProgram = shareMode !== "none", maxExpand = opts["max-expand"] === undefined ? Infinity : Number(opts["max-expand"]);
if (shareProgram && !instrument) throw Error("--share-program 1 requires --instrument 1 (it is implemented in the createProgram hook)");
if (!file.startsWith(root + path.sep)) throw Error("Active file must be inside root");
const revision = cp.execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const cogicRevision = cp.execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const { listFiles } = require(path.join(repo, "docs/thesis-experiments/p11-real-world/tools/analyzer/list-files.cjs"));
const listing = listFiles(root), norm = (x) => path.resolve(x).replace(/\\/g, "/").toLowerCase(), roots = new Set(listing.files.map(norm));
const rel = (x) => path.relative(root, x).replace(/\\/g, "/");
const now = () => performance.now(), totals = {}, calls = [];
let active = "", heapSampleMax = 0, rssSampleMax = 0, sharedProgram = null, sharedKey = null, lastProgram = null;
const mb = (x) => Math.round((x / 1048576) * 10) / 10;
function sample() { const m = process.memoryUsage(); heapSampleMax = Math.max(heapSampleMax, m.heapUsed); rssSampleMax = Math.max(rssSampleMax, m.rss); return { heapUsedMB: mb(m.heapUsed), rssMB: mb(m.rss) }; }
function measured(name, fn) { const s = now(); try { return fn(); } finally { const t = (totals[name] ??= { count: 0, ms: 0 }); t.count++; t.ms += now() - s; } }
const hostCallbacks = ["getSourceFile", "fileExists", "readFile", "directoryExists", "realpath", "getDirectories"];
function timedHost(host, stats) {
  const copy = { ...host };
  for (const name of hostCallbacks) {
    const fn = host[name];
    if (typeof fn !== "function") continue;
    copy[name] = function (...a) { const s = now(); try { return fn.apply(host, a); } finally { const t = (stats[name] ??= { count: 0, ms: 0 }); t.count++; t.ms += now() - s; } };
  }
  return copy;
}
// Re-checks the bail-out conditions of TypeScript's tryReuseStructureFromOldProgram (5.9) to explain StructureIsReused.Not.
function diagnoseNoReuse(ts, oldProgram, rootNames, options, host) {
  const r = {};
  try { r.changesAffectModuleResolution = ts.changesAffectModuleResolution ? ts.changesAffectModuleResolution(oldProgram.getCompilerOptions(), options) : "n/a"; } catch (e) { r.changesAffectModuleResolution = String(e.message); }
  const oldRoots = oldProgram.getRootFileNames();
  r.rootNamesEqual = oldRoots.length === rootNames.length && oldRoots.every((x, i) => x === rootNames[i]);
  const missing = [...(oldProgram.getMissingFilePaths?.() ?? new Map()).values()];
  const nowExisting = missing.filter((m) => host.fileExists(m));
  r.missingFilePaths = missing.length; r.missingNowExisting = nowExisting.length; r.missingNowExistingSample = nowExisting.slice(0, 3).map((x) => x.replace(/\\/g, "/").split("/").slice(-3).join("/"));
  return r;
}
const apiNames = ["getResolvedSignature", "getSymbolAtLocation", "getAliasedSymbol", "getTypeAtLocation", "getTypeOfSymbolAtLocation"];
const wrappedCheckers = new WeakSet();
globalThis.__p12 = {
  measured,
  createProgram(ts, rootNames, options, host) {
    const key = JSON.stringify([rootNames.map(norm).sort(), options]);
    if (shareMode === "checker" && sharedProgram && key === sharedKey) {
      calls.push({ file: active, roots: rootNames.length, sourceFiles: sharedProgram.getSourceFiles().length, createProgramMs: 0, reused: true });
      return sharedProgram;
    }
    const oldProgram = (shareMode === "oldProgram" || shareMode === "oldProgramSourceFiles") && lastProgram && key === sharedKey ? lastProgram : undefined;
    // old-sf: serve every non-active file from the previous Program (simulates a SourceFile store that holds the whole
    // program, like a LanguageService DocumentRegistry). Valid here because no file changes during a harness run.
    let fromOldProgram = 0, programHost = host;
    if (oldProgram && shareMode === "oldProgramSourceFiles") {
      const activeAbs = norm(path.resolve(root, active));
      programHost = { ...host, getSourceFile(fileName, ...rest) { if (norm(fileName) !== activeAbs) { const old = oldProgram.getSourceFile(fileName); if (old && !old.redirectInfo) { fromOldProgram++; return old; } } return host.getSourceFile(fileName, ...rest); } };
    }
    const hostStats = {}, start = now(), p = ts.createProgram(rootNames, options, timedHost(programHost, hostStats), oldProgram), ms = now() - start;
    const hostMs = Object.values(hostStats).reduce((a, t) => a + t.ms, 0);
    calls.push({ file: active, roots: rootNames.length, sourceFiles: p.getSourceFiles().length, createProgramMs: ms, hostCallbacks: hostStats, hostCallbackMs: hostMs, tsInternalMs: ms - hostMs, reused: false, oldProgramPassed: Boolean(oldProgram), sourceFilesFromOldProgram: fromOldProgram, structureReuse: oldProgram ? p.structureIsReused : null, reuseDiagnosis: oldProgram && p.structureIsReused === 0 ? diagnoseNoReuse(ts, oldProgram, rootNames, options, host) : undefined });
    if (shareMode === "checker") { sharedProgram = p; sharedKey = key; }
    if (shareMode === "oldProgram" || shareMode === "oldProgramSourceFiles") { lastProgram = p; sharedKey = key; }
    return p;
  },
  checker(program) {
    const c = measured("checkerAcquisition", () => program.getTypeChecker());
    if (wrappedCheckers.has(c)) return c;
    wrappedCheckers.add(c);
    for (const name of apiNames) { const fn = c[name]; if (typeof fn === "function") c[name] = function (...a) { return measured(`checker.${name}`, () => fn.apply(c, a)); }; }
    return c;
  },
};
if (instrument) {
  const target = path.join(repo, "out/analyzer/analyze.js"), original = Module._extensions[".js"];
  Module._extensions[".js"] = function (mod, filename) {
    if (path.resolve(filename) !== path.resolve(target)) return original(mod, filename);
    let text = fs.readFileSync(filename, "utf8");
    function replace(old, replacement, expected) { const parts = text.split(old); if (parts.length - 1 !== expected) throw Error(`Instrumentation anchor mismatch: ${old} count=${parts.length - 1}`); text = parts.join(replacement); }
    replace("const program = ts.createProgram(rootNames, options, host);", "const program = globalThis.__p12.createProgram(ts, rootNames, options, host);", 1);
    replace("const checker = program.getTypeChecker();", "const checker = globalThis.__p12.checker(program);", 2);
    replace("const calls = extractCallsResolved(sf, checker, resolveModuleLocation);", "const calls = globalThis.__p12.measured('extractCalls', () => extractCallsResolved(sf, checker, resolveModuleLocation));", 2);
    replace("const diagnostics = collectDiagnostics(program, sf);", "const diagnostics = globalThis.__p12.measured('diagnostics', () => collectDiagnostics(program, sf));", 2);
    replace("const { graph, trace } = buildActiveFileGraph(sf, checker, resolveModuleLocation, adapters);", "const { graph, trace } = globalThis.__p12.measured('graphExtraction', () => buildActiveFileGraph(sf, checker, resolveModuleLocation, adapters));", 2);
    mod._compile(text, filename);
  };
}
const analyzer = require(path.join(repo, "out/analyzer/index.js"));
const cpu0 = process.cpuUsage(), start = now(), maxMs = Number(opts["max-ms"] || 600000), minFree = Number(opts["min-free-mb"] || 500);
const meta = { tool: "profile-depth-v2", cogicRevision, revision, project: path.basename(root), activeFile: rel(file), depth: Number(opts.depth), cache: opts.cache, instrumented: instrument, shareProgram, shareMode, maxExpand: Number.isFinite(maxExpand) ? maxExpand : null, node: process.version, typescript: require("typescript/package.json").version, maxOldSpaceMB: Math.round(require("node:v8").getHeapStatistics().heap_size_limit / 1048576), fileCount: listing.files.length, fileCountTotal: listing.all, capped: listing.capped, freeMBAtStart: Math.round(os.freemem() / 1048576), totalMB: Math.round(os.totalmem() / 1048576) };
const records = []; let currentState = null;
function save(status, extra = {}) { fs.writeFileSync(opts.out, JSON.stringify({ meta, status, records, ...extra }, null, 2)); }
function check() { if (os.freemem() / 1048576 < minFree) throw Error(`ABORT_LOW_MEMORY:${Math.round(os.freemem() / 1048576)}MB`); if (now() - start > maxMs) throw Error("ABORT_TIME_LIMIT"); }
// Same algorithm as mergeGraphPayload in src/panel/CodeGraphPanel.ts.
function merge(prev, next) { const before = { nodes: prev.nodes.length, edges: prev.edges.length }, s = now(); const ns = new Map(prev.nodes.map((n) => [String(n.id), n])); for (const n of next.nodes) ns.set(String(n.id), n); const es = new Map(prev.edges.map((e) => [String(e.id), e])); for (const e of next.edges) es.set(String(e.id), e); const graph = { nodes: [...ns.values()], edges: [...es.values()] }; return { graph, stats: { before, next: { nodes: next.nodes.length, edges: next.edges.length }, after: { nodes: graph.nodes.length, edges: graph.edges.length }, ms: now() - s } }; }
// Same filter as collectDepthExpansionFiles in src/panel/CodeGraphPanel.ts.
function frontier(graph, seen) { const found = new Set(); for (const n of graph.nodes) if (n.kind === "external" && !seen.has(norm(n.file)) && roots.has(norm(n.file)) && !norm(n.file).endsWith(".d.ts")) found.add(n.file); return [...found]; }
function run(label, enabled) {
  const t0 = now(), localEvents = {}, runCalls = [], merges = [], seen = new Set([norm(file)]); const programOffset = calls.length;
  currentState = { label, analyses: runCalls, merges, programs: [], cacheEvents: localEvents, frontierCount: null };
  const debug = (name) => { if (name.startsWith("analyzer.sourceFileCache.")) { const k = name.slice("analyzer.sourceFileCache.".length); localEvents[k] = (localEvents[k] || 0) + 1; } };
  function analyze(f) {
    check(); active = rel(f); const code = fs.readFileSync(f, "utf8"), s = now();
    const r = analyzer.analyzeWorkspaceActive({ active: { code, fileName: f, languageId: f.endsWith(".tsx") ? "typescriptreact" : f.endsWith(".jsx") ? "javascriptreact" : f.endsWith(".js") ? "javascript" : "typescript" }, workspaceRoot: root, filePaths: listing.files, cacheEnabled: enabled, debug });
    runCalls.push({ file: active, ms: now() - s, nodes: r.graph.nodes.length, edges: r.graph.edges.length, cache: analyzer.getAnalyzerCacheStats(), memory: sample() });
    currentState.programs = calls.slice(programOffset);
    save("running", { partial: currentState, elapsedMs: now() - start, freeMB: Math.round(os.freemem() / 1048576) });
    return r;
  }
  const base = analyze(file); let graph = base.graph; const f0 = frontier(graph, seen), frontierCount = f0.length; currentState.frontierCount = frontierCount;
  if (meta.depth === 0) { const ns = graph.nodes.filter((n) => norm(n.file) === norm(file)), ids = new Set(ns.map((n) => n.id)); graph = { nodes: ns, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) }; }
  const targets = meta.depth === 2 ? f0.slice(0, maxExpand) : [];
  for (const target of targets) { check(); seen.add(norm(target)); const r = analyze(target), m = merge(graph, r.graph); graph = m.graph; merges.push({ file: rel(target), ...m.stats }); }
  const serializationStart = now(), serialized = JSON.stringify(graph), serializationMs = now() - serializationStart;
  if (opts["dump-graph"] && label === "measured") fs.writeFileSync(opts["dump-graph"], serialized);
  const programs = calls.slice(programOffset);
  const record = { label, totalMs: now() - t0, frontierCount, expandedFileCount: runCalls.length - 1, frontierCapped: targets.length < (meta.depth === 2 ? frontierCount : 0), analyses: runCalls, programs, programsCreated: programs.filter((p) => !p.reused).length, programsReused: programs.filter((p) => p.reused).length, createProgramMsTotal: programs.reduce((a, p) => a + p.createProgramMs, 0), cacheEvents: localEvents, merges, mergeMsTotal: merges.reduce((a, m) => a + m.ms, 0), serializationMs, nodeCount: graph.nodes.length, edgeCount: graph.edges.length, graphHash: crypto.createHash("sha256").update(serialized).digest("hex"), freeMB: Math.round(os.freemem() / 1048576), heapSampleMaxMB: mb(heapSampleMax), rssSampleMaxMB: mb(rssSampleMax), peakRSSMB: process.resourceUsage().maxRSS / 1024 };
  records.push(record); return record;
}
try {
  analyzer.clearAnalyzerCaches();
  if (opts.cache === "warm") run("warmup", true);
  const result = run("measured", opts.cache !== "off");
  const cpu = process.cpuUsage(cpu0); save("completed", { totals, cpuMs: { user: cpu.user / 1000, system: cpu.system / 1000 }, elapsedMs: now() - start });
  console.log(JSON.stringify({ project: meta.project, depth: meta.depth, instrumented: instrument, shareMode, status: "completed", totalMs: Math.round(result.totalMs), frontier: result.frontierCount, expanded: result.expandedFileCount, programsCreated: result.programsCreated, programMs: Math.round(result.createProgramMsTotal), nodes: result.nodeCount, edges: result.edgeCount, hash: result.graphHash.slice(0, 12), peakRSSMB: Math.round(result.peakRSSMB) }));
} catch (e) {
  // currentState.programs is refreshed after every completed analysis; a Program created by an analysis that was
  // interrupted is reported separately (v1 sliced by analysis count, which could misattribute it).
  if (currentState) currentState.programsCreatedTotal = calls.length;
  save("aborted", { error: e.message, partial: currentState, totals, elapsedMs: now() - start }); console.error(e.message); process.exitCode = 1;
}
