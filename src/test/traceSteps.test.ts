import * as assert from "assert";
import { buildGraphFromTrace, classifyTraceStep } from "../shared/traceSteps";
import type { GraphNode, GraphPayload, GraphTraceEvent } from "../shared/protocol";

function node(id: string, kind: GraphNode["kind"]): GraphTraceEvent {
  return {
    type: "node",
    node: {
      id,
      kind,
      name: id,
      file: "a.ts",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    },
  };
}

/** Same order the analyzer uses: the file first, then declarations, then relations. */
const EVENTS: GraphTraceEvent[] = [
  node("file:a.ts:0", "file"),
  node("function:a.ts:10", "function"),
  node("external:b.ts:5", "external"),
  { type: "edge", edge: { id: "calls:function:a.ts:10->external:b.ts:5@@", kind: "calls", source: "function:a.ts:10", target: "external:b.ts:5" } },
  { type: "edge", edge: { id: "dataflow:function:a.ts:10->external:b.ts:5@@x@@arg#0", kind: "dataflow", source: "function:a.ts:10", target: "external:b.ts:5", label: "x" } },
];

/** The canvas filter keeps file nodes and, here, nothing else ("Classes" on a graph without classes). */
const onlyFiles = (g: GraphPayload | undefined): GraphPayload | undefined =>
  g && { nodes: g.nodes.filter((n) => n.kind === "file"), edges: [] };

const ids = (g: GraphPayload | undefined) => g && [g.nodes.map((n) => n.id), g.edges.map((e) => e.id)];

suite("Trace steps", () => {
  test("a trace without events shows nothing and is not a trace step", () => {
    assert.strictEqual(buildGraphFromTrace([], 3), undefined);
    assert.strictEqual(classifyTraceStep(0, 0, undefined, undefined), "none");
  });

  test("cursor 0 is the intended empty start", () => {
    assert.strictEqual(buildGraphFromTrace(EVENTS, 0), undefined);
    assert.strictEqual(classifyTraceStep(EVENTS.length, 0, undefined, undefined), "ready");
  });

  test("cursor 1 holds only the file node, so there is no code node yet", () => {
    const g = buildGraphFromTrace(EVENTS, 1);
    assert.deepStrictEqual(ids(g), [["file:a.ts:0"], []]);
    assert.strictEqual(classifyTraceStep(EVENTS.length, 1, g, g), "file-only");
  });

  test("the first function node makes the step visible", () => {
    const g = buildGraphFromTrace(EVENTS, 2);
    assert.deepStrictEqual(ids(g), [["file:a.ts:0", "function:a.ts:10"], []]);
    assert.strictEqual(classifyTraceStep(EVENTS.length, 2, g, g), "visible");
  });

  test("edge events add relations with their original IDs", () => {
    const g = buildGraphFromTrace(EVENTS, 5)!;
    assert.deepStrictEqual(g.edges.map((e) => e.id), [
      "calls:function:a.ts:10->external:b.ts:5@@",
      "dataflow:function:a.ts:10->external:b.ts:5@@x@@arg#0",
    ]);
    assert.strictEqual(classifyTraceStep(EVENTS.length, 5, g, g), "visible");
    assert.deepStrictEqual(ids(buildGraphFromTrace(EVENTS, 4))![1], ["calls:function:a.ts:10->external:b.ts:5@@"]);
  });

  test("Next, Prev, Next gives the same graph at each cursor", () => {
    const forward = [1, 2, 3, 4, 5].map((c) => JSON.stringify(buildGraphFromTrace(EVENTS, c)));
    const back = [4, 3, 2, 1].map((c) => JSON.stringify(buildGraphFromTrace(EVENTS, c)));
    assert.deepStrictEqual(back, forward.slice(0, 4).reverse());
    assert.strictEqual(JSON.stringify(buildGraphFromTrace(EVENTS, 3)), forward[2]);
  });

  test("a step whose code nodes the filter hides is told apart", () => {
    const g = buildGraphFromTrace(EVENTS, 3);
    assert.strictEqual(classifyTraceStep(EVENTS.length, 3, g, onlyFiles(g)), "filtered");
    // the file-only step stays file-only under any filter
    const first = buildGraphFromTrace(EVENTS, 1);
    assert.strictEqual(classifyTraceStep(EVENTS.length, 1, first, onlyFiles(first)), "file-only");
  });

  test("the event order is kept, a cursor past the end is clamped, and events are not changed", () => {
    const before = JSON.stringify(EVENTS);
    const all = buildGraphFromTrace(EVENTS, 99)!;
    assert.deepStrictEqual(all.nodes.map((n) => n.id), ["file:a.ts:0", "function:a.ts:10", "external:b.ts:5"]);
    assert.deepStrictEqual(JSON.stringify(all), JSON.stringify(buildGraphFromTrace(EVENTS, EVENTS.length)));
    // a repeated ID keeps its first position and takes the later value
    const again = { ...EVENTS[1], node: { ...(EVENTS[1] as { node: GraphNode }).node, name: "renamed" } } as GraphTraceEvent;
    const g = buildGraphFromTrace([...EVENTS, again], 6)!;
    assert.deepStrictEqual(g.nodes.map((n) => [n.id, n.name]), [
      ["file:a.ts:0", "file:a.ts:0"],
      ["function:a.ts:10", "renamed"],
      ["external:b.ts:5", "external:b.ts:5"],
    ]);
    assert.strictEqual(JSON.stringify(EVENTS), before);
  });
});
