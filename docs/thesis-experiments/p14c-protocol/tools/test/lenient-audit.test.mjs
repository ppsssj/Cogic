// P14-C: minimal cases for the lenient-matching audit. They pin what exp01-scorer/1.2 does today
// (lib.mjs scoreCase) and what each candidate rule would do. They do not declare a policy.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, maximumMatching, normalizeCogicGraph, resolveGt, scoreCase } from "../../../tools/exp01/lib.mjs";
import { diffVerdicts, minCostMaximumMatching, scoreCaseVariant } from "../scorer-variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = loadCatalog(path.resolve(here, "../../../fixtures/exp-01/catalog.csv"));
const root = "C:/synthetic/fixture";
const file = `${root}/main.ts`;
const node = (name, line) => ({ id: name, name, kind: "function", file, range: { start: { line: line - 1, character: 0 }, end: { line: line - 1, character: 1 } } });
const gtNodes = [{ id: "a", type: "callable", file: "main.ts", line: 1 }, { id: "b", type: "callable", file: "main.ts", line: 5 }];
const graph = (kinds) => ({ nodes: [node("a", 1), node("b", 5)], edges: kinds.map((kind) => ({ id: `${kind}:a->b`, kind, source: "a", target: "b" })) });
const gtOf = ({ relations = [], negatives = [] }) => ({ schema: "exp01-gt/1", caseId: "synthetic", gtVersion: 1, activeFile: "main.ts", nodes: gtNodes, relations, negatives, excludedSites: [] });
const R = (id, kind, pattern) => ({ id, kind, source: "a", target: "b", pattern, gtStatus: "determinate", evidence: ["main.ts:1"] });
const score = (gt, kinds, mode, options) => {
  const pred = normalizeCogicGraph(graph(kinds), { fixtureRoot: root, caseId: "synthetic" });
  const resolved = resolveGt(gtOf(gt), catalog);
  return options ? scoreCaseVariant(resolved, pred, mode, options) : scoreCase(resolved, pred, mode);
};
const verdicts = (r) => r.predRows.map((x) => [x.kind, x.verdict]);

// P14-A's d01 shape: a determinate reference and an indeterminate call on the same endpoints.
const overlap = {
  relations: [R("R1", "references", "REF-VALUE-FN"), { id: "I1", kind: "calls", source: "a", pattern: "CALL-VARIABLE-ALIAS", gtStatus: "indeterminate", candidates: [{ target: "b" }], reason: "runtime target", evidence: ["main.ts:1"] }],
};

test("defaults reproduce lib.mjs scoreCase (strict and lenient)", () => {
  for (const mode of ["strict", "lenient"]) {
    for (const [gt, kinds] of [[overlap, ["calls", "references"]], [{ relations: [R("R1", "references", "REF-VALUE-FN")] }, ["calls", "references"]]]) {
      assert.deepEqual(diffVerdicts(score(gt, kinds, mode), score(gt, kinds, mode, {})), []);
    }
  }
});

test("current: lenient turns strict's TP into an FP (d01 shape)", () => {
  assert.deepEqual(verdicts(score(overlap, ["calls", "references"], "strict")), [["calls", "EXCLUDED"], ["references", "TP"]]);
  assert.deepEqual(verdicts(score(overlap, ["calls", "references"], "lenient")), [["calls", "TP"], ["references", "FP"]]);
});

test("cause 1: the matched prediction depends on key order, not on kind (L1)", () => {
  // No indeterminate entry: one GT reference, two predictions on its endpoints.
  const gt = { relations: [R("R1", "references", "REF-VALUE-FN")] };
  assert.deepEqual(verdicts(score(gt, ["calls", "references"], "lenient")), [["calls", "TP"], ["references", "FP"]]);
  assert.deepEqual(verdicts(score(gt, ["calls", "references"], "lenient", { matching: "mincost" })), [["calls", "FP"], ["references", "TP"]]);
});

