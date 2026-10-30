#!/usr/bin/env node
// P1-L: score ORIGINAL and IMPROVED Corpus B runs with the unchanged scorer 1.2 (v1, primary) and the
// approved v2 sensitivity split (tools/corpus-b-scoring/scope-v2.mjs), then compare them:
// per-kind / per-framework tables, relation-level transitions, and a paired case-cluster bootstrap of
// the differences (10,000 resamples, seed 20261101; v1 and v2 share the same resampled case indices).
// Usage: node score-pair.mjs --original <runDir> --improved <runDir> --out <new dir> [--bootstrap 10000]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../..");
const lib = await import(pathToFileURL(path.join(REPO_ROOT, "docs/thesis-experiments/tools/exp01/lib.mjs")).href);
const score = await import(pathToFileURL(path.join(REPO_ROOT, "docs/thesis-experiments/tools/exp01/score.mjs")).href);
const scope = await import(pathToFileURL(path.join(REPO_ROOT, "docs/thesis-experiments/tools/corpus-b-scoring/scope-v2.mjs")).href);

export const PAIR_VERSION = "corpus-b-pair/1";
export const PAIRED_SEED = 20261101;
export const CASE_SEED = 20261026;
const CORPUS = path.join(REPO_ROOT, "docs/thesis-experiments/corpus-b/fixtures");
const round = (x) => (x === null || x === undefined ? null : Number(x.toFixed(6)));

export function frameworkOf(corpus = CORPUS) {
  return new Map(lib.listCaseDirs(corpus).map((d) => {
    const c = lib.readJson(path.join(d, "case.json"));
    return [c.caseId, c.category];
  }));
}

const counts = (r) => {
  const tpPred = r.predRows.filter((p) => p.verdict === "TP").length;
  const fp = r.predRows.filter((p) => p.verdict === "FP").length;
  const excluded = r.predRows.filter((p) => p.verdict === "EXCLUDED").length;
  const inScope = r.gtRows.filter((g) => g.support === "supported");
  return { tpPred, fp, excluded, gtInScope: inScope.length, tpInScope: inScope.filter((g) => g.verdict === "TP").length, gtOverall: r.gtRows.length, tpOverall: r.gtRows.filter((g) => g.verdict === "TP").length };
};
const add = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + b[k]]));
const zero = () => ({ tpPred: 0, fp: 0, excluded: 0, gtInScope: 0, tpInScope: 0, gtOverall: 0, tpOverall: 0 });
const metrics = (c) => {
  const m = lib.metricsFromCounts(c);
  return { tp: c.tpPred, fp: c.fp, excluded: c.excluded, fnInScope: c.gtInScope - c.tpInScope, fnOverall: c.gtOverall - c.tpOverall, precision: round(m.precision), recallInScope: round(m.recallInScope), recallOverall: round(m.recallOverall), f1InScope: round(m.f1InScope), f1Overall: round(m.f1Overall) };
};

function percentile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// perCase: [{ caseId, o: {v1, v2}, i: {v1, v2} }] counts. Same resampled indices for every statistic.
export function pairedBootstrap(perCase, { resamples = 10000, seed = PAIRED_SEED } = {}) {
  const rand = lib.mulberry32(seed);
  const n = perCase.length;
  const stats = ["precision", "recallInScope", "recallOverall", "f1InScope", "f1Overall"];
  const draws = { v1: Object.fromEntries(stats.map((s) => [s, []])), v2: Object.fromEntries(stats.map((s) => [s, []])), diffOfDiff: [] };
  let undefinedDraws = 0;
  for (let b = 0; b < resamples; b++) {
    const agg = { o1: zero(), i1: zero(), o2: zero(), i2: zero() };
    for (let k = 0; k < n; k++) {
      const c = perCase[Math.floor(rand() * n)];
      agg.o1 = add(agg.o1, c.o.v1);
      agg.i1 = add(agg.i1, c.i.v1);
      agg.o2 = add(agg.o2, c.o.v2);
      agg.i2 = add(agg.i2, c.i.v2);
    }
    const m = Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, lib.metricsFromCounts(v)]));
    const d1 = Object.fromEntries(stats.map((s) => [s, m.i1[s] === null || m.o1[s] === null ? null : m.i1[s] - m.o1[s]]));
    const d2 = Object.fromEntries(stats.map((s) => [s, m.i2[s] === null || m.o2[s] === null ? null : m.i2[s] - m.o2[s]]));
    if ([...Object.values(d1), ...Object.values(d2)].some((x) => x === null)) {
      undefinedDraws += 1;
      continue;
    }
    for (const s of stats) {
      draws.v1[s].push(d1[s]);
      draws.v2[s].push(d2[s]);
    }
    draws.diffOfDiff.push(d2.f1InScope - d1.f1InScope);
  }
  const ci = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return { low: round(percentile(s, 0.025)), high: round(percentile(s, 0.975)), shareAboveZero: round(s.filter((x) => x > 0).length / (s.length || 1)), shareBelowZero: round(s.filter((x) => x < 0).length / (s.length || 1)) };
  };
  return {
    resamples,
    seed,
    cases: n,
    undefinedDraws,
    v1: Object.fromEntries(stats.map((s) => [s, ci(draws.v1[s])])),
    v2: Object.fromEntries(stats.map((s) => [s, ci(draws.v2[s])])),
    diffOfDiffF1InScope: ci(draws.diffOfDiff),
  };
}

