#!/usr/bin/env node
// EXP-02 report: combines the published (path-free) run directories into the thesis tables and the
// three-dimension reproduction verdicts of experiments/exp-02-cache-performance.md §9. Reads samples.csv,
// summary.csv, comparison-to-hist.csv, correctness.csv, integrity.json, run.json and workloads.json only.
// It never re-runs the analyzer.
// Usage: node exp02-report.mjs --a-orig <dir> --b-orig <dir> --a-robust <dir> --out <file.json>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapReduction, describe, historicalRows, parseCsv, SOURCE_FILE_CACHE_CAPACITY } from "./exp02-cache-benchmark.mjs";

export const REPORT_VERSION = "exp02-report/1";
const HIST_REQUESTS = { cogic: 172, "synthetic-100": 259, "synthetic-500": 659, "synthetic-1000": 1159, "synthetic-2000": 2159, zod: 534 };
const HIST_FILES = { cogic: 84, "synthetic-100": 100, "synthetic-500": 500, "synthetic-1000": 1000, "synthetic-2000": 2000, zod: null };
const R_HIST = 0.6636524963137866;

const read = (dir, f) => fs.readFileSync(path.join(dir, f), "utf8");
const json = (dir, f) => JSON.parse(read(dir, f));
const measured = (rows) => rows.filter((r) => Number(r.isWarmup) === 0);
const times = (rows, t, s, m) => measured(rows).filter((r) => r.target === t && r.scenario === s && r.mode === m).map((r) => Number(r.elapsedMs));

function cacheTable(samples, target, scenario) {
  const off = times(samples, target, scenario, "off");
  const out = {};
  for (const m of ["off", "sourcefile", "full"]) {
    const xs = times(samples, target, scenario, m);
    const d = describe(xs);
    out[m] = { n: d.n, median: d.medianType7, p50NearestRank: d.p50NearestRank, p95: d.p95NearestRank, iqr: d.iqr, mean: d.mean };
    if (m !== "off") {
      const b = bootstrapReduction(off, xs, { resamples: 10000, seed: 20261102 });
      out[m].reduction = 1 - d.medianType7 / describe(off).medianType7;
      out[m].reductionNearestRank = 1 - d.p50NearestRank / describe(off).p50NearestRank;
      out[m].ci = [b.rLow, b.rHigh];
      out[m].deltaMs = describe(off).medianType7 - d.medianType7;
      out[m].deltaCi = [b.deltaLow, b.deltaHigh];
    }
  }
  return out;
}

// P-robust: one median per (condition, block); between-block range and CV; per-block r
function robustBlocks(samples) {
  const conds = [...new Set(measured(samples).map((r) => `${r.target}|${r.scenario}|${r.mode}`))].sort();
  const blocks = [...new Set(samples.map((r) => Number(r.block)))].sort();
  const rows = [];
  for (const k of conds) {
    const [t, s, m] = k.split("|");
    const med = blocks.map((b) => describe(measured(samples).filter((r) => r.target === t && r.scenario === s && r.mode === m && Number(r.block) === b).map((r) => Number(r.elapsedMs))).medianType7);
    const mean = med.reduce((a, b) => a + b, 0) / med.length;
    const sd = Math.sqrt(med.reduce((a, b) => a + (b - mean) ** 2, 0) / (med.length - 1));
    rows.push({ target: t, scenario: s, mode: m, blockMedians: med, range: Math.max(...med) - Math.min(...med), cv: sd / mean });
  }
  // per-block reduction r for every cache mode
  for (const r of rows.filter((x) => x.mode !== "off")) {
    const off = rows.find((x) => x.target === r.target && x.scenario === r.scenario && x.mode === "off");
    r.blockReductions = r.blockMedians.map((v, i) => 1 - v / off.blockMedians[i]);
  }
  return { blocks, rows };
}

