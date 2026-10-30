// EXP-02 tool tests (synthetic inputs and a fake analyzer only; the real analyzer is not loaded).
// The fidelity tests extract the ORIGINAL functions from scripts/benchmark-analysis-cache.mjs (fed34a0
// content, never executed as a script) and compare their behaviour with the copies in Section A.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import * as T from "../exp02-cache-benchmark.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// ---- extract original functions -------------------------------------------------------------
const originalSrc = fs.readFileSync(path.join(repoRoot, "scripts/benchmark-analysis-cache.mjs"), "utf8").replace(/\r\n/g, "\n");
function extract(name, kind = "function") {
  const start = originalSrc.indexOf(kind === "class" ? `class ${name} ` : `function ${name}(`);
  assert.ok(start >= 0, name);
  let i = originalSrc.indexOf("{", originalSrc.indexOf(kind === "class" ? name : ")", start));
  if (kind === "function") i = originalSrc.indexOf("{", originalSrc.indexOf(") {", start));
  let depth = 0;
  for (let k = i; k < originalSrc.length; k++) {
    if (originalSrc[k] === "{") depth++;
    else if (originalSrc[k] === "}" && --depth === 0) return originalSrc.slice(start, k + 1);
  }
  throw new Error(`unbalanced ${name}`);
}
function originalModule(analyzer = null) {
  const names = ["listWorkspaceFiles", "generateSyntheticWorkspace", "analyzePanelEquivalent", "getAnalysisCacheKey", "getScenarioCode", "normalizeAnalysisResult", "stats", "percentile", "stableStringify", "cloneAnalysisResult", "normalizeComparablePath", "hashText", "clampGraphDepth"];
  const body = [...names.map((n) => extract(n)), extract("PanelEquivalentResultCache", "class"), `return { ${names.join(", ")}, PanelEquivalentResultCache };`].join("\n");
  return new Function("fs", "path", "crypto", "isWin", "MAX_WORKSPACE_FILES", "RESULT_CACHE_LIMIT", "analyzeWorkspaceActive", body)(fs, path, crypto, process.platform === "win32", 4000, 40, analyzer?.analyzeWorkspaceActive);
}

// ---- fake analyzer --------------------------------------------------------------------------
// Emits one SourceFile event per "request" (W = files + 3 lib files); remembers cached files when the
// cache is enabled; returns a graph that contains the functions declared in the active code.
function fakeAnalyzer({ libFiles = 3 } = {}) {
  let cache = new Set();
  return {
    clearAnalyzerCaches() {
      cache = new Set();
    },
    analyzeWorkspaceActive({ active, filePaths, cacheEnabled, debug }) {
      const requests = [...filePaths.filter((f) => f !== active.fileName), ...Array.from({ length: libFiles }, (_, i) => `/lib/lib.${i}.d.ts`)];
      for (const f of requests) {
        if (!cacheEnabled) debug?.("analyzer.sourceFileCache.disabled", { filePath: f });
        else if (cache.has(f)) debug?.("analyzer.sourceFileCache.hit", { filePath: f });
        else {
          debug?.("analyzer.sourceFileCache.miss", { filePath: f });
          cache.add(f);
        }
      }
      const fns = [...active.code.matchAll(/function (\w+)/g)].map((m) => m[1]);
      return { graph: { nodes: fns.map((n) => ({ id: `fn:${n}`, name: n, file: active.fileName })), edges: fns.slice(1).map((n, i) => ({ id: `e${i}`, source: `fn:${fns[0]}`, target: `fn:${n}`, kind: "calls" })) }, imports: [], exports: [], calls: [], diagnostics: [], meta: { usedTsconfig: true, rootFiles: filePaths.length } };
    },
  };
}
function fakeTarget(analyzer, n = 5) {
  const root = tmp("exp02-t-");
  T.generateSyntheticWorkspace(root, n);
  T.bindAnalyzer(analyzer);
  return T.makeRepositoryTarget("synthetic-test", "test", root, path.join(root, "entry.ts"));
}

// ---- fidelity --------------------------------------------------------------------------------
test("Section A matches the original: synthetic workspace, file listing, scenario code", () => {
  const O = originalModule();
  for (const n of [2, 13, 100, 523]) {
    const a = tmp("exp02-a-");
    const b = tmp("exp02-b-");
    O.generateSyntheticWorkspace(a, n);
    T.generateSyntheticWorkspace(b, n);
    const la = O.listWorkspaceFiles(a).map((f) => path.relative(a, f));
    const lb = T.listWorkspaceFiles(b).map((f) => path.relative(b, f));
    assert.deepEqual(lb, la, `listing ${n}`);
    for (const f of [...la, "tsconfig.json"]) assert.equal(fs.readFileSync(path.join(b, f), "utf8"), fs.readFileSync(path.join(a, f), "utf8"), `${n}/${f}`);
  }
  for (const s of ["cold", "repeated", "active-edit"]) for (const i of [0, 7]) assert.equal(T.getScenarioCode("x", s, i), O.getScenarioCode("x", s, i));
});

