#!/usr/bin/env node
// P1-K3: scoring-scope audit of the UNCHANGED scorer exp01-scorer/1.2 on Corpus B, with SYNTHETIC
// predictions only (built from the GT and from excludedSites). No Cogic output is read or produced.
// The scorer functions are imported unmodified from tools/exp01/lib.mjs and tools/exp01/score.mjs.
// Usage: node scoring-scope-probe.mjs [--json <out>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { repoRoot } from "./review-lib.mjs";

const lib = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/exp01/lib.mjs")).href);
const { loadPrediction } = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/exp01/score.mjs")).href);
const corpus = path.join(repoRoot, "docs/thesis-experiments/corpus-b/fixtures");
export const PROBE_VERSION = "corpus-b-scoring-scope-probe/1";

function loadCases() {
  const catalog = lib.loadCatalog(path.join(corpus, "catalog.csv"));
  return lib.listCaseDirs(corpus).map((dir) => {
    const gt = lib.readJson(path.join(dir, "expected.json"));
    const nodes = new Map(gt.nodes.map((n) => [n.id, n]));
    const k = (id) => lib.nodeKey(nodes.get(id));
    const support = (p) => catalog.get(p)?.support;
    const det = gt.relations.filter((r) => r.gtStatus === "determinate").map((r) => ({ kind: r.kind, srcKey: k(r.source), tgtKey: r.kind === "owner" ? null : k(r.target), argIndex: r.argIndex, support: support(r.pattern), lib: r.target ? nodes.get(r.target).type === "lib" : false }));
    const ind = gt.relations.filter((r) => r.gtStatus === "indeterminate").map((r) => ({ kind: r.kind, srcKey: k(r.source), candidates: r.candidates === "unbounded" ? "unbounded" : r.candidates.map((c) => ({ tgtKey: k(c.target), argIndex: c.argIndex })) }));
    const neg = gt.negatives.map((n) => ({ kind: n.kind, srcKey: k(n.source), tgtKey: n.target ? k(n.target) : null }));
    const excluded = gt.excludedSites.map((s) => Number(s.site.split(":").pop()));
    return { caseId: gt.caseId, gt, resolved: lib.resolveGt(gt, catalog), fileKey: `F|${gt.activeFile}`, det, ind, neg, excluded };
  });
}

const rel = (kind, srcKey, tgtKey, argIndex) => ({ kind, srcKey, tgtKey, ...(kind === "dataflow" ? { argIndex } : {}) });

function score(cases, predsFor) {
  const strict = cases.map((c) => lib.scoreCase(c.resolved, loadPrediction({ schema: lib.PRED_SCHEMA, caseId: c.caseId, relations: predsFor(c) }, c.caseId), "strict"));
  const m = lib.computeMetrics(strict).micro;
  const fpRows = strict.flatMap((r) => r.predRows.filter((p) => p.verdict === "FP"));
  const round = (x) => (x === null ? null : Number(x.toFixed(4)));
  return {
    predictions: strict.reduce((a, r) => a + r.predRows.length, 0),
    tp: m.tpPred,
    fp: m.fp,
    excluded: m.excluded,
    precision: round(m.precision),
    precisionSensitivity: round(m.precisionSensitivity),
    recallInScope: round(m.recallInScope),
    recallOverall: round(m.recallOverall),
    f1InScope: round(m.f1InScope),
    f1Overall: round(m.f1Overall),
    negativeViolations: strict.reduce((a, r) => a + r.negativeRows.filter((n) => n.violated).length, 0),
    fpByTargetClass: fpRows.reduce((o, p) => {
      const cls = p.key.includes("|X|shims/") ? "X|shims/*" : p.key.includes("|M|") ? "M|*" : p.kind === "owner" ? "owner" : "other";
      o[cls] = (o[cls] ?? 0) + 1;
      return o;
    }, {}),
  };
}