export function verdicts({ aOrig, aRobust }) {
  const cmp = parseCsv(read(aOrig, "comparison-to-hist.csv"));
  const prim = cmp.find((r) => r.target === "cogic" && r.scenario === "active-edit" && r.mode === "sourcefile");
  const wl = json(aOrig, "workloads.json").workloads;
  const inv = json(aOrig, "integrity.json").sampleInvariants;
  const run = json(aOrig, "run.json");
  const countsExact = wl.map((w) => ({ target: w.id, requests: w.sourceFileRequests, hist: HIST_REQUESTS[w.id], files: w.fileCount, histFiles: HIST_FILES[w.id], equal: w.sourceFileRequests === HIST_REQUESTS[w.id] }));
  const unmet = [];
  if (run.conditionsMeasured !== 54) unmet.push(`(c) ${run.conditionsMeasured}/54 conditions`);
  const dRequests = countsExact.filter((c) => !c.equal);
  if (dRequests.length) unmet.push(`(d) SourceFile requests per analysis differ: ${dRequests.map((c) => `${c.target} ${c.requests} vs ${c.hist}`).join(", ")}`);
  if (!inv.fullRepeatedAllResultHit) unmet.push("(d) Full repeated not all result hit");
  if (inv.fullActiveEditResultHits !== 0) unmet.push("(d) Full active-edit result hits != 0");
  const fileDiff = countsExact.filter((c) => c.histFiles !== null && c.files !== c.histFiles);
  if (fileDiff.length) unmet.push(`(b) workload file count differs: ${fileDiff.map((c) => `${c.target} ${c.files} vs ${c.histFiles}`).join(", ")}`);
  const rLow = Number(prim.rLow);
  const rHigh = Number(prim.rHigh);
  const dir = (lo, hi) => (lo > 0 ? "YES" : hi < 0 ? "REVERSED" : "NO");
  // P-robust: pooled samples of the 3 blocks (each block a separate process per condition)
  const rs = parseCsv(read(aRobust, "samples.csv"));
  const b = bootstrapReduction(times(rs, "cogic", "active-edit", "off"), times(rs, "cogic", "active-edit", "sourcefile"), { resamples: 10000, seed: 20261102 });
  const rRobust = 1 - describe(times(rs, "cogic", "active-edit", "sourcefile")).medianType7 / describe(times(rs, "cogic", "active-edit", "off")).medianType7;
  return {
    methodReproduced: unmet.length ? "NOT_MET" : "MET",
    methodUnmet: unmet,
    countsExact,
    effectDirection: { porig: dir(rLow, rHigh), probust: dir(b.rLow, b.rHigh) },
    magnitude: {
      porig: dir(rLow, rHigh) !== "YES" ? "NOT_ASSESSED" : R_HIST >= rLow && R_HIST <= rHigh ? "COMPATIBLE" : "NOT_COMPATIBLE",
      probust: dir(b.rLow, b.rHigh) !== "YES" ? "NOT_ASSESSED" : R_HIST >= b.rLow && R_HIST <= b.rHigh ? "COMPATIBLE" : "NOT_COMPATIBLE",
      rHist: R_HIST,
      porigR: Number(prim.newRType7),
      porigCi: [rLow, rHigh],
      porigHalfWidth: Number(prim.rHalfWidth),
      probustR: rRobust,
      probustCi: [b.rLow, b.rHigh],
      probustHalfWidth: (b.rHigh - b.rLow) / 2,
    },
  };
}

