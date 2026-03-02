import "reactflow/dist/style.css";
import "./CanvasPane.css";
import { useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
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
  type ReactFlowInstance,
} from "reactflow";

import { Crosshair, Network, Sigma, ZoomIn, ZoomOut, X } from "lucide-react";
import type { GraphNode, GraphPayload } from "../lib/vscode";
import type { ChipKey } from "./FiltersBar";

type CodeNodeData = {
  title: string;
  subtitle: string;
  kind: GraphNode["kind"];
  /** Absolute/relative file path used to expand external nodes. */
  file: string;
};

type Props = {
  hasData: boolean;

  // analysisResult.payload.graph
  graph?: GraphPayload;

  // filtering/search
  activeFilter: ChipKey;
  searchQuery: string;

  // rooting (optional)
  rootNodeId: string | null;
  onClearRoot: () => void;

  // selection bridge to Inspector
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;

  onGenerateFromActive: () => void;
  onUseSelectionAsRoot: () => void;

  /** When an external node is clicked, request expansion by file path. */
  onExpandExternal?: (filePath: string) => void;
};

function shortFile(p: string) {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function nodeTitle(n: GraphNode) {
  if (n.kind === "class") return `class ${n.name}`;
  if (n.kind === "function") return `${n.name}()`;
  if (n.kind === "method") return `${n.name}()`;
  return n.name;
}

function allowKindByFilter(kind: GraphNode["kind"], filter: ChipKey) {
  switch (filter) {
    case "functions":
      return kind === "function" || kind === "method";
    case "classes":
      return kind === "class";
    case "files":
      return kind === "file";
    // interface/variable kinds aren't in protocol yet
    case "interfaces":
    case "variables":
    default:
      return true;
  }
}

function buildRootSubgraph(graph: GraphPayload, rootId: string, depth: number) {
  const adj = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source); // undirected traversal for context
  }

  const keep = new Set<string>();
  keep.add(rootId);

  let frontier = new Set<string>([rootId]);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!keep.has(nb)) {
          keep.add(nb);
          next.add(nb);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  const nodes = graph.nodes.filter((n) => keep.has(n.id));
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return { nodes, edges };
}

function filterGraph(graph: GraphPayload, activeFilter: ChipKey, searchQuery: string) {
  const q = searchQuery.trim().toLowerCase();
  const nodes = graph.nodes.filter((n) => {
    if (!allowKindByFilter(n.kind, activeFilter)) return false;
    if (!q) return true;
    const hay = `${n.name} ${n.kind} ${n.file}`.toLowerCase();
    return hay.includes(q);
  });

  const keep = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return { nodes, edges };
}

// Minimal deterministic layout (no deps)
function buildLayout(nodes: GraphNode[]) {
  const colW = 260;
  const rowH = 140;
  const cols = Math.max(1, Math.floor(Math.sqrt(nodes.length)));

  return nodes.map((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return { id: n.id, position: { x: col * colW, y: row * rowH } };
  });
}

/** Custom node so we always render title/subtitle. */
function CodeNode({ data, selected }: { data: CodeNodeData; selected?: boolean }) {
  return (
    <div
      className={[
        "cgNode",
        `cgNode--${data.kind}`,
        selected ? "cgNode--selected" : "",
      ].join(" ")}
    >
      <Handle type="target" position={Position.Left} className="cgHandle" />
      <Handle type="source" position={Position.Right} className="cgHandle" />

      <div className="cgNodeTop">
        <span className={`cgBadge cgBadge--${data.kind}`}>
          {String(data.kind).toUpperCase()}
        </span>
      </div>

      <div className="cgNodeTitle">{data.title}</div>
      <div className="cgNodeSub">{data.subtitle}</div>
    </div>
  );
}

const nodeTypes = { code: CodeNode };
type DataflowEdgeData = { label?: string };

function DataflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  style,
}: EdgeProps<DataflowEdgeData>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const label = typeof data?.label === "string" ? data.label : "";

  const m = String(id).match(/@@arg#(\d+)/);
  const argIndex = m ? Number(m[1]) : 0;

  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;

  const nx = -dy / len;
  const ny = dx / len;

  const side = argIndex % 2 === 0 ? 1 : -1;
  const tier = Math.floor(argIndex / 2) + 1;
  const sep = 20;

  const ox = nx * sep * tier * side;
  const oy = ny * sep * tier * side;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="cgEdgeLabel cgEdgeLabel--dataflow"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX + ox}px, ${labelY + oy}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes = { dataflow: DataflowEdge };

