import * as assert from "assert";
import { aggregateEdges, type VisualEdge } from "../shared/edgeAggregation";
import {
  classifyFocusEdge,
  computeFocusNeighborhood,
  getFocusUiState,
  isFocusPaused,
} from "../shared/focusNeighborhood";
import type { GraphEdge, GraphEdgeKind, GraphNode, GraphPayload } from "../shared/protocol";

function node(id: string, kind: GraphNode["kind"] = "function", file = "a.ts"): GraphNode {
  return {
    id,
    kind,
    name: id,
    file,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  };
}

function edge(id: string, source: string, target: string, kind: GraphEdgeKind = "calls"): GraphEdge {
  return { id, kind, source, target };
}

/**
 *   A → B → C        B is the center. A calls B, B calls C, D sends data to B, B constructs E,
 *   D ⇢ B ⇢ E        E updates F (two hops), G references A (two hops), H is unrelated.
 *   E → F, G → A, H
 */
function sample(): GraphPayload {
  return {
    nodes: ["A", "B", "C", "D", "E", "F", "G", "H"].map((id) => node(id)).concat(node("file", "file")),
    edges: [
      edge("A->B", "A", "B"),
      edge("B->C", "B", "C"),
      edge("D->B@@x", "D", "B", "dataflow"),
      edge("B->E", "B", "E", "constructs"),
      edge("E->F", "E", "F", "updates"),
      edge("G->A", "G", "A", "references"),
      edge("H->H", "H", "H"),
    ],
  };
}

const sorted = (set: Set<string>) => [...set].sort();

suite("Focus + Context 1-hop neighborhood", () => {
  test("includes the center, its callers and its callees", () => {
    const focus = computeFocusNeighborhood(sample(), "B");
    assert.ok(focus);
    assert.strictEqual(focus.centerId, "B");
    assert.ok(focus.nodeIds.has("B"));
    assert.ok(focus.nodeIds.has("A"), "direct caller");
    assert.ok(focus.nodeIds.has("C"), "direct callee");
  });

  test("leaves out two-hop and unrelated nodes", () => {
    const focus = computeFocusNeighborhood(sample(), "B");
    assert.deepStrictEqual(sorted(focus!.nodeIds), ["A", "B", "C", "D", "E"]);
    for (const id of ["F", "G", "H"]) {
      assert.ok(!focus!.nodeIds.has(id), id);
    }
  });

  test("includes dataflow and the other relation kinds", () => {
    const focus = computeFocusNeighborhood(sample(), "B");
    assert.deepStrictEqual(sorted(focus!.edgeIds), ["A->B", "B->C", "B->E", "D->B@@x"]);
    const kinds = sample()
      .edges.filter((e) => focus!.edgeIds.has(e.id))
      .map((e) => e.kind)
      .sort();
    assert.deepStrictEqual(kinds, ["calls", "calls", "constructs", "dataflow"]);
    const fromE = computeFocusNeighborhood(sample(), "E");
    assert.deepStrictEqual(sorted(fromE!.edgeIds), ["B->E", "E->F"]);
    const fromA = computeFocusNeighborhood(sample(), "A");
    assert.deepStrictEqual(sorted(fromA!.edgeIds), ["A->B", "G->A"]);
  });

  test("keeps original IDs, so direction and kind come from the graph", () => {
    const graph = sample();
    const focus = computeFocusNeighborhood(graph, "B")!;
    const byId = new Map(graph.edges.map((e) => [e.id, e]));
    for (const id of focus.edgeIds) {
      assert.ok(byId.has(id), id);
    }
    assert.strictEqual(byId.get("A->B")!.target, "B", "incoming stays incoming");
    assert.strictEqual(byId.get("B->C")!.source, "B", "outgoing stays outgoing");
  });

  test("a self relation counts once and adds no other node", () => {
    const focus = computeFocusNeighborhood(sample(), "H")!;
    assert.deepStrictEqual(sorted(focus.nodeIds), ["H"]);
    assert.deepStrictEqual(sorted(focus.edgeIds), ["H->H"]);
  });

  test("is off without a center, for a missing center and for a file node", () => {
    assert.strictEqual(computeFocusNeighborhood(sample(), null), null);
    assert.strictEqual(computeFocusNeighborhood(sample(), "missing"), null);
    assert.strictEqual(computeFocusNeighborhood(sample(), "file"), null);
    assert.strictEqual(computeFocusNeighborhood(undefined, "B"), null);
  });

  test("with Focus off, no edge gets a focus state", () => {
    assert.strictEqual(classifyFocusEdge([{ id: "A->B" }], null), undefined);
  });

  test("an aggregate is related when some of its members touch the center", () => {
    const graph: GraphPayload = {
      nodes: [node("center", "function", "a.ts"), ...Array.from({ length: 12 }, (_, i) => node(`fn${i}`, "function", "b.ts"))],
      edges: Array.from({ length: 12 }, (_, i) =>
        edge(`calls:fn${i}->target${i}`, `fn${i}`, i < 2 ? "center" : `target${i}`),
      ),
    };
    const focus = computeFocusNeighborhood(graph, "center");
    const visual: VisualEdge[] = graph.edges.map((e) => ({
      id: e.id,
      kind: e.kind,
      source: "file:b.ts:0",
      target: "file:a.ts:0",
      originalSource: e.source,
      originalTarget: e.target,
      sourceHandleId: "out-control",
      targetHandleId: "in-control",
      collapsedBridge: true,
    }));
    const [drawn, ...rest] = aggregateEdges(visual);
    assert.strictEqual(rest.length, 0);
    assert.strictEqual(drawn.members.length, 12);
    const state = classifyFocusEdge(drawn.members, focus)!;
    assert.strictEqual(state.related, true);
    assert.deepStrictEqual(state.relatedIds, ["calls:fn0->target0", "calls:fn1->target1"]);
    assert.strictEqual(drawn.members.length, 12, "the count stays 12");

    const away = computeFocusNeighborhood(graph, "fn5");
    const other = classifyFocusEdge(drawn.members, away)!;
    assert.deepStrictEqual(other.relatedIds, ["calls:fn5->target5"]);
    const none = classifyFocusEdge(
      drawn.members,
      computeFocusNeighborhood({ nodes: [node("lonely")], edges: [] }, "lonely"),
    )!;
    assert.deepStrictEqual(none, { related: false, relatedIds: [] });
  });

  test("does not modify the graph", () => {
    const graph = sample();
    const before = JSON.stringify(graph);
    const focus = computeFocusNeighborhood(graph, "B")!;
    classifyFocusEdge(graph.edges, focus);
    assert.strictEqual(JSON.stringify(graph), before);
  });
});

