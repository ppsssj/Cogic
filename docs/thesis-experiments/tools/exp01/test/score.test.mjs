// Unit tests for the EXP-01 scoring tools (P1-A).
// All predictions here are hand-written synthetic data. The Cogic analyzer is never imported.
// Run: node --test docs/thesis-experiments/tools/exp01/test/score.test.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bootstrapMicroF1,
  cogicNodeKey,
  cohenKappa,
  computeMetrics,
  f1,
  listCaseDirs,
  isConfirmatory,
  loadCatalog,
  maximumMatching,
  metricsByPattern,
  mulberry32,
  normalizeCogicGraph,
  parseCsv,
  readJson,
  relativeFixturePath,
  resolveExternalCollision,
  resolveGt,
  SCORER_VERSION,
  scoreCase,
  toCsv,
  validateGtStructure,
  wilson,
} from "../lib.mjs";
import { loadPrediction, scoreCorpus, writeOutputs } from "../score.mjs";
import { collectItems, drawSample } from "../review-sample.mjs";
import { agreement } from "../review-agreement.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.resolve(here, "../../../fixtures/exp-01");
const catalog = loadCatalog(path.join(corpus, "catalog.csv"));

const ROOT = "C:\\fx\\case";
const abs = (rel) => `${ROOT}\\${rel.replace(/\//g, "\\")}`;

// --- synthetic Cogic-like graph builder ------------------------------------
function cnode(kind, rel, line, name, extra = {}) {
  const file = abs(rel);
  const pos = extra.pos ?? line * 100;
  return {
    id: extra.id ?? `${kind}:${file}:${pos}`,
    kind,
    name,
    file,
    range: { start: { line: line - 1, character: 0 }, end: { line: line - 1, character: 1 } },
    ...(extra.parentId ? { parentId: extra.parentId } : {}),
  };
}
function cedge(kind, src, tgt, { label = "", arg = null } = {}) {
  return {
    id: `${kind}:${src.id}->${tgt.id}@@${label}@@${arg === null ? "" : `arg#${arg}`}`,
    kind,
    source: src.id,
    target: tgt.id,
    label,
  };
}

// Minimal GT used by most tests.
function baseGt(extra = {}) {
  return {
    schema: "exp01-gt/1",
    caseId: "t01",
    gtVersion: 1,
    activeFile: "main.ts",
    nodes: [
      { id: "file", type: "file", file: "main.ts" },
      { id: "a", type: "callable", file: "main.ts", line: 1, name: "a" },
      { id: "b", type: "callable", file: "main.ts", line: 5, name: "b" },
      { id: "C", type: "class", file: "main.ts", line: 9, name: "C" },
      { id: "ext", type: "external", file: "lib.ts", line: 2, name: "ext" },
      ...(extra.nodes ?? []),
    ],
    relations: [
      { id: "R1", kind: "calls", source: "a", target: "b", pattern: "CALL-LOCAL-FN", gtStatus: "determinate", evidence: ["main.ts:2"] },
      { id: "R2", kind: "dataflow", source: "a", target: "b", argIndex: 0, pattern: "DF-POSITIONAL", gtStatus: "determinate", evidence: ["main.ts:2"] },
      { id: "R3", kind: "constructs", source: "a", target: "C", pattern: "CONS-LOCAL-IMPLICIT-CTOR", gtStatus: "determinate", evidence: ["main.ts:3"] },
      { id: "R4", kind: "references", source: "b", target: "ext", pattern: "REF-CROSS-FILE", gtStatus: "determinate", evidence: ["main.ts:6"] },
      ...(extra.relations ?? []),
    ],
    negatives: extra.negatives ?? [],
    excludedSites: [],
  };
}

function baseGraph() {
  const file = cnode("file", "main.ts", 1, "main.ts", { pos: 0 });
  const a = cnode("function", "main.ts", 1, "a");
  const b = cnode("function", "main.ts", 5, "b");
  const C = cnode("class", "main.ts", 9, "C");
  const ext = cnode("external", "lib.ts", 2, "ext (lib.ts)");
  return { file, a, b, C, ext };
}

function normalize(graph) {
  return normalizeCogicGraph(graph, { fixtureRoot: ROOT, caseId: "t01" });
}

function score(gt, graph, mode = "strict") {
  return scoreCase(resolveGt(gt, catalog), normalize(graph), mode);
}

function micro(result) {
  return computeMetrics([result]).micro;
}

// --- 1. normalization -------------------------------------------------------
test("normalizes Windows paths, drive letters and outside files", () => {
  assert.equal(relativeFixturePath("C:\\fx\\case\\src\\a.ts", "c:/fx/case"), "src/a.ts");
  assert.equal(relativeFixturePath("D:/other/x.ts", ROOT), "<outside>/x.ts");
  assert.equal(relativeFixturePath("C:/x/node_modules/typescript/lib/lib.es5.d.ts", ROOT), "<tslib>/lib.es5.d.ts");
});

test("maps Cogic node kinds to GT key classes", () => {
  const n = baseGraph();
  assert.equal(cogicNodeKey(n.file, ROOT), "F|main.ts");
  assert.equal(cogicNodeKey(n.a, ROOT), "D|main.ts|1|callable");
  assert.equal(cogicNodeKey(cnode("method", "main.ts", 3, "C.m"), ROOT), "D|main.ts|3|callable");
  assert.equal(cogicNodeKey(n.C, ROOT), "D|main.ts|9|class");
  assert.equal(cogicNodeKey(cnode("interface", "main.ts", 4, "I"), ROOT), "D|main.ts|4|typeLike");
  assert.equal(cogicNodeKey(n.ext, ROOT), "X|lib.ts|2");
  assert.equal(cogicNodeKey(cnode("external", "m.ts", 1, "import(m)", { id: `external:${abs("m.ts")}:-1` }), ROOT), "M|m.ts");
  assert.equal(cogicNodeKey(cnode("function", "main.ts", 7, "App.useEffect#1"), ROOT), "S|main.ts|7");
});

// --- 2-3. perfect / empty ---------------------------------------------------
test("perfect prediction gives P = R = F1 = 1", () => {
  const n = baseGraph();
  const graph = {
    nodes: Object.values(n),
    edges: [
      cedge("calls", n.a, n.b),
      cedge("dataflow", n.a, n.b, { label: "x ← 1", arg: 0 }),
      cedge("constructs", n.a, n.C),
      cedge("references", n.b, n.ext),
    ],
  };
  const m = micro(score(baseGt(), graph));
  assert.equal(m.precision, 1);
  assert.equal(m.recallInScope, 1);
  assert.equal(m.recallOverall, 1);
  assert.equal(m.f1Overall, 1);
});

test("no predictions: precision undefined, recall 0, F1 undefined", () => {
  const m = micro(score(baseGt(), { nodes: Object.values(baseGraph()), edges: [] }));
  assert.equal(m.precision, null);
  assert.equal(m.recallInScope, 0);
  assert.equal(m.recallOverall, 0);
  assert.equal(m.f1InScope, null);
  assert.equal(m.fp, 0);
});