test("Section A matches the original: result cache, cache key, normalization, statistics", () => {
  const fake = fakeAnalyzer();
  const O = originalModule(fake);
  const target = fakeTarget(fake, 12);
  const mode = T.cacheModes[2];
  for (const code of [target.activeCode, T.getScenarioCode(target.activeCode, "active-edit", 3)]) {
    const oc = new O.PanelEquivalentResultCache();
    const tc = new T.PanelEquivalentResultCache();
    const ev = (arr) => (e) => arr.push(e);
    const eo = [];
    const et = [];
    fake.clearAnalyzerCaches();
    const r1 = O.analyzePanelEquivalent({ target, activeCode: code, mode, resultCache: oc, debug: ev(eo) });
    fake.clearAnalyzerCaches();
    const r2 = T.analyzePanelEquivalent({ target, activeCode: code, mode, resultCache: tc, debug: ev(et) });
    assert.deepEqual(r2, r1);
    const r3 = O.analyzePanelEquivalent({ target, activeCode: code, mode, resultCache: oc, debug: ev(eo) });
    const r4 = T.analyzePanelEquivalent({ target, activeCode: code, mode, resultCache: tc, debug: ev(et) });
    assert.deepEqual(r4, r3);
    assert.equal(r4.cacheHit, true);
    assert.deepEqual(et, eo);
    assert.equal(T.normalizeAnalysisResult(r2.result).hash, O.normalizeAnalysisResult(r1.result).hash);
  }
  const xs = [5, 1, 9, 3, 3, 8, 2, 7, 6, 4, 10];
  assert.deepEqual(T.stats(xs), O.stats(xs));
  for (const p of [0.5, 0.95, 0.25]) assert.equal(T.percentile([...xs].sort((a, b) => a - b), p), O.percentile([...xs].sort((a, b) => a - b), p));
});

test("fast per-iteration hash equals the original normalization hash", () => {
  const O = originalModule();
  const rnd = T.mulberry32(7);
  for (let k = 0; k < 30; k++) {
    const item = () => ({ id: `n${Math.floor(rnd() * 50)}`, name: rnd() < 0.3 ? "한글이름" : `x${Math.floor(rnd() * 9)}`, range: { start: { line: Math.floor(rnd() * 9), character: 1 } }, tags: rnd() < 0.5 ? [1, "a", null] : undefined });
    const many = (n) => Array.from({ length: n }, item);
    const r = { graph: { nodes: many(Math.floor(rnd() * 20)), edges: many(Math.floor(rnd() * 20)) }, imports: many(3), exports: many(2), calls: many(4), diagnostics: k % 3 ? many(1) : undefined };
    assert.equal(T.fastNormalizedHash(r).hash, O.normalizeAnalysisResult(r).hash);
  }
});

test("measurement loop: same events and result hits as the original loop; samples recorded per iteration", () => {
  const fake = fakeAnalyzer();
  const target = fakeTarget(fake, 8);
  const rows = [];
  for (const s of T.scenarios) rows.push(...T.runScenarioSamples(target, s, { warmupRuns: 2, measuredRuns: 4, group: "A" }));
  assert.equal(rows.length, 3 * 3 * 6);
  const W = target.filePaths.length - 1 + 3;
  const pick = (sc, m) => rows.filter((r) => r.scenario === sc && r.mode === m && r.isWarmup === 0);
  assert.ok(pick("repeated", "off").every((r) => r.sfDisabled === W && r.sfHit === 0));
  assert.ok(pick("repeated", "sourcefile").every((r) => r.sfHit === W)); // warm after warm-up
  assert.ok(pick("cold", "sourcefile").every((r) => r.sfMiss === W && r.sfHit === 0)); // cleared every iteration
  assert.ok(pick("repeated", "full").every((r) => r.resultHit === 1 && r.sfHit + r.sfMiss === 0));
  assert.ok(pick("active-edit", "full").every((r) => r.resultHit === 0 && r.resultMiss === 1));
  assert.ok(pick("active-edit", "off").every((r) => r.variantReflected === "1"));
  const inv = T.sampleInvariants(rows, { "synthetic-test": W });
  assert.deepEqual(inv.problems, []);
  assert.equal(inv.hashMismatch, 0);
  assert.equal(inv.fullRepeatedAllResultHit, true);
  assert.equal(inv.fullActiveEditResultHits, 0);
  // the ORIGINAL runScenario, run with the same fake analyzer, reports the same measured counts
  const helpers = ["analyzePanelEquivalent", "getAnalysisCacheKey", "getScenarioCode", "stats", "percentile", "stableStringify", "cloneAnalysisResult", "normalizeComparablePath", "hashText", "clampGraphDepth"].map((n) => extract(n));
  const origRun = new Function("fs", "path", "crypto", "isWin", "RESULT_CACHE_LIMIT", "analyzeWorkspaceActive", "clearAnalyzerCaches", "performance", "warmupRuns", "measuredRuns", "cacheModes", [...helpers, extract("PanelEquivalentResultCache", "class"), extract("runScenario"), "return runScenario;"].join(String.fromCharCode(10)))(fs, path, crypto, process.platform === "win32", 40, fake.analyzeWorkspaceActive, fake.clearAnalyzerCaches, performance, 2, 4, T.cacheModes);
  const sum = (sc, m, f) => pick(sc, m).reduce((a, r) => a + r[f], 0);
  for (const s of T.scenarios) {
    for (const row of origRun(target, s)) {
      assert.equal(row.runs, pick(s.id, row.cacheMode).length, `${s.id}/${row.cacheMode} runs`);
      assert.equal(row.sourceFileCacheHits, sum(s.id, row.cacheMode, "sfHit"), `${s.id}/${row.cacheMode} hits`);
      assert.equal(row.sourceFileCacheMisses, sum(s.id, row.cacheMode, "sfMiss"), `${s.id}/${row.cacheMode} misses`);
      assert.equal(row.resultCacheHits, sum(s.id, row.cacheMode, "resultHit"), `${s.id}/${row.cacheMode} result hits`);
      assert.equal(row.resultCacheMisses, sum(s.id, row.cacheMode, "resultMiss"), `${s.id}/${row.cacheMode} result misses`);
    }
  }
});

