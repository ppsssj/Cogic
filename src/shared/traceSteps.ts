import type { GraphPayload, GraphTraceEvent } from "./protocol";

/**
 * The graph a trace shows at `cursor`: the first `cursor` events, in order. Cursor 0 has no
 * graph by design. A repeated ID keeps its first position and takes the later value.
 */
export function buildGraphFromTrace(
  events: readonly GraphTraceEvent[],
  cursor: number,
): GraphPayload | undefined {
  if (!events.length || cursor <= 0) {
    return undefined;
  }
  const count = Math.min(events.length, cursor);
  const nodes = new Map<string, GraphPayload["nodes"][number]>();
  const edges = new Map<string, GraphPayload["edges"][number]>();
  for (let i = 0; i < count; i++) {
    const event = events[i];
    if (event.type === "node") {
      nodes.set(event.node.id, event.node);
    } else {
      edges.set(event.edge.id, event.edge);
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/**
 * What a trace step can show:
 * - `ready`: cursor 0, before the first event (no graph, by design);
 * - `file-only`: only file nodes so far (the analyzer adds the file first), so no code node yet;
 * - `filtered`: code nodes exist, but the current filter keeps none of them;
 * - `visible`: at least one code node passes the filter.
 */
export type TraceStepView = "none" | "ready" | "file-only" | "filtered" | "visible";

export function classifyTraceStep(
  totalEvents: number,
  cursor: number,
  stepGraph: GraphPayload | undefined,
  filteredGraph: GraphPayload | undefined,
): TraceStepView {
  if (totalEvents <= 0) {
    return "none";
  }
  if (cursor <= 0) {
    return "ready";
  }
  const hasCode = (graph: GraphPayload | undefined) =>
    Boolean(graph?.nodes.some((node) => node.kind !== "file"));
  if (!hasCode(stepGraph)) {
    return "file-only";
  }
  return hasCode(filteredGraph) ? "visible" : "filtered";
}
