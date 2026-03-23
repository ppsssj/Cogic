// import "./../App.css";
import "reactflow/dist/style.css";
import "./CanvasPane.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MouseEvent as ReactDomMouseEvent,
} from "react";
import ReactFlow, {
  Background,
  ReactFlowProvider,
  MarkerType,
  Handle,
  Position,
  EdgeLabelRenderer,
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps,
  type Edge,
  type Node,
  // type NodeMouseHandler,
  type ReactFlowInstance,
} from "reactflow";

import { Crosshair, Network, Sigma, ZoomIn, ZoomOut } from "lucide-react";
import type {
  CodeDiagnostic,
  GraphNode,
  GraphPayload,
  GraphTraceEvent,
  UINotice,
} from "../lib/vscode";
import {
  dumpWebviewDebugBuffer,
  pushWebviewDebugEvent,
} from "../lib/debugLog";
import type { ChipKey } from "./FiltersBar";

type InterfaceSubkind = "interface" | "type" | "enum";
function getInterfaceSubkind(n: GraphNode): InterfaceSubkind | undefined {
  const v = (n as unknown as { subkind?: unknown }).subkind;
  return v === "interface" || v === "type" || v === "enum" ? v : undefined;
}

type CodeNodeData = {
  title: string;
  subtitle: string;
  kind: GraphNode["kind"];
  subkind?: InterfaceSubkind;
  searchHit?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  focusPulseToken?: number;
  diagnosticSeverity?: "error" | "warning";
  diagnosticCount?: number;
  warningCount?: number;
  childItems?: Array<{
    id: string;
    kind: string;
    title: string;
    subtitle: string;
    selected?: boolean;
    focusPulseToken?: number;
    diagnosticSeverity?: "error" | "warning";
    diagnosticCount?: number;
    warningCount?: number;
    onClick?: () => void;
    onDoubleClick?: () => void;
  }>;
  /** Absolute/relative file path used to expand external nodes. */
  file: string;
};

type DiagnosticSummary = {
  diagnosticSeverity: "error" | "warning";
  diagnosticCount: number;
  warningCount: number;
};

type FileGroupData = {
  title: string;
  subtitle: string;
  kind: "file";
  file: string;
  count: number;
};

function fitGraphView(inst: ReactFlowInstance | null, duration = 400) {
  if (!inst) return;
  inst.fitView({ padding: 0.12, duration });
}

function focusCanvasNode(
  inst: ReactFlowInstance | null,
  node: Node<CodeNodeData | FileGroupData>,
  zoom: number,
  duration: number,
) {
  if (!inst) return;
  inst.setCenter(
    node.position.x + (node.width ?? 210) / 2,
    node.position.y + (node.height ?? 72) / 2,
    { zoom, duration },
  );
}

function focusCanvasNodePair(
  inst: ReactFlowInstance | null,
  firstNode: Node<CodeNodeData | FileGroupData>,
  secondNode: Node<CodeNodeData | FileGroupData>,
  zoom: number,
  duration: number,
) {
  if (!inst) return;

  const firstWidth = firstNode.width ?? 210;
  const firstHeight = firstNode.height ?? 72;
  const secondWidth = secondNode.width ?? 210;
  const secondHeight = secondNode.height ?? 72;
  const centerX =
    (firstNode.position.x +
      firstWidth / 2 +
      secondNode.position.x +
      secondWidth / 2) /
    2;
  const centerY =
    (firstNode.position.y +
      firstHeight / 2 +
      secondNode.position.y +
      secondHeight / 2) /
    2;

  inst.setCenter(centerX, centerY, { zoom, duration });
}