suite("Focus precedence", () => {
  // The center exists and Focus is on; only the precedence inputs change.
  const ui = (input: Parameters<typeof isFocusPaused>[0]) =>
    getFocusUiState(true, true, isFocusPaused(input));

  test("no runtime session and no matching node: active", () => {
    assert.strictEqual(ui({ runtimeSessionActive: false, runtimeActiveNodeId: null }), "active");
    assert.strictEqual(ui({}), "active");
  });

  test("runtime session without a matching node: paused", () => {
    assert.strictEqual(ui({ runtimeSessionActive: true, runtimeActiveNodeId: null }), "paused");
  });

  test("runtime session with a matching node: paused", () => {
    assert.strictEqual(ui({ runtimeSessionActive: true, runtimeActiveNodeId: "function:a.ts:1" }), "paused");
  });

  test("the session ending brings Focus back", () => {
    const states = [
      { runtimeSessionActive: true, runtimeActiveNodeId: "function:a.ts:1" },
      { runtimeSessionActive: true, runtimeActiveNodeId: null },
      { runtimeSessionActive: false, runtimeActiveNodeId: null },
    ].map(ui);
    assert.deepStrictEqual(states, ["paused", "paused", "active"]);
  });

  test("trace, Param Flow and export also pause; pausing never turns Focus off", () => {
    assert.strictEqual(ui({ traceVisible: true }), "paused");
    assert.strictEqual(ui({ flowHighlightId: "dataflow:a->b@@x" }), "paused");
    assert.strictEqual(ui({ exporting: true }), "paused");
    assert.strictEqual(getFocusUiState(false, true, true), "off");
    assert.strictEqual(getFocusUiState(true, false, true), "idle");
  });
});
