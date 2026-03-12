// import "./../App.css";
import "reactflow/dist/style.css";
import "./CanvasPane.css";
import {
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
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
import type { GraphNode, GraphPayload, GraphTraceEvent } from "../lib/vscode";
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
  /** Absolute/relative file path used to expand external nodes. */
  file: string;
};

type FileGroupData = {
  title: string;
  subtitle: string;
  kind: "file";
  file: string;
  count: number;
};

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

function nodeTitle(n: GraphNode) {
  if (n.kind === "class") return `class ${n.name}`;
  if (n.kind === "function") return `${n.name}()`;
  if (n.kind === "method") return `${n.name}()`;
  return n.name;
}

function CodeNode({
  data,
  selected,
}: {
  data: CodeNodeData;
  selected?: boolean;
}) {
  const badge =
    data.kind === "interface"
      ? data.subkind
      : data.kind === "external"
        ? "external"
        : undefined;

  return (
    <div
      className={[
        "cgNode",
        selected || data.searchHit ? "cgNode--selected" : "",
      ].join(" ")}
    >
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
        {badge ? <div className="cgBadge">{badge.toUpperCase()}</div> : null}
      </div>
      <div className="cgNodeSub">{data.subtitle}</div>
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
): Array<Edge<DataflowEdgeData>> {
  if (!graph) return [];

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const visibleEdges = graph.edges.filter((e) => {
    const src = nodeById.get(e.source);
    const tgt = nodeById.get(e.target);
    if (!src || !tgt) return true;

    // File container edges are noisy and often visually occluded by the group frame.
    // Keep file node as a visual header only.
    if (src.kind === "file" || tgt.kind === "file") return false;
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
        (e.source === selectedNodeId || e.target === selectedNodeId),
    );
    const muted = Boolean(selectedNodeId && !isSelectedFlow && isDataflow);
    const showDataflowLabel = Boolean(selectedNodeId && isSelectedFlow);

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
      sourceHandle: isDataflow ? "out-dataflow" : "out-control",
      targetHandle: isDataflow ? "in-dataflow" : "in-control",
      markerEnd: isDataflow
        ? {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            color: isSelectedFlow ? "#38bdf8" : "#60a5fa",
          }
        : { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      style: isDataflow
        ? {
            stroke: isSelectedFlow ? "#38bdf8" : "#60a5fa",
            strokeWidth: isSelectedFlow ? 2.8 : 1.8,
            strokeDasharray: "8 6",
            opacity: muted ? 0.2 : 0.92,
          }
        : undefined,
      animated: isDataflow && !muted,
      data: isDataflow
        ? {
            label: showDataflowLabel ? label : undefined,
            highlighted: isSelectedFlow,
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

  const nodes = graph.nodes.filter((n) => {
    if (!matchesChipFilter(n, chip)) return false;
    return true;
  });

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
  for (const n of graph.nodes) {
    const fileText = `${n.file} ${shortFile(n.file)}`.toLowerCase();
    if (fileText.includes(q)) matchedFiles.add(n.file);
  }

  for (const n of graph.nodes) {
    if (n.kind === "file") continue;
    const text = `${n.name} ${n.kind} ${n.file} ${n.signature ?? ""}`.toLowerCase();
    if (text.includes(q) || matchedFiles.has(n.file)) ids.add(n.id);
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
): Array<Node<CodeNodeData | FileGroupData>> {
  if (!graph) return [];

  // Reuse existing file-node ids if analyzer already created them.
  const fileNodeByPath = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (n.kind === "file") fileNodeByPath.set(n.file, n);
  }

  // Group child (non-file) nodes by their owning file path.
  const byFile = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (n.kind === "file") continue; // file is rendered as a container only
    const key = n.file;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(n);
  }

  // Layout parameters
  const childColW = 340;
  const childRowH = 190;
  const pad = 18;
  const headerH = 52;

  const groups = [...byFile.entries()].map(([file, children]) => {
    const layout = layoutChildrenByFlow(children, graph, {
      pad,
      headerH,
      colW: childColW,
      rowH: childRowH,
    });
    return {
      file,
      children,
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

      const sk = getInterfaceSubkind(n);
      const kindLabel = String(n.kind) === "interface" && sk ? sk : n.kind;
      const subtitle = `${kindLabel} · ${shortFile(n.file)}:${n.range.start.line + 1}`;
      const pos = g.positions.get(n.id) ?? {
        x: pad,
        y: headerH + pad + i * childRowH,
      };

      const data: CodeNodeData = {
        title: nodeTitle(n),
        subtitle,
        kind: n.kind,
        subkind: sk,
        searchHit: Boolean(searchHitIds?.has(n.id)),
        file: n.file,
      };

      rfNodes.push({
        id: n.id,
        position: pos,
        type: "code",
        data,
        parentNode: parentId,
        extent: "parent",
        style: { zIndex: 2 },
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
  traceVisible,
  traceCursor,
  traceTotal,
  traceFocusEvent,
  onTracePrev,
  onTraceNext,
  onTraceFinish,
  autoLayoutTick,
  fitViewTick,
}: Props) {
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const filteredGraph = useMemo(
    () => filterGraph(graph, activeFilter),
    [graph, activeFilter],
  );
  const searchHitIds = useMemo(
    () => getSearchHitIds(filteredGraph, searchQuery),
    [filteredGraph, searchQuery],
  );

  const nodes = useMemo<Array<Node<CodeNodeData | FileGroupData>>>(
    () => toReactFlowNodes(filteredGraph, searchHitIds),
    [filteredGraph, searchHitIds],
  );

  const edges = useMemo<Array<Edge<DataflowEdgeData>>>(
    () => toReactFlowEdges(filteredGraph, selectedNodeId),
    [filteredGraph, selectedNodeId],
  );

  const visibleHasData = nodes.length > 0;

  const handleNodeClick = (
    _event: ReactMouseEvent,
    node: Node<CodeNodeData | FileGroupData>,
  ) => {
    onSelectNode(node.id);

    // File containers do not map to a code location.
    if (node.data?.kind === "file") return;

    // Open source location for the clicked graph node (if available)
    const gnode = graph?.nodes.find((n) => n.id === node.id);
    if (gnode) onOpenNode?.(gnode);

    if (node.data.kind === "external") {
      onExpandExternal?.(node.data.file);
    }
  };

  const onZoomIn = () => rfRef.current?.zoomIn?.();
  const onZoomOut = () => rfRef.current?.zoomOut?.();
  const onCenter = () => {
    const inst = rfRef.current;
    if (!inst) return;

    if (selectedNodeId) {
      const n = inst.getNode(selectedNodeId);
      if (n) {
        inst.setCenter(n.position.x, n.position.y, { zoom: 1.2 });
        return;
      }
    }
    inst.fitView({ padding: 0.12, duration: 400 });
  };

  useEffect(() => {
    const inst = rfRef.current;
    if (!inst) return;
    inst.fitView({ padding: 0.12, duration: 350 });
  }, [fitViewTick]);

  useEffect(() => {
    const inst = rfRef.current;
    if (!inst) return;
    // Current layout is deterministic; auto-layout trigger re-runs framing.
    inst.fitView({ padding: 0.12, duration: 500 });
  }, [autoLayoutTick]);

  useEffect(() => {
    const inst = rfRef.current;
    if (!inst || !traceVisible || !traceFocusEvent || traceCursor <= 0) return;

    if (traceFocusEvent.type === "node") {
      const rfNode = inst.getNode(traceFocusEvent.node.id);
      if (!rfNode) return;

      const width = rfNode.width ?? 210;
      const height = rfNode.height ?? 72;
      inst.setCenter(rfNode.position.x + width / 2, rfNode.position.y + height / 2, {
        zoom: 1.15,
        duration: 350,
      });
      return;
    }

    const sourceNode = inst.getNode(traceFocusEvent.edge.source);
    const targetNode = inst.getNode(traceFocusEvent.edge.target);
    if (!sourceNode || !targetNode) return;

    const sourceWidth = sourceNode.width ?? 210;
    const sourceHeight = sourceNode.height ?? 72;
    const targetWidth = targetNode.width ?? 210;
    const targetHeight = targetNode.height ?? 72;

    const centerX =
      (sourceNode.position.x +
        sourceWidth / 2 +
        targetNode.position.x +
        targetWidth / 2) /
      2;
    const centerY =
      (sourceNode.position.y +
        sourceHeight / 2 +
        targetNode.position.y +
        targetHeight / 2) /
      2;

    inst.setCenter(centerX, centerY, { zoom: 0.9, duration: 350 });
  }, [nodes, traceCursor, traceFocusEvent, traceVisible]);

  const isTraceAtEnd = traceCursor >= traceTotal;
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
    <section className="canvas">
      {!hasData || !visibleHasData ? (
        <div className="emptyState">
          <div className="emptyIcon">
            <Sigma size={20} />
          </div>
          <div className="emptyTitle">
            {hasData ? "No visible nodes" : "No graph yet"}
          </div>
          <div className="emptySub">
            {hasData
              ? "Try a different filter."
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
      ) : (
        <div className="canvasFlow">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={handleNodeClick}
              onPaneClick={onClearSelection}
              fitView
              minZoom={0.1}
              maxZoom={2.2}
              proOptions={{ hideAttribution: true }}
              onInit={(inst) => {
                rfRef.current = inst;
                // initial fit for better overview
                inst.fitView({ padding: 0.12, duration: 250 });
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
                <button className="iconBtn" onClick={onCenter} title="Center">
                  <Crosshair size={16} />
                </button>
                <button
                  className="iconBtn"
                  onClick={() =>
                    rfRef.current?.fitView({ padding: 0.12, duration: 400 })
                  }
                  title="Fit view"
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
  traceVisible: boolean;
  traceCursor: number;
  traceTotal: number;
  traceFocusEvent: GraphTraceEvent | null;
  onTracePrev: () => void;
  onTraceNext: () => void;
  onTraceFinish: () => void;
  autoLayoutTick: number;
  fitViewTick: number;
};