function shortFile(p: string) {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function baseName(p: string) {
  return shortFile(p);
}
function dirName(p: string) {
  const norm = p.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(0, i) : "";
}

function getGraphCounts(graph: GraphPayload | undefined) {
  return {
    graphNodes: graph?.nodes.length ?? 0,
    graphEdges: graph?.edges.length ?? 0,
  };
}

function shortenTopologyKey(value: string, max = 96) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...(${value.length})`;
}

const ENABLE_AUTO_VIEWPORT_EFFECTS = true;

function nodeTitle(n: GraphNode) {
  if (n.kind === "class") return `class ${n.name}`;
  if (n.kind === "function") return `${n.name}()`;
  if (n.kind === "method") return `${n.name}()`;
  return n.name;
}

function childTitle(parent: GraphNode, child: GraphNode) {
  if (child.kind === "method") {
    return child.name.replace(`${parent.name}.`, "") + "()";
  }
  if (child.kind === "function") return `${child.name}()`;
  if (child.kind === "class") return `class ${child.name}`;
  return child.name;
}

function childKindLabel(child: GraphNode) {
  if (child.kind === "interface" && child.subkind) return child.subkind;
  return child.kind;
}

function getNodeToneClass(data: CodeNodeData): string {
  if (data.kind === "class") return "cgNode--class";
  if (data.kind === "function" || data.kind === "method") {
    return "cgNode--function";
  }
  if (data.kind === "interface") {
    if (data.subkind === "type") return "cgNode--type";
    if (data.subkind === "enum") return "cgNode--enum";
    return "cgNode--interface";
  }
  if (data.kind === "external") return "cgNode--external";
  return "cgNode--default";
}

function normalizePath(p: string) {
  return p.replace(/\\/g, "/");
}

function comparePos(
  a: { line: number; character: number },
  b: { line: number; character: number },
) {
  if (a.line !== b.line) return a.line - b.line;
  return a.character - b.character;
}

function rangesOverlap(
  a: GraphNode["range"],
  b: NonNullable<CodeDiagnostic["range"]>,
) {
  return comparePos(a.start, b.end) <= 0 && comparePos(b.start, a.end) <= 0;
}

function rangeSize(
  range:
    | GraphNode["range"]
    | NonNullable<CodeDiagnostic["range"]>,
) {
  return (
    (range.end.line - range.start.line) * 1_000_000 +
    (range.end.character - range.start.character)
  );
}

function distanceToRange(
  pos: { line: number; character: number },
  range: GraphNode["range"],
) {
  if (comparePos(pos, range.start) < 0) {
    return (
      (range.start.line - pos.line) * 1_000_000 +
      (range.start.character - pos.character)
    );
  }
  if (comparePos(pos, range.end) > 0) {
    return (
      (pos.line - range.end.line) * 1_000_000 +
      (pos.character - range.end.character)
    );
  }
  return 0;
}

function pickDiagnosticOwner(
  nodes: GraphNode[],
  diagnostic: CodeDiagnostic,
) {
  if (!nodes.length) return null;

  const orderedNodes = [...nodes].sort((a, b) => {
    const startDiff = comparePos(a.range.start, b.range.start);
    if (startDiff !== 0) return startDiff;
    return rangeSize(a.range) - rangeSize(b.range);
  });

  if (!diagnostic.range) return orderedNodes[0] ?? null;

  const overlapping = orderedNodes
    .filter((node) => rangesOverlap(node.range, diagnostic.range!))
    .sort((a, b) => {
      const sizeDiff = rangeSize(a.range) - rangeSize(b.range);
      if (sizeDiff !== 0) return sizeDiff;
      return comparePos(a.range.start, b.range.start);
    });
  if (overlapping.length) return overlapping[0];

  return (
    orderedNodes
      .map((node) => ({
        node,
        distance: distanceToRange(diagnostic.range!.start, node.range),
      }))
      .sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
        return rangeSize(a.node.range) - rangeSize(b.node.range);
      })[0]?.node ?? null
  );
}

function buildDiagnosticSummaryByNode(
  graph: GraphPayload,
  diagnostics: CodeDiagnostic[] | undefined,
) {
  const summaries = new Map<string, DiagnosticSummary>();
  if (!diagnostics?.length) return summaries;

  const nodesByFile = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    if (node.kind === "file") continue;
    const fileKey = normalizePath(node.file);
    if (!nodesByFile.has(fileKey)) nodesByFile.set(fileKey, []);
    nodesByFile.get(fileKey)!.push(node);
  }

  const countsByNodeId = new Map<
    string,
    { diagnosticCount: number; warningCount: number }
  >();

  for (const diagnostic of diagnostics) {
    if (!diagnostic.filePath) continue;
    const fileNodes = nodesByFile.get(normalizePath(diagnostic.filePath));
    if (!fileNodes?.length) continue;

    const owner = pickDiagnosticOwner(fileNodes, diagnostic);
    if (!owner) continue;

    const counts = countsByNodeId.get(owner.id) ?? {
      diagnosticCount: 0,
      warningCount: 0,
    };
    if (diagnostic.severity === "warning") {
      counts.warningCount += 1;
    } else if (diagnostic.severity === "error") {
      counts.diagnosticCount += 1;
    }
    countsByNodeId.set(owner.id, counts);
  }

  for (const [nodeId, counts] of countsByNodeId.entries()) {
    if (counts.diagnosticCount <= 0 && counts.warningCount <= 0) continue;
    summaries.set(nodeId, {
      diagnosticSeverity:
        counts.diagnosticCount > 0 ? "error" : "warning",
      diagnosticCount: counts.diagnosticCount,
      warningCount: counts.warningCount,
    });
  }

  return summaries;
}

function CodeNode({
  data,
  selected,
}: {
  data: CodeNodeData;
  selected?: boolean;
}) {
  const isSelected = Boolean(selected || data.selected);
  const badge =
    data.kind === "interface"
      ? data.subkind
      : data.kind === "external"
        ? "external"
        : undefined;
  const handleChildClick =
    (onClick?: () => void) => (event: ReactDomMouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      onClick?.();
    };
  const handleChildDoubleClick =
    (onDoubleClick?: () => void) => (event: ReactDomMouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      onDoubleClick?.();
    };

  return (
    <div
      className={[
        "cgNode",
        getNodeToneClass(data),
        data.highlighted ? "cgNode--connected" : "",
        data.searchHit ? "cgNode--searchHit" : "",
        isSelected ? "cgNode--selected" : "",
      ].join(" ")}
    >
      {data.focusPulseToken ? (
        <span key={data.focusPulseToken} className="cgNodePulse" aria-hidden="true" />
      ) : null}
      {/* Structural edges (calls/constructs/references) */}
      <Handle
        id="in-control"
        type="target"
        position={Position.Left}
        className="cgHandle"
      />
      <Handle
        id="out-control"
        type="source"
        position={Position.Right}
        className="cgHandle"
      />
      {/* Dataflow edges use separate lanes to reduce overlap */}
      <Handle
        id="in-dataflow"
        type="target"
        position={Position.Top}
        className="cgHandle"
      />
      <Handle
        id="out-dataflow"
        type="source"
        position={Position.Bottom}
        className="cgHandle"
      />

      <div className="cgNodeTop">
        <div className="cgNodeTitle">{data.title}</div>
        <div className="cgNodeBadges">
          {(data.diagnosticCount ?? 0) > 0 ? (
            <div
              className={["cgDiagBadge", "cgDiagBadge--error"].join(" ")}
            >
              {`ERROR ${data.diagnosticCount ?? 0}`}
            </div>
          ) : null}
          {(data.warningCount ?? 0) > 0 ? (
            <div className={["cgDiagBadge", "cgDiagBadge--warning"].join(" ")}>
              {`WARN ${data.warningCount ?? 0}`}
            </div>
          ) : null}
          {badge ? <div className="cgBadge">{badge.toUpperCase()}</div> : null}
        </div>
      </div>
      <div className="cgNodeSub">{data.subtitle}</div>
      {data.childItems?.length ? (
        <div className="cgChildList">
          <div className="cgChildListHeader">
            <span className="cgChildListTitle">Nested</span>
            <span className="cgChildListCount">{data.childItems.length}</span>
          </div>
          {data.childItems.map((child) => (
            <div
              key={child.id}
              className={[
                "cgChildNode",
                child.selected ? "cgChildNode--selected" : "",
                child.onClick || child.onDoubleClick ? "cgChildNode--interactive" : "",
              ].join(" ")}
              onClick={handleChildClick(child.onClick)}
              onDoubleClick={handleChildDoubleClick(child.onDoubleClick)}
            >
              {child.focusPulseToken ? (
                <span
                  key={child.focusPulseToken}
                  className="cgChildPulse"
                  aria-hidden="true"
                />
              ) : null}
              <Handle
                id={`in-child-${child.id}`}
                type="target"
                position={Position.Left}
                className="cgHandle cgHandle--child"
              />
              <Handle
                id={`out-child-${child.id}`}
                type="source"
                position={Position.Right}
                className="cgHandle cgHandle--child"
              />
              <div className="cgChildTop">
                <div className="cgChildTitle">{child.title}</div>
                <div className="cgChildBadgeWrap">
                  {(child.diagnosticCount ?? 0) > 0 ? (
                    <div
                      className={[
                        "cgChildDiagBadge",
                        "cgChildDiagBadge--error",
                      ].join(" ")}
                    >
                      {`ERROR ${child.diagnosticCount ?? 0}`}
                    </div>
                  ) : null}
                  {(child.warningCount ?? 0) > 0 ? (
                    <div
                      className={[
                        "cgChildDiagBadge",
                        "cgChildDiagBadge--warning",
                      ].join(" ")}
                    >
                      {`WARN ${child.warningCount ?? 0}`}
                    </div>
                  ) : null}
                  <div className="cgChildBadge">{child.kind.toUpperCase()}</div>
                </div>
              </div>
              <div className="cgChildSub">{child.subtitle}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FileGroupNode({
  data,
  selected,
}: {
  data: FileGroupData;
  selected?: boolean;
}) {
  return (
    <div className={["cgGroup", selected ? "cgGroup--selected" : ""].join(" ")}>
      <div className="cgGroupHeader">
        <div className="cgGroupTitle">{data.title}</div>
        <div className="cgGroupMeta">
          <span className="cgGroupPath">{data.subtitle}</span>
          <span className="cgGroupCount">{data.count} nodes</span>
        </div>
      </div>
    </div>
  );
}
const nodeTypes = { code: CodeNode, fileGroup: FileGroupNode };
type DataflowEdgeData = {
  label?: string;
  highlighted?: boolean;
  muted?: boolean;
  lane?: number;
};

function DataflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<DataflowEdgeData>) {
  const lane = data?.lane ?? 0;
  const laneOffset = 30 + Math.abs(lane) * 22;
  const laneShiftY = lane * 18;
  const labelShiftY = lane * 28;
  const sourceYLaned = sourceY + laneShiftY;
  const targetYLaned = targetY + laneShiftY;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY: sourceYLaned,
    targetX,
    targetY: targetYLaned,
    sourcePosition,
    targetPosition,
    borderRadius: 18,
    offset: laneOffset,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className="cgEdgeLabel"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + labelShiftY}px)`,
              opacity: data.muted ? 0.35 : 1,
              borderColor: data.highlighted ? "rgba(56,189,248,0.75)" : undefined,
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes = { dataflow: DataflowEdge };

function toReactFlowEdges(
  graph?: GraphPayload,
  selectedNodeId?: string | null,
  highlightedEdgeId?: string | null,
): Array<Edge<DataflowEdgeData>> {
  if (!graph) return [];

  const existingNodeIds = new Set(graph.nodes.map((n) => n.id));
  const collapsedNodeIds = new Set(
    graph.nodes
      .filter((n) => n.parentId && existingNodeIds.has(n.parentId))
      .map((n) => n.id),
  );
  const parentIdByNodeId = new Map(
    graph.nodes
      .filter((n) => n.parentId && existingNodeIds.has(n.parentId))
      .map((n) => [n.id, n.parentId as string]),
  );

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const remappedEdges = graph.edges
    .map((e) => ({
      ...e,
      source: parentIdByNodeId.get(e.source) ?? e.source,
      target: parentIdByNodeId.get(e.target) ?? e.target,
      originalSource: e.source,
      originalTarget: e.target,
      sourceHandleId: parentIdByNodeId.has(e.source) ? `out-child-${e.source}` : undefined,
      targetHandleId: parentIdByNodeId.has(e.target) ? `in-child-${e.target}` : undefined,
    }))
    .filter((e) => e.source !== e.target);

  const dedupedEdges = new Map<string, (typeof remappedEdges)[number]>();
  for (const edge of remappedEdges) {
    const key = `${edge.kind}:${edge.source}:${edge.target}:${edge.sourceHandleId ?? ""}:${edge.targetHandleId ?? ""}:${edge.label ?? ""}`;
    if (!dedupedEdges.has(key)) dedupedEdges.set(key, edge);
  }

  const visibleEdges = [...dedupedEdges.values()].filter((e) => {
    const src = nodeById.get(e.source);
    const tgt = nodeById.get(e.target);
    if (!src || !tgt) return false;

    // File container edges are noisy and often visually occluded by the group frame.
    // Keep file node as a visual header only.
    if (src.kind === "file" || tgt.kind === "file") return false;
    if (collapsedNodeIds.has(src.id) || collapsedNodeIds.has(tgt.id)) return false;
    return true;
  });

  const dataflowCountByPair = new Map<string, number>();
  for (const e of visibleEdges) {
    if (e.kind !== "dataflow") continue;
    const key = `${e.source}=>${e.target}`;
    dataflowCountByPair.set(key, (dataflowCountByPair.get(key) ?? 0) + 1);
  }
  const dataflowSeenByPair = new Map<string, number>();

  return visibleEdges.map((e) => {
    const label = e.label ?? e.kind;
    const isDataflow = e.kind === "dataflow";

    const isSelectedFlow = Boolean(
      selectedNodeId &&
        (e.originalSource === selectedNodeId ||
          e.originalTarget === selectedNodeId),
    );
    const isFocusedFlow = Boolean(highlightedEdgeId && e.id === highlightedEdgeId);
    const muted = Boolean(
      isDataflow &&
        ((highlightedEdgeId && !isFocusedFlow) ||
          (!highlightedEdgeId && selectedNodeId && !isSelectedFlow)),
    );
    const showDataflowLabel = Boolean(
      isFocusedFlow || (selectedNodeId && isSelectedFlow),
    );

    let lane = 0;
    if (isDataflow) {
      const key = `${e.source}=>${e.target}`;
      const seen = dataflowSeenByPair.get(key) ?? 0;
      const total = dataflowCountByPair.get(key) ?? 1;
      dataflowSeenByPair.set(key, seen + 1);
      if (total % 2 === 1) {
        lane = seen - Math.floor(total / 2);
      } else {
        // even count: avoid lane 0 so parallel edges don't sit on top of each other
        const half = total / 2;
        lane = seen < half ? seen - half : seen - half + 1;
      }
    }

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: isDataflow ? "dataflow" : undefined, // ✅ dataflow만 커스텀 엣지 사용
      sourceHandle:
        e.sourceHandleId ?? (isDataflow ? "out-dataflow" : "out-control"),
      targetHandle:
        e.targetHandleId ?? (isDataflow ? "in-dataflow" : "in-control"),
      markerEnd: isDataflow
        ? {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            color: isFocusedFlow || isSelectedFlow ? "#38bdf8" : "#60a5fa",
          }
        : { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      style: isDataflow
        ? {
            stroke: isFocusedFlow || isSelectedFlow ? "#38bdf8" : "#60a5fa",
            strokeWidth: isFocusedFlow || isSelectedFlow ? 2.8 : 1.8,
            strokeDasharray: "8 6",
            opacity: muted ? 0.2 : 0.92,
          }
        : undefined,
      animated: isDataflow && !muted,
      data: isDataflow
        ? {
            label: showDataflowLabel ? label : undefined,
            highlighted: isFocusedFlow || isSelectedFlow,
            muted,
            lane,
          }
        : undefined, // ✅ dataflow 라벨은 data.label로
      label: undefined, // keep non-dataflow labels hidden to prevent clutter
    };
  });
}

function matchesChipFilter(node: GraphNode, chip: ChipKey): boolean {
  if (chip === "all") return true;
  if (node.kind === "file") return true;
  if (chip === "files") return true;
  if (chip === "functions") return node.kind === "function" || node.kind === "method";
  if (chip === "classes") return node.kind === "class";
  if (chip === "interfaces") return node.kind === "interface";
  if (chip === "variables") return node.kind === "external";
  return true;
}

function filterGraph(
  graph: GraphPayload | undefined,
  chip: ChipKey,
): GraphPayload | undefined {
  if (!graph) return undefined;

  const matched = graph.nodes.filter((n) => matchesChipFilter(n, chip));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodeMap = new Map(matched.map((n) => [n.id, n]));

  for (const node of matched) {
    let parentId = node.parentId;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) break;
      nodeMap.set(parent.id, parent);
      parentId = parent.parentId;
    }
  }

  const nodes = [...nodeMap.values()];

  const idSet = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => idSet.has(e.source) && idSet.has(e.target),
  );

  return { nodes, edges };
}

