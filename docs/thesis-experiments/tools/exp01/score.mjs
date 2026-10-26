#!/usr/bin/env node
// EXP-01 scorer (P1-A).
//
// Compares analyzer predictions with the pre-registered Ground Truth and writes
// row-level verdicts and metrics. P1-A only exercises this tool with synthetic
// predictions in unit tests; it is not run on Cogic output in this phase.
//
// Prediction files: <predictions>/<caseId>.json, one of
//   { "schema": "exp01-raw/1", "caseId", "fixtureRoot": "<abs path used at run>", "analyzerOutput": { "graph": {...} } }
//   { "schema": "exp01-pred/1", "caseId", "relations": [{ kind, srcKey, tgtKey, argIndex?, sourceFramework? }] }
//
// Usage:
//   node score.mjs --predictions <dir> --out <dir> [--corpus <dir>] [--gt-version 1]
//                  [--allow-missing] [--bootstrap 10000] [--seed 20261026]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORIES,
  PRED_SCHEMA,
  bootstrapMicroF1,
  computeMetrics,
  gtFileName,
  lenientKey,
  listCaseDirs,
  loadCatalog,
  metricsByPattern,
  normalizeCogicGraph,
  readJson,
  relationKey,
  resolveGt,
  scoreCase,
  toCsv,
  validateGtStructure,
} from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

export const METRIC_COLUMNS = [
  "mode",
  "category",
  "tpPred",
  "fp",
  "excluded",
  "precision",
  "precisionLow",
  "precisionHigh",
  "precisionSensitivity",
  "gtInScope",
  "tpInScope",
  "fnInScope",
  "recallInScope",
  "recallInScopeLow",
  "recallInScopeHigh",
  "f1InScope",
  "gtOverall",
  "tpOverall",
  "fnOverall",
  "recallOverall",
  "recallOverallLow",
  "recallOverallHigh",
  "f1Overall",
];

function parseArgs(argv) {
  const args = {
    corpus: path.join(repoRoot, "docs/thesis-experiments/fixtures/exp-01"),
    predictions: null,
    out: null,
    gtVersion: 1,
    allowMissing: false,
    bootstrap: 10000,
    seed: 20261026,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--corpus") {
      args.corpus = path.resolve(argv[++i]);
    } else if (a === "--predictions") {
      args.predictions = path.resolve(argv[++i]);
    } else if (a === "--out") {
      args.out = path.resolve(argv[++i]);
    } else if (a === "--gt-version") {
      args.gtVersion = Number(argv[++i]);
    } else if (a === "--allow-missing") {
      args.allowMissing = true;
    } else if (a === "--bootstrap") {
      args.bootstrap = Number(argv[++i]);
    } else if (a === "--seed") {
      args.seed = Number(argv[++i]);
    } else {
      throw new Error(`unknown argument ${a}`);
    }
  }
  if (!args.predictions || !args.out) {
    throw new Error("--predictions and --out are required");
  }
  return args;
}

// Accepts raw analyzer output or pre-normalized predictions.
export function loadPrediction(doc, caseId) {
  if (doc.schema === PRED_SCHEMA) {
    const relations = (doc.relations ?? []).map((r) => ({
      kind: r.kind,
      srcKey: r.srcKey,
      tgtKey: r.tgtKey ?? null,
      argIndex: r.argIndex,
      key: relationKey(r.kind, r.srcKey, r.tgtKey ?? null, r.argIndex),
      lenientKey: lenientKey(r.kind, r.srcKey, r.tgtKey ?? null, r.argIndex),
      sourceFramework: r.sourceFramework ?? null,
      occurrences: r.occurrences ?? 1,
    }));
    const unique = new Map();
    const duplicates = [];
    for (const r of relations) {
      if (unique.has(r.key)) {
        unique.get(r.key).occurrences += r.occurrences;
      } else {
        unique.set(r.key, { ...r });
      }
    }
    for (const r of unique.values()) {
      if (r.occurrences > 1) {
        duplicates.push({ key: r.key, occurrences: r.occurrences });
      }
    }
    return { caseId, relations: [...unique.values()], collisions: doc.collisions ?? [], duplicates, malformed: [] };
  }
  const graph = doc.analyzerOutput?.graph ?? doc.graph;
  if (!graph) {
    throw new Error(`prediction for ${caseId}: no graph (expected analyzerOutput.graph)`);
  }
  if (!doc.fixtureRoot) {
    throw new Error(`prediction for ${caseId}: fixtureRoot missing`);
  }
  return normalizeCogicGraph(graph, { fixtureRoot: doc.fixtureRoot, caseId });
}

