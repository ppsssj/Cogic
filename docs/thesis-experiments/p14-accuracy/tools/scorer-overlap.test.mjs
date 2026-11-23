// Characterizes a post-hoc scorer ambiguity; this does not assert the desired policy.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, normalizeCogicGraph, resolveGt, scoreCase, computeMetrics } from "../../tools/exp01/lib.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.resolve(here, "../../fixtures/exp-01");
const catalog = loadCatalog(path.join(corpus, "catalog.csv"));
test("characterize lenient matching when a determinate reference overlaps an indeterminate call", () => {
  const root = "C:/synthetic/fixture", file = `${root}/main.ts`;
  const node = (name, line) => ({ id: name, name, kind: "function", file, range: { start: { line: line - 1, character: 0 }, end: { line: line - 1, character: 1 } } });
  const graph = { nodes: [node("a", 1), node("b", 5)], edges: ["calls", "references"].map(kind => ({ id: `${kind}:a->b`, kind, source: "a", target: "b" })) };
  const gt = { schema: "exp01-gt/1", caseId: "synthetic", gtVersion: 1, activeFile: "main.ts", nodes: [{ id: "a", type: "callable", file: "main.ts", line: 1 }, { id: "b", type: "callable", file: "main.ts", line: 5 }], relations: [{ id: "R1", kind: "references", source: "a", target: "b", pattern: "REF-VALUE-FN", gtStatus: "determinate", evidence: ["main.ts:1"] }, { id: "I1", kind: "calls", source: "a", pattern: "CALL-VARIABLE-ALIAS", gtStatus: "indeterminate", candidates: [{ target: "b" }], reason: "runtime target", evidence: ["main.ts:1"] }], negatives: [], excludedSites: [] };
  const pred = normalizeCogicGraph(graph, { fixtureRoot: root, caseId: "synthetic" }), resolved = resolveGt(gt, catalog);
  const strict = scoreCase(resolved, pred, "strict"), lenient = scoreCase(resolved, pred, "lenient");
  assert.deepEqual(strict.predRows.map(x => [x.kind, x.verdict]), [["calls", "EXCLUDED"], ["references", "TP"]]);
  assert.deepEqual(lenient.predRows.map(x => [x.kind, x.verdict]), [["calls", "TP"], ["references", "FP"]]);
  assert.ok(computeMetrics([lenient]).micro.precision < computeMetrics([strict]).micro.precision);
});
