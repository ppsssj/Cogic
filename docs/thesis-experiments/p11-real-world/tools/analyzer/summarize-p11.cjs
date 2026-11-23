// P11 summarizer. node summarize-p11.cjs <outDir> <runDir> [runDir...]
// Reads blocks.jsonl from each run dir. Nothing is excluded: failed/skipped blocks are counted and reported.
"use strict";
const fs = require("node:fs"), path = require("node:path");
const [outDir, ...runs] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const recs = runs.flatMap((d) => fs.readFileSync(path.join(d, "blocks.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => ({ ...JSON.parse(l), run: path.basename(d) })));
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
const r1 = (x) => (x === null || x === undefined || Number.isNaN(x) ? "" : Math.round(x * 10) / 10);
// bootstrap 95% CI of (median B / median A - 1), resampling A and B separately; seed 20261122
let seed = 20261122; const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function bootCI(a, b, n = 10000) {
  if (a.length < 2 || b.length < 2) return [null, null];
  const out = []; const pick = (x) => Array.from(x, () => x[Math.floor(rnd() * x.length)]);
  for (let i = 0; i < n; i++) out.push(med(pick(b)) / med(pick(a)) - 1);
  return [q(out, 0.025), q(out, 0.975)];
}
const projects = [...new Set(recs.map((r) => r.project))];
const scenarios = ["cold-start", "warm-cleared", "repeated", "active-edit", "cross-file", "file-switch"];
const conds = ["off", "fixed800", "adaptive"];
const failures = recs.filter((r) => r.skipped || r.exit !== 0 || r.error || r.parseError).map((r) => ({ project: r.project, scenario: r.scenario, condition: r.condition, block: r.block, run: r.run, skipped: r.skipped || "", exit: r.exit, error: (r.error || r.stderrTail || "").slice(0, 300) }));
const ok = recs.filter((r) => !r.skipped && r.exit === 0 && !r.error && r.samples);

const cell = {}; // project|scenario|cond -> stats
for (const p of projects) for (const s of scenarios) for (const c of conds) {
  const blocks = ok.filter((r) => r.project === p && r.scenario === s && r.condition === c);
  if (!blocks.length) continue;
  const S = blocks.flatMap((b) => b.samples);
  const t = S.map((x) => x.extensionSideMs);
  const sf = S.reduce((a, x) => { for (const k of Object.keys(x.sf)) a[k] = (a[k] || 0) + x.sf[k]; return a; }, {});
  const analyzed = S.filter((x) => !x.resultCacheHit);
  const ret = blocks.map((b) => b.retained).filter(Boolean);
  cell[`${p}|${s}|${c}`] = {
    project: p, scenario: s, condition: c, blocks: blocks.length, n: S.length, t,
    medianMs: med(t), p25: q(t, 0.25), p75: q(t, 0.75), minMs: Math.min(...t), maxMs: Math.max(...t),
    blockMedians: blocks.map((b) => med(b.samples.map((x) => x.extensionSideMs))),
    resultCacheHits: S.filter((x) => x.resultCacheHit).length,
    sf, sfHitRatio: sf.hit + sf.miss ? sf.hit / (sf.hit + sf.miss) : null,
    // SourceFile events are only emitted with the cache enabled, so the Program size is not observable for "off"
    programSourceFiles: c === "off" ? null : med(analyzed.map((x) => x.programSourceFiles).filter((v) => v !== null)),
    rootFiles: med(S.map((x) => x.rootFiles).filter((v) => v !== null)),
    nodes: med(S.map((x) => x.nodes)), edges: med(S.map((x) => x.edges)),
    cacheEntries: med(S.map((x) => x.cacheStats?.entries).filter((v) => v != null)), cacheCapacity: med(S.map((x) => x.cacheStats?.capacity).filter((v) => v != null)),
    cacheCharsM: med(S.map((x) => x.cacheStats?.chars).filter((v) => v != null)) / 1e6,
    heapUsedMB: med(S.map((x) => x.mem.heapUsedMB)), heapTotalMB: med(S.map((x) => x.mem.heapTotalMB)), rssMB: med(S.map((x) => x.mem.rssMB)), rssMaxMB: Math.max(...S.map((x) => x.mem.rssMB)),
    retainedHeapMB: med(ret.map((x) => x.retainedHeapMB)), heapWithCacheMB: med(ret.map((x) => x.withCache.heapUsedMB)), heapAfterClearMB: med(ret.map((x) => x.afterClear.heapUsedMB)), rssWithCacheMB: med(ret.map((x) => x.withCache.rssMB)),
  };
}
// ---- timing table
const hdr = ["project", "scenario", "condition", "blocks", "n", "median_ms", "p25_ms", "p75_ms", "min_ms", "max_ms", "block_medians_ms", "result_cache_hits", "sf_hit", "sf_miss", "sf_evict", "sf_skipFull", "sf_hit_ratio", "program_source_files", "root_files", "nodes", "edges", "cache_entries", "cache_capacity", "cache_chars_M", "heapUsed_MB", "heapTotal_MB", "rss_MB", "rss_max_MB", "retained_heap_MB", "heap_with_cache_MB", "heap_after_clear_MB", "rss_with_cache_MB"];
const lines = [hdr.join(",")];
for (const v of Object.values(cell)) lines.push([v.project, v.scenario, v.condition, v.blocks, v.n, r1(v.medianMs), r1(v.p25), r1(v.p75), r1(v.minMs), r1(v.maxMs), v.blockMedians.map(r1).join("/"), v.resultCacheHits, v.sf.hit || 0, v.sf.miss || 0, v.sf.evict || 0, v.sf.skipFull || 0, v.sfHitRatio === null ? "" : (v.sfHitRatio * 100).toFixed(1), v.programSourceFiles ?? "", v.rootFiles ?? "", v.nodes, v.edges, v.cacheEntries ?? "", v.cacheCapacity ?? "", r1(v.cacheCharsM), r1(v.heapUsedMB), r1(v.heapTotalMB), r1(v.rssMB), r1(v.rssMaxMB), r1(v.retainedHeapMB), r1(v.heapWithCacheMB), r1(v.heapAfterClearMB), r1(v.rssWithCacheMB)].join(","));
fs.writeFileSync(path.join(outDir, "p11-conditions.csv"), lines.join("\n") + "\n");
// ---- comparisons
const cmp = [["project", "scenario", "A", "B", "median_A_ms", "median_B_ms", "change_pct", "ci95_low_pct", "ci95_high_pct", "block_medians_separated"].join(",")];
const blockSep = (a, b) => { const A = a.blockMedians, B = b.blockMedians; if (Math.max(...B) < Math.min(...A)) return "B<A all blocks"; if (Math.min(...B) > Math.max(...A)) return "B>A all blocks"; return "overlap"; };
for (const p of projects) for (const s of scenarios) for (const [A, B] of [["fixed800", "adaptive"], ["off", "adaptive"], ["off", "fixed800"]]) {
  const a = cell[`${p}|${s}|${A}`], b = cell[`${p}|${s}|${B}`]; if (!a || !b) continue;
  const [lo, hi] = bootCI(a.t, b.t);
  cmp.push([p, s, A, B, r1(a.medianMs), r1(b.medianMs), r1((b.medianMs / a.medianMs - 1) * 100), r1(lo * 100), r1(hi * 100), blockSep(a, b)].join(","));
}
fs.writeFileSync(path.join(outDir, "p11-comparisons.csv"), cmp.join("\n") + "\n");
// ---- correctness: per project/scenario/iteration, compare result hashes across conditions and blocks (reference = off)
const corr = [["project", "scenario", "iterations", "comparisons", "strict_equal", "graphSet_equal", "ids_equal", "mismatching_parts", "note"].join(",")];
const corrDetail = [];
for (const p of projects) for (const s of scenarios) {
  const byIt = new Map();
  for (const r of ok.filter((x) => x.project === p && x.scenario === s)) for (const smp of r.samples) {
    const k = s === "cold-start" ? 0 : smp.iteration; if (!byIt.has(k)) byIt.set(k, []); byIt.get(k).push({ cond: r.condition, block: r.block, h: smp.hash, file: smp.file });
  }
  let comps = 0, strict = 0, gset = 0, ids = 0; const parts = new Set();
  for (const [it, list] of byIt) {
    const ref = list.find((x) => x.cond === "off") || list[0];
    for (const x of list) { if (x === ref) continue; comps++; if (x.h.strict === ref.h.strict) strict++; else { for (const k of Object.keys(x.h.parts)) if (x.h.parts[k] !== ref.h.parts[k]) parts.add(k); if (x.h.graphSet !== ref.h.graphSet) parts.add("graph"); corrDetail.push({ project: p, scenario: s, iteration: it, cond: x.cond, block: x.block, refCond: ref.cond, refBlock: ref.block, file: x.file }); }
      if (x.h.graphSet === ref.h.graphSet) gset++; if (x.h.ids === ref.h.ids) ids++; }
  }
  if (byIt.size) corr.push([p, s, byIt.size, comps, strict, gset, ids, [...parts].join("|"), ""].join(","));
}
fs.writeFileSync(path.join(outDir, "p11-correctness.csv"), corr.join("\n") + "\n");
fs.writeFileSync(path.join(outDir, "p11-correctness-mismatches.json"), JSON.stringify(corrDetail, null, 1));
// ---- failures
fs.writeFileSync(path.join(outDir, "p11-failures.json"), JSON.stringify(failures, null, 1));
// ---- headline table (active-edit)
const head = ["| Project | Program SourceFiles (roots) | Fixed 800 edit (ms) | Adaptive edit (ms) | Change | 95% CI | Retained heap fixed→adaptive (MB) | Result identical |", "|---|---:|---:|---:|---:|---|---:|---|"];
for (const p of projects) {
  const f = cell[`${p}|active-edit|fixed800`], a = cell[`${p}|active-edit|adaptive`]; if (!f || !a) continue;
  const c = cmp.find((l) => l.startsWith(`${p},active-edit,fixed800,adaptive,`)).split(",");
  const cr = corr.find((l) => l.startsWith(`${p},active-edit,`)).split(",");
  head.push(`| ${p} | ${a.programSourceFiles} (${a.rootFiles}) | ${r1(f.medianMs)} | ${r1(a.medianMs)} | ${c[6]}% | [${c[7]}, ${c[8]}]% | ${r1(f.retainedHeapMB)} → ${r1(a.retainedHeapMB)} | ${cr[4]}/${cr[3]} strict |`);
}
fs.writeFileSync(path.join(outDir, "p11-headline.md"), head.join("\n") + "\n");
console.log(head.join("\n")); console.log(`records=${recs.length} ok=${ok.length} failures=${failures.length} mismatches=${corrDetail.length}`);
