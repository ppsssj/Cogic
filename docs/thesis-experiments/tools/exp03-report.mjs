#!/usr/bin/env node
// EXP-03 report (exp03-report/1): combines the phase outputs of one run root into the thesis tables
// (5-9, 5-10, 5-11), the prediction check, the thrashing criteria and the H3-1..H3-6 verdicts with the
// rules fixed in exp03-protocol-notes.md before measurement. Never runs the analyzer.
// Usage: node exp03-report.mjs --run-root <dir> [--out <dir>]   (default <run-root>/report)
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import * as X from "./exp02-cache-benchmark.mjs";
import { CAPACITIES, MAIN_N, DEFAULT_SEED, requestCategory } from "./exp03-cache-scalability.mjs";

export const REPORT_VERSION = "exp03-report/1";
const HIT = 0.99;
const MISS = 0.01;
const num = (v) => (v === "" || v === undefined || v === null ? null : Number(v));
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const csv = (f) => (fs.existsSync(f) ? X.parseCsv(fs.readFileSync(f, "utf8")) : []);
const med = (xs) => X.quantile7([...xs].sort((a, b) => a - b), 0.5);
const measured = (rows) => rows.filter((r) => r.isWarmup === "0");

// ---------------------------------------------------------------------------
// statistics

// Two-stage (cluster) bootstrap of r = 1 - median(ON)/median(OFF). Blocks are drawn with replacement
// (the same block indices for OFF and ON: each block ran both conditions), then iterations within each
// drawn block-process. With k = 1 it reduces to the within-process bootstrap.
export function clusterBootstrap(offBlocks, onBlocks, { resamples = 10000, seed = DEFAULT_SEED } = {}) {
  const rand = X.mulberry32(seed);
  const k = offBlocks.length;
  if (k !== onBlocks.length || k === 0) throw new Error("block count mismatch");
  const rs = [];
  const ds = [];
  for (let b = 0; b < resamples; b++) {
    const po = [];
    const pc = [];
    for (let j = 0; j < k; j++) {
      const bi = Math.floor(rand() * k);
      const o = offBlocks[bi];
      const c = onBlocks[bi];
      for (let i = 0; i < o.length; i++) po.push(o[Math.floor(rand() * o.length)]);
      for (let i = 0; i < c.length; i++) pc.push(c[Math.floor(rand() * c.length)]);
    }
    const mo = med(po);
    const mc = med(pc);
    ds.push(mo - mc);
    rs.push(1 - mc / mo);
  }
  ds.sort((a, b) => a - b);
  rs.sort((a, b) => a - b);
  return { resamples, seed, blocks: k, deltaLow: X.quantile7(ds, 0.025), deltaHigh: X.quantile7(ds, 0.975), rLow: X.quantile7(rs, 0.025), rHigh: X.quantile7(rs, 0.975) };
}