test("cause 2: a prediction that lost its GT is never compared with indeterminate entries (L2)", () => {
  assert.deepEqual(verdicts(score(overlap, ["calls", "references"], "lenient", { matching: "mincost" })), [["calls", "FP"], ["references", "TP"]]);
  assert.deepEqual(verdicts(score(overlap, ["calls", "references"], "lenient", { matching: "mincost", indeterminateBeforeExtra: true })), [["calls", "EXCLUDED"], ["references", "TP"]]);
});

test("L1 and L2 leave strict unchanged in these cases", () => {
  for (const gt of [overlap, { relations: [R("R1", "references", "REF-VALUE-FN")] }]) {
    const ref = score(gt, ["calls", "references"], "strict");
    assert.deepEqual(diffVerdicts(ref, score(gt, ["calls", "references"], "strict", { matching: "mincost", indeterminateBeforeExtra: true })), []);
  }
});

test("cause 3: a lenient negative is violated by a correct prediction of another kind (L3)", () => {
  // GT: a references b; a must not update b. The analyzer predicts exactly the reference.
  const gt = { relations: [R("R1", "references", "REF-VALUE-FN")], negatives: [{ id: "N1", kind: "updates", source: "a", target: "b", pattern: "NEG-READ-ONLY", evidence: ["main.ts:1"], rationale: "read only" }] };
  assert.equal(score(gt, ["references"], "strict").negativeRows[0].violated, false);
  assert.equal(score(gt, ["references"], "lenient").negativeRows[0].violated, true);
  assert.equal(score(gt, ["references"], "lenient", { lenientNegatives: "sameKind" }).negativeRows[0].violated, false);
});

test("L4 one-sided collapse loses TPs when the GT itself has two kinds on one endpoint pair", () => {
  const gt = { relations: [R("R1", "references", "REF-VALUE-FN"), R("R2", "calls", "CALL-LOCAL-FN")] };
  const now = score(gt, ["calls", "references"], "lenient");
  assert.equal(now.gtRows.filter((g) => g.verdict === "TP").length, 2);
  const collapsed = score(gt, ["calls", "references"], "lenient", { lenientCollapse: true });
  assert.equal(collapsed.gtRows.filter((g) => g.verdict === "TP").length, 1, "the GT side would have to be collapsed too");
});

test("min-cost matching keeps the maximum cardinality of Kuhn's matching", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let t = 0; t < 300; t++) {
    const P = 1 + Math.floor(rnd() * 6);
    const G = 1 + Math.floor(rnd() * 6);
    const edges = Array.from({ length: P }, () => Array.from({ length: G }, (_, g) => g).filter(() => rnd() < 0.4).map((g) => ({ g, cost: Math.floor(rnd() * 4) })));
    const a = maximumMatching(edges.map((e) => e.map((x) => x.g)), G);
    const b = minCostMaximumMatching(edges, G);
    const size = (m) => m.predToGt.filter((g) => g >= 0).length;
    assert.equal(size(b), size(a));
    b.predToGt.forEach((g, p) => g >= 0 && assert.ok(edges[p].some((e) => e.g === g)));
    assert.equal(new Set(b.predToGt.filter((g) => g >= 0)).size, size(b));
    // brute force: the least total cost among matchings of maximum size
    let best = { size: -1, cost: Infinity };
    const walk = (p, used, sz, cost) => {
      if (p === P) {
        if (sz > best.size || (sz === best.size && cost < best.cost)) best = { size: sz, cost };
        return;
      }
      walk(p + 1, used, sz, cost);
      for (const e of edges[p]) if (!used.has(e.g)) walk(p + 1, new Set([...used, e.g]), sz + 1, cost + e.cost);
    };
    walk(0, new Set(), 0, 0);
    const cost = b.predToGt.reduce((s, g, p) => (g >= 0 ? s + edges[p].find((e) => e.g === g).cost : s), 0);
    assert.equal(cost, best.cost);
  }
});