function byKind(results) {
  const out = {};
  for (const r of results) {
    for (const g of r.gtRows) {
      const k = (out[g.kind] ??= { gt: 0, tp: 0, gtInScope: 0, tpInScope: 0, fp: 0, excluded: 0 });
      k.gt += 1;
      k.tp += g.verdict === "TP" ? 1 : 0;
      if (g.support === "supported") {
        k.gtInScope += 1;
        k.tpInScope += g.verdict === "TP" ? 1 : 0;
      }
    }
    for (const p of r.predRows) {
      const k = (out[p.kind] ??= { gt: 0, tp: 0, gtInScope: 0, tpInScope: 0, fp: 0, excluded: 0 });
      if (p.verdict === "FP") k.fp += 1;
      if (p.verdict === "EXCLUDED") k.excluded += 1;
    }
  }
  return Object.fromEntries(Object.entries(out).sort().map(([k, v]) => [k, { ...v, fn: v.gt - v.tp, fnInScope: v.gtInScope - v.tpInScope, recallInScope: round(lib.safeDiv(v.tpInScope, v.gtInScope)), recallOverall: round(lib.safeDiv(v.tp, v.gt)) }]));
}

export function transitions(oResults, iResults) {
  const gt = (rs) => new Map(rs.flatMap((r) => r.gtRows.map((g) => [`${r.caseId}/${g.id}`, g])));
  const fp = (rs) => new Map(rs.flatMap((r) => r.predRows.filter((p) => p.verdict === "FP").map((p) => [`${r.caseId}|${p.key}`, p])));
  const go = gt(oResults);
  const gi = gt(iResults);
  const t = { TP_TP: [], TP_FN: [], FN_TP: [], FN_FN: [] };
  for (const [k, g] of go) {
    const h = gi.get(k);
    t[`${g.verdict}_${h.verdict}`].push({ item: k, kind: g.kind, pattern: g.pattern, support: g.support, key: g.key });
  }
  const fo = fp(oResults);
  const fi = fp(iResults);
  const newFp = [...fi.keys()].filter((k) => !fo.has(k)).map((k) => ({ item: k, kind: fi.get(k).kind }));
  const goneFp = [...fo.keys()].filter((k) => !fi.has(k)).map((k) => ({ item: k, kind: fo.get(k).kind }));
  const tally = (xs, f) => xs.reduce((o, x) => ((o[f(x)] = (o[f(x)] ?? 0) + 1), o), {});
  return {
    counts: { TP_TP: t.TP_TP.length, TP_FN_lost: t.TP_FN.length, FN_TP_recovered: t.FN_TP.length, FN_FN: t.FN_FN.length, newFP: newFp.length, removedFP: goneFp.length },
    lost: t.TP_FN,
    recovered: t.FN_TP,
    recoveredByPattern: tally(t.FN_TP, (x) => x.pattern),
    lostByPattern: tally(t.TP_FN, (x) => x.pattern),
    newFP: newFp,
    newFPByKind: tally(newFp, (x) => x.kind),
    removedFP: goneFp,
    removedFPByKind: tally(goneFp, (x) => x.kind),
  };
}

