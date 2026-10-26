// P0 thesis audit tool (read-only).
// Cross-checks docs/benchmarks/analysis-cache raw CSV/JSON against results.md/README.md.
// It never writes into the repository; output goes to stdout only.
//
// Usage (from repository root):
//   node docs/thesis-experiments/tools/audit-existing-benchmark.mjs .
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const dir = path.join(root, "docs", "benchmarks", "analysis-cache");
const json = JSON.parse(fs.readFileSync(path.join(dir, "raw", "analysis-cache-results.json"), "utf8"));
const csvText = fs.readFileSync(path.join(dir, "raw", "analysis-cache-results.csv"), "utf8").trim();
const resultsMd = fs.readFileSync(path.join(dir, "results.md"), "utf8");
const readmeMd = fs.readFileSync(path.join(dir, "README.md"), "utf8");

const fmt = (v) => `${v.toFixed(2)} ms`;
const fmtImp = (ms, pct) => `${ms >= 0 ? "" : "-"}${Math.abs(ms).toFixed(2)} ms (${pct.toFixed(1)}%)`;
const issues = [];
const info = [];

// 1. CSV vs JSON
const [header, ...lines] = csvText.split(/\r?\n/);
const cols = header.split(",");
if (lines.length !== json.rows.length) issues.push(`CSV rows ${lines.length} != JSON rows ${json.rows.length}`);
lines.forEach((line, i) => {
  const cells = line.split(","); // no quoted cells expected; verify
  if (cells.length !== cols.length) issues.push(`CSV line ${i + 2} has ${cells.length} cells`);
  const rec = Object.fromEntries(cols.map((c, k) => [c, cells[k]]));
  const row = json.rows[i];
  const expected = {
    targetId: row.targetId, scenarioId: row.scenarioId, cacheMode: row.cacheMode,
    meanMs: row.stats.mean, p50Ms: row.stats.p50, p95Ms: row.stats.p95, minMs: row.stats.min,
    maxMs: row.stats.max, stddevMs: row.stats.standardDeviation,
    sourceFileCacheHits: row.sourceFileCacheHits, sourceFileCacheMisses: row.sourceFileCacheMisses,
    resultCacheHits: row.resultCacheHits, resultCacheMisses: row.resultCacheMisses,
    p50ImprovementPct: row.p50ImprovementPct,
  };
  for (const [k, v] of Object.entries(expected)) {
    if (String(v) !== rec[k]) issues.push(`CSV/JSON mismatch line ${i + 2} ${k}: ${rec[k]} vs ${v}`);
  }
});
info.push(`CSV vs JSON: ${lines.length} rows compared`);

// 2. Internal consistency + recomputed improvements
const byKey = new Map(json.rows.map((r) => [`${r.targetId}|${r.scenarioId}|${r.cacheMode}`, r]));
let mdMatched = 0;
for (const r of json.rows) {
  const s = r.stats;
  if (!(s.min <= s.p50 && s.p50 <= s.p95 && s.p95 <= s.max)) issues.push(`order violated ${r.targetId}/${r.scenarioId}/${r.cacheMode}`);
  if (!(s.min <= s.mean && s.mean <= s.max)) issues.push(`mean out of range ${r.targetId}`);
  if (s.median !== s.p50) issues.push(`median != p50 ${r.targetId}`);
  if (r.runs !== json.benchmark.measuredRuns) issues.push(`runs ${r.runs}`);
  const off = byKey.get(`${r.targetId}|${r.scenarioId}|off`);
  const d = off.stats.p50 - s.p50;
  const pct = (d / off.stats.p50) * 100;
  if (Math.abs(d - r.p50ImprovementMs) > 1e-9 || Math.abs(pct - r.p50ImprovementPct) > 1e-9) issues.push(`improvement mismatch ${r.targetId}/${r.scenarioId}/${r.cacheMode}`);
  // 3. results.md row present with same formatted values
  const mdRow = `| ${r.targetLabel} | ${r.cacheLabel} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.mean)} | ${fmt(s.min)} | ${fmt(s.max)} | ${fmt(s.standardDeviation)} | ${fmtImp(r.p50ImprovementMs, r.p50ImprovementPct)} | ${r.sourceFileCacheHits} | ${r.resultCacheHits} |`;
  if (resultsMd.includes(mdRow)) mdMatched += 1; else issues.push(`results.md row missing/different: ${r.targetId}/${r.scenarioId}/${r.cacheMode}`);
}
info.push(`results.md scenario-table rows matched: ${mdMatched}/${json.rows.length}`);

// 4. Per-run SourceFile request counts (hits+misses)/runs
const perRun = new Map();
for (const r of json.rows.filter((x) => x.cacheMode !== "off")) {
  const total = r.sourceFileCacheHits + r.sourceFileCacheMisses;
  const key = r.targetId;
  const v = total / r.runs;
  if (r.scenarioId === "repeated" && r.cacheMode === "full") continue; // analyzer not invoked on hits
  if (!perRun.has(key)) perRun.set(key, new Set());
  perRun.get(key).add(v);
}
for (const [k, set] of perRun) {
  const repo = json.repositories.find((x) => x.id === k);
  info.push(`SourceFile requests per analysis ${k}: ${[...set].join(",")} (harness fileCount ${repo.fileCount}, diff ${[...set][0] - repo.fileCount})`);
}

// 5. Variability / outliers (CV and max/p50)
const flagged = [];
for (const r of json.rows) {
  const cv = r.stats.standardDeviation / r.stats.mean;
  const tail = r.stats.max / r.stats.p50;
  if (cv > 0.1 || tail > 1.4) flagged.push(`${r.targetId}/${r.scenarioId}/${r.cacheMode}: CV=${(cv * 100).toFixed(1)}% max/p50=${tail.toFixed(2)} (p50 ${fmt(r.stats.p50)}, max ${fmt(r.stats.max)})`);
}
info.push(`High-variability rows (CV>10% or max/p50>1.4): ${flagged.length}`);
flagged.forEach((f) => info.push(`  - ${f}`));

// 6. README headline numbers
const cs = byKey.get("cogic|active-edit|sourcefile");
const cf = byKey.get("cogic|active-edit|full");
const co = byKey.get("cogic|active-edit|off");
info.push(`README headline: OFF ${fmt(co.stats.p50)}, SF ${fmt(cs.stats.p50)} (${cs.p50ImprovementPct.toFixed(1)}%), Full ${fmt(cf.stats.p50)} (${cf.p50ImprovementPct.toFixed(1)}%)`);
if (readmeMd.includes("1.09 s to 0.38 s")) info.push(`README conservative statement says '1.09 s to 0.38 s' while SourceFile-only p50 = ${(cs.stats.p50 / 1000).toFixed(3)} s (0.38 s matches Full result ${(cf.stats.p50 / 1000).toFixed(3)} s)`);

// 7. Same-process ordering: within a target, condition sequence
info.push(`Condition order (per target): scenarios ${json.scenarios.map((s) => s.id).join(" -> ")}, modes ${json.cacheModes.map((m) => m.id).join(" -> ")}`);
info.push(`Duration: ${json.benchmark.startedAt} -> ${json.benchmark.endedAt}`);
info.push(`Per-iteration samples present in raw JSON: ${json.rows.some((r) => Array.isArray(r.samples) || Array.isArray(r.timings)) ? "yes" : "NO (aggregates only)"}`);

console.log("ISSUES:", issues.length ? "\n" + issues.join("\n") : "none");
console.log(info.join("\n"));
