// P12-B: measure the *product* Depth path without patching compiled code.
//
// --cogic <checkout>   Cogic checkout whose compiled out/analyzer is loaded unmodified.
//   * P12-B build (exports analyzeWorkspaceDepth): runs the same function the Code Graph panel runs
//     (src/analyzer/depth.ts), with --session 1|0 mapped to `programSession`. Program creation time, TypeScript
//     structure reuse and reused SourceFile counts come from the product's own `analyzer.program.created` debug event.
//   * Baseline build (P12-A, no analyzeWorkspaceDepth): runs the P12-A replica of CodeGraphPanel.analyzeWorkspaceDepth
//     (identical to profile-depth-v2.cjs with --instrument 0). No per-Program timing is available there.
// Graph hashes: `graphHashRaw` is SHA-256 of the serialized graph; `graphHashNormalized` first replaces the Cogic
// checkout root and the process cwd by <cogic> (both hold the same node_modules here: the baseline worktree's
// node_modules is a junction to the main checkout's, and runs use the main checkout as cwd), and the project root by
// <project>, so builds in different checkouts compare.
"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto"), cp = require("node:child_process"), v8 = require("node:v8");
const opts = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, xs) => { if (i % 2 === 0) a.push([x.replace(/^--/, ""), xs[i + 1]]); return a; }, []));
if (!opts.cogic || !opts.root || !opts.file || !opts.out || !["0", "1", "2"].includes(opts.depth)) {
  throw Error("--cogic <checkout> --root <project> --file <relative> --depth 0|1|2 --out <new.json> [--session 1|0] [--cache cold|off] [--dump-graph <file>] [--min-free-mb 400]");
}
if (fs.existsSync(opts.out)) throw Error("Output already exists");
const cogic = path.resolve(opts.cogic), root = path.resolve(opts.root), file = path.resolve(root, opts.file);
const depth = Number(opts.depth), session = opts.session !== "0", cache = opts.cache ?? "cold", minFree = Number(opts["min-free-mb"] ?? 400);
const git = (dir, ...a) => cp.execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const repoForTools = path.resolve(__dirname, "../../../../..");
const { listFiles } = require(path.join(repoForTools, "docs/thesis-experiments/p11-real-world/tools/analyzer/list-files.cjs"));
const listing = listFiles(root), norm = (x) => path.resolve(x).replace(/\\/g, "/").toLowerCase(), roots = new Set(listing.files.map(norm));
const analyzer = require(path.join(cogic, "out/analyzer/index.js"));
const impl = typeof analyzer.analyzeWorkspaceDepth === "function" ? "product-analyzeWorkspaceDepth" : "baseline-replica";
if (impl === "baseline-replica" && opts.session === "1") throw Error("--session 1 needs a P12-B build");
const oldSpaceArg = process.execArgv.find((a) => a.startsWith("--max-old-space-size="));
const mb = (x) => Math.round((x / 1048576) * 10) / 10;
const meta = {
  tool: "p12b/profile-depth-product", impl, cogicRevision: git(cogic, "rev-parse", "HEAD"), cogicDirty: git(cogic, "status", "--porcelain", "--", "src").length > 0,
  projectRevision: git(root, "rev-parse", "HEAD"), project: path.basename(root), activeFile: path.relative(root, file).replace(/\\/g, "/"),
  depth, cache, programSession: impl === "baseline-replica" ? null : session, node: process.version, typescript: require(path.join(cogic, "node_modules/typescript/package.json")).version,
  maxOldSpaceSizeMB: oldSpaceArg ? Number(oldSpaceArg.split("=")[1]) : null, v8HeapSizeLimitMB: mb(v8.getHeapStatistics().heap_size_limit),
  fileCount: listing.files.length, freeMBAtStart: Math.round(os.freemem() / 1048576), totalMB: Math.round(os.totalmem() / 1048576), platform: process.platform,
};
if (os.freemem() / 1048576 < minFree) { fs.writeFileSync(opts.out, JSON.stringify({ meta, status: "skipped", error: `LOW_MEMORY_AT_START:${meta.freeMBAtStart}MB` }, null, 2)); console.error("low memory at start"); process.exit(1); }

const programs = [], cacheEvents = {}, sessionFallbacks = [], memory = [];
let minFreeSeen = Infinity, aborted = null;
function sample(tag) { const m = process.memoryUsage(), free = Math.round(os.freemem() / 1048576); minFreeSeen = Math.min(minFreeSeen, free); memory.push({ tag, rssMB: mb(m.rss), heapUsedMB: mb(m.heapUsed), freeMB: free }); if (free < minFree && !aborted) aborted = `ABORT_LOW_MEMORY:${free}MB`; }
const debug = (event, detail) => {
  if (event === "analyzer.program.created") { programs.push({ ...detail, activeFile: path.relative(root, detail.activeFile).replace(/\\/g, "/") }); sample(`program:${programs.length}`); }
  else if (event === "analyzer.session.fallback") sessionFallbacks.push(detail);
  else if (event.startsWith("analyzer.sourceFileCache.")) { const k = event.slice(25); cacheEvents[k] = (cacheEvents[k] || 0) + 1; }
};
const readFile = async (f) => { if (aborted) throw Error(aborted); return fs.promises.readFile(f, "utf8"); };
const languageId = (f) => (f.endsWith(".tsx") ? "typescriptreact" : f.endsWith(".ts") ? "typescript" : f.endsWith(".jsx") ? "javascriptreact" : f.endsWith(".js") ? "javascript" : "typescript");

