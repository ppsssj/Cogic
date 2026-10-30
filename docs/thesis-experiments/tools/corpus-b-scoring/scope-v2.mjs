#!/usr/bin/env node
// P1-K4 (DRAFT, awaiting researcher approval): Corpus B scoring-scope sensitivity analysis.
// v1 = the unchanged scorer exp01-scorer/1.2 on all predictions (primary).
// v2 = the same unchanged scorer on the predictions whose TARGET KEY lies inside the evaluation universe
//      (secondary, predefined sensitivity). The split uses only the prediction key and the case
//      workspace file list; it never reads the GT, so it cannot select predictions by correctness.
// Everything removed is kept in the output (key, kind, class, occurrences).
// Usage: node scope-v2.mjs --corpus <fixtures> --predictions <dir of <caseId>.json> --out <new dir>
//                          [--bootstrap 10000] [--seed 20261026] [--label ORIGINAL|IMPROVED]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const lib = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/exp01/lib.mjs")).href);
const score = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/exp01/score.mjs")).href);

export const SCOPE_VERSION = "corpus-b-scope-v2/1-draft";
export const SCORER = lib.SCORER_VERSION;

// Target-key classes (EVALUATION_PROTOCOL.v2.md §4). IN_* are kept; OUT_* are set aside in v2.
export const CLASSES = {
  IN_NO_TARGET: "owner relation (no target)",
  IN_FILE: "F| file node",
  IN_LIB: "L| TypeScript lib node",
  IN_SYNTHETIC: "S| framework synthetic node",
  IN_LOCAL_DECLARATION: "D| or X| declaration in a workspace source file (not shims/)",
  IN_LOCAL_MODULE: "M| module that is a workspace source file (dynamic import of a corpus module)",
  IN_TSLIB_EXTERNAL: "X| declaration inside the TypeScript lib (<tslib>/...): kept; GT names lib targets L|, so such a key is scored as FP (key-form issue, not scope)",
  IN_UNCLASSIFIED: "any other key form: kept (conservative)",
  OUT_SHIM_DECLARATION: "X| or M| target inside shims/ (the generated untyped third-party declarations)",
  OUT_OUTSIDE_WORKSPACE: "X| or M| target outside the case workspace (<outside>/...)",
  OUT_UNRESOLVED_MODULE: "M| target path that is not a file of the case workspace",
};

export function workspaceFiles(caseDir) {
  const out = new Set();
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.add(r);
    }
  };
  walk(caseDir, "");
  return out;
}

const isShim = (p) => p.startsWith("shims/");
const isSource = (p, files) => files.has(p) && !isShim(p) && !/\.json$/.test(p) && p !== "LICENSE.upstream";

// Pure function of the key and the workspace file list (no GT, no other predictions).
export function classifyTarget(tgtKey, files) {
  if (tgtKey === null || tgtKey === undefined || tgtKey === "") return "IN_NO_TARGET";
  const [tag, p] = String(tgtKey).split("|");
  switch (tag) {
    case "F":
      return "IN_FILE";
    case "L":
      return "IN_LIB";
    case "S":
      return "IN_SYNTHETIC";
    case "D":
      return isSource(p, files) ? "IN_LOCAL_DECLARATION" : "IN_UNCLASSIFIED";
    case "X":
      if (isShim(p)) return "OUT_SHIM_DECLARATION";
      if (p.startsWith("<outside>/")) return "OUT_OUTSIDE_WORKSPACE";
      if (p.startsWith("<tslib>/")) return "IN_TSLIB_EXTERNAL";
      return isSource(p, files) ? "IN_LOCAL_DECLARATION" : "IN_UNCLASSIFIED";
    case "M":
      if (isShim(p)) return "OUT_SHIM_DECLARATION";
      if (p.startsWith("<outside>/")) return "OUT_OUTSIDE_WORKSPACE";
      return isSource(p, files) ? "IN_LOCAL_MODULE" : "OUT_UNRESOLVED_MODULE";
    default:
      return "IN_UNCLASSIFIED";
  }
}

// Split a normalized prediction (after loadPrediction / normalizeCogicGraph, i.e. after the scorer's own
// duplicate merge). Collisions, malformed edges and other blockers are carried over unchanged, so a case
// blocked in v1 is blocked in v2 as well.
export function splitPrediction(pred, files) {
  const kept = [];
  const removed = [];
  for (const r of pred.relations) {
    const cls = classifyTarget(r.tgtKey, files);
    (cls.startsWith("OUT_") ? removed : kept).push({ ...r, scopeClass: cls });
  }
  return { kept: { ...pred, relations: kept.map(({ scopeClass, ...r }) => r) }, keptClasses: kept.map((r) => ({ key: r.key, scopeClass: r.scopeClass })), removed };
}

const round = (x) => (x === null || x === undefined ? null : Number(x.toFixed(6)));
const pick = (m) => ({ tp: m.tpPred, fp: m.fp, excluded: m.excluded, precision: round(m.precision), recallInScope: round(m.recallInScope), recallOverall: round(m.recallOverall), f1InScope: round(m.f1InScope), f1Overall: round(m.f1Overall), gtInScope: m.gtInScope, gtOverall: m.gtOverall });