test("invariants catch a broken request count, an unreflected variant and a hash mismatch", () => {
  const base = { group: "A", target: "t", scenario: "active-edit", process: "p0", block: 0, isWarmup: 0, sfStale: 0, sfBypass: 0, resultMiss: 0, resultHit: 0, variantReflected: "1" };
  const rows = [
    { ...base, mode: "off", iteration: 5, sfDisabled: 10, sfHit: 0, sfMiss: 0, resultHash: "h" },
    { ...base, mode: "sourcefile", iteration: 5, sfDisabled: 0, sfHit: 4, sfMiss: 5, resultHash: "h" },
    { ...base, mode: "full", iteration: 5, sfDisabled: 0, sfHit: 10, sfMiss: 0, resultHash: "x", variantReflected: "0" },
  ];
  const inv = T.sampleInvariants(rows, { t: 10 });
  assert.equal(inv.problems.length, 3);
  assert.equal(inv.hashMismatch, 1);
});

test("hit-path correctness checks pass on a consistent analyzer and fail on an inconsistent one", () => {
  const fake = fakeAnalyzer();
  const target = fakeTarget(fake, 6);
  const c = T.correctnessChecks(target);
  assert.ok(c.rows.every((r) => r.pass === 1), JSON.stringify(c.rows));
  const bad = fakeAnalyzer();
  const inner = bad.analyzeWorkspaceActive;
  bad.analyzeWorkspaceActive = (args) => {
    const r = inner(args);
    if (args.cacheEnabled) r.graph.edges = [];
    return r;
  };
  T.bindAnalyzer(bad);
  assert.ok(T.correctnessChecks(target).rows.some((r) => r.pass === 0));
});

