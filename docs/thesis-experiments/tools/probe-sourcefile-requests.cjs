// P0 thesis instrumentation probe (NOT a performance measurement; no timings are recorded).
//
// Runs the compiled analyzer (out/analyzer) twice on the Cogic repository with
// src/panel/CodeGraphPanel.ts as the active file (SourceFile cache enabled), and reports:
//   - how many disk SourceFiles are requested per analysis,
//   - which categories they belong to (workspace / typescript lib / @types / other node_modules),
//   - whether the request order is identical across consecutive analyses.
// These facts are prerequisites for interpreting the SourceFile cache benchmark (EXP-02/03).
//
// Usage (from repository root, after `npm run compile`):
//   node docs/thesis-experiments/tools/probe-sourcefile-requests.cjs . > out.json
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

const root = path.resolve(process.argv[2] || ".");
const { analyzeWorkspaceActive, clearAnalyzerCaches } = require(path.join(root, "out", "analyzer"));

const activeFile = path.join(root, "src", "panel", "CodeGraphPanel.ts");
const code = fs.readFileSync(activeFile, "utf8");
const REQUEST_EVENTS = new Set([
  "analyzer.sourceFileCache.hit",
  "analyzer.sourceFileCache.miss",
  "analyzer.sourceFileCache.stale",
]);

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function run() {
  const events = [];
  const result = analyzeWorkspaceActive({
    active: { code, fileName: activeFile, languageId: "typescript" },
    workspaceRoot: root,
    filePaths: [activeFile],
    cacheEnabled: true,
    debug: (event, detail) => events.push({ event, file: detail && detail.filePath }),
  });
  return { events, result };
}

function categorize(filePath) {
  const n = String(filePath).replace(/\\/g, "/");
  if (n.includes("/node_modules/typescript/lib/")) return "typescript-lib";
  if (n.includes("/node_modules/@types/")) return "@types/" + n.split("/node_modules/@types/")[1].split("/")[0];
  if (n.includes("/node_modules/")) return "node_modules/" + n.split("/node_modules/").pop().split("/")[0];
  return "workspace";
}

const count = (events, name) => events.filter((e) => e.event === name).length;

clearAnalyzerCaches();
const first = run();
const second = run();
clearAnalyzerCaches();

const requests1 = first.events.filter((e) => REQUEST_EVENTS.has(e.event)).map((e) => e.file);
const requests2 = second.events.filter((e) => REQUEST_EVENTS.has(e.event)).map((e) => e.file);
const composition = {};
for (const file of requests1) {
  const key = categorize(file);
  composition[key] = (composition[key] || 0) + 1;
}

const status = git(["status", "--porcelain"]);
console.log(JSON.stringify({
  kind: "P0 instrumentation probe (counts only, no timing)",
  recordedAt: new Date().toISOString(),
  git: { head: git(["rev-parse", "HEAD"]), dirty: status === null ? null : status.length > 0 },
  environment: {
    node: process.version,
    typescript: require(path.join(root, "node_modules", "typescript", "package.json")).version,
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0] && os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  },
  activeFile: path.relative(root, activeFile).replace(/\\/g, "/"),
  meta: { ...first.result.meta, projectRoot: undefined },
  analysis1: {
    requests: requests1.length,
    uniqueFiles: new Set(requests1).size,
    miss: count(first.events, "analyzer.sourceFileCache.miss"),
    hit: count(first.events, "analyzer.sourceFileCache.hit"),
    stale: count(first.events, "analyzer.sourceFileCache.stale"),
    bypass: count(first.events, "analyzer.sourceFileCache.bypass"),
  },
  analysis2: {
    requests: requests2.length,
    miss: count(second.events, "analyzer.sourceFileCache.miss"),
    hit: count(second.events, "analyzer.sourceFileCache.hit"),
  },
  sameRequestOrderAcrossAnalyses:
    requests1.length === requests2.length && requests1.every((file, i) => file === requests2[i]),
  compositionOfAnalysis1: composition,
  graphCounts: {
    nodes: first.result.graph.nodes.length,
    edges: first.result.graph.edges.length,
    callsListEntries: first.result.calls.length,
  },
}, null, 2));