// --- 4. strict vs lenient ---------------------------------------------------
test("kind mismatch is FP + FN in strict mode and TP in lenient mode", () => {
  const n = baseGraph();
  const graph = { nodes: Object.values(n), edges: [cedge("references", n.a, n.b)] };
  const strict = score(baseGt(), graph, "strict");
  const sp = strict.predRows.find((r) => r.kind === "references");
  assert.equal(sp.verdict, "FP");
  assert.equal(strict.gtRows.find((r) => r.id === "R1").verdict, "FN");
  const lenient = score(baseGt(), graph, "lenient");
  assert.equal(lenient.predRows[0].verdict, "TP");
  assert.equal(lenient.gtRows.find((r) => r.id === "R1").verdict, "TP");
  // dataflow keeps argIndex even in lenient mode
  assert.equal(lenient.gtRows.find((r) => r.id === "R2").verdict, "FN");
});

// --- 5. duplicates ----------------------------------------------------------
test("deduplicates dataflow edges that differ only by label", () => {
  const n = baseGraph();
  const graph = {
    nodes: Object.values(n),
    edges: [
      cedge("dataflow", n.a, n.b, { label: "x ← 1", arg: 0 }),
      cedge("dataflow", n.a, n.b, { label: "x ← 2", arg: 0 }),
    ],
  };
  const pred = normalize(graph);
  assert.equal(pred.relations.length, 1);
  assert.deepEqual(pred.duplicates, [{ key: "dataflow|D|main.ts|1|callable|D|main.ts|5|callable|0", occurrences: 2 }]);
  const r = scoreCase(resolveGt(baseGt(), catalog), pred, "strict");
  assert.equal(r.predRows.filter((p) => p.verdict === "TP").length, 1);
});

// --- 6. key collision -------------------------------------------------------
test("reports node key collisions", () => {
  const n = baseGraph();
  const twin = cnode("function", "main.ts", 1, "a2", { pos: 105 });
  const pred = normalize({ nodes: [...Object.values(n), twin], edges: [] });
  assert.equal(pred.collisions.length, 1);
  assert.equal(pred.collisions[0].key, "D|main.ts|1|callable");
  assert.equal(pred.collisions[0].ids.length, 2);
});

// --- 7. arg# parsing --------------------------------------------------------
test("parses arg#i and flags dataflow edges without it", () => {
  const n = baseGraph();
  const good = cedge("dataflow", n.a, n.b, { arg: 3 });
  const bad = { ...cedge("dataflow", n.a, n.b), id: "dataflow:no-arg" };
  const pred = normalize({ nodes: Object.values(n), edges: [good, bad] });
  assert.equal(pred.relations[0].argIndex, 3);
  assert.equal(pred.malformed.length, 1);
});

// --- 8. indeterminate -------------------------------------------------------
test("indeterminate candidates are excluded, other targets stay FP", () => {
  const gt = baseGt({
    nodes: [{ id: "c", type: "callable", file: "main.ts", line: 12, name: "c" }],
    relations: [
      { id: "I1", kind: "calls", source: "b", candidates: [{ target: "a" }, { target: "c" }], pattern: "CALL-ELEMENT-DYNAMIC", gtStatus: "indeterminate", evidence: ["main.ts:7"], reason: "runtime key" },
    ],
  });
  const n = baseGraph();
  const c = cnode("function", "main.ts", 12, "c");
  const graph = {
    nodes: [...Object.values(n), c],
    edges: [cedge("calls", n.b, n.a), cedge("calls", n.b, n.C), cedge("calls", n.a, n.b)],
  };
  const r = score(gt, graph);
  const verdictOf = (src, tgt) => r.predRows.find((p) => p.key === `calls|${src}|${tgt}`).verdict;
  assert.equal(verdictOf("D|main.ts|5|callable", "D|main.ts|1|callable"), "EXCLUDED");
  assert.equal(verdictOf("D|main.ts|5|callable", "D|main.ts|9|class"), "FP");
  assert.equal(verdictOf("D|main.ts|1|callable", "D|main.ts|5|callable"), "TP");
  const m = micro(r);
  assert.equal(m.excluded, 1);
  assert.equal(m.precision, 1 / 2);
  assert.equal(m.precisionSensitivity, 1 / 3);
  assert.equal(r.indeterminateRows[0].excludedCount, 1);
});

test("unbounded candidates exclude every unexplained prediction from that source and kind", () => {
  const gt = baseGt({
    relations: [{ id: "I1", kind: "calls", source: "b", candidates: "unbounded", pattern: "CALL-PARAM-CALLBACK", gtStatus: "indeterminate", evidence: ["main.ts:7"], reason: "parameter" }],
  });
  const n = baseGraph();
  const r = score(gt, { nodes: Object.values(n), edges: [cedge("calls", n.b, n.a), cedge("calls", n.b, n.C), cedge("references", n.b, n.a)] });
  assert.equal(r.predRows.filter((p) => p.verdict === "EXCLUDED").length, 2);
  assert.equal(r.predRows.find((p) => p.kind === "references").verdict, "FP");
});

test("a prediction matching both a determinate relation and a candidate counts as TP", () => {
  const gt = baseGt({
    relations: [{ id: "I1", kind: "calls", source: "a", candidates: [{ target: "b" }], pattern: "CALL-ELEMENT-DYNAMIC", gtStatus: "indeterminate", evidence: ["main.ts:2"], reason: "x" }],
  });
  const n = baseGraph();
  const r = score(gt, { nodes: Object.values(n), edges: [cedge("calls", n.a, n.b)] });
  assert.equal(r.predRows[0].verdict, "TP");
  assert.equal(r.indeterminateRows[0].excludedCount, 0);
});

// --- 9. in-scope vs overall -------------------------------------------------
test("missing unsupported-by-design relation lowers overall recall only", () => {
  const n = baseGraph();
  const graph = {
    nodes: Object.values(n),
    edges: [cedge("calls", n.a, n.b), cedge("dataflow", n.a, n.b, { arg: 0 }), cedge("constructs", n.a, n.C)],
  };
  const m = micro(score(baseGt(), graph));
  assert.equal(m.gtInScope, 3);
  assert.equal(m.recallInScope, 1);
  assert.equal(m.gtOverall, 4);
  assert.equal(m.recallOverall, 3 / 4);
  assert.equal(m.fnOverall, 1);
});

// --- 10. alternatives -------------------------------------------------------
test("target alternatives: one TP, extra alternative is FP", () => {
  const gt = baseGt({
    nodes: [
      { id: "o1", type: "external", file: "lib.ts", line: 10, name: "o" },
      { id: "o2", type: "external", file: "lib.ts", line: 11, name: "o" },
    ],
    relations: [{ id: "R9", kind: "calls", source: "b", target: "o1", targetAlternatives: ["o2"], pattern: "CALL-IMPORT-NAMED", gtStatus: "determinate", evidence: ["main.ts:7"] }],
  });
  const n = baseGraph();
  const o1 = cnode("external", "lib.ts", 10, "o");
  const o2 = cnode("external", "lib.ts", 11, "o");
  const one = score(gt, { nodes: [...Object.values(n), o2], edges: [cedge("calls", n.b, o2)] });
  assert.equal(one.gtRows.find((g) => g.id === "R9").verdict, "TP");
  const both = score(gt, { nodes: [...Object.values(n), o1, o2], edges: [cedge("calls", n.b, o1), cedge("calls", n.b, o2)] });
  const verdicts = both.predRows.filter((p) => p.kind === "calls").map((p) => `${p.verdict}${p.note ? `:${p.note}` : ""}`).sort();
  assert.deepEqual(verdicts, ["FP:EXTRA-ALTERNATIVE", "TP"]);
});