function getSearchHitIds(
  graph: GraphPayload | undefined,
  searchQuery: string,
): Set<string> {
  const ids = new Set<string>();
  if (!graph) return ids;

  const q = searchQuery.trim().toLowerCase();
  if (!q) return ids;

  const matchedFiles = new Set<string>();
  const parentIdByNodeId = new Map(
    graph.nodes
      .filter((n) => n.parentId)
      .map((n) => [n.id, n.parentId as string]),
  );
  for (const n of graph.nodes) {
    const fileText = `${n.file} ${shortFile(n.file)}`.toLowerCase();
    if (fileText.includes(q)) matchedFiles.add(n.file);
  }

  for (const n of graph.nodes) {
    if (n.kind === "file") continue;
    const text = `${n.name} ${n.kind} ${n.file} ${n.signature ?? ""}`.toLowerCase();
    if (text.includes(q) || matchedFiles.has(n.file)) {
      ids.add(n.id);
      let parentId = parentIdByNodeId.get(n.id);
      while (parentId) {
        ids.add(parentId);
        parentId = parentIdByNodeId.get(parentId);
      }
    }
  }

  return ids;
}

type Positioned = { x: number; y: number };

function layoutChildrenByFlow(
  children: GraphNode[],
  graph: GraphPayload,
  opts: { pad: number; headerH: number; colW: number; rowH: number },
): { positions: Map<string, Positioned>; width: number; height: number } {
  const { pad, headerH, colW, rowH } = opts;
  const positions = new Map<string, Positioned>();
  const nodeW = 210;
  const nodeH = 72;

  if (children.length === 0) {
    return { positions, width: pad * 2 + colW, height: headerH + pad * 2 + rowH };
  }

  const childIds = new Set(children.map((n) => n.id));
  const childOrder = [...children].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) {
      return a.range.start.line - b.range.start.line;
    }
    return a.name.localeCompare(b.name);
  });
  const orderIndex = new Map(childOrder.map((n, i) => [n.id, i]));

  // Structural edges only: calls/constructs shape the placement.
  const structural = graph.edges.filter(
    (e) =>
      e.kind !== "dataflow" && childIds.has(e.source) && childIds.has(e.target),
  );

  if (structural.length === 0) {
    const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(children.length))));
    for (let i = 0; i < childOrder.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.set(childOrder[i].id, {
        x: pad + col * colW,
        y: headerH + pad + row * rowH,
      });
    }
    const rows = Math.max(1, Math.ceil(children.length / cols));
    return {
      positions,
      width: pad * 2 + cols * colW,
      height: headerH + pad * 2 + rows * rowH,
    };
  }

  const out = new Map<string, Set<string>>();
  const indeg = new Map<string, number>();
  const preds = new Map<string, string[]>();
  for (const n of childOrder) {
    out.set(n.id, new Set());
    indeg.set(n.id, 0);
    preds.set(n.id, []);
  }

  for (const e of structural) {
    if (e.source === e.target) continue;
    const set = out.get(e.source);
    if (!set || set.has(e.target)) continue;
    set.add(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    preds.get(e.target)?.push(e.source);
  }

  const level = new Map<string, number>();
  const ready = childOrder
    .filter((n) => (indeg.get(n.id) ?? 0) === 0)
    .map((n) => n.id);
  const seen = new Set<string>();

  while (ready.length) {
    ready.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
    const id = ready.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);

    const srcLevel = level.get(id) ?? 0;
    const next = out.get(id);
    if (!next) continue;
    for (const t of next) {
      const prev = level.get(t) ?? 0;
      if (srcLevel + 1 > prev) level.set(t, srcLevel + 1);
      indeg.set(t, (indeg.get(t) ?? 0) - 1);
      if ((indeg.get(t) ?? 0) === 0) ready.push(t);
    }
  }

  // Cycle fallback: keep unresolved nodes in level 0.
  for (const n of childOrder) {
    if (!level.has(n.id)) level.set(n.id, 0);
  }

  const byLevel = new Map<number, string[]>();
  for (const n of childOrder) {
    const lv = level.get(n.id) ?? 0;
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv)!.push(n.id);
  }

  const maxLevel = Math.max(...byLevel.keys());
  const rankInLevel = new Map<string, number>();
  for (let lv = 0; lv <= maxLevel; lv++) {
    const ids = byLevel.get(lv) ?? [];
    ids.sort((a, b) => {
      const pa = preds.get(a) ?? [];
      const pb = preds.get(b) ?? [];
      const ac =
        pa.length === 0
          ? orderIndex.get(a) ?? 0
          : pa.reduce((s, p) => s + (rankInLevel.get(p) ?? 0), 0) / pa.length;
      const bc =
        pb.length === 0
          ? orderIndex.get(b) ?? 0
          : pb.reduce((s, p) => s + (rankInLevel.get(p) ?? 0), 0) / pb.length;
      return ac - bc;
    });
    ids.forEach((id, i) => rankInLevel.set(id, i));
  }

  let maxRows = 1;
  for (let lv = 0; lv <= maxLevel; lv++) {
    const ids = byLevel.get(lv) ?? [];
    maxRows = Math.max(maxRows, ids.length);
  }

  for (let lv = 0; lv <= maxLevel; lv++) {
    const ids = byLevel.get(lv) ?? [];
    const yStart = ((maxRows - ids.length) * rowH) / 2;
    ids.forEach((id, row) => {
      positions.set(id, {
        x: pad + lv * colW,
        y: headerH + pad + yStart + row * rowH,
      });
    });
  }

  return {
    positions: centerPositionsInGroup(
      positions,
      pad,
      headerH,
      pad * 2 + (maxLevel + 1) * colW,
      headerH + pad * 2 + maxRows * rowH,
      nodeW,
      nodeH,
    ),
    width: pad * 2 + (maxLevel + 1) * colW,
    height: headerH + pad * 2 + maxRows * rowH,
  };
}