test("statistics: type-7 quantiles, bootstrap determinism, rank tests, Holm", () => {
  assert.equal(T.quantile7([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(T.percentile([1, 2, 3, 4], 0.5), 2);
  const d = T.describe([1, 2, 3, 4, 5]);
  assert.deepEqual([d.medianType7, d.q1, d.q3, d.iqr, d.sdSample.toFixed(4)], [3, 2, 4, 2, "1.5811"]);
  const off = Array.from({ length: 30 }, (_, i) => 1000 + (i % 7) * 10);
  const sf = off.map((x) => x * 0.35);
  const b1 = T.bootstrapReduction(off, sf, { resamples: 2000, seed: 1 });
  const b2 = T.bootstrapReduction(off, sf, { resamples: 2000, seed: 1 });
  assert.deepEqual(b1, b2);
  assert.ok(b1.rLow <= 0.65 && b1.rHigh >= 0.65);
  const mw = T.mannWhitney(off, sf);
  assert.ok(mw.p < 1e-6);
  assert.equal(T.cliffsDelta(off, sf), 1);
  assert.equal(T.hodgesLehmann([3, 4], [1, 2]), 2);
  assert.deepEqual(T.holm([0.01, 0.04, 0.03]).map((x) => Number(x.toFixed(2))), [0.03, 0.06, 0.06]);
  const rows = T.summarize([...off.map((v, i) => ({ target: "t", scenario: "s", mode: "off", isWarmup: 0, elapsedMs: v, iteration: i })), ...sf.map((v, i) => ({ target: "t", scenario: "s", mode: "sourcefile", isWarmup: 0, elapsedMs: v, iteration: i }))], { resamples: 500 });
  const r = rows.find((x) => x.mode === "sourcefile");
  assert.equal(Number(r.reductionType7.toFixed(2)), 0.65);
});

test("comparison to history: direction and magnitude rules", () => {
  const mk = (rLow, rHigh) => ({ target: "cogic", scenario: "active-edit", mode: "sourcefile", rLow, rHigh, rHalfWidth: (rHigh - rLow) / 2, reductionNearestRank: (rLow + rHigh) / 2, reductionType7: (rLow + rHigh) / 2 });
  const hist = [{ target: "cogic", scenario: "active-edit", mode: "sourcefile", rHist: 0.664, p50: 366 }, { target: "cogic", scenario: "active-edit", mode: "off", rHist: null, p50: 1088 }];
  const off = { target: "cogic", scenario: "active-edit", mode: "off", p50NearestRank: 900 };
  assert.deepEqual(T.compareToHistory([off, mk(0.6, 0.7)], hist).map((x) => [x.effectDirection, x.magnitude]), [["YES", "COMPATIBLE"]]);
  assert.deepEqual(T.compareToHistory([off, mk(0.4, 0.5)], hist).map((x) => [x.effectDirection, x.magnitude]), [["YES", "NOT_COMPATIBLE"]]);
  assert.deepEqual(T.compareToHistory([off, mk(-0.1, 0.2)], hist).map((x) => [x.effectDirection, x.magnitude]), [["NO", "NOT_ASSESSED"]]);
  assert.deepEqual(T.compareToHistory([off, mk(-0.3, -0.1)], hist).map((x) => [x.effectDirection, x.magnitude]), [["REVERSED", "NOT_ASSESSED"]]);
  const hr = T.historicalRows(repoRoot);
  assert.equal(hr.length, 54);
  const h = hr.find((x) => x.target === "cogic" && x.scenario === "active-edit" && x.mode === "sourcefile");
  assert.equal(Number(h.rHist.toFixed(3)), 0.664);
});

test("integrity, output guards and publishing", () => {
  const r = T.integrityCheck(repoRoot);
  assert.equal(r.ok, true, JSON.stringify(r.files.filter((f) => !f.ok)));
  assert.equal(r.files.length, 8);
  const copy = tmp("exp02-int-");
  for (const f of Object.keys(T.PROTECTED)) {
    fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, f), path.join(copy, f));
  }
  assert.equal(T.integrityCheck(copy).ok, true);
  fs.appendFileSync(path.join(copy, "docs/benchmarks/analysis-cache/results.md"), "x");
  assert.equal(T.integrityCheck(copy).ok, false);
  assert.throws(() => T.assertOutputAllowed(path.join(repoRoot, "docs/benchmarks/analysis-cache/new")), /docs\/benchmarks/);
  assert.throws(() => T.assertOutputAllowed(copy), /overwrite/);
  const run = tmp("exp02-run-");
  for (const f of ["samples.csv", "correctness.csv", "summary.csv", "comparison-to-hist.csv", "summary.md"]) fs.writeFileSync(path.join(run, f), "a,b\n1,2\n");
  fs.writeFileSync(path.join(run, "integrity.json"), "{}");
  fs.writeFileSync(path.join(run, "run.json"), JSON.stringify({ failures: [] }));
  fs.writeFileSync(path.join(run, "env.json"), JSON.stringify({ url: "https://example.org/x" }));
  fs.writeFileSync(path.join(run, "workloads.json"), JSON.stringify({ workloads: [{ files: [{ path: "src/a.ts" }] }] }));
  const to = path.join(tmp("exp02-pub-"), "out");
  T.publish(run, to);
  assert.ok(fs.existsSync(path.join(to, "samples.csv")));
  fs.writeFileSync(path.join(run, "env.json"), JSON.stringify({ cwd: "C:\\Users\\someone\\x" }));
  assert.throws(() => T.publish(run, path.join(tmp("exp02-pub-"), "out")), /absolute paths/);
});

// EXP-02 plan §7 lists 6x active-edit x3 + 2x repeated x3 + cogic cold x3 = 27 conditions (it states "30").
test("robust condition set and seeded order", () => {
  assert.equal(T.ROBUST_CONDITIONS.length, 27);
  assert.deepEqual(T.shuffled(T.ROBUST_CONDITIONS, 5), T.shuffled(T.ROBUST_CONDITIONS, 5));
  assert.notDeepEqual(T.shuffled(T.ROBUST_CONDITIONS, 5), T.shuffled(T.ROBUST_CONDITIONS, 6));
});
