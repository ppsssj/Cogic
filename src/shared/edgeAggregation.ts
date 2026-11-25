import type { GraphEdgeKind } from "./protocol";

/** A graph relation after its endpoints were mapped to what is currently drawn. */
export type VisualEdge = {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
  label?: string;
  originalSource: string;
  originalTarget: string;
  sourceHandleId?: string;
  targetHandleId?: string;
  /** True when at least one endpoint is a collapsed file or folder. */
  collapsedBridge: boolean;
};

/** One relation of the analyzed graph, with its real endpoints. */
export type EdgeMember = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type DrawnEdge = VisualEdge & {
  members: EdgeMember[];
  /** Set when one drawn edge stands for two or more relations, collapsed or not. */
  aggregated: boolean;
};

/**
 * Draws relations that share kind, direction, endpoints and handles as one edge, but only
 * where a file or folder is collapsed. Every relation stays in `members`; the label is not
 * part of the collapsed key because each member keeps its own.
 *
 * Elsewhere, only relations with equal labels share an edge (the long-standing rule). Such an
 * edge is an aggregate too, so that every relation behind it can be opened.
 *
 * The count is the number of distinct relation IDs from the analyzer, not a number of
 * runtime calls. A repeated ID counts once.
 */
export function aggregateEdges(edges: readonly VisualEdge[]): DrawnEdge[] {
  const groups = new Map<string, { first: VisualEdge; members: Map<string, EdgeMember> }>();

  for (const edge of edges) {
    const key = groupKey(edge);
    let group = groups.get(key);
    if (!group) {
      group = { first: edge, members: new Map() };
      groups.set(key, group);
    }
    if (!group.members.has(edge.id)) {
      group.members.set(edge.id, {
        id: edge.id,
        source: edge.originalSource,
        target: edge.originalTarget,
        label: edge.label,
      });
    }
  }

  return [...groups].map(([key, { first, members }]) => {
    const list = [...members.values()];
    const aggregated = list.length > 1;
    return {
      ...first,
      // Built from what the edge connects, so it does not depend on input order.
      id: aggregated ? `aggregate:${key}` : first.id,
      members: list,
      aggregated,
    };
  });
}

function groupKey(edge: VisualEdge): string {
  const parts = [
    edge.kind,
    edge.source,
    edge.target,
    edge.sourceHandleId ?? "",
    edge.targetHandleId ?? "",
  ];
  return JSON.stringify(edge.collapsedBridge ? parts : [...parts, edge.label ?? ""]);
}