// Score one prediction set both ways. predictionFor(caseId) returns a normalized prediction or null.
export function scoreV1V2({ corpus, predictionFor, allowMissing = false }) {
  const dirs = new Map(lib.listCaseDirs(corpus).map((d) => [lib.readJson(path.join(d, "expected.json")).caseId, d]));
  const split = new Map();
  const v1 = score.scoreCorpus({ corpus, predictionFor, allowMissing });
  const v2 = score.scoreCorpus({
    corpus,
    allowMissing,
    predictionFor: (caseId) => {
      const p = predictionFor(caseId);
      if (!p) return null;
      const s = splitPrediction(p, workspaceFiles(dirs.get(caseId)));
      split.set(caseId, s);
      return s.kept;
    },
  });
  // removed predictions and the GT-based risk indicator (reporting only; the split above never saw the GT)
  const removed = [];
  const risk = [];
  for (const r of v1.results.strict) {
    const s = split.get(r.caseId);
    if (!s) continue;
    const fnByOwner = new Map();
    for (const g of r.gtRows.filter((x) => x.verdict === "FN" && ["calls", "constructs", "references", "dataflow"].includes(x.kind))) {
      const k = `${g.kind}|${sourceOf(g.key)}`;
      fnByOwner.set(k, [...(fnByOwner.get(k) ?? []), g.id]);
    }
    for (const x of s.removed) {
      removed.push({ caseId: r.caseId, key: x.key, kind: x.kind, scopeClass: x.scopeClass, occurrences: x.occurrences });
      const hit = fnByOwner.get(`${x.kind}|${x.srcKey}`);
      if (hit && x.scopeClass === "OUT_SHIM_DECLARATION") risk.push({ caseId: r.caseId, removedKey: x.key, sameOwnerFnGt: hit });
    }
  }
  const m1 = lib.computeMetrics(v1.results.strict);
  const m2 = lib.computeMetrics(v2.results.strict);
  const a = pick(m1.micro);
  const b = pick(m2.micro);
  const delta = Object.fromEntries(["precision", "recallInScope", "recallOverall", "f1InScope", "f1Overall"].map((k) => [k, a[k] === null || b[k] === null ? null : round(b[k] - a[k])]));
  const tally = (xs, f) => xs.reduce((o, x) => ((o[f(x)] = (o[f(x)] ?? 0) + 1), o), {});
  const keptClasses = [...split.values()].flatMap((s) => s.keptClasses);
  return {
    v1,
    v2,
    comparison: {
      schema: SCOPE_VERSION,
      scorer: SCORER,
      mode: "strict",
      blockedCases: { v1: m1.blockedCases, v2: m2.blockedCases },
      v1: a,
      v2: b,
      delta,
      predictions: { scored: keptClasses.length + removed.length, kept: keptClasses.length, removed: removed.length, keptByClass: tally(keptClasses, (x) => x.scopeClass), removedByClass: tally(removed, (x) => x.scopeClass), removedByKind: tally(removed, (x) => x.kind), removedOccurrences: removed.reduce((s, x) => s + (x.occurrences ?? 1), 0) },
      riskIndicator: { removedShimTargetsWithSameOwnerFn: risk.length, items: risk },
      removed,
    },
  };
}

function sourceOf(gtKey) {
  // relation key = kind|<srcKey>|<tgtKey>[|argIndex]; srcKey itself contains '|'
  const parts = gtKey.split("|");
  const kind = parts[0];
  const rest = parts.slice(1);
  const width = (tag) => ({ F: 2, M: 2, L: 2, X: 3, S: 3, D: 4 })[tag] ?? 2;
  return kind === "owner" ? rest.join("|") : rest.slice(0, width(rest[0])).join("|");
}

function main() {
  const arg = (n, d = null) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
  const corpus = path.resolve(arg("--corpus"));
  const predictions = path.resolve(arg("--predictions"));
  const out = path.resolve(arg("--out"));
  if (fs.existsSync(out)) throw new Error(`${out} exists; refusing to overwrite`);
  const bootstrap = Number(arg("--bootstrap", "10000"));
  const seed = Number(arg("--seed", "20261026"));
  const predictionFor = (caseId) => {
    const f = path.join(predictions, `${caseId}.json`);
    return fs.existsSync(f) ? score.loadPrediction(lib.readJson(f), caseId) : null;
  };
  const { v1, v2, comparison } = scoreV1V2({ corpus, predictionFor });
  score.writeOutputs(path.join(out, "v1"), v1, { bootstrap, seed, gtVersion: 1 });
  score.writeOutputs(path.join(out, "v2"), v2, { bootstrap, seed, gtVersion: 1 });
  fs.writeFileSync(path.join(out, "scope-comparison.json"), `${JSON.stringify({ label: arg("--label"), ...comparison }, null, 2)}\n`);
  console.log(JSON.stringify({ v1: comparison.v1, v2: comparison.v2, delta: comparison.delta, removed: comparison.predictions.removedByClass }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
