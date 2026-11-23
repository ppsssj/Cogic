// P12-A: build data/summary-runs.csv and data/summary.json from the pilot (v1) and v2 run files.
// Usage: node tools/summarize.cjs   (overwrites only the two summary files)
"use strict";
const fs = require("node:fs"), path = require("node:path");
const dataDir = path.join(__dirname, "..", "data");
const files = [
  ...fs.readdirSync(dataDir).filter((f) => f.endsWith(".json") && f.startsWith("pilot-")).map((f) => ({ group: "pilot-v1-tool", file: f, full: path.join(dataDir, f) })),
  ...fs.readdirSync(path.join(dataDir, "v2")).filter((f) => f.endsWith(".json")).map((f) => ({ group: "v2", file: "v2/" + f, full: path.join(dataDir, "v2", f) })),
];
const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const rows = [];
for (const { group, file, full } of files) {
  const d = JSON.parse(fs.readFileSync(full, "utf8")), m = d.meta, rec = d.records.find((r) => r.label === "measured");
  const progs = rec ? rec.programs : (d.partial?.programs ?? []);
  const created = progs.filter((p) => !p.reused), expansions = created.slice(1);
  const cb = (name, sel) => sum(sel, (p) => p.hostCallbacks?.[name]?.ms);
  rows.push({
    group, file, project: m.project, activeFile: m.activeFile, depth: m.depth, cache: m.cache, instrumented: m.instrumented,
    mode: m.shareMode ?? (m.shareProgram ? "checker" : "none"), status: d.status, error: d.error ?? "", heapLimitMB: m.maxOldSpaceMB ?? "", freeMBAtStart: m.freeMBAtStart ?? "",
    totalMs: r1(rec?.totalMs), frontier: rec?.frontierCount ?? d.partial?.frontierCount ?? "", expanded: rec?.expandedFileCount ?? "",
    analyses: rec ? rec.analyses.length : (d.partial?.analyses?.length ?? ""), programsCreated: created.length, programsReused: progs.length - created.length,
    createProgramMs: r1(sum(created, (p) => p.createProgramMs)), firstProgramMs: r1(created[0]?.createProgramMs),
    expansionProgramMedianMs: r1(median(expansions.map((p) => p.createProgramMs))),
    expansionHostGetSourceFileMs: r1(cb("getSourceFile", expansions)),
    expansionHostResolutionIoMs: r1(cb("directoryExists", expansions) + cb("fileExists", expansions) + cb("readFile", expansions) + cb("realpath", expansions) + cb("getDirectories", expansions)),
    expansionTsInternalMs: r1(sum(expansions, (p) => p.tsInternalMs)),
    structureReuse: [...new Set(expansions.map((p) => p.structureReuse).filter((x) => x !== undefined && x !== null))].join("|"),
    checkerAcquisitionMs: r1(d.totals?.checkerAcquisition?.ms), extractCallsMs: r1(d.totals?.extractCalls?.ms), diagnosticsMs: r1(d.totals?.diagnostics?.ms), graphExtractionMs: r1(d.totals?.graphExtraction?.ms),
    mergeCount: rec?.merges?.length ?? "", mergeMs: r1(rec ? sum(rec.merges, (x) => x.ms) : null), serializationMs: r1(rec?.serializationMs),
    nodes: rec?.nodeCount ?? "", edges: rec?.edgeCount ?? "", graphHash: rec?.graphHash?.slice(0, 16) ?? "",
    cacheHit: rec?.cacheEvents?.hit ?? "", cacheMiss: rec?.cacheEvents?.miss ?? "", cacheSkipFull: rec?.cacheEvents?.skipFull ?? "", cacheEvict: rec?.cacheEvents?.evict ?? "",
    peakRSSMB: r1(rec?.peakRSSMB), heapSampleMaxMB: r1(rec?.heapSampleMaxMB), rssSampleMaxMB: r1(rec?.rssSampleMaxMB ?? null),
  });
}
const cols = Object.keys(rows[0]);
const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => { const v = r[c] ?? ""; return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v; }).join(","))].join("\n") + "\n";
fs.writeFileSync(path.join(dataDir, "summary-runs.csv"), csv);
// Condition summary (completed runs only).
const groups = {};
for (const r of rows.filter((x) => x.status === "completed" && x.group === "v2")) {
  const k = `${r.project}|D${r.depth}|${r.mode}|${r.instrumented ? "instr" : "uninstr"}`;
  (groups[k] ??= []).push(r);
}
const conditions = Object.entries(groups).map(([k, rs]) => ({ condition: k, n: rs.length, totalMs: rs.map((r) => r.totalMs), medianTotalMs: r1(median(rs.map((r) => r.totalMs))), programsCreated: rs[0].programsCreated, medianCreateProgramMs: r1(median(rs.map((r) => r.createProgramMs))), nodes: rs[0].nodes, edges: rs[0].edges, graphHashes: [...new Set(rs.map((r) => r.graphHash))], peakRSSMB: rs.map((r) => r.peakRSSMB) }));
fs.writeFileSync(path.join(dataDir, "summary.json"), JSON.stringify({ generatedBy: "tools/summarize.cjs", conditions }, null, 2));
console.table(conditions.map((c) => ({ condition: c.condition, n: c.n, medianTotalMs: c.medianTotalMs, programs: c.programsCreated, medianCreateProgramMs: c.medianCreateProgramMs, nodes: c.nodes, edges: c.edges, hashes: c.graphHashes.join(" "), peakRSS: c.peakRSSMB.join("/") })));
