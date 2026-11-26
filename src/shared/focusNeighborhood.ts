import type { GraphEdge, GraphPayload } from "./protocol";

/**
 * The relations one graph edge away from a node, in either direction. Only the graph that is
 * passed in is read: no transitive or inferred relations, and nothing is modified.
 */
export type FocusNeighborhood = {
  centerId: string;
  /** The center and every node at the other end of one of its relations. */
  nodeIds: Set<string>;
  /** Original relation IDs with the center at one end, of any kind. */
  edgeIds: Set<string>;
};

/**
 * Returns null when the center is not in the graph (filtered out, or gone after a
 * regeneration) or is a file node, so the caller falls back to the normal view.
 */
export function computeFocusNeighborhood(
  graph: GraphPayload | undefined,
  centerId: string | null | undefined,
): FocusNeighborhood | null {
  if (!graph || !centerId) {
    return null;
  }
  const center = graph.nodes.find((node) => node.id === centerId);
  if (!center || center.kind === "file") {
    return null;
  }

  const nodeIds = new Set<string>([centerId]);
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source !== centerId && edge.target !== centerId) {
      continue;
    }
    edgeIds.add(edge.id);
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  return { centerId, nodeIds, edgeIds };
}

/** How a drawn edge relates to the focus. `undefined` means the focus is off. */
export type FocusEdgeState = {
  /** At least one original relation behind the edge touches the center. */
  related: boolean;
  /** Those relations, in member order. The member list itself is never changed. */
  relatedIds: string[];
};

export function classifyFocusEdge(
  members: ReadonlyArray<Pick<GraphEdge, "id">>,
  focus: FocusNeighborhood | null,
): FocusEdgeState | undefined {
  if (!focus) {
    return undefined;
  }
  const relatedIds = members.filter((member) => focus.edgeIds.has(member.id)).map((m) => m.id);
  return { related: relatedIds.length > 0, relatedIds };
}
