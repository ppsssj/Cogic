// P12-B: summarize data/runs/*.json into data/summary-runs.csv and data/summary.json.
"use strict";
const fs = require("node:fs"), path = require("node:path");
const dir = path.join(__dirname, "..", "data"), runsDir = path.join(dir, "runs");
const median = (xs) => { const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b); if (!s.length) return null; return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const r1 = (x) => (typeof x === "number" ? Math.round(x * 10) / 10 : x);
const rows = [];
for (const f of fs.readdirSync(runsDir).filter((x) => x.endsWith(".json")).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(runsDir, f), "utf8"));
  const name = f.replace(/(\.skipped)?\.json$/, ""), [project, depthTag, condition] = name.split("-");
  if (d.status === "skipped" && !d.meta) { rows.push({ name, project, depth: Number(depthTag.slice(1)), condition, status: "skipped", error: d.reason }); continue; }
  rows.push({
    name, project, depth: d.meta.depth, condition, status: d.status, error: d.error ?? "",
    impl: d.meta.impl, cogicRevision: d.meta.cogicRevision.slice(0, 7), maxOldSpaceSizeMB: d.meta.maxOldSpaceSizeMB, v8HeapSizeLimitMB: d.meta.v8HeapSizeLimitMB,
    freeMBAtStart: d.meta.freeMBAtStart, minFreeMBSeen: d.minFreeMBSeen, totalMs: r1(d.totalMs), programs: d.programsCreated,
    createProgramMs: r1(d.createProgramMsTotal), firstProgramMs: r1(d.firstProgramMs), expansionProgramMedianMs: r1(d.expansionProgramMedianMs),
    structureReuse: Object.entries(d.structureReuse ?? {}).map(([k, v]) => `${k}:${v}`).join(" "), reusedSourceFiles: d.reusedSourceFilesTotal,
    sessionFallbacks: (d.sessionFallbacks ?? []).length, cacheHit: d.cacheEvents?.hit ?? 0, cacheMiss: d.cacheEvents?.miss ?? 0, cacheSkipFull: d.cacheEvents?.skipFull ?? 0,
    nodes: d.nodes, edges: d.edges, graphHashNormalized: d.graphHashNormalized?.slice(0, 16), peakRSSMB: r1(d.peakRSSMB),
  });
}
const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
fs.writeFileSync(path.join(dir, "summary-runs.csv"), [cols.join(","), ...rows.map((r) => cols.map((c) => { const v = r[c] ?? ""; return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v; }).join(","))].join("\n") + "\n");
const groups = {};
for (const r of rows.filter((x) => x.status === "completed")) (groups[`${r.project}|D${r.depth}`] ??= {})[r.condition] = [...((groups[`${r.project}|D${r.depth}`] ?? {})[r.condition] ?? []), r];
const comparisons = Object.entries(groups).map(([key, byCond]) => {
  const stat = (c) => byCond[c] && { n: byCond[c].length, totalMs: byCond[c].map((r) => r.totalMs), medianTotalMs: r1(median(byCond[c].map((r) => r.totalMs))), medianCreateProgramMs: r1(median(byCond[c].map((r) => r.createProgramMs))), programs: byCond[c][0].programs, structureReuse: byCond[c][0].structureReuse, peakRSSMB: byCond[c].map((r) => r.peakRSSMB), nodes: byCond[c][0].nodes, edges: byCond[c][0].edges, hashes: [...new Set(byCond[c].map((r) => r.graphHashNormalized))] };
  const base = stat("base"), off = stat("off"), on = stat("on");
  const allHashes = [...new Set(Object.values(byCond).flat().map((r) => r.graphHashNormalized))];
  return { key, base, off, on, graphIdenticalAcrossConditions: allHashes.length === 1, hashes: allHashes, speedupOnVsBase: base && on ? r1(base.medianTotalMs / on.medianTotalMs) : null, reductionOnVsBasePct: base && on ? r1((1 - on.medianTotalMs / base.medianTotalMs) * 100) : null };
});
fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ generatedBy: "p12b/tools/summarize-p12b.cjs", comparisons }, null, 2));
console.table(comparisons.map((c) => ({ key: c.key, base: c.base?.medianTotalMs, off: c.off?.medianTotalMs, on: c.on?.medianTotalMs, nBase: c.base?.n, nOn: c.on?.n, speedup: c.speedupOnVsBase, reductionPct: c.reductionOnVsBasePct, programMsOn: c.on?.medianCreateProgramMs, programMsOff: c.off?.medianCreateProgramMs, reuse: c.on?.structureReuse, identical: c.graphIdenticalAcrossConditions, rssBase: c.base?.peakRSSMB.join("/"), rssOn: c.on?.peakRSSMB.join("/") })));
const skipped = rows.filter((r) => r.status !== "completed");
if (skipped.length) console.log("not completed:", skipped.map((r) => `${r.name}:${r.status}:${r.error}`).join(", "));