function centerPositionsInGroup(
  positions: Map<string, Positioned>,
  pad: number,
  headerH: number,
  width: number,
  height: number,
  nodeW: number,
  nodeH: number,
): Map<string, Positioned> {
  if (positions.size === 0) return positions;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + nodeW);
    maxY = Math.max(maxY, p.y + nodeH);
  }

  const contentW = Math.max(0, maxX - minX);
  const contentH = Math.max(0, maxY - minY);

  const innerW = Math.max(0, width - pad * 2);
  const innerH = Math.max(0, height - headerH - pad * 2);

  const targetMinX = pad + Math.max(0, (innerW - contentW) / 2);
  const targetMinY = headerH + pad + Math.max(0, (innerH - contentH) / 2);

  const dx = targetMinX - minX;
  const dy = targetMinY - minY;

  const shifted = new Map<string, Positioned>();
  for (const [id, p] of positions.entries()) {
    shifted.set(id, { x: p.x + dx, y: p.y + dy });
  }
  return shifted;
}

/**
 * Core change:
 * - file nodes are NOT rendered as normal nodes.
 * - we synthesize a fileGroup parent per file path, then place all nodes under it
 *   via parentNode + extent:"parent".
 */
function toReactFlowNodes(
  graph?: GraphPayload,
  searchHitIds?: Set<string>,
  diagnostics?: CodeDiagnostic[],
  highlightedNodeIds?: Set<string>,
  selectedNodeId?: string | null,
  traceActiveNodeId?: string | null,
  runtimeActiveNodeId?: string | null,
  focusPulseRequests?: Array<{
    nodeId: string;
    visibleNodeId: string;
    token: number;
  }>,
  onSelectChildNode?: (nodeId: string, visibleNodeId: string) => void,
  onOpenChildNode?: (nodeId: string) => void,
): Array<Node<CodeNodeData | FileGroupData>> {
  if (!graph) return [];
  const orderedFocusPulseRequests = [...(focusPulseRequests ?? [])].reverse();
  const existingNodeIds = new Set(graph.nodes.map((n) => n.id));

  // Reuse existing file-node ids if analyzer already created them.
  const fileNodeByPath = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (n.kind === "file") fileNodeByPath.set(n.file, n);
  }

  const childItemsByParentId = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (!n.parentId) continue;
    if (!existingNodeIds.has(n.parentId)) continue;
    if (!childItemsByParentId.has(n.parentId)) childItemsByParentId.set(n.parentId, []);
    childItemsByParentId.get(n.parentId)!.push(n);
  }

  const diagnosticSummaryByNode = buildDiagnosticSummaryByNode(graph, diagnostics);

  // Group child (non-file) nodes by their owning file path.
  const byFile = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (n.kind === "file") continue; // file is rendered as a container only
    if (n.parentId && existingNodeIds.has(n.parentId)) continue;
    const key = n.file;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(n);
  }

  // Layout parameters
  const childColW = 340;
  const pad = 18;
  const headerH = 52;

  const groups = [...byFile.entries()].map(([file, children]) => {
    const childRowH = Math.max(
      190,
      ...children.map((n) => {
        const childItems = childItemsByParentId.get(n.id) ?? [];
        return childItems.length > 0 ? 126 + childItems.length * 62 : 190;
      }),
    );
    const layout = layoutChildrenByFlow(children, graph, {
      pad,
      headerH,
      colW: childColW,
      rowH: childRowH,
    });
    return {
      file,
      children,
      childRowH,
      positions: layout.positions,
      width: layout.width,
      height: layout.height,
    };
  });

  // Dynamic shelf layout for file groups to avoid overlaps on varying group sizes.
  const groupGapX = 130;
  const groupGapY = 130;
  const maxRowWidth = 1800;
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;

  const rfNodes: Array<Node<CodeNodeData | FileGroupData>> = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];

    const existingFileNode = fileNodeByPath.get(g.file);
    const parentId = existingFileNode?.id ?? `file:${g.file}`;

    if (cursorX > 0 && cursorX + g.width > maxRowWidth) {
      cursorX = 0;
      cursorY += rowH + groupGapY;
      rowH = 0;
    }
    const gx = cursorX;
    const gy = cursorY;
    cursorX += g.width + groupGapX;
    rowH = Math.max(rowH, g.height);

    // Parent (file container) node
    rfNodes.push({
      id: parentId,
      type: "fileGroup",
      position: { x: gx, y: gy },
      draggable: false,
      selectable: false,
      focusable: false,
      data: {
        title: baseName(g.file),
        subtitle: dirName(g.file),
        kind: "file",
        file: g.file,
        count: g.children.length,
      },
      style: { width: g.width, height: g.height, zIndex: 0 },
    });

    // Child nodes inside the parent
    for (let i = 0; i < g.children.length; i++) {
      const n = g.children[i];
      const childItems = childItemsByParentId.get(n.id) ?? [];

      const sk = getInterfaceSubkind(n);
      const kindLabel = String(n.kind) === "interface" && sk ? sk : n.kind;
      const subtitle = `${kindLabel} · ${shortFile(n.file)}:${n.range.start.line + 1}`;
      const pos = g.positions.get(n.id) ?? {
        x: pad,
        y: headerH + pad + i * g.childRowH,
      };

      const hasSelectedChild = childItems.some((child) => child.id === selectedNodeId);
      const hasTraceActiveChild = childItems.some((child) => child.id === traceActiveNodeId);
      const hasRuntimeActiveChild = childItems.some(
        (child) => child.id === runtimeActiveNodeId,
      );
      const visiblePulseRequest = orderedFocusPulseRequests.find(
        (request) => request.visibleNodeId === n.id,
      );

      const data: CodeNodeData = {
        ...(diagnosticSummaryByNode.get(n.id) ?? {}),
        title: nodeTitle(n),
        subtitle,
        kind: n.kind,
        subkind: sk,
        highlighted: Boolean(highlightedNodeIds?.has(n.id)),
        searchHit: Boolean(searchHitIds?.has(n.id)),
        selected:
          selectedNodeId === n.id ||
          traceActiveNodeId === n.id ||
          runtimeActiveNodeId === n.id ||
          hasSelectedChild ||
          hasTraceActiveChild ||
          hasRuntimeActiveChild,
        focusPulseToken: visiblePulseRequest?.token,
        childItems: childItems.map((child) => {
          const childPulseRequest = orderedFocusPulseRequests.find(
            (request) => request.nodeId === child.id,
          );
          return {
          id: child.id,
          kind: childKindLabel(child),
          title: childTitle(n, child),
          selected:
            selectedNodeId === child.id ||
            traceActiveNodeId === child.id ||
            runtimeActiveNodeId === child.id,
          focusPulseToken: childPulseRequest?.token,
          subtitle: `${childKindLabel(child)} · ${shortFile(child.file)}:${child.range.start.line + 1}`,
          ...(diagnosticSummaryByNode.get(child.id) ?? {}),
          onClick:
            onSelectChildNode ? () => onSelectChildNode(child.id, n.id) : undefined,
          onDoubleClick:
            onOpenChildNode ? () => onOpenChildNode(child.id) : undefined,
          };
        }),
        file: n.file,
      };
      const nodeHeight = childItems.length > 0 ? 94 + childItems.length * 62 : undefined;

      rfNodes.push({
        id: n.id,
        position: pos,
        type: "code",
        data,
        parentNode: parentId,
        extent: "parent",
        style: {
          zIndex: 2,
          width: childItems.length > 0 ? 272 : undefined,
          height: nodeHeight,
        },
      });
    }
  }

  return rfNodes;
}