export function scenarios() {
  const cases = loadCases();
  const gtPreds = (c, filter = () => true) => c.det.filter(filter).map((r) => rel(r.kind, r.srcKey, r.tgtKey, r.argIndex));
  // an external-API prediction at an excluded site; the shim declares every module on its own line,
  // so a "correct" external target (the module that is really called) and a "wrong" one differ only in line
  const ext = (c, mode) =>
    c.excluded.map((line, i) => {
      if (mode === "distinct") return rel("calls", c.fileKey, `X|shims/third-party.d.ts|${100 + line}`);
      if (mode === "wrong") return rel("calls", c.fileKey, `X|shims/third-party.d.ts|${900 + line}`);
      return rel("calls", c.fileKey, "X|shims/third-party.d.ts|3"); // one module-level key: duplicates merge
    });
  const S = {};
  S.S0_perfect = score(cases, (c) => gtPreds(c));
  S.S1_perfect_without_lib_targets = score(cases, (c) => gtPreds(c, (r) => !r.lib));
  S.S2_supported_only = score(cases, (c) => gtPreds(c, (r) => r.support === "supported"));
  S.S3a_supported_plus_external_distinct = score(cases, (c) => [...gtPreds(c, (r) => r.support === "supported"), ...ext(c, "distinct")]);
  S.S3b_supported_plus_external_wrong_target = score(cases, (c) => [...gtPreds(c, (r) => r.support === "supported"), ...ext(c, "wrong")]);
  S.S3c_supported_plus_external_module_key = score(cases, (c) => [...gtPreds(c, (r) => r.support === "supported"), ...ext(c, "module")]);
  S.S4_supported_plus_unsupported_tp = score(cases, (c) => gtPreds(c, (r) => r.support !== "ambiguous"));
  S.S5_S3a_plus_unsupported_tp = score(cases, (c) => [...gtPreds(c, (r) => r.support !== "ambiguous"), ...ext(c, "distinct")]);
  S.S6_supported_plus_indeterminate_candidates = score(cases, (c) => [
    ...gtPreds(c, (r) => r.support === "supported"),
    ...c.ind.flatMap((e) => (e.candidates === "unbounded" ? [rel(e.kind, e.srcKey, "X|src/anything.ts|1", 0)] : e.candidates.map((x) => rel(e.kind, e.srcKey, x.tgtKey, x.argIndex)))),
  ]);
  S.S7_perfect_plus_negative_violations = score(cases, (c) => [...gtPreds(c), ...c.neg.map((n) => rel(n.kind, n.srcKey, n.tgtKey))]);
  // a proposed restricted precision: drop predictions whose target is a shim declaration before scoring
  const restricted = (preds) => preds.filter((p) => !String(p.tgtKey ?? "").startsWith("X|shims/"));
  S.S8_S3a_with_shim_targets_set_aside = score(cases, (c) => restricted([...gtPreds(c, (r) => r.support === "supported"), ...ext(c, "distinct")]));
  const counts = {
    determinate: cases.reduce((a, c) => a + c.det.length, 0),
    supported: cases.reduce((a, c) => a + c.det.filter((r) => r.support === "supported").length, 0),
    libTargets: cases.reduce((a, c) => a + c.det.filter((r) => r.lib).length, 0),
    excludedSites: cases.reduce((a, c) => a + c.excluded.length, 0),
    indeterminate: cases.reduce((a, c) => a + c.ind.length, 0),
    negatives: cases.reduce((a, c) => a + c.neg.length, 0),
  };
  return { schema: PROBE_VERSION, scorer: lib.SCORER_VERSION, synthetic: true, counts, scenarios: S };
}

function main() {
  const r = scenarios();
  const i = process.argv.indexOf("--json");
  if (i >= 0) {
    const out = path.resolve(process.argv[i + 1]);
    if (fs.existsSync(out)) throw new Error(`${out} exists; refusing to overwrite`);
    fs.writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`);
  }
  console.log(JSON.stringify(r.counts));
  for (const [k, v] of Object.entries(r.scenarios)) console.log(k.padEnd(46), JSON.stringify({ n: v.predictions, tp: v.tp, fp: v.fp, ex: v.excluded, P: v.precision, Rin: v.recallInScope, Rall: v.recallOverall, F1in: v.f1InScope, neg: v.negativeViolations }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
