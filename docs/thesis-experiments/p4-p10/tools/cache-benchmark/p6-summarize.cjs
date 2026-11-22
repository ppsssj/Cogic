// Summarise P6 non-UI raw.jsonl -> summary.csv, summary.md, sizes.csv, correctness.csv
// Statistics: n, mean, sd (sample), min, p50 (median), p95 (nearest-rank), max. No outlier removal.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
if (!dir) throw new Error("usage: node summarize.cjs <run dir>");
const rows = fs.readFileSync(path.join(dir, "raw.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

function stats(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  const n = a.length;
  if (!n) return { n: 0 };
  const mean = a.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const q = (p) => a[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  const median = n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  return { n, mean, sd, min: a[0], p50: median, p95: q(0.95), max: a[n - 1] };
}
// Seeded bootstrap (mulberry32) for r = 1 - median(ON)/median(OFF), resampling OFF and ON separately (as in thesis EXP-02).
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const med = (a) => { const b = [...a].sort((p, q) => p - q); const n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
function bootstrapReduction(off, on, B = 10000, seed = 20261122) {
  if (off.length < 2 || on.length < 2) return null;
  const rnd = mulberry32(seed);
  const pick = (a) => { const o = new Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[Math.floor(rnd() * a.length)]; return o; };
  const rs = [];
  for (let b = 0; b < B; b++) rs.push(1 - med(pick(on)) / med(pick(off)));
  rs.sort((p, q) => p - q);
  return { lo: rs[Math.floor(0.025 * B)], hi: rs[Math.floor(0.975 * B) - 1], r: 1 - med(on) / med(off) };
}
const f = (x) => (x === undefined || x === null ? "" : Number(x).toFixed(2));

const errors = rows.filter((r) => !r.samples);
const groups = new Map();
for (const r of rows.filter((r) => r.samples)) {
  const k = `${r.target}|${r.scenario}|${r.cacheMode}`;
  if (!groups.has(k)) groups.set(k, { target: r.target, fileCount: r.fileCount, scenario: r.scenario, cacheMode: r.cacheMode, samples: [], procs: [] });
  const g = groups.get(k);
  g.samples.push(...r.samples);
  g.procs.push(r);
}

const metrics = ["analysisMs", "extensionSideMs", "cacheLookupMs", "pruneMs", "serializeMs"];
const out = [];
for (const g of groups.values()) {
  const row = { target: g.target, fileCount: g.fileCount, scenario: g.scenario, cacheMode: g.cacheMode, processes: g.procs.length };
  for (const m of metrics) row[m] = stats(g.samples.map((s) => s[m]));
  if (g.scenario === "cold-start") {
    row.processWallMs = stats(g.procs.map((p) => p.wallMs));
    row.moduleLoadMs = stats(g.procs.map((p) => p.moduleLoadMs));
  }
  row.resultCacheHitRate = g.samples.filter((s) => s.resultCacheHit).length / g.samples.length;
  row.sourceFileHitsMean = g.samples.reduce((a, s) => a + s.sourceFileCacheHits, 0) / g.samples.length;
  row.sourceFileMissesMean = g.samples.reduce((a, s) => a + s.sourceFileCacheMisses, 0) / g.samples.length;
  const s0 = g.samples[0];
  row.depth0 = s0.depth0; row.depth1 = s0.depth1; row.payloadBytes = s0.payloadBytes;
  row.graphHashes = [...new Set(g.samples.map((s) => s.graphHash))];
  out.push(row);
}
const order = ["fixture", "cogic-repo", "synthetic-100", "synthetic-500", "synthetic-1000", "synthetic-2000"];
const scOrder = ["cold-start", "warm-cleared", "repeated", "active-edit"];
out.sort((a, b) => order.indexOf(a.target) - order.indexOf(b.target) || scOrder.indexOf(a.scenario) - scOrder.indexOf(b.scenario) || a.cacheMode.localeCompare(b.cacheMode));
fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ errors: errors.length, rows: out }, null, 2));

const head = ["target", "fileCount", "scenario", "cache", "n", "procs", "analysis_mean", "analysis_sd", "analysis_p50", "analysis_p95", "analysis_min", "analysis_max", "ext_mean", "ext_p50", "ext_p95", "proc_wall_p50", "module_load_p50", "resultHitRate", "sfHitsMean", "sfMissesMean", "d0_nodes", "d0_edges", "d1_nodes", "d1_edges", "payloadBytes", "graphHashes"];
const lines = [head.join(",")];
for (const r of out) {
  lines.push([r.target, r.fileCount, r.scenario, r.cacheMode, r.analysisMs.n, r.processes, f(r.analysisMs.mean), f(r.analysisMs.sd), f(r.analysisMs.p50), f(r.analysisMs.p95), f(r.analysisMs.min), f(r.analysisMs.max),
    f(r.extensionSideMs.mean), f(r.extensionSideMs.p50), f(r.extensionSideMs.p95), f(r.processWallMs?.p50), f(r.moduleLoadMs?.p50), r.resultCacheHitRate.toFixed(2), r.sourceFileHitsMean.toFixed(1), r.sourceFileMissesMean.toFixed(1),
    r.depth0.nodes, r.depth0.edges, r.depth1.nodes, r.depth1.edges, r.payloadBytes, r.graphHashes.join(" ")].join(","));
}
fs.writeFileSync(path.join(dir, "summary.csv"), lines.join("\n") + "\n");

// ON vs OFF comparison (extension-side p50 and mean) and correctness (graph hash equality ON vs OFF)
const md = [];
md.push(`# P6 non-UI summary (${path.basename(dir)})`, "", `Processes with errors: ${errors.length}`, "");
md.push("| Target | Files | Scenario | OFF p50 | ON p50 | Δp50 | Δ% [95% CI] | OFF mean | ON mean | OFF p95 | ON p95 | n(OFF/ON) | Result-hit ON | Graph same |", "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|");
const corr = ["target,scenario,off_hashes,on_hashes,same"];
for (const t of order) for (const sc of scOrder) {
  const off = out.find((r) => r.target === t && r.scenario === sc && r.cacheMode === "off");
  const on = out.find((r) => r.target === t && r.scenario === sc && r.cacheMode === "on");
  if (!off || !on) continue;
  const same = off.graphHashes.join() === on.graphHashes.join();
  corr.push([t, sc, off.graphHashes.join(" "), on.graphHashes.join(" "), same].join(","));
  const d = off.extensionSideMs.p50 - on.extensionSideMs.p50;
  const g = (tt, m) => groups.get(`${tt}|${sc}|${m}`).samples.map((x) => x.extensionSideMs);
  const ci = bootstrapReduction(g(t, "off"), g(t, "on"));
  md.push(`| ${t} | ${off.fileCount} | ${sc} | ${f(off.extensionSideMs.p50)} | ${f(on.extensionSideMs.p50)} | ${f(d)} | ${f((d / off.extensionSideMs.p50) * 100)}${ci ? ` [${f(ci.lo * 100)}, ${f(ci.hi * 100)}]` : ""} | ${f(off.extensionSideMs.mean)} | ${f(on.extensionSideMs.mean)} | ${f(off.extensionSideMs.p95)} | ${f(on.extensionSideMs.p95)} | ${off.extensionSideMs.n}/${on.extensionSideMs.n} | ${on.resultCacheHitRate.toFixed(2)} | ${same ? "yes" : "NO"} |`);
}
md.push("", "Δ = OFF − ON (positive = cache ON faster). Values are extension-side ms (cache lookup + analysis + depth-0 prune + payload JSON).", "");
md.push("## Graph size (cache OFF, warm-cleared)", "", "| Target | Project files | Depth0 nodes | Depth0 edges | Depth1 nodes | Depth1 edges | Depth1 edge kinds | Payload bytes (depth0) |", "|---|---:|---:|---:|---:|---:|---|---:|");
const sizes = ["target,projectFiles,depth0_nodes,depth0_edges,depth1_nodes,depth1_edges,depth1_edgeKinds,payloadBytes"];
for (const t of order) {
  const r = out.find((x) => x.target === t && x.scenario === "warm-cleared" && x.cacheMode === "off");
  if (!r) continue;
  const ek = Object.entries(r.depth1.edgeKinds).map(([k, v]) => `${k}:${v}`).join(" ");
  md.push(`| ${t} | ${r.fileCount} | ${r.depth0.nodes} | ${r.depth0.edges} | ${r.depth1.nodes} | ${r.depth1.edges} | ${ek} | ${r.payloadBytes} |`);
  sizes.push([t, r.fileCount, r.depth0.nodes, r.depth0.edges, r.depth1.nodes, r.depth1.edges, ek, r.payloadBytes].join(","));
}
md.push("", "## Cold start (fresh Node process per sample)", "", "| Target | Cache | n | analysis p50 | analysis p95 | module load p50 | process wall p50 | process wall p95 |", "|---|---|---:|---:|---:|---:|---:|---:|");
for (const r of out.filter((x) => x.scenario === "cold-start")) {
  md.push(`| ${r.target} | ${r.cacheMode} | ${r.analysisMs.n} | ${f(r.analysisMs.p50)} | ${f(r.analysisMs.p95)} | ${f(r.moduleLoadMs.p50)} | ${f(r.processWallMs.p50)} | ${f(r.processWallMs.p95)} |`);
}
fs.writeFileSync(path.join(dir, "summary.md"), md.join("\n") + "\n");
fs.writeFileSync(path.join(dir, "sizes.csv"), sizes.join("\n") + "\n");
fs.writeFileSync(path.join(dir, "correctness.csv"), corr.join("\n") + "\n");
console.log(md.join("\n"));