export function CanvasPane({
  hasData,
  graph,
  activeFilter,
  searchQuery,
  rootNodeId,
  onClearRoot,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
  onOpenNode,
  onGenerateFromActive,
  onUseSelectionAsRoot,
  onExpandExternal,
  analysisDiagnostics,
  highlightedNodeIds,
  highlightedEdgeId,
  traceActiveNodeId,
  runtimeActiveNodeId,
  runtimeFocusRequest,
  inspectorFocusRequest,
  notice,
  traceVisible,
  traceCursor,
  traceTotal,
  traceFocusEvent,
  onTracePrev,
  onTraceNext,
  onTraceFinish,
  autoLayoutTick,
  onOpenScaffoldModal,
}: Props) {
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const canvasFlowRef = useRef<HTMLDivElement | null>(null);
  const lastVisibleHasDataRef = useRef<boolean | null>(null);
  const lastRecoveryAtRef = useRef(0);
  const snapshotTimersRef = useRef<number[]>([]);
  const [recoveryTick, setRecoveryTick] = useState(0);
  const [canvasFocusRequest, setCanvasFocusRequest] = useState<{
    visibleNodeId: string;
    token: number;
  } | null>(null);
  const [focusPulseRequest, setFocusPulseRequest] = useState<{
    nodeId: string;
    visibleNodeId: string;
    token: number;
  } | null>(null);
  const filteredGraph = useMemo(
    () => filterGraph(graph, activeFilter),
    [graph, activeFilter],
  );
  const searchHitIds = useMemo(
    () => getSearchHitIds(filteredGraph, searchQuery),
    [filteredGraph, searchQuery],
  );
  const visibleHighlightedNodeIds = useMemo(() => {
    if (!graph || !highlightedNodeIds?.length) return new Set<string>();
    const existingNodeIds = new Set(graph.nodes.map((node) => node.id));
    const parentIdByNodeId = new Map(
      graph.nodes
        .filter((node) => node.parentId && existingNodeIds.has(node.parentId))
        .map((node) => [node.id, node.parentId as string]),
    );
    return new Set(
      highlightedNodeIds.map((nodeId) => parentIdByNodeId.get(nodeId) ?? nodeId),
    );
  }, [graph, highlightedNodeIds]);
  const visibleInspectorFocusNodeId = useMemo(() => {
    if (!graph || !inspectorFocusRequest?.nodeId) return null;
    const target = graph.nodes.find((node) => node.id === inspectorFocusRequest.nodeId);
    if (!target) return null;
    const hasParent = Boolean(target.parentId && graph.nodes.some((node) => node.id === target.parentId));
    return hasParent ? (target.parentId as string) : target.id;
  }, [graph, inspectorFocusRequest]);
  const visibleSelectedNodeId = useMemo(() => {
    if (!graph || !selectedNodeId) return selectedNodeId;
    const target = graph.nodes.find((node) => node.id === selectedNodeId);
    if (!target) return selectedNodeId;
    const hasParent = Boolean(target.parentId && graph.nodes.some((node) => node.id === target.parentId));
    return hasParent ? (target.parentId as string) : target.id;
  }, [graph, selectedNodeId]);
  const visibleTraceActiveNodeId = useMemo(() => {
    if (!graph || !traceActiveNodeId) return traceActiveNodeId;
    const target = graph.nodes.find((node) => node.id === traceActiveNodeId);
    if (!target) return traceActiveNodeId;
    const hasParent = Boolean(target.parentId && graph.nodes.some((node) => node.id === target.parentId));
    return hasParent ? (target.parentId as string) : target.id;
  }, [graph, traceActiveNodeId]);
  const visibleRuntimeActiveNodeId = useMemo(() => {
    if (!graph || !runtimeActiveNodeId) return runtimeActiveNodeId;
    const target = graph.nodes.find((node) => node.id === runtimeActiveNodeId);
    if (!target) return runtimeActiveNodeId;
    const hasParent = Boolean(target.parentId && graph.nodes.some((node) => node.id === target.parentId));
    return hasParent ? (target.parentId as string) : target.id;
  }, [graph, runtimeActiveNodeId]);
  const inspectorPulseRequest = useMemo(() => {
    if (!inspectorFocusRequest || !visibleInspectorFocusNodeId) return null;
    return {
      nodeId: inspectorFocusRequest.nodeId,
      visibleNodeId: visibleInspectorFocusNodeId,
      token: inspectorFocusRequest.token,
    };
  }, [inspectorFocusRequest, visibleInspectorFocusNodeId]);
  const tracePulseRequest = useMemo(() => {
    if (!traceVisible || traceCursor <= 0 || !traceActiveNodeId || !visibleTraceActiveNodeId) {
      return null;
    }
    return {
      nodeId: traceActiveNodeId,
      visibleNodeId: visibleTraceActiveNodeId,
      token: traceCursor,
    };
  }, [traceActiveNodeId, traceCursor, traceVisible, visibleTraceActiveNodeId]);
  const runtimePulseRequest = useMemo(() => {
    if (!runtimeFocusRequest || !visibleRuntimeActiveNodeId) return null;
    return {
      nodeId: runtimeFocusRequest.nodeId,
      visibleNodeId: visibleRuntimeActiveNodeId,
      token: runtimeFocusRequest.token,
    };
  }, [runtimeFocusRequest, visibleRuntimeActiveNodeId]);
  const focusPulseRequests = useMemo(
    () =>
      [
        focusPulseRequest,
        inspectorPulseRequest,
        tracePulseRequest,
        runtimePulseRequest,
      ].filter(
        (
          request,
        ): request is {
          nodeId: string;
          visibleNodeId: string;
          token: number;
        } => Boolean(request),
      ),
    [focusPulseRequest, inspectorPulseRequest, runtimePulseRequest, tracePulseRequest],
  );

  const nodes = useMemo<Array<Node<CodeNodeData | FileGroupData>>>(
    () =>
      toReactFlowNodes(
        filteredGraph,
        searchHitIds,
        analysisDiagnostics,
        visibleHighlightedNodeIds,
        selectedNodeId,
        traceActiveNodeId,
        runtimeActiveNodeId,
        focusPulseRequests,
        (nodeId, visibleNodeId) => {
          const target = graph?.nodes.find((node) => node.id === nodeId);
          pushWebviewDebugEvent("canvas.embedded-node.click", {
            nodeId,
            visibleNodeId,
            nodeKind: target?.kind ?? null,
            filePath: target?.file ?? null,
            isExternal: target?.kind === "external",
            ...getGraphCounts(graph),
          });
          setFocusPulseRequest((current) => ({
            nodeId,
            visibleNodeId,
            token: (current?.token ?? 0) + 1,
          }));
          onSelectNode(nodeId);
          setCanvasFocusRequest((current) => ({
            visibleNodeId,
            token: (current?.token ?? 0) + 1,
          }));
        },
        (nodeId) => {
          const target = graph?.nodes.find((node) => node.id === nodeId);
          pushWebviewDebugEvent("canvas.embedded-node.doubleClick", {
            nodeId,
            nodeKind: target?.kind ?? null,
            filePath: target?.file ?? null,
          });
          if (!target) return;
          onOpenNode?.(target);
          if (target.kind === "external") {
            onExpandExternal?.(target.file);
          }
        },
      ),
    [
      analysisDiagnostics,
      filteredGraph,
      graph,
      onExpandExternal,
      onOpenNode,
      onSelectNode,
      selectedNodeId,
      traceActiveNodeId,
      runtimeActiveNodeId,
      searchHitIds,
      focusPulseRequests,
      visibleHighlightedNodeIds,
    ],
  );
  const nodeTopologyKey = useMemo(
    () =>
      nodes
        .map((node) => `${node.id}:${node.parentNode ?? ""}`)
        .sort()
        .join("|"),
    [nodes],
  );

  const edges = useMemo<Array<Edge<DataflowEdgeData>>>(
    () => toReactFlowEdges(filteredGraph, selectedNodeId, highlightedEdgeId),
    [filteredGraph, highlightedEdgeId, selectedNodeId],
  );
  const edgeTopologyKey = useMemo(
    () =>
      edges
        .map((edge) => `${edge.id}:${edge.source}->${edge.target}`)
        .sort()
        .join("|"),
    [edges],
  );
  const visibleHasData = nodes.length > 0;

  const clearSnapshotTimers = useCallback(() => {
    for (const timerId of snapshotTimersRef.current) {
      window.clearTimeout(timerId);
    }
    snapshotTimersRef.current = [];
  }, []);

  const requestCanvasRecovery = useCallback((reason: string, detail: Record<string, unknown>) => {
    const now = Date.now();
    if (now - lastRecoveryAtRef.current < 1500) {
      pushWebviewDebugEvent("canvas.recovery.skipped.cooldown", {
        reason,
        recoveryTick,
      });
      return;
    }

    lastRecoveryAtRef.current = now;
    pushWebviewDebugEvent("canvas.recovery.requested", {
      reason,
      recoveryTick,
      ...detail,
    });
    setRecoveryTick((tick) => tick + 1);
  }, [recoveryTick]);

  const collectCanvasSnapshot = useCallback((reason: string, extra?: Record<string, unknown>) => {
    const container = canvasFlowRef.current;
    const reactFlowRoot = container?.querySelector(".react-flow") as HTMLElement | null;
    const viewportEl = container?.querySelector(".react-flow__viewport") as HTMLElement | null;
    const domNodes = container?.querySelectorAll(".react-flow__node").length ?? 0;
    const domEdges = container?.querySelectorAll(".react-flow__edge").length ?? 0;
    const rect = reactFlowRoot?.getBoundingClientRect();
    const viewport = (
      rfRef.current as unknown as {
        getViewport?: () => { x: number; y: number; zoom: number };
      } | null
    )?.getViewport?.();
    const detail = {
      reason,
      hasData,
      visibleHasData,
      renderedNodes: nodes.length,
      renderedEdges: edges.length,
      domNodes,
      domEdges,
      rootWidth: rect ? Math.round(rect.width) : null,
      rootHeight: rect ? Math.round(rect.height) : null,
      viewportTransform: viewportEl?.style.transform ?? null,
      viewportX: viewport?.x ?? null,
      viewportY: viewport?.y ?? null,
      viewportZoom: viewport?.zoom ?? null,
      selectedNodeId,
      rootNodeId,
      ...getGraphCounts(graph),
      ...(extra ?? {}),
    };

    pushWebviewDebugEvent("canvas.dom.snapshot", detail);

    const hasDomAnomaly =
      hasData &&
      (domNodes === 0 ||
        !rect ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        viewport?.zoom === 0);
    if (hasDomAnomaly) {
      dumpWebviewDebugBuffer("canvas.dom.anomaly", detail, 35);
      requestCanvasRecovery(reason, detail);
    }
  }, [
    edges.length,
    graph,
    hasData,
    nodes.length,
    requestCanvasRecovery,
    rootNodeId,
    selectedNodeId,
    visibleHasData,
  ]);

  const scheduleCanvasSnapshots = useCallback((reason: string, extra?: Record<string, unknown>) => {
    clearSnapshotTimers();
    for (const delay of [0, 80, 240, 500]) {
      const timerId = window.setTimeout(() => {
        collectCanvasSnapshot(`${reason}@${delay}ms`, extra);
      }, delay);
      snapshotTimersRef.current.push(timerId);
    }
  }, [clearSnapshotTimers, collectCanvasSnapshot]);

  const handleNodeClick = (
    _event: ReactMouseEvent,
    node: Node<CodeNodeData | FileGroupData>,
  ) => {
    const graphNode = graph?.nodes.find((n) => n.id === node.id);
    pushWebviewDebugEvent("canvas.node.click", {
      nodeId: node.id,
      visibleNodeId: node.id,
      visibleKind: node.data.kind,
      graphNodeKind: graphNode?.kind ?? null,
      filePath: "file" in node.data ? node.data.file : null,
      isExternal: node.data.kind === "external",
      renderedNodes: nodes.length,
      renderedEdges: edges.length,
      ...getGraphCounts(graph),
    });
    scheduleCanvasSnapshots("node-click", {
      nodeId: node.id,
      visibleKind: node.data.kind,
    });
    setFocusPulseRequest((current) => ({
      nodeId: node.id,
      visibleNodeId: node.id,
      token: (current?.token ?? 0) + 1,
    }));
    onSelectNode(node.id);
    setCanvasFocusRequest((current) => ({
      visibleNodeId: node.id,
      token: (current?.token ?? 0) + 1,
    }));

    if (node.data?.kind === "file") return;
  };

  const handleNodeDoubleClick = (
    _event: ReactMouseEvent,
    node: Node<CodeNodeData | FileGroupData>,
  ) => {
    const graphNode = graph?.nodes.find((n) => n.id === node.id);
    pushWebviewDebugEvent("canvas.node.doubleClick", {
      nodeId: node.id,
      visibleKind: node.data.kind,
      graphNodeKind: graphNode?.kind ?? null,
      filePath: graphNode?.file ?? ("file" in node.data ? node.data.file : null),
    });
    if (node.data.kind === "file" || !graphNode) return;
    onOpenNode?.(graphNode);
    if (graphNode.kind === "external") {
      onExpandExternal?.(graphNode.file);
    }
  };

  const handleCanvasContextMenu = (event: ReactDomMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, select, a")) {
      return;
    }

    event.preventDefault();
    pushWebviewDebugEvent("canvas.contextMenu.openScaffold", {
      selectedNodeId,
      hasData,
      visibleHasData,
      clientX: event.clientX,
      clientY: event.clientY,
      ...getGraphCounts(graph),
    });
    onOpenScaffoldModal?.({
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  const handleNodeContextMenu = (
    event: ReactMouseEvent,
    node: Node<CodeNodeData | FileGroupData>,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const graphNode = graph?.nodes.find((candidate) => candidate.id === node.id) ?? null;
    pushWebviewDebugEvent("canvas.node.contextMenu.openScaffold", {
      nodeId: node.id,
      visibleKind: node.data.kind,
      graphNodeKind: graphNode?.kind ?? null,
      filePath: graphNode?.file ?? ("file" in node.data ? node.data.file : null),
      selectedNodeId,
      hasData,
      visibleHasData,
      clientX: event.clientX,
      clientY: event.clientY,
      ...getGraphCounts(graph),
    });
    onSelectNode(node.id);
    onOpenScaffoldModal?.({
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  const onZoomIn = () => rfRef.current?.zoomIn?.();
  const onZoomOut = () => rfRef.current?.zoomOut?.();
  const onFocusSelection = () => {
    const inst = rfRef.current;
    if (!inst || !visibleSelectedNodeId) return;

    const node = inst.getNode(visibleSelectedNodeId);
    if (!node) return;
    focusCanvasNode(inst, node, 1.2, 320);
  };

  useEffect(() => {
    pushWebviewDebugEvent("canvas.reactflow.topology-changed", {
      visibleHasData,
      renderedNodes: nodes.length,
      renderedEdges: edges.length,
      recoveryTick,
      nodeTopologyKey: shortenTopologyKey(nodeTopologyKey),
      edgeTopologyKey: shortenTopologyKey(edgeTopologyKey),
    });
    scheduleCanvasSnapshots("topology-changed");
  }, [
    edgeTopologyKey,
    nodeTopologyKey,
    visibleHasData,
    nodes.length,
    edges.length,
    recoveryTick,
    scheduleCanvasSnapshots,
  ]);

  useEffect(() => {
    return () => {
      clearSnapshotTimers();
    };
  }, [clearSnapshotTimers]);

  useEffect(() => {
    if (!ENABLE_AUTO_VIEWPORT_EFFECTS) return;
    if (!visibleHasData) return;

    const rafId = window.requestAnimationFrame(() => {
      fitGraphView(rfRef.current, 280);
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [nodeTopologyKey, visibleHasData]);

  useEffect(() => {
    if (lastVisibleHasDataRef.current === visibleHasData) return;
    lastVisibleHasDataRef.current = visibleHasData;

    const detail = {
      visibleHasData,
      hasData,
      renderedNodes: nodes.length,
      renderedEdges: edges.length,
      filteredNodes: filteredGraph?.nodes.length ?? 0,
      filteredEdges: filteredGraph?.edges.length ?? 0,
      selectedNodeId,
      rootNodeId,
      highlightedEdgeId,
      nodeTopologyKey: shortenTopologyKey(nodeTopologyKey),
      edgeTopologyKey: shortenTopologyKey(edgeTopologyKey),
      ...getGraphCounts(graph),
    };

    pushWebviewDebugEvent("canvas.visibleHasData.changed", detail);
    if (!visibleHasData && hasData) {
      dumpWebviewDebugBuffer("canvas.visibleHasData.false", detail, 35);
    }
  }, [
    edgeTopologyKey,
    filteredGraph,
    graph,
    hasData,
    highlightedEdgeId,
    nodeTopologyKey,
    nodes.length,
    edges.length,
    rootNodeId,
    selectedNodeId,
    visibleHasData,
  ]);

  useEffect(() => {
    if (!ENABLE_AUTO_VIEWPORT_EFFECTS) return;
    // Auto layout keeps its own role, but finishes by reframing the full graph.
    fitGraphView(rfRef.current, 500);
  }, [autoLayoutTick]);

  useEffect(() => {
    if (!ENABLE_AUTO_VIEWPORT_EFFECTS) return;
    const inst = rfRef.current;
    if (!inst || !traceVisible || !traceFocusEvent || traceCursor <= 0) return;

    if (traceFocusEvent.type === "node") {
      if (!visibleTraceActiveNodeId) return;
      const rfNode = inst.getNode(visibleTraceActiveNodeId);
      if (!rfNode) return;
      focusCanvasNode(inst, rfNode, 1.15, 350);
      return;
    }

    const sourceNodeId =
      graph?.nodes.find((node) => node.id === traceFocusEvent.edge.source)?.parentId ??
      traceFocusEvent.edge.source;
    const targetNodeId =
      graph?.nodes.find((node) => node.id === traceFocusEvent.edge.target)?.parentId ??
      traceFocusEvent.edge.target;
    const sourceNode = inst.getNode(sourceNodeId);
    const targetNode = inst.getNode(targetNodeId);
    if (!sourceNode || !targetNode) return;

    focusCanvasNodePair(inst, sourceNode, targetNode, 0.9, 350);
  }, [graph, nodes, traceCursor, traceFocusEvent, traceVisible, visibleTraceActiveNodeId]);

  useEffect(() => {
    if (!ENABLE_AUTO_VIEWPORT_EFFECTS) return;
    const inst = rfRef.current;
    if (!inst || !highlightedEdgeId || visibleHighlightedNodeIds.size === 0) return;

    const [firstId, secondId] = [...visibleHighlightedNodeIds];
    const firstNode = firstId ? inst.getNode(firstId) : null;
    const secondNode = secondId ? inst.getNode(secondId) : null;
    if (!firstNode && !secondNode) return;

    if (firstNode && secondNode) {
      focusCanvasNodePair(inst, firstNode, secondNode, 1.05, 320);
      return;
    }

    const node = firstNode ?? secondNode;
    if (!node) return;
    focusCanvasNode(inst, node, 1.15, 320);
  }, [highlightedEdgeId, visibleHighlightedNodeIds]);

  useEffect(() => {
    if (!ENABLE_AUTO_VIEWPORT_EFFECTS) return;
    const inst = rfRef.current;
    if (!inst || !visibleInspectorFocusNodeId || !inspectorFocusRequest) return;

    const node = inst.getNode(visibleInspectorFocusNodeId);
    if (!node) return;
    focusCanvasNode(inst, node, 1.18, 320);
  }, [inspectorFocusRequest, visibleInspectorFocusNodeId]);

  useEffect(() => {
    if (!ENABLE_AUTO_VIEWPORT_EFFECTS) return;
    const inst = rfRef.current;
    if (!inst || !visibleRuntimeActiveNodeId || !runtimeFocusRequest) return;

    const node = inst.getNode(visibleRuntimeActiveNodeId);
    if (!node) return;
    focusCanvasNode(inst, node, 1.2, 320);
  }, [runtimeFocusRequest, visibleRuntimeActiveNodeId]);

  useEffect(() => {
    const inst = rfRef.current;
    if (!inst || !canvasFocusRequest) return;

    const node = inst.getNode(canvasFocusRequest.visibleNodeId);
    if (!node) return;
    focusCanvasNode(inst, node, 1.2, 260);
  }, [canvasFocusRequest]);

  const isTraceAtEnd = traceCursor >= traceTotal;
  const renderEmptyState = (mode: "no-graph" | "no-visible") => (
    <div className={["emptyState", mode === "no-visible" ? "emptyState--overlay" : ""].join(" ")}>
      {notice && mode === "no-graph" ? (
        <div
          className={[
            "canvasNotice",
            "canvasNotice--inline",
            `canvasNotice--${notice.severity}`,
          ].join(" ")}
        >
          <div className="canvasNoticeTitle">{notice.message}</div>
          {notice.detail ? (
            <div className="canvasNoticeDetail">{notice.detail}</div>
          ) : null}
        </div>
      ) : null}
      <div className="emptyIcon">
        <Sigma size={20} />
      </div>
      <div className="emptyTitle">
        {mode === "no-visible" ? "No visible nodes" : "No graph yet"}
      </div>
      <div className="emptySub">
        {mode === "no-visible"
          ? "Graph data exists, but the current render pass found no visible nodes."
          : "Open a TypeScript/JavaScript file, then click Generate."}
      </div>
      <div className="emptyActions">
        <button className="btnPrimary" onClick={onGenerateFromActive}>
          Generate from active file
        </button>
      </div>
      {traceVisible ? (
        <div style={{ marginTop: 8 }}>{renderTraceControls()}</div>
      ) : null}
    </div>
  );
  const renderTraceControls = () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 12,
        border: "1px solid rgba(56,189,248,0.35)",
        background: "rgba(8,18,38,0.82)",
      }}
    >
      <button
        className="btnGhost"
        onClick={onTracePrev}
        disabled={traceCursor <= 0}
        style={{ padding: "6px 10px", opacity: traceCursor <= 0 ? 0.45 : 1 }}
      >
        {"<-"}
      </button>
      <div className="mono" style={{ fontSize: 12, minWidth: 90, textAlign: "center" }}>
        {traceCursor} / {traceTotal}
      </div>
      {isTraceAtEnd ? (
        <button
          className="btnGhost"
          onClick={onTraceFinish}
          style={{ padding: "6px 10px" }}
        >
          끝
        </button>
      ) : (
        <button
          className="btnGhost"
          onClick={onTraceNext}
          disabled={traceCursor >= traceTotal}
          style={{
            padding: "6px 10px",
            opacity: traceCursor >= traceTotal ? 0.45 : 1,
          }}
        >
          {"->"}
        </button>
      )}
    </div>
  );

  return (
    <section className="canvas" onContextMenu={handleCanvasContextMenu}>
      {!hasData ? (
        renderEmptyState("no-graph")
      ) : (
        <div className="canvasFlow" ref={canvasFlowRef}>
          <ReactFlowProvider key={`provider:recovery:${recoveryTick}`}>
            <ReactFlow
              key={`flow:recovery:${recoveryTick}`}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable={false}
              panOnDrag
              selectionOnDrag={false}
              zoomOnDoubleClick={false}
              onNodeClick={handleNodeClick}
              onNodeDoubleClick={handleNodeDoubleClick}
              onNodeContextMenu={handleNodeContextMenu}
              onPaneClick={onClearSelection}
              fitView
              minZoom={0.1}
              maxZoom={2.2}
              proOptions={{ hideAttribution: true }}
              onInit={(inst) => {
                rfRef.current = inst;
                pushWebviewDebugEvent("canvas.reactflow.init", {
                  renderedNodes: nodes.length,
                  renderedEdges: edges.length,
                  visibleHasData,
                  recoveryTick,
                  autoViewportEffects: ENABLE_AUTO_VIEWPORT_EFFECTS,
                });
                scheduleCanvasSnapshots("reactflow-init");
                if (ENABLE_AUTO_VIEWPORT_EFFECTS) {
                  // Initial mount frames the whole graph, same role as Fit Graph.
                  fitGraphView(inst, 250);
                }
              }}
            >
              <Background gap={24} size={1} />

              <div className="canvasControls">
                <button className="iconBtn" onClick={onZoomIn} title="Zoom in">
                  <ZoomIn size={16} />
                </button>
                <button
                  className="iconBtn"
                  onClick={onZoomOut}
                  title="Zoom out"
                >
                  <ZoomOut size={16} />
                </button>
                <button
                  className="iconBtn"
                  onClick={onFocusSelection}
                  title={
                    selectedNodeId ? "Focus Selection" : "Focus Selection (select a node first)"
                  }
                  disabled={!selectedNodeId}
                >
                  <Crosshair size={16} />
                </button>
                <button
                  className="iconBtn"
                  onClick={() => fitGraphView(rfRef.current, 400)}
                  title="Fit Graph"
                >
                  <Network size={16} />
                </button>
              </div>

              {/* Root bar (kept; currently not applied to layout in this file) */}
              {rootNodeId ? (
                <div className="rootBanner">
                  <div className="rootText">
                    Root mode: <b>{rootNodeId}</b>
                  </div>
                  <button className="btnGhost" onClick={onClearRoot}>
                    Clear root
                  </button>
                </div>
              ) : null}

              {notice ? (
                <div
                  className={[
                    "canvasNotice",
                    `canvasNotice--${notice.severity}`,
                  ].join(" ")}
                >
                  <div className="canvasNoticeTitle">{notice.message}</div>
                  {notice.detail ? (
                    <div className="canvasNoticeDetail">{notice.detail}</div>
                  ) : null}
                </div>
              ) : null}

              {/* Filter/search props are currently handled upstream or will be applied later */}
              <div style={{ display: "none" }}>
                {activeFilter} {searchQuery}
              </div>

              {/* Selection actions */}
              {selectedNodeId ? (
                <div className="selectionBanner">
                  <button className="btnGhost" onClick={onUseSelectionAsRoot}>
                    Use selection as root
                  </button>
                </div>
              ) : null}

              {traceVisible ? (
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: 14,
                    transform: "translateX(-50%)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 12,
                    border: "1px solid rgba(56,189,248,0.35)",
                    background: "rgba(8,18,38,0.82)",
                    zIndex: 7,
                  }}
                >
                  {renderTraceControls()}
                </div>
              ) : null}

              <div
                style={{
                  position: "absolute",
                  right: 12,
                  bottom: 12,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(10,14,28,0.68)",
                  fontSize: 11,
                  lineHeight: 1.3,
                  pointerEvents: "none",
                }}
              >
                <span style={{ color: "#60a5fa" }}>dashed blue</span> = parameter flow
              </div>
            </ReactFlow>
          </ReactFlowProvider>
          {!visibleHasData ? renderEmptyState("no-visible") : null}
        </div>
      )}
    </section>
  );
}

type Props = {
  hasData: boolean;
  graph?: GraphPayload;

  activeFilter: ChipKey;
  searchQuery: string;
  rootNodeId: string | null;
  onClearRoot: () => void;

  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;

  onOpenNode?: (node: GraphNode) => void;

  onGenerateFromActive: () => void;
  onUseSelectionAsRoot: () => void;

  onExpandExternal?: (filePath: string) => void;
  analysisDiagnostics?: CodeDiagnostic[];
  highlightedNodeIds?: string[];
  highlightedEdgeId?: string | null;
  traceActiveNodeId?: string | null;
  runtimeActiveNodeId?: string | null;
  runtimeFocusRequest?: { nodeId: string; token: number } | null;
  inspectorFocusRequest?: { nodeId: string; token: number } | null;
  notice?: UINotice | null;
  traceVisible: boolean;
  traceCursor: number;
  traceTotal: number;
  traceFocusEvent: GraphTraceEvent | null;
  onTracePrev: () => void;
  onTraceNext: () => void;
  onTraceFinish: () => void;
  autoLayoutTick: number;
  onOpenScaffoldModal?: (args: {
    clientX: number;
    clientY: number;
  }) => void;
};