function toReactFlowNodes(graph?: GraphPayload): Array<Node<CodeNodeData>> {
  if (!graph) return [];
  const layout = buildLayout(graph.nodes);
  const posById = new Map(layout.map((p) => [p.id, p.position]));

  return graph.nodes.map((n) => {
    const pos = posById.get(n.id) ?? { x: 0, y: 0 };
    const subtitle = `${n.kind} · ${shortFile(n.file)}:${n.range.start.line + 1}`;

    const data: CodeNodeData = {
      title: nodeTitle(n),
      subtitle,
      kind: n.kind,
      file: n.file,
    };

    return {
      id: n.id,
      position: pos,
      type: "code",
      data,
    };
  });
}

function toReactFlowEdges(graph?: GraphPayload): Array<Edge<DataflowEdgeData>> {
  if (!graph) return [];

  return graph.edges.map((e) => {
    const isDataflow = e.kind === "dataflow";

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: isDataflow ? "dataflow" : "smoothstep",
      className:
        e.kind === "constructs"
          ? "cgEdge cgEdge--constructs"
          : isDataflow
            ? "cgEdge cgEdge--dataflow"
            : "cgEdge cgEdge--calls",
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      data: isDataflow ? { label: e.label ?? "" } : undefined,
    };
  });
}

function CanvasFlow({
  hasData,
  graph,
  activeFilter,
  searchQuery,
  rootNodeId,
  onClearRoot,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
  onGenerateFromActive,
  onUseSelectionAsRoot,
  onExpandExternal,
}: Props) {
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const visibleGraph = useMemo(() => {
    if (!graph) return undefined;
    const rooted = rootNodeId ? buildRootSubgraph(graph, rootNodeId, 2) : graph;
    return filterGraph(rooted, activeFilter, searchQuery);
  }, [graph, rootNodeId, activeFilter, searchQuery]);

  const rfNodes = useMemo<Array<Node<CodeNodeData>>>(() => toReactFlowNodes(visibleGraph), [visibleGraph]);
  const rfEdges = useMemo<Array<Edge<DataflowEdgeData>>>(() => toReactFlowEdges(visibleGraph), [visibleGraph]);

  const handleNodeClick = (_event: ReactMouseEvent, node: Node<CodeNodeData>) => {
    onSelectNode(node.id);
    if (node.data.kind === "external") onExpandExternal?.(node.data.file);
  };

  const onZoomIn = () => rfRef.current?.zoomIn?.();
  const onZoomOut = () => rfRef.current?.zoomOut?.();
  const onCenter = () => {
    const inst = rfRef.current;
    if (!inst) return;

    if (selectedNodeId) {
      const n = inst.getNode(selectedNodeId);
      if (n) {
        inst.setCenter(n.position.x + 80, n.position.y + 40, { zoom: 1.1, duration: 200 });
        return;
      }
    }
    inst.fitView({ padding: 0.2, duration: 250 });
  };

  return (
    <section className="canvas">
      <div className="canvasGrid" />

      {hasData && rootNodeId ? (
        <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10 }}>
          <button
            type="button"
            className="smallBtn"
            onClick={onClearRoot}
            title="Clear Root"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <X className="icon" />
            Clear Root
          </button>
        </div>
      ) : null}

      {!hasData ? (
        <div className="emptyState">
          <div className="emptyBadge">
            <Network className="icon emptyBadgeIcon" />
          </div>

          <div className="emptyText">
            <h3>No graph data generated</h3>
            <p>Click Generate to analyze the active file and build initial graph data.</p>
          </div>

          <div className="emptyActions">
            <button className="ctaBtn" type="button" onClick={onGenerateFromActive}>
              <Network className="icon ctaIcon" />
              <span>Generate from Active File</span>
            </button>

            <button className="ctaBtn" type="button" onClick={onUseSelectionAsRoot}>
              <Sigma className="icon ctaIcon" />
              <span>Use Selection as Root</span>
            </button>
          </div>
        </div>
      ) : null}

      {hasData ? (
        <div className="canvasFlow">
          <ReactFlow
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodes={rfNodes}
            edges={rfEdges}
            onInit={(inst) => {
              rfRef.current = inst;
              inst.fitView({ padding: 0.25, duration: 0 });
            }}
            onPaneClick={() => onClearSelection()}
            onNodeClick={handleNodeClick}
            fitView
          >
            <Background />
          </ReactFlow>
        </div>
      ) : null}

      <div className="canvasControls">
        <div className="controlsCard">
          <button className="controlBtn" type="button" title="Zoom in" onClick={onZoomIn} disabled={!hasData}>
            <ZoomIn className="icon" />
          </button>
          <div className="controlSep" />
          <button className="controlBtn" type="button" title="Zoom out" onClick={onZoomOut} disabled={!hasData}>
            <ZoomOut className="icon" />
          </button>
          <div className="controlSep" />
          <button className="controlBtn" type="button" title="Center" onClick={onCenter} disabled={!hasData}>
            <Crosshair className="icon" />
          </button>
        </div>
      </div>
    </section>
  );
}

export function CanvasPane(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasFlow {...props} />
    </ReactFlowProvider>
  );
}
