// Regression characterization of the current defect, not a desired-behavior test.
// Opt in only on the pre-fix analyzer: COGIC_P14A_HISTORICAL=1 node --test <this file>.
// The unmodified original is preserved in p14-call-ownership-fix/ui-smoke/evidence/.
"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
test("historical pre-fix H2 defect characterization", { skip: process.env.COGIC_P14A_HISTORICAL === "1" ? false : "historical pre-fix evidence; not a current-product test" }, () => {
  const analyzer = require(path.resolve(__dirname, "../../../../out/analyzer"));
  const code = `function target(x: number) { return x; }
class Example {
  fetch: (x: number) => number = (x) => this.#dispatch(x);
  request = (x: number) => this.fetch(x);
  #dispatch(x: number) { return target(x); }
}`;
  const result = analyzer.analyzeActiveFile({ code, fileName: "p14-h2.ts", languageId: "typescript", cacheEnabled: false });
  const nodes = new Map(result.graph.nodes.map(n => [n.id, n.name]));
  const edges = result.graph.edges.map(e => [e.kind, nodes.get(e.source), nodes.get(e.target)]);
  const has = (kind, from, to) => edges.some(e => e[0] === kind && e[1] === from && e[2] === to);
  assert.ok([...nodes.values()].includes("Example.request"));
  assert.ok([...nodes.values()].includes("Example.fetch"));
  assert.ok(![...nodes.values()].some(n => /dispatch/.test(n)));
  assert.ok(!has("calls", "Example.request", "Example.fetch"));
  assert.ok(has("calls", "p14-h2.ts", "target"));
  assert.ok(has("dataflow", "p14-h2.ts", "target"));
});