// --- 11. negatives ----------------------------------------------------------
test("flags violated negative assertions", () => {
  const gt = baseGt({
    negatives: [{ id: "N1", kind: "calls", source: "b", target: "a", pattern: "NEG-CALLBACK-PASS", evidence: ["main.ts:6"], rationale: "passed only" }],
  });
  const n = baseGraph();
  const r = score(gt, { nodes: Object.values(n), edges: [cedge("calls", n.b, n.a)] });
  assert.equal(r.negativeRows[0].violated, true);
  assert.equal(r.predRows[0].verdict, "FP");
});

// --- 12. framework owners ---------------------------------------------------
test("derives owner relations and framework categories from synthetic nodes", () => {
  const gt = {
    ...baseGt(),
    relations: [],
    nodes: [
      { id: "file", type: "file", file: "main.ts" },
      { id: "Ctl", type: "class", file: "main.ts", line: 20, name: "Ctl" },
      { id: "m", type: "callable", file: "main.ts", line: 22, name: "m" },
      { id: "fx", type: "synthetic", file: "main.ts", line: 3, framework: "react", role: "callback-owner", anchor: "useEffect" },
      { id: "st", type: "synthetic", file: "main.ts", line: 4, framework: "vue", role: "state-source", anchor: "ref" },
      { id: "rt", type: "synthetic", file: "main.ts", line: 5, framework: "express", role: "route-owner", anchor: "app.get" },
      { id: "nr", type: "synthetic", file: "main.ts", line: 22, framework: "nest", role: "route-owner", anchor: "@Get" },
    ],
  };
  gt.relations = [
    { id: "O1", kind: "owner", source: "fx", pattern: "FW-REACT-CALLBACK-INLINE", gtStatus: "determinate", evidence: ["main.ts:3"] },
    { id: "O2", kind: "owner", source: "st", pattern: "FW-VUE-STATE-SOURCE", gtStatus: "determinate", evidence: ["main.ts:4"] },
    { id: "O3", kind: "owner", source: "rt", pattern: "FW-EXPRESS-INLINE", gtStatus: "determinate", evidence: ["main.ts:5"] },
    { id: "O4", kind: "owner", source: "nr", pattern: "FW-NEST-ROUTE", gtStatus: "determinate", evidence: ["main.ts:22"] },
    { id: "E1", kind: "calls", source: "nr", target: "m", pattern: "FW-NEST-HANDLER-CALL", gtStatus: "determinate", evidence: ["main.ts:22"] },
  ];
  const ctl = cnode("class", "main.ts", 20, "Ctl");
  const m = cnode("method", "main.ts", 22, "Ctl.m", { parentId: ctl.id });
  const nodes = [
    ctl,
    m,
    cnode("function", "main.ts", 3, "App.useEffect#1"),
    cnode("function", "main.ts", 4, "useX.ref#1"),
    cnode("function", "main.ts", 5, "reg.route.get:/u#1", { parentId: "function:fn" }),
    cnode("function", "main.ts", 22, "Ctl.route.get:/c#1", { parentId: ctl.id }),
    cnode("function", "main.ts", 30, "App.useMemo#2"),
  ];
  const nr = nodes[5];
  const r = score(gt, { nodes, edges: [cedge("calls", nr, m)] });
  const byCat = Object.fromEntries(computeMetrics([r]).byCategory.map((c) => [c.category, c]));
  assert.equal(byCat["react-hook-owner"].tpPred, 1);
  assert.equal(byCat["react-hook-owner"].fp, 1, "unmatched useMemo owner is a react FP");
  assert.equal(byCat["vue-hook-owner"].tpPred, 1);
  assert.equal(byCat["express-route-owner"].tpPred, 1);
  assert.equal(byCat["nest-route-owner"].tpPred, 2);
  assert.equal(byCat["nest-route-owner"].recallOverall, 1);
});

// --- 13. zero-division rules ------------------------------------------------
test("category with empty GT but predictions: recall undefined, precision 0", () => {
  const gt = { ...baseGt(), relations: baseGt().relations.filter((r) => r.kind !== "references") };
  const n = baseGraph();
  const r = score(gt, { nodes: Object.values(n), edges: [cedge("references", n.a, n.ext)] });
  const refs = computeMetrics([r]).byCategory.find((c) => c.category === "references");
  assert.equal(refs.gtOverall, 0);
  assert.equal(refs.recallOverall, null);
  assert.equal(refs.precision, 0);
  assert.equal(refs.f1Overall, null);
});

test("F1 is 0 when both precision and recall are 0, and undefined when either is undefined", () => {
  assert.equal(f1(0, 0), 0);
  assert.equal(f1(null, 0.5), null);
  assert.equal(f1(0.5, null), null);
  const n = baseGraph();
  const r = score(baseGt(), { nodes: Object.values(n), edges: [cedge("calls", n.b, n.a)] });
  const calls = computeMetrics([r]).byCategory.find((c) => c.category === "calls");
  assert.equal(calls.precision, 0);
  assert.equal(calls.recallInScope, 0);
  assert.equal(calls.f1InScope, 0);
});

test("macro average skips categories with undefined F1 and lists the included ones", () => {
  const n = baseGraph();
  const r = score(baseGt(), { nodes: Object.values(n), edges: [cedge("calls", n.a, n.b)] });
  const m = computeMetrics([r]);
  assert.ok(m.macro.f1Overall.includedCategories.includes("calls"));
  assert.ok(!m.macro.f1Overall.includedCategories.includes("updates"));
});

// --- 14. statistics ---------------------------------------------------------
test("Wilson interval matches a known value", () => {
  const w = wilson(8, 10);
  assert.ok(Math.abs(w.low - 0.4902) < 1e-3);
  assert.ok(Math.abs(w.high - 0.9433) < 1e-3);
  assert.deepEqual(wilson(0, 0), { low: null, high: null });
});

test("bootstrap is deterministic for a fixed seed", () => {
  const n = baseGraph();
  const r1 = score(baseGt(), { nodes: Object.values(n), edges: [cedge("calls", n.a, n.b)] });
  const r2 = score({ ...baseGt(), caseId: "t02" }, { nodes: Object.values(n), edges: [cedge("constructs", n.a, n.C)] });
  const a = bootstrapMicroF1([r1, r2], { resamples: 200, seed: 7 });
  const b = bootstrapMicroF1([r1, r2], { resamples: 200, seed: 7 });
  assert.deepEqual(a, b);
  const rand = mulberry32(1);
  const first = rand();
  assert.equal(first, mulberry32(1)());
});

test("Cohen's kappa matches a hand-computed value", () => {
  const k = cohenKappa(["y", "y", "n", "n"], ["y", "n", "n", "n"]);
  assert.equal(k.observed, 0.75);
  assert.equal(k.expected, 0.5);
  assert.equal(k.kappa, 0.5);
  assert.equal(cohenKappa([], []).kappa, null);
});

// --- 15. CSV ----------------------------------------------------------------
test("CSV writer and parser round-trip commas, quotes and newlines", () => {
  const rows = [{ a: 'x,"y"', b: "line1\nline2", c: 0.5 }];
  const back = parseCsv(toCsv(rows, ["a", "b", "c"]));
  assert.equal(back[0].a, 'x,"y"');
  assert.equal(back[0].b, "line1\nline2");
  assert.equal(back[0].c, "0.500000");
});