export function report({ aOrig, bOrig, aRobust }) {
  const A = parseCsv(read(aOrig, "samples.csv"));
  const Bs = parseCsv(read(bOrig, "samples.csv"));
  const R = parseCsv(read(aRobust, "samples.csv"));
  const tables = {};
  for (const [name, s] of [["groupA", A], ["groupB", Bs]]) {
    tables[name] = {};
    for (const t of ["cogic", "synthetic-100", "synthetic-500", "synthetic-1000", "synthetic-2000", "zod"]) for (const sc of ["cold", "repeated", "active-edit"]) tables[name][`${t}|${sc}`] = cacheTable(s, t, sc);
  }
  // A vs B on the same condition: median ratio and the difference of reductions (bootstrap of each group)
  const ab = {};
  for (const k of Object.keys(tables.groupA)) {
    ab[k] = Object.fromEntries(["off", "sourcefile", "full"].map((m) => {
      const a = tables.groupA[k][m];
      const b = tables.groupB[k][m];
      return [m, { medianA: a.median, medianB: b.median, ratioBtoA: b.median / a.median, reductionA: a.reduction ?? null, reductionB: b.reduction ?? null }];
    }));
  }
  const robust = robustBlocks(R);
  const robustOrig = Object.fromEntries(robust.rows.filter((r) => r.mode !== "off").map((r) => {
    const k = `${r.target}|${r.scenario}`;
    const pooledOff = times(R, r.target, r.scenario, "off");
    const pooled = times(R, r.target, r.scenario, r.mode);
    const bs = bootstrapReduction(pooledOff, pooled, { resamples: 10000, seed: 20261102 });
    return [`${k}|${r.mode}`, { porigReduction: tables.groupA[k][r.mode].reduction, porigCi: tables.groupA[k][r.mode].ci, probustReduction: 1 - describe(pooled).medianType7 / describe(pooledOff).medianType7, probustCi: [bs.rLow, bs.rHigh], blockReductions: r.blockReductions, sameDirection: Math.sign(tables.groupA[k][r.mode].reduction) === Math.sign(1 - describe(pooled).medianType7 / describe(pooledOff).medianType7) }];
  }));
  const corr = (dir) => {
    const c = parseCsv(read(dir, "correctness.csv"));
    const inv = json(dir, "integrity.json");
    return { phaseD: `${c.filter((x) => x.pass === "1").length}/${c.length}`, hashCompared: inv.sampleInvariants.hashCompared, hashMismatch: inv.sampleInvariants.hashMismatch, invariantProblems: inv.sampleInvariants.problemCount, fullRepeatedAllResultHit: inv.sampleInvariants.fullRepeatedAllResultHit, fullActiveEditResultHits: inv.sampleInvariants.fullActiveEditResultHits, integrityBefore: inv.before?.ok ?? null, integrityAfter: inv.after.ok };
  };
  const memory = (s) => ({ minFreeMB: Math.min(...s.map((r) => Number(r.freeMem))) / 1048576, maxRssMB: Math.max(...s.map((r) => Number(r.rss))) / 1048576 });
  const run = (d) => {
    const r = json(d, "run.json");
    return { runId: r.runId, group: r.group, protocol: r.protocol, status: r.status, conditions: r.conditionsMeasured, tool: r.tool, toolCommit: r.toolCommit, analyzer: { head: r.analyzer.head, buildHash: r.analyzer.buildHash, srcEqualsHistoricalD9faa02: r.analyzer.srcEqualsHistoricalD9faa02 }, startedAt: r.startedAt, finishedAt: r.finishedAt, failures: r.failures.length, env: json(d, "env.json") };
  };
  return {
    schema: REPORT_VERSION,
    runs: { aOrig: run(aOrig), bOrig: run(bOrig), aRobust: run(aRobust) },
    tables,
    groupAvsB: ab,
    robust: { blocks: robust.blocks, rows: robust.rows, versusPorig: robustOrig },
    correctness: { aOrig: corr(aOrig), bOrig: corr(bOrig), aRobust: corr(aRobust) },
    memory: { aOrig: memory(A), bOrig: memory(Bs), aRobust: memory(R) },
    verdicts: verdicts({ aOrig, aRobust }),
    historical: historicalRows().filter((h) => h.target === "cogic" && h.scenario === "active-edit"),
    capacity: SOURCE_FILE_CACHE_CAPACITY,
  };
}

function main() {
  const arg = (n) => process.argv[process.argv.indexOf(n) + 1];
  const out = path.resolve(arg("--out"));
  if (fs.existsSync(out)) throw new Error(`${out} exists; refusing to overwrite`);
  const r = report({ aOrig: path.resolve(arg("--a-orig")), bOrig: path.resolve(arg("--b-orig")), aRobust: path.resolve(arg("--a-robust")) });
  fs.writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`);
  console.log(JSON.stringify({ verdicts: r.verdicts, correctness: r.correctness, memory: r.memory }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