export function scorePair({ originalPredictions, improvedPredictions, corpus = CORPUS, bootstrap = 10000, writeTo = null }) {
  const load = (dir) => (caseId) => {
    const f = path.join(dir, `${caseId}.json`);
    return fs.existsSync(f) ? score.loadPrediction(lib.readJson(f), caseId) : null;
  };
  const fw = frameworkOf(corpus);
  const side = (label, dir) => {
    const s = scope.scoreV1V2({ corpus, predictionFor: load(dir) });
    if (writeTo) {
      score.writeOutputs(path.join(writeTo, label, "v1"), s.v1, { bootstrap, seed: CASE_SEED, gtVersion: 1 });
      score.writeOutputs(path.join(writeTo, label, "v2"), s.v2, { bootstrap, seed: CASE_SEED, gtVersion: 1 });
      fs.writeFileSync(path.join(writeTo, label, "scope-comparison.json"), `${JSON.stringify({ label, ...s.comparison }, null, 2)}\n`);
    }
    return s;
  };
  const o = side("ORIGINAL", originalPredictions);
  const i = side("IMPROVED", improvedPredictions);
  const scored = (s) => new Set(s.v1.results.strict.filter(lib.isConfirmatory).map((r) => r.caseId));
  const both = [...scored(o)].filter((c) => scored(i).has(c));
  const pick = (s, v, ids) => s[v].results.strict.filter((r) => ids.includes(r.caseId));
  const perCase = both.map((caseId) => {
    const one = (s, v) => counts(s[v].results.strict.find((r) => r.caseId === caseId));
    return { caseId, o: { v1: one(o, "v1"), v2: one(o, "v2") }, i: { v1: one(i, "v1"), v2: one(i, "v2") } };
  });
  const total = (side, v) => perCase.reduce((a, c) => add(a, c[side][v]), zero());
  const table = {};
  for (const v of ["v1", "v2"]) {
    const om = metrics(total("o", v));
    const im = metrics(total("i", v));
    table[v] = { ORIGINAL: om, IMPROVED: im, delta: Object.fromEntries(Object.keys(om).map((k) => [k, om[k] === null || im[k] === null ? null : round(im[k] - om[k])])) };
  }
  const frameworks = {};
  for (const f of ["react", "vue", "express", "nest"]) {
    const ids = both.filter((c) => fw.get(c) === f);
    const t = (side, v) => ids.reduce((a, c) => add(a, perCase.find((p) => p.caseId === c)[side][v]), zero());
    frameworks[f] = { cases: ids.length, v1: { ORIGINAL: metrics(t("o", "v1")), IMPROVED: metrics(t("i", "v1")) }, v2: { ORIGINAL: metrics(t("o", "v2")), IMPROVED: metrics(t("i", "v2")) } };
  }
  const negatives = (s) => s.v1.results.strict.flatMap((r) => r.negativeRows.filter((n) => n.violated).map((n) => `${r.caseId}/${n.id}`));
  const indeterminate = (s, v) => s[v].results.strict.flatMap((r) => r.indeterminateRows.filter((x) => x.excludedCount > 0).map((x) => ({ item: `${r.caseId}/${x.id}`, excluded: x.excludedCount })));
  return {
    schema: PAIR_VERSION,
    scorer: lib.SCORER_VERSION,
    mode: "strict",
    scoringStatus: { ORIGINAL: o.v1.blocked.length ? "BLOCKED" : "COMPLETE", IMPROVED: i.v1.blocked.length ? "BLOCKED" : "COMPLETE" },
    blockedCases: { ORIGINAL: o.v1.blocked, IMPROVED: i.v1.blocked },
    missingPredictions: { ORIGINAL: o.v1.missing, IMPROVED: i.v1.missing },
    pairedCases: both.length,
    table,
    byKind: { ORIGINAL: byKind(pick(o, "v1", both)), IMPROVED: byKind(pick(i, "v1", both)) },
    frameworks,
    transitions: transitions(pick(o, "v1", both), pick(i, "v1", both)),
    negativeViolations: { ORIGINAL: negatives(o), IMPROVED: negatives(i) },
    indeterminateExclusions: { ORIGINAL: { v1: indeterminate(o, "v1"), v2: indeterminate(o, "v2") }, IMPROVED: { v1: indeterminate(i, "v1"), v2: indeterminate(i, "v2") } },
    scope: {
      ORIGINAL: { predictions: o.comparison.predictions, riskIndicator: o.comparison.riskIndicator },
      IMPROVED: { predictions: i.comparison.predictions, riskIndicator: i.comparison.riskIndicator },
    },
    caseBootstrap: {
      ORIGINAL: { v1: lib.bootstrapMicroF1(pick(o, "v1", both), { resamples: bootstrap, seed: CASE_SEED }), v2: lib.bootstrapMicroF1(pick(o, "v2", both), { resamples: bootstrap, seed: CASE_SEED }) },
      IMPROVED: { v1: lib.bootstrapMicroF1(pick(i, "v1", both), { resamples: bootstrap, seed: CASE_SEED }), v2: lib.bootstrapMicroF1(pick(i, "v2", both), { resamples: bootstrap, seed: CASE_SEED }) },
    },
    pairedBootstrap: pairedBootstrap(perCase, { resamples: bootstrap, seed: PAIRED_SEED }),
    perCase: perCase.map((c) => ({ caseId: c.caseId, framework: fw.get(c.caseId), ORIGINAL: metrics(c.o.v1), IMPROVED: metrics(c.i.v1) })),
  };
}

function main() {
  const arg = (n, d = null) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
  const out = path.resolve(arg("--out"));
  if (fs.existsSync(out)) throw new Error(`${out} exists; refusing to overwrite`);
  fs.mkdirSync(out, { recursive: true });
  const r = scorePair({ originalPredictions: path.join(path.resolve(arg("--original")), "predictions"), improvedPredictions: path.join(path.resolve(arg("--improved")), "predictions"), bootstrap: Number(arg("--bootstrap", "10000")), writeTo: out });
  fs.writeFileSync(path.join(out, "pair-summary.json"), `${JSON.stringify(r, null, 2)}\n`);
  console.log(JSON.stringify({ status: r.scoringStatus, paired: r.pairedCases, v1: r.table.v1, v2: r.table.v2, transitions: r.transitions.counts }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