// --- 16. GT structural validation -------------------------------------------
test("GT validator rejects inconsistent documents", () => {
  const dup = baseGt({ relations: [{ id: "R5", kind: "calls", source: "a", target: "b", pattern: "CALL-LOCAL-FN", gtStatus: "determinate", evidence: ["main.ts:2"] }] });
  assert.ok(validateGtStructure(dup, catalog).errors.some((e) => e.includes("duplicate relation key")));

  const collide = baseGt({ nodes: [{ id: "a2", type: "callable", file: "main.ts", line: 1, name: "a" }] });
  assert.ok(validateGtStructure(collide, catalog).errors.some((e) => e.includes("node key collision")));

  const badTarget = baseGt({ relations: [{ id: "R6", kind: "constructs", source: "a", target: "b", pattern: "CONS-LOCAL-IMPLICIT-CTOR", gtStatus: "determinate", evidence: ["main.ts:2"] }] });
  assert.ok(validateGtStructure(badTarget, catalog).errors.some((e) => e.includes("not allowed for constructs")));

  const negClash = baseGt({ negatives: [{ id: "N1", kind: "calls", source: "a", target: "b", pattern: "NEG-CALLBACK-PASS", evidence: ["main.ts:2"], rationale: "x" }] });
  assert.ok(validateGtStructure(negClash, catalog).errors.some((e) => e.includes("same key as positive")));

  const noReason = baseGt({ relations: [{ id: "I1", kind: "calls", source: "a", candidates: "unbounded", pattern: "CALL-PARAM-CALLBACK", gtStatus: "indeterminate", evidence: ["main.ts:2"] }] });
  assert.ok(validateGtStructure(noReason, catalog).errors.some((e) => e.includes("needs reason")));

  const unknownPattern = baseGt({ relations: [{ id: "R7", kind: "calls", source: "b", target: "a", pattern: "NOPE", gtStatus: "determinate", evidence: ["main.ts:6"] }] });
  assert.ok(validateGtStructure(unknownPattern, catalog).errors.some((e) => e.includes("not in catalog")));

  assert.deepEqual(validateGtStructure(baseGt(), catalog).errors, []);
});

// --- 17. prediction loading -------------------------------------------------
test("loads pre-normalized predictions and merges duplicates", () => {
  const pred = loadPrediction(
    {
      schema: "exp01-pred/1",
      caseId: "t01",
      relations: [
        { kind: "calls", srcKey: "D|main.ts|1|callable", tgtKey: "D|main.ts|5|callable" },
        { kind: "calls", srcKey: "D|main.ts|1|callable", tgtKey: "D|main.ts|5|callable" },
      ],
    },
    "t01",
  );
  assert.equal(pred.relations.length, 1);
  assert.equal(pred.duplicates[0].occurrences, 2);
  assert.throws(() => loadPrediction({ schema: "exp01-raw/1", analyzerOutput: { graph: { nodes: [], edges: [] } } }, "t01"), /fixtureRoot/);
});

// --- 18. corpus-level checks (synthetic predictions derived from the GT) ------
// Builds a Cogic-shaped graph that encodes exactly the GT (minus TS-lib targets, which
// Cogic never emits). This verifies key normalization on the real corpus. It is a tool
// self-check, not an accuracy measurement.
function graphFromGt(gt, root) {
  const nodes = new Map();
  const absOf = (rel) => `${root}/${rel}`;
  const hook = { react: "useState", vue: "ref" };
  let classForNest = null;
  // Negative-only synthetic nodes must not appear: they represent owners that should not exist.
  const used = new Set(gt.relations.filter((r) => r.gtStatus === "determinate").flatMap((r) => [r.source, r.target]));
  for (const n of gt.nodes) {
    if (n.type === "synthetic" && !used.has(n.id)) {
      continue;
    }
    const line = (n.line ?? 1) - 1;
    const range = { start: { line, character: 0 }, end: { line, character: 1 } };
    if (n.type === "lib") {
      continue;
    }
    let node;
    if (n.type === "file") {
      node = { id: `file:${absOf(n.file)}:0`, kind: "file", name: n.file, file: absOf(n.file), range };
    } else if (n.type === "module") {
      node = { id: `external:${absOf(n.file)}:-1`, kind: "external", name: n.file, file: absOf(n.file), range };
    } else if (n.type === "external") {
      node = { id: `external:${absOf(n.file)}:${n.line}`, kind: "external", name: n.name, file: absOf(n.file), range };
    } else if (n.type === "synthetic") {
      let name;
      let parentId;
      if (n.framework === "nest") {
        classForNest ??= { id: "class:nest-parent", kind: "class", name: "P", file: absOf("<none>"), range };
        name = "P.route.get:/x#1";
        parentId = classForNest.id;
      } else if (n.framework === "express") {
        name = "f.route.get:/x#1";
      } else {
        name = `f.${hook[n.framework]}#1`;
      }
      node = { id: `function:${absOf(n.file)}:s${n.line}`, kind: "function", name, file: absOf(n.file), range, ...(parentId ? { parentId } : {}) };
    } else {
      const kind = n.type === "class" ? "class" : n.type === "typeLike" ? "interface" : "function";
      node = { id: `${kind}:${absOf(n.file)}:${n.line}`, kind, name: n.name, file: absOf(n.file), range };
    }
    nodes.set(n.id, node);
  }
  if (classForNest) {
    nodes.set("__nestParent", classForNest);
  }
  const edges = [];
  for (const r of gt.relations) {
    if (r.gtStatus !== "determinate" || r.kind === "owner") {
      continue;
    }
    const s = nodes.get(r.source);
    const t = nodes.get(r.target);
    if (!s || !t) {
      continue;
    }
    edges.push({
      id: `${r.kind}:${s.id}->${t.id}@@@@${r.kind === "dataflow" ? `arg#${r.argIndex}` : ""}`,
      kind: r.kind,
      source: s.id,
      target: t.id,
    });
  }
  return { nodes: [...nodes.values()], edges };
}

test("corpus round-trip: GT-encoded synthetic graphs score every non-lib relation as TP", () => {
  const root = "C:/synthetic/root";
  const dirs = listCaseDirs(corpus);
  assert.equal(dirs.length, 44);
  const libIds = new Map();
  const scored = scoreCorpus({
    corpus,
    predictionFor: (caseId) => {
      const dir = dirs.find((d) => path.basename(d) === caseId);
      const gt = readJson(path.join(dir, "expected.json"));
      libIds.set(caseId, new Set(gt.nodes.filter((n) => n.type === "lib").map((n) => n.id)));
      return normalizeCogicGraph(graphFromGt(gt, root), { fixtureRoot: root, caseId });
    },
  });
  for (const r of scored.results.strict) {
    assert.equal(r.predRows.filter((p) => p.verdict !== "TP").length, 0, `${r.caseId}: unexpected FP/EXCLUDED`);
    const gt = readJson(path.join(dirs.find((d) => path.basename(d) === r.caseId), "expected.json"));
    const libTargets = new Set(gt.relations.filter((x) => libIds.get(r.caseId).has(x.target)).map((x) => x.id));
    for (const g of r.gtRows) {
      assert.equal(g.verdict, libTargets.has(g.id) ? "FN" : "TP", `${r.caseId} ${g.id}`);
    }
  }
  const diag = scored.diagnostics.filter((d) => d.collisions.length > 0 || d.malformed.length > 0);
  assert.deepEqual(diag, []);
});