export function ols(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxy / sxx;
  return { n, slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}
export function olsBootstrap(xs, ys, { resamples = 10000, seed = DEFAULT_SEED } = {}) {
  const rand = X.mulberry32(seed);
  const sl = [];
  for (let b = 0; b < resamples; b++) {
    const ix = xs.map(() => Math.floor(rand() * xs.length));
    const bx = ix.map((i) => xs[i]);
    if (new Set(bx).size < 2) continue;
    sl.push(ols(bx, ix.map((i) => ys[i])).slope);
  }
  sl.sort((a, b) => a - b);
  return { ...ols(xs, ys), slopeLow: X.quantile7(sl, 0.025), slopeHigh: X.quantile7(sl, 0.975), resamplesUsed: sl.length };
}

const hitClass = (h) => (h === null ? "n/a" : h >= HIT ? "hit" : h < MISS ? "miss" : "partial");
function counts(rows) {
  const s = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const hit = s("sfHit");
  const req = hit + s("sfMiss") + s("sfStale");
  return { analyses: rows.length, hit, miss: s("sfMiss"), stale: s("sfStale"), bypass: s("sfBypass"), store: s("sfStore"), evict: s("evictDerived"), hitRatio: req ? hit / req : null };
}

// ---------------------------------------------------------------------------

export function report(runRoot) {
  const P = (n) => path.join(runRoot, "phases", n);
  const wl = readJson(path.join(runRoot, "workloads.json"));
  const inj = readJson(path.join(runRoot, "capacity-injection.json"));
  const W = Object.fromEntries(wl.workloads.map((w) => [w.id, w]));
  const phases = {};
  for (const n of ["correctness", "time", "repeated", "boundary", "trace", "memory", "microbench"]) phases[n] = fs.existsSync(path.join(P(n), "phase.json")) ? readJson(path.join(P(n), "phase.json")) : null;
  const time = measured(csv(path.join(P("time"), "samples.csv")));
  const rep = measured(csv(path.join(P("repeated"), "samples.csv")));
  const bnd = measured(csv(path.join(P("boundary"), "samples.csv")));
  const mem = measured(csv(path.join(P("memory"), "samples.csv")));
  const allTime = [...csv(path.join(P("time"), "samples.csv")), ...csv(path.join(P("repeated"), "samples.csv")), ...csv(path.join(P("boundary"), "samples.csv"))];
  const corr = csv(path.join(P("correctness"), "correctness.csv"));
  const reuse = csv(path.join(P("trace"), "reuse-distance.csv"));
  const micro = csv(path.join(P("microbench"), "overhead-microbench.csv"));
  const memMeta = phases.memory ? readJson(path.join(P("memory"), "process-meta.json")) : [];
  const sel = (rows, wid, build) => rows.filter((r) => r.workload === wid && r.build === build);
  const blocksOf = (rows) => [...new Set(rows.map((r) => Number(r.block)))].sort((a, b) => a - b);
  const times = (rows) => rows.map((r) => Number(r.elapsedMs));

  // ---- time tables (main grid: time = active-edit, repeated)
  const timeTable = (rows, scenario) => {
    const out = [];
    const comps = [];
    for (const n of MAIN_N) {
      const wid = `n${n}`;
      const off = sel(rows, wid, "original");
      const offBlocks = blocksOf(off).map((b) => times(off.filter((r) => Number(r.block) === b)));
      for (const build of ["original", ...CAPACITIES.map((C) => `c${C}`)]) {
        const xs = sel(rows, wid, build);
        if (!xs.length) continue;
        const d = X.describe(times(xs));
        const bl = blocksOf(xs).map((b) => med(times(xs.filter((r) => Number(r.block) === b))));
        const row = { scenario, workload: wid, N: n, W: W[wid].W, build, capacity: build === "original" ? "" : Number(build.slice(1)), mode: build === "original" ? "off" : "sourcefile", n: d.n, blocks: bl.length, medianType7: d.medianType7, blockMedians: bl.map((v) => v.toFixed(2)).join(";"), p95Type7: d.p95Type7, q1: d.q1, q3: d.q3, iqr: d.iqr, mean: d.mean, sdSample: d.sdSample, min: d.min, max: d.max, ...counts(xs) };
        if (build !== "original" && off.length) {
          const onBlocks = blocksOf(xs).map((b) => times(xs.filter((r) => Number(r.block) === b)));
          const cb = clusterBootstrap(offBlocks, onBlocks);
          const offMed = X.describe(times(off)).medianType7;
          const mw = X.mannWhitney(times(off), times(xs));
          Object.assign(row, { reduction: 1 - d.medianType7 / offMed, deltaMs: offMed - d.medianType7, rLow: cb.rLow, rHigh: cb.rHigh, deltaLow: cb.deltaLow, deltaHigh: cb.deltaHigh, blockReductions: bl.map((v, i) => (1 - v / med(offBlocks[i])).toFixed(4)).join(";"), hodgesLehmannMs: X.hodgesLehmann(times(off), times(xs)), mannWhitneyU: mw.u, mannWhitneyP: mw.p, cliffsDelta: X.cliffsDelta(times(off), times(xs)) });
          comps.push(row);
        }
        out.push(row);
      }
    }
    const adj = X.holm(comps.map((r) => r.mannWhitneyP));
    comps.forEach((r, i) => (r.mannWhitneyPHolm = adj[i]));
    return out;
  };
  const mainTime = timeTable(time, "active-edit");
  const repTime = timeTable(rep, "repeated");

  // N-time slope per capacity (block medians; ms per 1,000 files)
  const slopes = ["original", ...CAPACITIES.map((C) => `c${C}`)].map((build) => {
    const xs = [];
    const ys = [];
    for (const n of MAIN_N) {
      const r = sel(time, `n${n}`, build);
      for (const b of blocksOf(r)) {
        xs.push(n);
        ys.push(med(times(r.filter((x) => Number(x.block) === b))));
      }
    }
    if (xs.length < 3) return { build };
    const o = olsBootstrap(xs, ys);
    return { build, points: xs.length, msPer1000Files: o.slope * 1000, low: o.slopeLow * 1000, high: o.slopeHigh * 1000, r2: o.r2 };
  });

  // ---- boundary / H3-4 hit table
  const boundary = wl.workloads.flatMap((w) => w.roles.filter((r) => r.startsWith("boundary:") || r.startsWith("h3-4:")).map((role) => {
    const C = role.startsWith("h3-4:") ? 800 : Number(role.split(":")[1].slice(1));
    const xs = sel(bnd, w.id, `c${C}`);
    const c = counts(xs);
    const bl = blocksOf(xs).map((b) => counts(xs.filter((r) => Number(r.block) === b)).hitRatio);
    const d = xs.length ? X.describe(times(xs)) : null;
    return { role, workload: w.id, N: w.n, types: w.types, W: w.W, C, WminusC: w.W - C, ...c, blockHitRatios: bl.map((v) => (v === null ? "" : v.toFixed(4))).join(";"), observed: hitClass(c.hitRatio), predicted: w.W <= C ? "hit" : "miss", medianMs: d?.medianType7 ?? null, evictPerAnalysis: c.analyses ? c.evict / c.analyses : null };
  }));

  // ---- prediction check (H3-1, H3-2, H3-3, H3-4)
  const prior = wl.priorTable.W;
  const prediction = [];
  for (const [scenario, rows] of [["active-edit", time], ["repeated", rep]]) {
    for (const n of MAIN_N) for (const C of CAPACITIES) {
      const c = counts(sel(rows, `n${n}`, `c${C}`));
      const obs = hitClass(c.hitRatio);
      const priorPred = prior[n] <= C ? "hit" : "miss";
      const measPred = W[`n${n}`].W <= C ? "hit" : "miss";
      prediction.push({ set: "main", scenario, workload: `n${n}`, N: n, C, Wprior: prior[n], Wmeasured: W[`n${n}`].W, predictedPrior: priorPred, predictedMeasuredW: measPred, hitRatio: c.hitRatio, observed: obs, matchPrior: obs === priorPred ? 1 : 0, matchMeasuredW: obs === measPred ? 1 : 0 });
    }
  }
  for (const b of boundary) prediction.push({ set: b.role.startsWith("h3-4") ? "h3-4" : "boundary", scenario: "active-edit", workload: b.workload, N: b.N, C: b.C, Wprior: "", Wmeasured: b.W, predictedPrior: "", predictedMeasuredW: b.predicted, hitRatio: b.hitRatio, observed: b.observed, matchPrior: "", matchMeasuredW: b.observed === b.predicted ? 1 : 0, role: b.role });

  // ---- eviction per condition (time phase)
  const eviction = [];
  for (const [phase, rows] of [["time", time], ["repeated", rep], ["boundary", bnd]]) {
    const keys = [...new Set(rows.filter((r) => r.mode === "sourcefile").map((r) => `${r.workload}|${r.build}`))];
    for (const k of keys) {
      const [wid, build] = k.split("|");
      const xs = sel(rows, wid, build);
      const ev = xs.map((r) => Number(r.evictDerived));
      const mi = xs.map((r) => Number(r.sfMiss));
      const oc = xs.map((r) => Number(r.occupancyEnd));
      eviction.push({ phase, workload: wid, N: W[wid].n, W: W[wid].W, capacity: Number(build.slice(1)), analyses: xs.length, evictPerAnalysisMedian: med(ev), evictMin: Math.min(...ev), evictMax: Math.max(...ev), missPerAnalysisMedian: med(mi), evictToMiss: med(mi) ? med(ev) / med(mi) : null, occupancyEndMin: Math.min(...oc), occupancyEndMax: Math.max(...oc), maxEntries: Math.max(...xs.map((r) => Number(r.maxEntries))), statCallsPerAnalysis: med(xs.map((r) => Number(r.statCalls))), derivationAnomalies: xs.reduce((s, r) => s + Number(r.derivationAnomalies), 0) });
    }
  }

  // ---- reuse distance (trace phase, measured iterations)
  const reuseSummary = [];
  for (const k of [...new Set(reuse.map((r) => `${r.workload}|${r.build}`))]) {
    const [wid, build] = k.split("|");
    const xs = reuse.filter((r) => r.workload === wid && r.build === build && r.measured === "1");
    const C = Number(build.slice(1));
    reuseSummary.push({ workload: wid, N: W[wid].n, W: W[wid].W, capacity: C, iterations: xs.length, requests: xs.reduce((s, r) => s + Number(r.requests), 0), reuseMin: Math.min(...xs.map((r) => Number(r.reuseMin))), reuseMedian: med(xs.map((r) => Number(r.reuseMedian))), reuseMax: Math.max(...xs.map((r) => Number(r.reuseMax))), fractionAtLeastC: xs.reduce((s, r) => s + Number(r.reuseAtLeastC), 0) / xs.reduce((s, r) => s + Number(r.requests) - Number(r.firstAccess), 0), observedHits: xs.reduce((s, r) => s + Number(r.observedHits), 0), lruPredictedHits: xs.reduce((s, r) => s + Number(r.lruPredictedHits), 0), lruVsObservedMismatch: xs.reduce((s, r) => s + Math.abs(Number(r.observedHits) - Number(r.lruPredictedHits)), 0), orderStable: xs.every((r) => r.orderSameAsPrevious === "1") ? 1 : 0 });
  }

  // ---- memory (5-11)
  const memory = [];
  for (const n of MAIN_N) for (const build of ["original", ...CAPACITIES.map((C) => `c${C}`)]) {
    const xs = sel(mem, `n${n}`, build);
    if (!xs.length) continue;
    const meta = memMeta.find((m) => m.workload === `n${n}` && m.build === build);
    const off = sel(mem, `n${n}`, "original");
    memory.push({ workload: `n${n}`, N: n, W: W[`n${n}`].W, build, capacity: build === "original" ? "" : Number(build.slice(1)), mode: build === "original" ? "off" : "sourcefile", analyses: xs.length, occupancyDirect: meta?.occupancyDirectAtEnd ?? null, occupancyEndMedian: med(xs.map((r) => Number(r.occupancyEnd))), heapAfterGcMedianMB: med(xs.map((r) => Number(r.heapUsedAfterGc))) / 1048576, heapAfterGcMinusOffMB: (med(xs.map((r) => Number(r.heapUsedAfterGc))) - med(off.map((r) => Number(r.heapUsedAfterGc)))) / 1048576, heapAfterClearGcMB: meta?.memoryTail ? meta.memoryTail.heapUsedAfterClearGc / 1048576 : null, cacheRetainedMB: meta?.memoryTail ? meta.memoryTail.cacheRetainedEstimate / 1048576 : null, rssAfterGcMedianMB: med(xs.map((r) => Number(r.rssAfterGc))) / 1048576, rssMaxMB: Math.max(...xs.map((r) => Number(r.rss))) / 1048576, gcMsPerAnalysisMedian: med(xs.map((r) => Number(r.gcMsInAnalysis))), gcCountPerAnalysisMedian: med(xs.map((r) => Number(r.gcCountInAnalysis))), gcMajorPerAnalysisMedian: med(xs.map((r) => Number(r.gcMajorInAnalysis))), elapsedMedianMs: med(times(xs)), hitRatio: counts(xs).hitRatio });
  }
  const memPts = memory.filter((m) => m.occupancyDirect !== null && m.cacheRetainedMB !== null);
  // exploratory: marginal retained bytes per workspace entry from pairs that differ only in the number of
  // cached workspace files (both W <= C, so the same 160 non-workspace entries are cached)
  const retainedOf = (wid, build) => memory.find((m) => m.workload === wid && m.build === build)?.cacheRetainedMB ?? null;
  const wsPairs = [["n100", "n500", "c800"], ["n100", "n500", "c1600"], ["n500", "n1000", "c1600"]].map(([x, y, b]) => {
    const rx = retainedOf(x, b);
    const ry = retainedOf(y, b);
    const dn = W[y].n - W[x].n;
    return { from: x, to: y, build: b, bytesPerWorkspaceEntry: rx === null || ry === null ? null : ((ry - rx) * 1048576) / dn, nonWorkspaceBytes: rx === null || ry === null ? null : rx * 1048576 - ((ry - rx) * 1048576 * (W[x].n - 1)) / dn };
  });
  const h36 = memPts.length >= 3 ? olsBootstrap(memPts.map((m) => m.occupancyDirect), memPts.map((m) => m.cacheRetainedMB * 1048576)) : null;

  // ---- microbench + overhead decomposition (H3-5)
  const mb = (bench, filt) => med(micro.filter((r) => r.bench === bench && filt(r)).map((r) => Number(r.usPerOp)));
  const microSummary = [...CAPACITIES.map((C) => ({ bench: "prune-sort", capacity: C, N: "", usPerOpMedian: mb("prune-sort", (r) => Number(r.capacity) === C) })), ...MAIN_N.flatMap((n) => ["statSync", "cache-key"].map((b) => ({ bench: b, capacity: "", N: n, usPerOpMedian: mb(b, (r) => Number(r.N) === n) })))];
  const decomposition = [];
  for (const r of mainTime.filter((x) => x.mode === "sourcefile" && x.W > x.capacity)) {
    const ev = eviction.find((e) => e.phase === "time" && e.workload === r.workload && e.capacity === r.capacity);
    const statUs = mb("statSync", (x) => Number(x.N) === r.N);
    const keyUs = mb("cache-key", (x) => Number(x.N) === r.N);
    const pruneUs = mb("prune-sort", (x) => Number(x.capacity) === r.capacity);
    const memOn = memory.find((m) => m.workload === r.workload && m.build === r.build);
    const memOff = memory.find((m) => m.workload === r.workload && m.build === "original");
    const parts = { statMs: ev ? (ev.statCallsPerAnalysis * statUs) / 1000 : null, keyMs: ev ? (ev.statCallsPerAnalysis * keyUs) / 1000 : null, sortMs: ev ? (ev.evictPerAnalysisMedian * pruneUs) / 1000 : null, gcMs: memOn && memOff ? memOn.gcMsPerAnalysisMedian - memOff.gcMsPerAnalysisMedian : null };
    const sum = Object.values(parts).every((v) => v !== null) ? Object.values(parts).reduce((a, b) => a + b, 0) : null;
    const observed = -r.deltaMs;
    decomposition.push({ workload: r.workload, N: r.N, W: r.W, capacity: r.capacity, observedSlowdownMs: observed, observedLow: -r.deltaHigh, observedHigh: -r.deltaLow, ...parts, sumMs: sum, residualMs: sum === null ? null : observed - sum, explainedFraction: sum === null || observed === 0 ? null : sum / observed, sumWithinObservedCi: sum === null ? null : sum >= -r.deltaHigh && sum <= -r.deltaLow ? 1 : 0 });
  }

  // ---- correctness
  const corrByBuild = (b) => corr.filter((r) => r.build === b);
  const c800vsOriginal = wl.workloads.filter((w) => corrByBuild("original").some((r) => r.workload === w.id)).map((w) => {
    const a = corrByBuild("original").filter((r) => r.workload === w.id);
    const b = corrByBuild("c800").filter((r) => r.workload === w.id);
    const key = (r) => [r.run, r.sfHit, r.sfMiss, r.sfStale, r.sfStore, r.evictDerived, r.occupancyEnd, r.maxEntries, r.occupancyDirect, r.hash].join("|");
    return { workload: w.id, rows: a.length, equal: a.length > 0 && a.length === b.length && a.every((r, i) => key(r) === key(b[i])) ? 1 : 0 };
  });
  // per-iteration hashes in the timed phases: every capacity equals OFF at the same iteration (time,
  // repeated); boundary iterations are compared across blocks and, for iterations 0-2, with correctness OFF.
  const hashChecks = { compared: 0, mismatches: 0, details: [] };
  for (const rows of [csv(path.join(P("time"), "samples.csv")), csv(path.join(P("repeated"), "samples.csv"))]) {
    const ref = new Map(rows.filter((r) => r.mode === "off").map((r) => [`${r.workload}|${r.scenario}|${r.iteration}`, r.resultHash]));
    for (const r of rows.filter((x) => x.mode === "sourcefile")) {
      const h = ref.get(`${r.workload}|${r.scenario}|${r.iteration}`);
      if (h === undefined) continue;
      hashChecks.compared++;
      if (h !== r.resultHash) {
        hashChecks.mismatches++;
        if (hashChecks.details.length < 50) hashChecks.details.push(`${r.workload} ${r.build} ${r.scenario} it${r.iteration} b${r.block}`);
      }
    }
  }
  const bndAll = csv(path.join(P("boundary"), "samples.csv"));
  const offCorr = new Map(corrByBuild("original").map((r) => [`${r.workload}|${r.run}`, r.offHash]));
  for (const r of bndAll) {
    const first = bndAll.find((x) => x.workload === r.workload && x.iteration === r.iteration);
    hashChecks.compared++;
    if (first.resultHash !== r.resultHash) hashChecks.mismatches++;
    const o = offCorr.get(`${r.workload}|${r.iteration}`);
    if (o !== undefined) {
      hashChecks.compared++;
      if (o !== r.resultHash) hashChecks.mismatches++;
    }
  }
  const iterProblems = [];
  for (const r of [...allTime, ...csv(path.join(P("trace"), "samples.csv")), ...csv(path.join(P("memory"), "samples.csv"))]) {
    const w = W[r.workload];
    if (r.mode === "sourcefile") {
      if (Number(r.sfHit) + Number(r.sfMiss) + Number(r.sfStale) + Number(r.sfBypass) !== w.W) iterProblems.push(`${r.phase} ${r.workload} ${r.build} it${r.iteration}: requests`);
      if (Number(r.maxEntries) > Number(r.capacity)) iterProblems.push(`${r.phase} ${r.workload} ${r.build} it${r.iteration}: occupancy > C`);
      if (Number(r.derivationAnomalies) !== 0) iterProblems.push(`${r.phase} ${r.workload} ${r.build} it${r.iteration}: derivation`);
    } else if (Number(r.sfDisabled) !== w.W) iterProblems.push(`${r.phase} ${r.workload} off it${r.iteration}: requests`);
    if (r.scenario === "active-edit" && r.variantReflected !== "1") iterProblems.push(`${r.phase} ${r.workload} ${r.build} it${r.iteration}: variant`);
  }
  // count determinism across blocks: the same (workload, build, scenario, iteration) has the same counts
  const det = new Map();
  let nondeterministic = 0;
  for (const r of allTime) {
    const k = `${r.phase}|${r.workload}|${r.build}|${r.scenario}|${r.iteration}`;
    const v = [r.sfHit, r.sfMiss, r.sfStale, r.evictDerived, r.occupancyEnd].join("|");
    if (det.has(k) && det.get(k) !== v) nondeterministic++;
    det.set(k, v);
  }
  const correctness = { phaseRows: corr.length, phasePass: corr.filter((r) => r.pass === "1").length, failures: corr.filter((r) => r.pass !== "1").map((r) => `${r.build} ${r.workload} run${r.run}`), c800EqualsOriginal: c800vsOriginal.every((x) => x.equal === 1), c800vsOriginal, hashChecks, iterationProblems: iterProblems.length, iterationProblemSamples: iterProblems.slice(0, 50), nondeterministicCounts: nondeterministic, injection: { status: inj.status, constant: inj.constant, builds: inj.builds.map((b) => ({ id: b.id, ok: b.ok, changedFiles: b.changedFiles, changedLines: b.changedLines, load: b.load })) } };

  // ---- thrashing criteria
  const thrash = [];
  const zeroHitConds = [...MAIN_N.flatMap((n) => CAPACITIES.filter((C) => W[`n${n}`].W > C).map((C) => ({ workload: `n${n}`, C, source: "time", role: "main" }))), ...boundary.filter((b) => b.W > b.C).map((b) => ({ workload: b.workload, C: b.C, source: "boundary", role: b.role }))];
  for (const z of zeroHitConds) {
    const w = W[z.workload];
    const rows = sel(z.source === "time" ? time : bnd, z.workload, `c${z.C}`);
    const c = counts(rows);
    const ev = eviction.find((e) => e.phase === z.source && e.workload === z.workload && e.capacity === z.C);
    const ru = reuseSummary.find((r) => r.workload === z.workload && r.capacity === z.C);
    const cf = corr.filter((r) => r.workload === z.workload && r.build !== "original" && Number(r.capacity) > z.C && Number(r.capacity) >= w.W && Number(r.run) > 0);
    const cfHit = cf.length ? cf.every((r) => Number(r.hitRatio) >= HIT) : null;
    const sameN = wl.workloads.find((x) => x.n === w.n && x.types === "none" && w.types === "default");
    const cfH34 = sameN ? boundary.find((b) => b.workload === sameN.id) : null;
    const k1 = c.hitRatio !== null && c.hitRatio < MISS;
    const k2 = ev ? Math.abs(ev.evictToMiss - 1) <= 0.01 : false;
    const k3 = ev ? ev.occupancyEndMin === z.C && ev.occupancyEndMax === z.C : false;
    const k4 = ru ? ru.reuseMin >= z.C : null;
    const k5 = cfHit === true || (cfH34 && cfH34.observed === "hit") ? true : cfHit === false ? false : null;
    const met = [k1, k2, k3, k4, k5];
    thrash.push({ workload: z.workload, role: z.role, N: w.n, W: w.W, C: z.C, c1HitRatioBelow1pct: k1 ? 1 : 0, hitRatio: c.hitRatio, c2EvictEqualsMiss: k2 ? 1 : 0, evictToMiss: ev?.evictToMiss ?? null, c3OccupancySaturated: k3 ? 1 : 0, occupancyEnd: ev ? `${ev.occupancyEndMin}-${ev.occupancyEndMax}` : "", c4AllReuseAtLeastC: k4 === null ? "NOT_MEASURED" : k4 ? 1 : 0, reuseMin: ru?.reuseMin ?? "", c5Counterfactual: k5 === null ? "NOT_TESTABLE" : k5 ? 1 : 0, counterfactualSource: [cf.length ? `capacity ${[...new Set(cf.map((r) => r.capacity))].join("/")} > W (correctness phase)` : "", cfH34 ? `${cfH34.workload} W=${cfH34.W} (H3-4)` : ""].filter(Boolean).join("; ") || "none (no measured C > W)", verdict: met.every((m) => m === true) ? "THRASHING_OBSERVED" : "PARTIAL_EVIDENCE" });
  }

  // ---- hypotheses (rules: exp03-protocol-notes.md §5)
  const mainPred = prediction.filter((p) => p.set === "main");
  const h31 = { cells: mainPred.length, match: mainPred.filter((p) => p.matchMeasuredW === 1).length, mismatches: mainPred.filter((p) => p.matchMeasuredW !== 1).map((p) => `${p.scenario} N=${p.N} C=${p.C} h=${p.hitRatio}`) };
  h31.verdict = h31.cells && h31.match === h31.cells ? "SUPPORTED" : "NOT_SUPPORTED";
  const recov = [[500, 400, 800], [1000, 800, 1600]].map(([n, lo, hi]) => {
    const a = mainTime.find((r) => r.N === n && r.capacity === lo);
    const b = mainTime.find((r) => r.N === n && r.capacity === hi);
    return { N: n, from: lo, to: hi, hitFrom: a?.hitRatio ?? null, hitTo: b?.hitRatio ?? null, rTo: b?.reduction ?? null, rToLow: b?.rLow ?? null, ok: Boolean(a && b && a.hitRatio < MISS && b.hitRatio >= HIT && b.rLow > 0) };
  });
  const priorCells = mainPred.filter((p) => p.scenario === "active-edit");
  const h32 = { priorTableMatch: `${priorCells.filter((p) => p.matchPrior === 1).length}/${priorCells.length}`, recoveries: recov, verdict: recov.every((r) => r.ok) && priorCells.every((p) => p.matchPrior === 1) ? "SUPPORTED" : recov.some((r) => r.ok) ? "PARTIALLY_SUPPORTED" : "NOT_SUPPORTED" };
  const h33 = { perCapacity: CAPACITIES.map((C) => {
    const b = boundary.filter((x) => x.role.startsWith(`boundary:C${C}:`));
    const get = (s) => b.find((x) => x.role.endsWith(`:${s}`));
    const ok = get("C-1")?.observed === "hit" && get("C")?.observed === "hit" && get("C+1")?.observed === "miss";
    return { C, cells: b.map((x) => `${x.role.split(":")[2]} W=${x.W} h=${x.hitRatio === null ? "" : x.hitRatio.toFixed(4)}`), ok };
  }) };
  h33.verdict = h33.perCapacity.every((x) => x.ok) ? "SUPPORTED" : h33.perCapacity.some((x) => x.ok) ? "PARTIALLY_SUPPORTED" : "NOT_SUPPORTED";
  const h34cells = boundary.filter((b) => b.role.startsWith("h3-4"));
  const h34 = { L: wl.L, Lnotypes: wl.Lnotypes, WreductionByTypes: wl.L - wl.Lnotypes, cells: h34cells.map((b) => ({ role: b.role, workload: b.workload, W: b.W, observed: b.observed, predicted: b.predicted })), sameNDefault: boundaryNsDefault(boundary) };
  h34.verdict = wl.Lnotypes < wl.L && h34cells.length === 5 && h34cells.every((b) => b.observed === b.predicted) ? "SUPPORTED" : "NOT_SUPPORTED";
  const zeroHitMain = mainTime.filter((r) => r.mode === "sourcefile" && r.W > r.capacity);
  const prune = CAPACITIES.map((C) => microSummary.find((m) => m.bench === "prune-sort" && m.capacity === C)?.usPerOpMedian ?? null);
  const h35 = { slowdownCiAboveZero: zeroHitMain.map((r) => ({ N: r.N, C: r.capacity, slowdownMs: -r.deltaMs, ci: [-r.deltaHigh, -r.deltaLow], significant: r.deltaHigh < 0 })), pruneUsByCapacity: prune, sortIncreasesWithC: prune.every((v, i) => v !== null && (i === 0 || v > prune[i - 1])), decomposition };
  h35.verdict = h35.slowdownCiAboveZero.every((x) => x.significant) && h35.sortIncreasesWithC && decomposition.every((d) => d.sumWithinObservedCi === 1) ? "SUPPORTED" : h35.slowdownCiAboveZero.some((x) => x.significant) ? "PARTIALLY_SUPPORTED" : "NOT_SUPPORTED";
  const h36v = h36 ? { ...h36, workspaceEntryPairs: wsPairs, bytesPerEntry: h36.slope, bytesPerEntryCi: [h36.slopeLow, h36.slopeHigh], verdict: h36.slopeLow > 0 && h36.r2 >= 0.9 ? "SUPPORTED" : h36.slopeLow > 0 ? "PARTIALLY_SUPPORTED" : "NOT_SUPPORTED" } : { verdict: "NOT_MEASURED" };

  const phaseStatus = Object.fromEntries(Object.entries(phases).map(([k, p]) => [k, p ? { status: p.status, processes: p.processes.length, failures: p.failures.length, startedAt: p.startedAt, finishedAt: p.finishedAt, minFreeMemMB: Math.min(p.envStart.freeMemBytes, p.envEnd?.freeMemBytes ?? Infinity, ...p.processes.flatMap((x) => [x.freeMemBefore ?? Infinity, x.freeMemAfter ?? Infinity])) / 1048576, integrityBefore: p.integrityBefore.ok, integrityAfter: p.integrityAfter?.ok ?? null, analyzerBefore: p.analyzerBefore.ok, analyzerAfter: p.analyzerAfter?.ok ?? null, toolCommit: p.toolCommit } : null]));
  const lowMemIterations = [...allTime, ...csv(path.join(P("trace"), "samples.csv")), ...csv(path.join(P("memory"), "samples.csv"))].filter((r) => Number(r.freeMem) < 512 * 1048576).length;
  const complete = Object.values(phaseStatus).every((p) => p && p.status === "COMPLETE");
  // exploratory: categories of the entries left in the cache after the trace conditions of the main grid
  const retained = [];
  for (const n of MAIN_N) for (const C of CAPACITIES) {
    const g = path.join(P("trace"), "blocks", "b1", `n${n}.c${C}.sourcefile.active-edit.sequence.csv.gz`);
    if (fs.existsSync(g)) retained.push({ workload: `n${n}`, N: n, W: W[`n${n}`].W, capacity: C, ...retainedComposition(g, C) });
  }

  return { schema: REPORT_VERSION, runRoot: path.basename(runRoot), complete, phaseStatus, lowMemIterations, workloads: { L: wl.L, Lnotypes: wl.Lnotypes, cwdNodeModules: wl.cwdNodeModules, list: wl.workloads.map((w) => ({ id: w.id, N: w.n, types: w.types, W: w.W, predictedW: w.predictedW, roles: w.roles, requestsByCategory: w.requestsByCategory, fileCount: w.fileCount, programRootFiles: w.programRootFiles, usedTsconfig: w.usedTsconfig })) }, tables: { mainTime, repTime, slopes, boundary, memory, microSummary }, retained, prediction, eviction, reuseSummary, thrash, correctness, hypotheses: { H3_1: h31, H3_2: h32, H3_3: h33, H3_4: h34, H3_5: h35, H3_6: h36v } };
}

function boundaryNsDefault(boundary) {
  return boundary.filter((b) => b.role.startsWith("boundary:C800:C") && !b.role.endsWith("C-1")).map((b) => ({ role: b.role, workload: b.workload, W: b.W, observed: b.observed }));
}

// ---------------------------------------------------------------------------
// render

const f = (x, d = 1) => (x === null || x === undefined || x === "" || Number.isNaN(Number(x)) ? "" : Number(x).toFixed(d));
const pc = (x, d = 1) => (x === null || x === undefined || x === "" ? "" : `${(Number(x) * 100).toFixed(d)}%`);
export function renderSummary(r) {
  const L = [`# EXP-03 report (${r.runRoot})`, "", `Generated by ${REPORT_VERSION} from the phase outputs. No hand-written interpretation.`, "", "## Phases", "", "| phase | status | processes | failures | min free MB | integrity before/after | analyzer before/after |", "|---|---|---:|---:|---:|---|---|"];
  for (const [k, p] of Object.entries(r.phaseStatus)) L.push(p ? `| ${k} | ${p.status} | ${p.processes} | ${p.failures} | ${f(p.minFreeMemMB, 0)} | ${p.integrityBefore}/${p.integrityAfter} | ${p.analyzerBefore}/${p.analyzerAfter} |` : `| ${k} | NOT_RUN | | | | | |`);
  L.push("", `- L = ${r.workloads.L} (types: [] → ${r.workloads.Lnotypes}); iterations with free memory < 512 MB: ${r.lowMemIterations}`, "", "## Table 5-9 — SourceFile hit ratio (active-edit, measured iterations)", "", "| N | W | C=400 | C=800 | C=1600 |", "|---:|---:|---:|---:|---:|");
  for (const n of MAIN_N) {
    const row = r.tables.mainTime.filter((x) => x.N === n);
    L.push(`| ${n} | ${row[0]?.W ?? ""} | ${CAPACITIES.map((C) => pc(row.find((x) => x.capacity === C)?.hitRatio)).join(" | ")} |`);
  }
  L.push("", "## Table 5-10 — median analysis time, ms (active-edit; r and two-stage bootstrap 95% CI)", "", "| N | OFF | C=400 | C=800 | C=1600 |", "|---:|---:|---:|---:|---:|");
  for (const n of MAIN_N) {
    const row = r.tables.mainTime.filter((x) => x.N === n);
    const cell = (x) => (x ? `${f(x.medianType7)} (r ${pc(x.reduction)} [${pc(x.rLow)}, ${pc(x.rHigh)}])` : "");
    L.push(`| ${n} | ${f(row.find((x) => x.mode === "off")?.medianType7)} | ${CAPACITIES.map((C) => cell(row.find((x) => x.capacity === C))).join(" | ")} |`);
  }
  L.push("", "## Repeated (k = 1 block)", "", "| N | OFF | C=400 | C=800 | C=1600 |", "|---:|---:|---:|---:|---:|");
  for (const n of MAIN_N) {
    const row = r.tables.repTime.filter((x) => x.N === n);
    const cell = (x) => (x ? `${f(x.medianType7)} (h ${pc(x.hitRatio)}, r ${pc(x.reduction)})` : "");
    L.push(`| ${n} | ${f(row.find((x) => x.mode === "off")?.medianType7)} | ${CAPACITIES.map((C) => cell(row.find((x) => x.capacity === C))).join(" | ")} |`);
  }
  L.push("", "## Table 5-11 — memory (memory phase, --expose-gc, GC forced after each analysis)", "", "| N | build | occupancy | heap after GC MB | Δ vs OFF MB | cache retained MB | RSS after GC MB | GC ms/analysis |", "|---:|---|---:|---:|---:|---:|---:|---:|");
  for (const m of r.tables.memory) L.push(`| ${m.N} | ${m.build} | ${m.occupancyDirect ?? ""} | ${f(m.heapAfterGcMedianMB)} | ${f(m.heapAfterGcMinusOffMB)} | ${f(m.cacheRetainedMB)} | ${f(m.rssAfterGcMedianMB, 0)} | ${f(m.gcMsPerAnalysisMedian)} |`);
  L.push("", "## Boundary and H3-4", "", "| role | workload | W | C | hit ratio | observed | predicted |", "|---|---|---:|---:|---:|---|---|");
  for (const b of r.tables.boundary) L.push(`| ${b.role} | ${b.workload} | ${b.W} | ${b.C} | ${pc(b.hitRatio, 2)} | ${b.observed} | ${b.predicted} |`);
  L.push("", "## Thrashing criteria", "", "| workload | W | C | 1 h<1% | 2 evict≈miss | 3 occ=C | 4 reuse≥C | 5 counterfactual | verdict |", "|---|---:|---:|---|---|---|---|---|---|");
  for (const t of r.thrash) L.push(`| ${t.workload} | ${t.W} | ${t.C} | ${t.c1HitRatioBelow1pct} | ${t.c2EvictEqualsMiss} | ${t.c3OccupancySaturated} | ${t.c4AllReuseAtLeastC} | ${t.c5Counterfactual} | ${t.verdict} |`);
  L.push("", "## H3-5 overhead decomposition (zero-hit, ms per analysis)", "", "| N | C | observed slowdown [CI] | stat | key | sort | GC Δ | sum | residual |", "|---:|---:|---|---:|---:|---:|---:|---:|---:|");
  for (const d of r.hypotheses.H3_5.decomposition) L.push(`| ${d.N} | ${d.capacity} | ${f(d.observedSlowdownMs)} [${f(d.observedLow)}, ${f(d.observedHigh)}] | ${f(d.statMs, 2)} | ${f(d.keyMs, 2)} | ${f(d.sortMs, 2)} | ${f(d.gcMs, 1)} | ${f(d.sumMs)} | ${f(d.residualMs)} |`);
  L.push("", "## Hypotheses", "", ...Object.entries(r.hypotheses).map(([k, v]) => `- ${k}: ${v.verdict}`), "", "## Correctness", "", `- correctness phase: ${r.correctness.phasePass}/${r.correctness.phaseRows} rows pass; c800 equals original: ${r.correctness.c800EqualsOriginal}`, `- per-iteration hash comparisons: ${r.correctness.hashChecks.compared}, mismatches ${r.correctness.hashChecks.mismatches}`, `- per-iteration invariant problems: ${r.correctness.iterationProblems}; non-deterministic counts across blocks: ${r.correctness.nondeterministicCounts}`, "");
  return `${L.join("\n")}\n`;
}

export function writeOutputs(r, out) {
  if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${out}`);
  fs.mkdirSync(out, { recursive: true });
  const w = (name, rows) => fs.writeFileSync(path.join(out, name), X.toCsv(rows, Object.keys(rows[0] ?? { empty: "" })));
  w("summary.csv", [...r.tables.mainTime, ...r.tables.repTime]);
  w("prediction-check.csv", r.prediction);
  w("thrashing-criteria.csv", r.thrash);
  w("eviction.csv", r.eviction);
  w("reuse-distance.csv", r.reuseSummary);
  w("memory.csv", r.tables.memory);
  w("boundary.csv", r.tables.boundary);
  w("overhead-decomposition.csv", r.hypotheses.H3_5.decomposition);
  w("overhead-microbench-summary.csv", r.tables.microSummary);
  fs.writeFileSync(path.join(out, "exp03-report.json"), `${JSON.stringify(r, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "summary.md"), renderSummary(r));
}

// exploratory: which request categories remain cached at the end of a trace condition (last C distinct)
export function retainedComposition(seqGzFile, capacity) {
  const rows = X.parseCsv(zlib.gunzipSync(fs.readFileSync(seqGzFile)).toString("utf8"));
  const req = rows.filter((r) => r.kind === "hit" || r.kind === "miss" || r.kind === "stale").map((r) => r.label);
  const seen = new Set();
  const kept = [];
  for (let i = req.length - 1; i >= 0 && kept.length < capacity; i--) {
    const k = req[i].toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(req[i]);
  }
  const byCategory = {};
  for (const l of kept) byCategory[requestCategory(l)] = (byCategory[requestCategory(l)] ?? 0) + 1;
  return { kept: kept.length, byCategory };
}

// Copy the aggregated outputs into the repository without local paths. Raw per-process CSVs, access
// sequences, request lists and the build copies stay in the run root (and its ZIP).
export function publish(runRoot, to) {
  if (fs.existsSync(to)) throw new Error(`refusing to overwrite ${to}`);
  fs.mkdirSync(to, { recursive: true });
  const rep = path.join(runRoot, "report");
  for (const n of fs.readdirSync(rep)) fs.copyFileSync(path.join(rep, n), path.join(to, n));
  const strip = (s) => String(s ?? "").replace(/[A-Za-z]:[\\/][^\s"']*/g, "<path>");
  fs.copyFileSync(path.join(runRoot, "capacity-injection.json"), path.join(to, "capacity-injection.json"));
  fs.mkdirSync(path.join(to, "builds"));
  for (const n of fs.readdirSync(path.join(runRoot, "builds")).filter((x) => x.endsWith(".diff"))) fs.copyFileSync(path.join(runRoot, "builds", n), path.join(to, "builds", n));
  fs.copyFileSync(path.join(runRoot, "workloads.json"), path.join(to, "workloads.json"));
  const samples = [];
  fs.mkdirSync(path.join(to, "phases"));
  for (const ph of fs.readdirSync(path.join(runRoot, "phases")).filter((x) => !x.includes("-"))) {
    const d = path.join(runRoot, "phases", ph);
    const p = readJson(path.join(d, "phase.json"));
    p.failures = p.failures.map((x) => ({ ...x, stack: undefined, stderr: x.stderr ? strip(x.stderr) : undefined, error: x.error ? strip(x.error) : undefined }));
    fs.writeFileSync(path.join(to, "phases", `${ph}.phase.json`), `${JSON.stringify(p, null, 2)}\n`);
    for (const extra of ["correctness.csv", "overhead-microbench.csv", "process-meta.json"]) if (fs.existsSync(path.join(d, extra))) fs.copyFileSync(path.join(d, extra), path.join(to, "phases", `${ph}.${extra}`));
    if (fs.existsSync(path.join(d, "reuse-distance.csv"))) fs.copyFileSync(path.join(d, "reuse-distance.csv"), path.join(to, "phases", `${ph}.reuse-distance-per-iteration.csv`));
    if (fs.existsSync(path.join(d, "samples.csv"))) samples.push(...csv(path.join(d, "samples.csv")));
  }
  fs.writeFileSync(path.join(to, "samples.csv"), X.toCsv(samples, Object.keys(samples[0] ?? { empty: "" })));
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const leaks = walk(to).filter((f) => /[A-Za-z]:[\\/](?!\/)|\\Users\\|\/Users\//.test(fs.readFileSync(f, "utf8").replace(/https?:\/\//g, "")));
  if (leaks.length) throw new Error(`absolute paths remain in ${leaks.map((f) => path.basename(f)).join(", ")}`);
  return to;
}

function main() {
  const a = process.argv.slice(2);
  const arg = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : null);
  if (arg("--publish")) {
    console.log(publish(path.resolve(arg("--run-root")), path.resolve(arg("--publish"))));
    return;
  }
  const runRoot = path.resolve(arg("--run-root"));
  const out = path.resolve(arg("--out") ?? path.join(runRoot, "report"));
  const r = report(runRoot);
  writeOutputs(r, out);
  console.log(JSON.stringify({ complete: r.complete, hypotheses: Object.fromEntries(Object.entries(r.hypotheses).map(([k, v]) => [k, v.verdict])), correctness: { pass: `${r.correctness.phasePass}/${r.correctness.phaseRows}`, c800: r.correctness.c800EqualsOriginal, hash: r.correctness.hashChecks, problems: r.correctness.iterationProblems } }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