export function scoreCorpus({ corpus, gtVersion = 1, predictionFor, allowMissing = false }) {
  const catalog = loadCatalog(path.join(corpus, "catalog.csv"));
  const results = { strict: [], lenient: [] };
  const missing = [];
  const diagnostics = [];
  for (const dir of listCaseDirs(corpus)) {
    const gt = readJson(path.join(dir, gtFileName(gtVersion)));
    const structural = validateGtStructure(gt, catalog);
    if (structural.errors.length > 0) {
      throw new Error(`GT ${gt.caseId} is invalid: ${structural.errors.join("; ")}`);
    }
    const resolved = resolveGt(gt, catalog);
    let pred = predictionFor(gt.caseId);
    if (!pred) {
      if (!allowMissing) {
        throw new Error(`missing prediction for ${gt.caseId}`);
      }
      missing.push(gt.caseId);
      pred = { caseId: gt.caseId, relations: [], collisions: [], duplicates: [], malformed: [] };
    }
    diagnostics.push({
      caseId: gt.caseId,
      collisions: pred.collisions,
      duplicates: pred.duplicates,
      malformed: pred.malformed,
    });
    results.strict.push(scoreCase(resolved, pred, "strict"));
    results.lenient.push(scoreCase(resolved, pred, "lenient"));
  }
  return { results, missing, diagnostics };
}

function writeOutputs(out, scored, { bootstrap, seed, gtVersion }) {
  fs.mkdirSync(out, { recursive: true });
  const { results, missing, diagnostics } = scored;
  const all = [...results.strict, ...results.lenient];

  const matchRows = [];
  for (const r of all) {
    for (const g of r.gtRows) {
      matchRows.push({ ...g, verdict: g.verdict, causeCode: "" });
    }
    for (const p of r.predRows) {
      matchRows.push({ ...p, causeCode: "" });
    }
  }
  fs.writeFileSync(
    path.join(out, "matches.csv"),
    toCsv(matchRows, ["caseId", "mode", "side", "id", "kind", "key", "category", "pattern", "support", "verdict", "note", "matchedBy", "occurrences", "causeCode"]),
  );

  const summary = { gtVersion, missingPredictions: missing, modes: {} };
  const metricRows = [];
  const patternRows = [];
  for (const mode of ["strict", "lenient"]) {
    const m = computeMetrics(results[mode], { categories: CATEGORIES });
    for (const row of m.byCategory) {
      metricRows.push({ mode, ...row });
    }
    metricRows.push({ mode, ...m.micro });
    for (const row of metricsByPattern(results[mode])) {
      patternRows.push({ mode, ...row });
    }
    summary.modes[mode] = {
      micro: m.micro,
      macro: m.macro,
      bootstrap: bootstrap > 0 ? bootstrapMicroF1(results[mode], { resamples: bootstrap, seed }) : null,
    };
  }
  fs.writeFileSync(path.join(out, "metrics-by-category.csv"), toCsv(metricRows, METRIC_COLUMNS));
  fs.writeFileSync(
    path.join(out, "metrics-by-pattern.csv"),
    toCsv(patternRows, ["mode", "pattern", "category", "support", "gt", "tp", "fn", "recall"]),
  );

  const indRows = all.flatMap((r) => r.indeterminateRows);
  fs.writeFileSync(
    path.join(out, "indeterminate.csv"),
    toCsv(indRows, ["caseId", "mode", "id", "kind", "srcKey", "category", "pattern", "support", "candidates", "reason", "excludedCount", "excludedPredictions"]),
  );
  const negRows = all.flatMap((r) => r.negativeRows);
  fs.writeFileSync(
    path.join(out, "negatives.csv"),
    toCsv(negRows, ["caseId", "mode", "id", "kind", "key", "category", "pattern", "violated"]),
  );
  fs.writeFileSync(path.join(out, "diagnostics.json"), `${JSON.stringify(diagnostics, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function main() {
  const args = parseArgs(process.argv);
  const predictionFor = (caseId) => {
    const file = path.join(args.predictions, `${caseId}.json`);
    if (!fs.existsSync(file)) {
      return null;
    }
    return loadPrediction(readJson(file), caseId);
  };
  const scored = scoreCorpus({
    corpus: args.corpus,
    gtVersion: args.gtVersion,
    predictionFor,
    allowMissing: args.allowMissing,
  });
  const summary = writeOutputs(args.out, scored, args);
  for (const mode of ["strict", "lenient"]) {
    const m = summary.modes[mode].micro;
    console.log(
      `${mode}: P=${m.precision ?? "n/a"} R_in=${m.recallInScope ?? "n/a"} R_all=${m.recallOverall ?? "n/a"} (TP ${m.tpPred}, FP ${m.fp}, EXCLUDED ${m.excluded})`,
    );
  }
  if (scored.missing.length > 0) {
    console.log(`missing predictions (scored as empty): ${scored.missing.join(", ")}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

export { writeOutputs };