test("scoreCorpus refuses missing predictions unless allowed", () => {
  assert.throws(() => scoreCorpus({ corpus, predictionFor: () => null }), /missing prediction/);
  const scored = scoreCorpus({ corpus, predictionFor: () => null, allowMissing: true });
  assert.equal(scored.missing.length, 44);
  const m = computeMetrics(scored.results.strict).micro;
  assert.equal(m.precision, null);
  assert.equal(m.recallOverall, 0);
});

test("every corpus GT file passes structural validation", () => {
  for (const dir of listCaseDirs(corpus)) {
    const gt = readJson(path.join(dir, "expected.json"));
    assert.deepEqual(validateGtStructure(gt, catalog).errors, [], gt.caseId);
  }
});

// --- 19. review sample ------------------------------------------------------
test("review sample is deterministic and covers at least 20% of every category", () => {
  const items = collectItems(corpus);
  const a = drawSample(items, { rate: 0.2, seed: 20261026 });
  const b = drawSample(items, { rate: 0.2, seed: 20261026 });
  assert.deepEqual(a.sample.map((s) => `${s.caseId}/${s.itemId}`), b.sample.map((s) => `${s.caseId}/${s.itemId}`));
  for (const c of a.perCategory) {
    assert.ok(c.sampled / c.population >= 0.2, c.category);
  }
  const labels = new Set(a.sample.map((s) => s.gtLabel));
  assert.ok(labels.has("exists") && labels.has("not-exists"));
});

test("agreement counts empty reviewer labels as unreviewed, not as agreement", () => {
  const key = [
    { sampleId: "S001", category: "calls", gtLabel: "exists" },
    { sampleId: "S002", category: "calls", gtLabel: "not-exists" },
    { sampleId: "S003", category: "calls", gtLabel: "exists" },
  ];
  const sheet = [
    { sampleId: "S001", reviewerLabel: "exists" },
    { sampleId: "S002", reviewerLabel: "" },
    { sampleId: "S003", reviewerLabel: "maybe" },
  ];
  const r = agreement(sheet, key);
  assert.equal(r.reviewed, 1);
  assert.deepEqual(r.unreviewed, ["S002"]);
  assert.equal(r.invalid.length, 1);
});