// P12-A replica of CodeGraphPanel.analyzeWorkspaceWithDepth (Generate path: traceMode off), for builds without depth.ts.
async function baselineReplica(code) {
  const seen = new Set([norm(file)]), analyses = [];
  const analyze = (f, text) => { const s = performance.now(); const r = analyzer.analyzeWorkspaceActive({ active: { code: text, fileName: f, languageId: languageId(f) }, workspaceRoot: root, filePaths: listing.files, cacheEnabled: cache !== "off", debug }); analyses.push({ file: path.relative(root, f).replace(/\\/g, "/"), ms: performance.now() - s }); sample(`analysis:${analyses.length}`); return r; };
  const base = analyze(file, code); let graph = base.graph;
  const frontier = []; for (const n of graph.nodes) if (n.kind === "external" && !seen.has(norm(n.file)) && roots.has(norm(n.file)) && !norm(n.file).endsWith(".d.ts") && !frontier.includes(n.file)) frontier.push(n.file);
  if (depth === 0) { const ns = graph.nodes.filter((n) => norm(n.file) === norm(file)), ids = new Set(ns.map((n) => n.id)); graph = { nodes: ns, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) }; }
  if (depth === 2) for (const t of frontier) { seen.add(norm(t)); try { const r = analyze(t, await readFile(t)); const ns = new Map(graph.nodes.map((n) => [String(n.id), n])); for (const n of r.graph.nodes) ns.set(String(n.id), n); const es = new Map(graph.edges.map((e) => [String(e.id), e])); for (const e of r.graph.edges) es.set(String(e.id), e); graph = { nodes: [...ns.values()], edges: [...es.values()] }; } catch { /* panel ignores unreadable targets */ } }
  return { graph, analyses, frontierCount: frontier.length };
}

(async () => {
  const code = fs.readFileSync(file, "utf8");
  analyzer.clearAnalyzerCaches();
  sample("start");
  const cpu0 = process.cpuUsage(), t0 = performance.now();
  let graph, extra = {};
  if (impl === "baseline-replica") { const r = await baselineReplica(code); graph = r.graph; extra = { analyses: r.analyses, frontierCount: r.frontierCount }; }
  else {
    const r = await analyzer.analyzeWorkspaceDepth({ code, fileName: file, languageId: languageId(file), traceMode: false, graphDepth: depth, traceScope: "current-depth", workspaceRoot: root, filePaths: listing.files, cacheEnabled: cache !== "off", readFile, debug, programSession: session });
    graph = r.graph;
  }
  const totalMs = performance.now() - t0, cpu = process.cpuUsage(cpu0);
  sample("end");
  const raw = JSON.stringify(graph);
  const placeholders = [[cogic, "<cogic>"], [process.cwd(), "<cogic>"], [root, "<project>"]].map(([p, t]) => [path.resolve(p).replace(/\\/g, "/"), t]).sort((a, b) => b[0].length - a[0].length);
  let normalized = raw; for (const [p, t] of placeholders) normalized = normalized.split(p).join(t);
  if (opts["dump-graph"]) fs.writeFileSync(opts["dump-graph"], normalized);
  const created = programs.filter(Boolean), expansions = created.slice(1);
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
  const record = {
    status: aborted ? "aborted" : "completed", error: aborted, totalMs, cpuMs: { user: cpu.user / 1000, system: cpu.system / 1000 },
    nodes: graph.nodes.length, edges: graph.edges.length,
    graphHashRaw: crypto.createHash("sha256").update(raw).digest("hex"), graphHashNormalized: crypto.createHash("sha256").update(normalized).digest("hex"),
    programsCreated: impl === "baseline-replica" ? (extra.analyses?.length ?? null) : created.length,
    programTimingSource: impl === "baseline-replica" ? "unavailable (baseline build has no program event)" : "product debug event analyzer.program.created",
    createProgramMsTotal: impl === "baseline-replica" ? null : created.reduce((a, p) => a + p.createProgramMs, 0),
    firstProgramMs: created[0]?.createProgramMs ?? null, expansionProgramMedianMs: median(expansions.map((p) => p.createProgramMs)),
    structureReuse: expansions.reduce((a, p) => ((a[p.structureReuse] = (a[p.structureReuse] || 0) + 1), a), {}),
    reusedSourceFilesTotal: created.reduce((a, p) => a + (p.reusedSourceFiles || 0), 0), sessionFallbacks,
    cacheEvents, peakRSSMB: process.resourceUsage().maxRSS / 1024, minFreeMBSeen: minFreeSeen,
    programs: created, memory, ...extra,
  };
  fs.writeFileSync(opts.out, JSON.stringify({ meta, ...record }, null, 2));
  console.log(JSON.stringify({ impl, project: meta.project, depth, session: meta.programSession, status: record.status, totalMs: Math.round(totalMs), programs: record.programsCreated, programMs: record.createProgramMsTotal && Math.round(record.createProgramMsTotal), reuse: record.structureReuse, nodes: record.nodes, edges: record.edges, hashN: record.graphHashNormalized.slice(0, 12), peakRSSMB: Math.round(record.peakRSSMB), minFree: minFreeSeen }));
  if (aborted) process.exitCode = 1;
})().catch((e) => { fs.writeFileSync(opts.out, JSON.stringify({ meta, status: "failed", error: String(e && e.stack || e) }, null, 2)); console.error(e); process.exitCode = 1; });
