import * as assert from "assert";
import { aggregateEdges, type VisualEdge } from "../shared/edgeAggregation";

const FILE_A = "file:a.ts:0";
const FILE_B = "file:b.ts:0";

function edge(id: string, over: Partial<VisualEdge> = {}): VisualEdge {
  return {
    id,
    kind: "calls",
    source: FILE_A,
    target: FILE_B,
    originalSource: `fn:${id}`,
    originalTarget: "fn:process",
    sourceHandleId: "out-control",
    targetHandleId: "in-control",
    collapsedBridge: true,
    ...over,
  };
}

function ids(edges: ReturnType<typeof aggregateEdges>) {
  return edges.flatMap((e) => e.members.map((m) => m.id)).sort();
}

suite("Semantic edge aggregation", () => {
  test("collapsed relations share one edge and keep every original", () => {
    const [drawn, ...rest] = aggregateEdges([edge("calc"), edge("validate"), edge("format")]);
    assert.strictEqual(rest.length, 0);
    assert.strictEqual(drawn.aggregated, true);
    assert.deepStrictEqual(drawn.members, [
      { id: "calc", source: "fn:calc", target: "fn:process", label: undefined },
      { id: "validate", source: "fn:validate", target: "fn:process", label: undefined },
      { id: "format", source: "fn:format", target: "fn:process", label: undefined },
    ]);
  });

  test("a single collapsed relation is not an aggregate and keeps its ID", () => {
    const [drawn] = aggregateEdges([edge("calc")]);
    assert.strictEqual(drawn.aggregated, false);
    assert.strictEqual(drawn.id, "calc");
  });

  test("expanded relations stay individual", () => {
    const drawn = aggregateEdges([
      edge("one", { collapsedBridge: false, source: "fn:one" }),
      edge("two", { collapsedBridge: false, source: "fn:two" }),
    ]);
    assert.deepStrictEqual(drawn.map((e) => e.id), ["one", "two"]);
    assert.ok(drawn.every((e) => !e.aggregated));
  });

  test("expanded relations with equal labels share an edge without a count", () => {
    const base = { collapsedBridge: false, source: "fn:x", target: "fn:y", label: "x <- x", kind: "dataflow" as const };
    const drawn = aggregateEdges([edge("arg0", base), edge("arg1", base)]);
    assert.strictEqual(drawn.length, 1);
    assert.strictEqual(drawn[0].aggregated, false);
    assert.strictEqual(drawn[0].id, "arg0");
    assert.deepStrictEqual(ids(drawn), ["arg0", "arg1"]);
  });

  test("kind, direction and handles are never merged", () => {
    const drawn = aggregateEdges([
      edge("call"),
      edge("ref", { kind: "references" }),
      edge("build", { kind: "constructs" }),
      edge("back", { source: FILE_B, target: FILE_A }),
      edge("child", { targetHandleId: "in-child-fn:process" }),
    ]);
    assert.strictEqual(drawn.length, 5);
    assert.ok(drawn.every((e) => !e.aggregated));
  });

  test("dataflow labels survive aggregation", () => {
    const drawn = aggregateEdges([
      edge("f1", { kind: "dataflow", label: "a <- x" }),
      edge("f2", { kind: "dataflow", label: "b <- y" }),
    ]);
    assert.strictEqual(drawn.length, 1);
    assert.deepStrictEqual(drawn[0].members.map((m) => m.label), ["a <- x", "b <- y"]);
  });

  test("a repeated relation ID counts once", () => {
    const drawn = aggregateEdges([edge("calc"), edge("calc"), edge("format")]);
    assert.strictEqual(drawn[0].members.length, 2);
  });

  test("IDs do not depend on input order and differ between groups", () => {
    const input = [edge("a"), edge("b"), edge("r1", { kind: "references" }), edge("r2", { kind: "references" })];
    const forward = aggregateEdges(input).map((e) => e.id).sort();
    const reverse = aggregateEdges([...input].reverse()).map((e) => e.id).sort();
    assert.deepStrictEqual(forward, reverse);
    assert.strictEqual(new Set(forward).size, 2);
  });

  test("input is not modified and no relation is lost or repeated", () => {
    const input = [edge("a"), edge("b"), edge("c", { kind: "references" }), edge("d", { collapsedBridge: false })];
    const before = JSON.stringify(input);
    const drawn = aggregateEdges(input);
    assert.strictEqual(JSON.stringify(input), before);
    assert.deepStrictEqual(ids(drawn), ["a", "b", "c", "d"]);
  });
});