// --- 20. output files -------------------------------------------------------
test("score CLI writes all output files for synthetic predictions", async () => {
  const { writeOutputs } = await import("../score.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exp01-score-"));
  const scored = scoreCorpus({ corpus, predictionFor: () => null, allowMissing: true });
  writeOutputs(tmp, scored, { bootstrap: 20, seed: 1, gtVersion: 1 });
  for (const f of ["matches.csv", "metrics-by-category.csv", "metrics-by-pattern.csv", "indeterminate.csv", "negatives.csv", "diagnostics.json", "summary.json"]) {
    assert.ok(fs.existsSync(path.join(tmp, f)), f);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ===========================================================================
// P1-A-R1 regression tests (synthetic predictions only)
// ===========================================================================

const tpCount = (r) => r.predRows.filter((p) => p.verdict === "TP").length;
const gtTp = (r) => r.gtRows.filter((g) => g.verdict === "TP").map((g) => g.id).sort();
const shape = (r) => ({
  pred: r.predRows.map((p) => `${p.key}=${p.verdict}:${p.note}`).sort(),
  gt: r.gtRows.map((g) => `${g.id}=${g.verdict}:${g.matchedBy}`).sort(),
});

// GT with two structural relations of different kinds on the same endpoints (b -> a).
function sameEndpointGt() {
  return baseGt({
    relations: [
      { id: "S1", kind: "calls", source: "b", target: "a", pattern: "CALL-LOCAL-FN", gtStatus: "determinate", evidence: ["main.ts:6"] },
      { id: "S2", kind: "references", source: "b", target: "a", pattern: "REF-VALUE-FN", gtStatus: "determinate", evidence: ["main.ts:6"] },
    ],
  });
}

test("R1 lenient: one prediction matches at most one GT relation on shared endpoints", () => {
  const n = baseGraph();
  const graph = { nodes: Object.values(n), edges: [cedge("calls", n.b, n.a)] };
  const lenient = score(sameEndpointGt(), graph, "lenient");
  assert.equal(tpCount(lenient), 1);
  assert.deepEqual(gtTp(lenient).filter((id) => id.startsWith("S")), ["S1"], "same-kind GT is preferred");
  assert.equal(lenient.gtRows.find((g) => g.id === "S2").verdict, "FN");
  const m = micro(lenient);
  assert.equal(m.tpPred, m.tpOverall, "TP on the prediction side equals TP on the GT side");
  const strict = score(sameEndpointGt(), graph, "strict");
  assert.deepEqual(gtTp(strict).filter((id) => id.startsWith("S")), ["S1"]);
});

test("R1 lenient: two GT, one prediction of a third kind -> exactly one TP", () => {
  const n = baseGraph();
  const graph = { nodes: Object.values(n), edges: [cedge("constructs", n.b, n.a)] };
  const lenient = score(sameEndpointGt(), graph, "lenient");
  assert.equal(tpCount(lenient), 1);
  assert.equal(lenient.gtRows.filter((g) => g.id.startsWith("S") && g.verdict === "TP").length, 1);
  const strict = score(sameEndpointGt(), graph, "strict");
  assert.equal(strict.gtRows.filter((g) => g.id.startsWith("S") && g.verdict === "TP").length, 0);
});

test("R1 lenient: two predictions on one GT relation -> one TP, one FP(EXTRA-LENIENT)", () => {
  const gt = baseGt({
    relations: [{ id: "S1", kind: "calls", source: "b", target: "a", pattern: "CALL-LOCAL-FN", gtStatus: "determinate", evidence: ["main.ts:6"] }],
  });
  const n = baseGraph();
  const r = score(gt, { nodes: Object.values(n), edges: [cedge("calls", n.b, n.a), cedge("references", n.b, n.a)] }, "lenient");
  const rows = r.predRows.filter((p) => p.key.endsWith("|D|main.ts|5|callable|D|main.ts|1|callable"));
  assert.deepEqual(rows.map((p) => `${p.kind}:${p.verdict}:${p.note}`).sort(), ["calls:TP:", "references:FP:EXTRA-LENIENT"]);
  assert.equal(r.gtRows.find((g) => g.id === "S1").matchedBy, "calls|D|main.ts|5|callable|D|main.ts|1|callable");
});

test("R1 lenient: both kinds predicted -> both GT relations TP, no double count", () => {
  const n = baseGraph();
  const r = score(sameEndpointGt(), { nodes: Object.values(n), edges: [cedge("references", n.b, n.a), cedge("calls", n.b, n.a)] }, "lenient");
  const s = r.gtRows.filter((g) => g.id.startsWith("S"));
  assert.deepEqual(s.map((g) => `${g.id}<-${g.matchedBy.split("|")[0]}`).sort(), ["S1<-calls", "S2<-references"]);
});

function alternativesGt() {
  return baseGt({
    nodes: [
      { id: "o1", type: "external", file: "lib.ts", line: 10, name: "o" },
      { id: "o2", type: "external", file: "lib.ts", line: 11, name: "o" },
    ],
    relations: [
      { id: "G1", kind: "calls", source: "b", target: "o1", targetAlternatives: ["o2"], pattern: "CALL-IMPORT-NAMED", gtStatus: "determinate", evidence: ["main.ts:7"] },
      { id: "G2", kind: "calls", source: "b", target: "o2", pattern: "CALL-IMPORT-NAMED", gtStatus: "determinate", evidence: ["main.ts:7"] },
    ],
  });
}

test("R1 targetAlternatives: maximum matching instead of first-free greedy (strict and lenient)", () => {
  const n = baseGraph();
  const o1 = cnode("external", "lib.ts", 10, "o");
  const o2 = cnode("external", "lib.ts", 11, "o");
  for (const mode of ["strict", "lenient"]) {
    for (const edges of [
      [cedge("calls", n.b, o2), cedge("calls", n.b, o1)],
      [cedge("calls", n.b, o1), cedge("calls", n.b, o2)],
    ]) {
      const r = score(alternativesGt(), { nodes: [...Object.values(n), o1, o2], edges }, mode);
      assert.deepEqual(gtTp(r).filter((id) => id.startsWith("G")), ["G1", "G2"], mode);
      assert.equal(tpCount(r), 2, mode);
    }
  }
});

test("R1 targetAlternatives: one prediction on a shared target matches only one GT", () => {
  const n = baseGraph();
  const o2 = cnode("external", "lib.ts", 11, "o");
  for (const mode of ["strict", "lenient"]) {
    const r = score(alternativesGt(), { nodes: [...Object.values(n), o2], edges: [cedge("calls", n.b, o2)] }, mode);
    assert.equal(tpCount(r), 1, mode);
    assert.deepEqual(gtTp(r).filter((id) => id.startsWith("G")), ["G2"], `${mode}: primary target preferred over alternative`);
  }
  // lenient + alternatives + another kind: still 1:1.
  const r = score(alternativesGt(), { nodes: [...Object.values(n), o2], edges: [cedge("references", n.b, o2), cedge("calls", n.b, o2)] }, "lenient");
  assert.equal(tpCount(r), 2);
  assert.equal(r.gtRows.filter((g) => g.id.startsWith("G") && g.verdict === "TP").length, 2);
});

test("R1 matching is independent of node and edge input order", () => {
  const n = baseGraph();
  const o1 = cnode("external", "lib.ts", 10, "o");
  const o2 = cnode("external", "lib.ts", 11, "o");
  const edges = [
    cedge("calls", n.b, o2),
    cedge("references", n.b, o1),
    cedge("calls", n.b, n.a),
    cedge("references", n.b, n.a),
    cedge("constructs", n.b, n.a),
    cedge("calls", n.a, n.b),
  ];
  const gt = baseGt({
    nodes: alternativesGt().nodes.slice(-2),
    relations: [...alternativesGt().relations.slice(-2), ...sameEndpointGt().relations.slice(-2)],
  });
  const rand = mulberry32(7);
  for (const mode of ["strict", "lenient"]) {
    const ref = shape(score(gt, { nodes: [...Object.values(n), o1, o2], edges }, mode));
    for (let i = 0; i < 20; i++) {
      const shuffled = [...edges].sort(() => rand() - 0.5);
      const nodes = [...Object.values(n), o1, o2].sort(() => rand() - 0.5);
      assert.deepEqual(shape(score(gt, { nodes, edges: shuffled }, mode)), ref, mode);
    }
  }
});

test("R1 maximumMatching finds the matching that first-free greedy would miss", () => {
  // pred0 -> {0,1}, pred1 -> {0}: greedy pred0->0 leaves pred1 unmatched.
  assert.deepEqual(maximumMatching([[0, 1], [0]], 2).predToGt, [1, 0]);
  assert.deepEqual(maximumMatching([[0], [0], [0]], 1).predToGt.filter((g) => g >= 0), [0]);
});

test("R1 TP is identical on both sides and lenient never scores below strict", () => {
  const n = baseGraph();
  const graph = { nodes: Object.values(n), edges: [cedge("calls", n.b, n.a), cedge("references", n.b, n.a), cedge("constructs", n.b, n.a)] };
  const s = micro(score(sameEndpointGt(), graph, "strict"));
  const l = micro(score(sameEndpointGt(), graph, "lenient"));
  assert.equal(l.tpPred, l.tpOverall);
  assert.equal(s.tpPred, s.tpOverall);
  assert.ok(l.tpOverall >= s.tpOverall);
  assert.ok(l.tpOverall <= l.gtOverall);
});

// --- R2. fail-closed diagnostics -------------------------------------------
function scoreGraph(graph) {
  const pred = normalize(graph);
  return { pred, r: scoreCase(resolveGt(baseGt(), catalog), pred, "strict") };
}

test("R2 clean prediction is SCORED and confirmatory", () => {
  const n = baseGraph();
  const { r } = scoreGraph({ nodes: Object.values(n), edges: [cedge("calls", n.a, n.b)] });
  assert.equal(r.status, "SCORED");
  assert.deepEqual(r.blockers, []);
  assert.ok(isConfirmatory(r));
});

test("R2 each diagnostic class blocks the case and keeps the raw record", () => {
  const n = baseGraph();
  const cases = {
    "node-key-collision": { nodes: [...Object.values(n), cnode("function", "main.ts", 1, "a2", { pos: 105 })], edges: [] },
    "invalid-endpoint": { nodes: Object.values(n), edges: [{ ...cedge("calls", n.a, n.b), target: "function:missing" }] },
    "unparsable-dataflow-index": { nodes: Object.values(n), edges: [{ ...cedge("dataflow", n.a, n.b), id: "dataflow:a->b@@x@@arg#one" }] },
    "unknown-edge-kind": { nodes: Object.values(n), edges: [cedge("imports", n.a, n.b)] },
    "unknown-node-kind": { nodes: [...Object.values(n), cnode("variable", "main.ts", 3, "v")], edges: [] },
  };
  for (const [code, graph] of Object.entries(cases)) {
    const before = JSON.stringify(graph);
    const { pred, r } = scoreGraph(graph);
    assert.equal(r.status, "SCORING_BLOCKED", code);
    assert.deepEqual(r.blockers.map((b) => b.code), [code], code);
    assert.ok(r.gtRows.every((g) => g.caseStatus === "SCORING_BLOCKED"), code);
    const raw = [...pred.collisions, ...pred.malformed, ...pred.unknownNodes];
    assert.equal(raw.length, 1, code);
    assert.ok(raw[0].ids || raw[0].raw, `${code}: raw diagnostic kept`);
    assert.equal(JSON.stringify(graph), before, `${code}: input graph not modified`);
  }
});

test("R2 blocked cases are excluded from confirmatory metrics, pattern table and bootstrap", () => {
  const n = baseGraph();
  const ok = scoreGraph({ nodes: Object.values(n), edges: [cedge("calls", n.a, n.b)] }).r;
  const bad = { ...scoreGraph({ nodes: Object.values(n), edges: [cedge("calls", n.a, n.b), cedge("imports", n.a, n.b)] }).r, caseId: "t02" };
  const m = computeMetrics([ok, bad]);
  assert.equal(m.scoredCases, 1);
  assert.deepEqual(m.blockedCases, ["t02"]);
  assert.deepEqual(m.micro, computeMetrics([ok]).micro);
  assert.equal(computeMetrics([bad]).micro.gtOverall, 0);
  assert.deepEqual(metricsByPattern([ok, bad]), metricsByPattern([ok]));
  assert.deepEqual(bootstrapMicroF1([ok, bad], { resamples: 50, seed: 3 }), bootstrapMicroF1([ok], { resamples: 50, seed: 3 }));
});

test("R2 pre-normalized predictions get the same fail-closed checks", () => {
  const doc = {
    schema: "exp01-pred/1",
    caseId: "t01",
    relations: [
      { kind: "calls", srcKey: "D|main.ts|1|callable", tgtKey: "D|main.ts|5|callable" },
      { kind: "dataflow", srcKey: "D|main.ts|1|callable", tgtKey: "D|main.ts|5|callable", argIndex: "0" },
      { kind: "imports", srcKey: "F|main.ts", tgtKey: "M|x.ts" },
      { kind: "calls", srcKey: "D|main.ts|1|callable" },
    ],
  };
  const pred = loadPrediction(doc, "t01");
  assert.deepEqual(pred.malformed.map((m) => m.code).sort(), ["invalid-endpoint", "unknown-edge-kind", "unparsable-dataflow-index"]);
  assert.ok(pred.malformed.every((m) => m.raw));
  assert.equal(pred.relations.length, 1);
  assert.equal(scoreCase(resolveGt(baseGt(), catalog), pred, "strict").status, "SCORING_BLOCKED");
  const collided = loadPrediction({ ...doc, relations: doc.relations.slice(0, 1), collisions: [{ key: "D|main.ts|1|callable", ids: ["x", "y"] }] }, "t01");
  assert.equal(scoreCase(resolveGt(baseGt(), catalog), collided, "strict").status, "SCORING_BLOCKED");
});

test("R2 corpus run with one blocked case: summary BLOCKED, diagnostics kept, others still scored", () => {
  const dirs = listCaseDirs(corpus);
  const victim = path.basename(dirs[0]);
  const scored = scoreCorpus({
    corpus,
    allowMissing: true,
    predictionFor: (caseId) =>
      caseId === victim
        ? { caseId, relations: [], collisions: [{ code: "node-key-collision", key: "D|main.ts|1|callable", ids: ["p", "q"] }], duplicates: [], malformed: [], unknownNodes: [] }
        : null,
  });
  assert.deepEqual(scored.blocked, [victim]);
  const d = scored.diagnostics.find((x) => x.caseId === victim);
  assert.equal(d.status, "SCORING_BLOCKED");
  assert.deepEqual(d.collisions[0].ids, ["p", "q"]);
  assert.equal(computeMetrics(scored.results.strict).scoredCases, dirs.length - 1);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exp01-blocked-"));
  const summary = writeOutputs(tmp, scored, { bootstrap: 0, seed: 1, gtVersion: 1 });
  assert.equal(summary.scoringStatus, "BLOCKED");
  assert.deepEqual(summary.blockedCases, [victim]);
  const matches = parseCsv(fs.readFileSync(path.join(tmp, "matches.csv"), "utf8"));
  assert.ok(matches.some((row) => row.caseId === victim && row.caseStatus === "SCORING_BLOCKED"));
  const diag = readJson(path.join(tmp, "diagnostics.json"));
  assert.equal(diag.find((x) => x.caseId === victim).blockers[0].code, "node-key-collision");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- R3 (P1-G, scorer 1.2): same-line external declarations -----------------
// Shapes taken from the first EXP-01 run (P1-F): a .d.ts line holding `useState` and the setter
// function type of its return tuple, or `useReducer` and its dispatch type. Synthetic data only.
function extNode(rel, line, startChar, endChar, name, pos) {
  return {
    id: `external:${abs(rel)}:${pos}`,
    kind: "external",
    name,
    file: abs(rel),
    range: { start: { line: line - 1, character: startChar }, end: { line: line - 1, character: endChar } },
  };
}

function hookGt(hookLine, hookName) {
  return {
    schema: "exp01-gt/1",
    caseId: "t01",
    gtVersion: 1,
    activeFile: "main.ts",
    nodes: [
      { id: "file", type: "file", file: "main.ts" },
      { id: "Comp", type: "callable", file: "main.ts", line: 3, name: "Comp" },
      { id: "inc", type: "callable", file: "main.ts", line: 5, name: "inc" },
      { id: "hook", type: "external", file: "shims/react.d.ts", line: hookLine, name: hookName },
    ],
    relations: [
      { id: "R1", kind: "calls", source: "Comp", target: "hook", pattern: "CALL-IMPORT-NAMED", gtStatus: "determinate", evidence: ["main.ts:4"] },
      { id: "R2", kind: "dataflow", source: "Comp", target: "hook", argIndex: 0, pattern: "DF-POSITIONAL", gtStatus: "determinate", evidence: ["main.ts:4"] },
    ],
    negatives: [],
    excludedSites: [],
  };
}

function hookGraph(decl, inner, { ownerAlsoCallsInner = false } = {}) {
  const file = cnode("file", "main.ts", 1, "main.ts", { pos: 0 });
  const Comp = cnode("function", "main.ts", 3, "Comp");
  const inc = cnode("function", "main.ts", 5, "inc");
  const edges = [
    cedge("calls", Comp, decl),
    cedge("dataflow", Comp, decl, { arg: 0 }),
    cedge("calls", inc, inner),
    cedge("dataflow", inc, inner, { arg: 0 }),
    ...(ownerAlsoCallsInner ? [cedge("calls", Comp, inner)] : []),
  ];
  return { nodes: [file, Comp, inc, decl, inner], edges };
}

const verdicts = (rows) => rows.map((r) => `${r.verdict} ${r.key}`).sort();

test("R3 scorer version is 1.2", () => {
  assert.equal(SCORER_VERSION, "exp01-scorer/1.2");
});

test("R3 useState declaration and setter function type on one line: resolved, setter relations are FP", () => {
  const decl = extNode("shims/react.d.ts", 5, 0, 91, "useState (react.d.ts)", 131);
  const setter = extNode("shims/react.d.ts", 5, 53, 89, "setCount (react.d.ts)", 184);
  const graph = hookGraph(decl, setter);
  const before = JSON.stringify(graph);
  const pred = normalize(graph);
  assert.deepEqual(pred.collisions, []);
  assert.equal(pred.resolvedCollisions.length, 1);
  assert.equal(pred.resolvedCollisions[0].key, "X|shims/react.d.ts|5");
  assert.equal(pred.resolvedCollisions[0].kept, decl.id);
  assert.deepEqual(pred.resolvedCollisions[0].rekeyed, [{ id: setter.id, key: "X|shims/react.d.ts|5|c53" }]);
  const r = scoreCase(resolveGt(hookGt(5, "useState"), catalog), pred, "strict");
  assert.equal(r.status, "SCORED");
  assert.deepEqual(r.gtRows.map((g) => g.verdict), ["TP", "TP"]);
  assert.deepEqual(verdicts(r.predRows), [
    "FP calls|D|main.ts|5|callable|X|shims/react.d.ts|5|c53",
    "FP dataflow|D|main.ts|5|callable|X|shims/react.d.ts|5|c53|0",
    "TP calls|D|main.ts|3|callable|X|shims/react.d.ts|5",
    "TP dataflow|D|main.ts|3|callable|X|shims/react.d.ts|5|0",
  ]);
  assert.equal(JSON.stringify(graph), before, "GraphPayload not modified");
});

test("R3 useReducer declaration and dispatch function type on one line: resolved", () => {
  const decl = extNode("shims/react.d.ts", 6, 0, 116, "useReducer (react.d.ts)", 224);
  const dispatch = extNode("shims/react.d.ts", 6, 95, 114, "dispatch (react.d.ts)", 319);
  const pred = normalize(hookGraph(decl, dispatch));
  assert.deepEqual(pred.collisions, []);
  assert.deepEqual(pred.resolvedCollisions[0].rekeyed, [{ id: dispatch.id, key: "X|shims/react.d.ts|6|c95" }]);
  const r = scoreCase(resolveGt(hookGt(6, "useReducer"), catalog), pred, "strict");
  assert.equal(r.status, "SCORED");
  assert.equal(r.gtRows.filter((g) => g.verdict === "TP").length, 2);
  assert.equal(r.predRows.filter((p) => p.verdict === "FP").length, 2);
});

test("R3 unique enclosing declaration with several inner nodes: all distinct keys", () => {
  const decl = extNode("shims/x.d.ts", 2, 0, 120, "decl (x.d.ts)", 10);
  const i1 = extNode("shims/x.d.ts", 2, 40, 60, "i1 (x.d.ts)", 50);
  const i2 = extNode("shims/x.d.ts", 2, 80, 100, "i2 (x.d.ts)", 90);
  const pred = normalize({ nodes: [decl, i1, i2], edges: [] });
  assert.deepEqual(pred.collisions, []);
  assert.deepEqual(pred.resolvedCollisions[0].rekeyed.map((x) => x.key).sort(), ["X|shims/x.d.ts|2|c40", "X|shims/x.d.ts|2|c80"]);
});

test("R3 fail-closed: no enclosing node, equal candidates, partial overlap and missing range stay blocked", () => {
  const groups = {
    "no enclosing node": [extNode("shims/x.d.ts", 2, 0, 30, "a", 10), extNode("shims/x.d.ts", 2, 40, 80, "b", 50)],
    "two equal candidates": [extNode("shims/x.d.ts", 2, 0, 30, "a", 10), extNode("shims/x.d.ts", 2, 0, 30, "b", 11)],
    "partial overlap": [extNode("shims/x.d.ts", 2, 0, 50, "a", 10), extNode("shims/x.d.ts", 2, 40, 80, "b", 50)],
    "missing range": [extNode("shims/x.d.ts", 2, 0, 90, "a", 10), { ...extNode("shims/x.d.ts", 2, 40, 80, "b", 50), range: { start: { line: 1, character: 40 } } }],
  };
  for (const [name, nodes] of Object.entries(groups)) {
    const { pred, r } = scoreGraph({ nodes: [...Object.values(baseGraph()), ...nodes], edges: [] });
    assert.deepEqual(pred.resolvedCollisions, [], name);
    assert.deepEqual(pred.collisions.map((c) => c.key), ["X|shims/x.d.ts|2"], name);
    assert.equal(r.status, "SCORING_BLOCKED", name);
    assert.deepEqual(r.blockers.map((b) => b.code), ["node-key-collision"], name);
  }
});

test("R3 fail-closed: non-external collisions are not resolved, even with nested ranges", () => {
  const n = baseGraph();
  const outer = { ...cnode("function", "main.ts", 1, "a2", { pos: 105 }), range: { start: { line: 0, character: 0 }, end: { line: 0, character: 90 } } };
  const inner = { ...n.a, range: { start: { line: 0, character: 10 }, end: { line: 0, character: 20 } } };
  const { pred, r } = scoreGraph({ nodes: [n.file, inner, outer, n.b, n.C, n.ext], edges: [] });
  assert.deepEqual(pred.resolvedCollisions, []);
  assert.deepEqual(pred.collisions.map((c) => c.key), ["D|main.ts|1|callable"]);
  assert.equal(r.status, "SCORING_BLOCKED");
  assert.equal(resolveExternalCollision("D|main.ts|1|callable", [outer, inner], new Set()), null);
  const moduleNode = { ...extNode("lib.ts", 1, 0, 10, "module (lib.ts)", 0), id: `external:${abs("lib.ts")}:-1` };
  assert.equal(resolveExternalCollision("X|lib.ts|1", [moduleNode, extNode("lib.ts", 1, 2, 5, "m", 3)], new Set()), null);
});

test("R3 re-keying never creates a duplicate key", () => {
  const decl = extNode("shims/x.d.ts", 2, 0, 120, "decl", 10);
  const sameColumn = [decl, extNode("shims/x.d.ts", 2, 53, 60, "i1", 60), extNode("shims/x.d.ts", 2, 53, 89, "i2", 61)];
  const pred = normalize({ nodes: sameColumn, edges: [] });
  assert.deepEqual(pred.resolvedCollisions, []);
  assert.deepEqual(pred.collisions.map((c) => c.key), ["X|shims/x.d.ts|2"]);
  const inner = extNode("shims/x.d.ts", 2, 53, 89, "i", 62);
  assert.equal(resolveExternalCollision("X|shims/x.d.ts|2", [decl, inner], new Set(["X|shims/x.d.ts|2|c53"])), null);
  const ok = normalize({ nodes: [decl, inner, extNode("shims/y.d.ts", 2, 0, 5, "y", 1)], edges: [] });
  assert.deepEqual(ok.collisions, []);
  assert.equal(ok.resolvedCollisions.length, 1);
});

test("R3 no fake TP when the same owner calls the declaration and the inner function type", () => {
  const decl = extNode("shims/react.d.ts", 5, 0, 91, "useState (react.d.ts)", 131);
  const setter = extNode("shims/react.d.ts", 5, 53, 89, "setCount (react.d.ts)", 184);
  const graph = hookGraph(decl, setter, { ownerAlsoCallsInner: true });
  const pred = normalize(graph);
  const declCall = pred.relations.find((p) => p.key === "calls|D|main.ts|3|callable|X|shims/react.d.ts|5");
  assert.deepEqual(declCall.cogicIds, [cedge("calls", graph.nodes[1], decl).id], "the TP relation carries only the declaration call");
  const r = scoreCase(resolveGt(hookGt(5, "useState"), catalog), pred, "strict");
  assert.ok(r.predRows.some((p) => p.verdict === "FP" && p.key === "calls|D|main.ts|3|callable|X|shims/react.d.ts|5|c53"));
  assert.equal(r.gtRows.filter((g) => g.verdict === "TP").length, 2);
});

test("R3 collision-free graphs normalize exactly as before (every key is cogicNodeKey)", () => {
  const root = "C:/synthetic/root";
  for (const dir of listCaseDirs(corpus)) {
    const gt = readJson(path.join(dir, "expected.json"));
    const graph = graphFromGt(gt, root);
    const keys = new Set(graph.nodes.map((n) => cogicNodeKey(n, root)));
    const pred = normalizeCogicGraph(graph, { fixtureRoot: root, caseId: gt.caseId });
    assert.deepEqual(pred.resolvedCollisions, [], gt.caseId);
    for (const p of pred.relations) {
      assert.ok(keys.has(p.srcKey), `${gt.caseId} ${p.key}`);
      assert.ok(p.tgtKey === null || keys.has(p.tgtKey), `${gt.caseId} ${p.key}`);
    }
  }
});
