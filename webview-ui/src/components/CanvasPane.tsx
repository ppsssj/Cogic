// import "./../App.css";
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
  // type NodeMouseHandler,
  type ReactFlowInstance,
} from "reactflow";

import { Crosshair, Network, Sigma, ZoomIn, ZoomOut } from "lucide-react";
import type { GraphNode, GraphPayload } from "../lib/vscode";
import type { ChipKey } from "./FiltersBar";

type GraphEdge = GraphPayload["edges"][number];

type CodeNodeData = {
  title: string;
  subtitle: string;
  kind: GraphNode["kind"];
  subkind?: InterfaceSubkind;
  /** Absolute/relative file path used to expand external nodes. */
  file: string;
};

type InterfaceSubkind = "interface" | "type" | "enum";

function getInterfaceSubkind(n: GraphNode): InterfaceSubkind | undefined {
  const v = (n as unknown as { subkind?: unknown }).subkind;
  return v === "interface" || v === "type" || v === "enum" ? v : undefined;
}

type Props = {
  hasData: boolean;

  // analysisResult.payload.graph
  graph?: GraphPayload;

  // UI state forwarded from App
  activeFilter: ChipKey;
  searchQuery: string;
  rootNodeId: string | null; // ✅ 추가
  onClearRoot: () => void;

  // selection bridge to Inspector
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;

  /** When a node is clicked, open its source location in VS Code. */
  onOpenNode?: (node: GraphNode) => void;

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

/** Custom node so we always render title/subtitle (default node expects data.label). */
function CodeNode({
  data,
  selected,
}: {
  data: CodeNodeData;
  selected?: boolean;
}) {
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
          {String(
            String(data.kind) === "interface" && data.subkind
              ? data.subkind
              : data.kind,
          ).toUpperCase()}
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

  // ✅ 라벨 겹침 방지: extension에서 id에 넣은 "@@arg#i"를 파싱해 y-offset 적용
  // ✅ arg index 파싱
  const m = String(id).match(/@@arg#(\d+)/);
  const argIndex = m ? Number(m[1]) : 0;

  // ✅ 라벨을 "간선 방향의 법선"으로 옆으로 이동시켜 노드와 겹침 최소화
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;

  // 법선 단위벡터 (edge에 수직)
  const nx = -dy / len;
  const ny = dx / len;

  // 0,1,2,3... -> +,-,+,- 형태로 퍼지게 (라벨이 한쪽으로만 몰리지 않게)
  const side = argIndex % 2 === 0 ? 1 : -1;
  const tier = Math.floor(argIndex / 2) + 1;

  // ✅ 간격(픽셀): 라벨/노드 겹침 방지용. 필요 시 16~28 사이로 조정
  const sep = 20;

  // 최종 오프셋
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
              transform: `translate(-50%, -50%) translate(${labelX + ox}px, ${
                labelY + oy
              }px)`,
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

  return graph.nodes.map((n: GraphNode) => {
    const pos = posById.get(n.id) ?? { x: 0, y: 0 };
    const sk = getInterfaceSubkind(n);
    const kindLabel = String(n.kind) === "interface" && sk ? sk : n.kind;
    const subtitle = `${kindLabel} · ${shortFile(n.file)}:${
      n.range.start.line + 1
    }`;

    const data: CodeNodeData = {
      title: nodeTitle(n),
      subtitle,
      kind: n.kind,
      subkind: getInterfaceSubkind(n),
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

  return graph.edges.map((e: GraphEdge) => {
    const isDataflow = e.kind === "dataflow";

    const edge: Edge<DataflowEdgeData> = {
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

      // ✅ Dataflow 라벨
      data: isDataflow ? { label: e.label ?? "" } : undefined,
    };

    return edge;
  });
}

function CanvasFlow({
  hasData,
  graph,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
  onGenerateFromActive,
  onUseSelectionAsRoot,
  onExpandExternal,
  onOpenNode,
}: Props) {
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const rfNodes = useMemo<Array<Node<CodeNodeData>>>(
    () => toReactFlowNodes(graph),
    [graph],
  );

  const rfEdges = useMemo<Array<Edge<DataflowEdgeData>>>(
    () => toReactFlowEdges(graph),
    [graph],
  );

  const handleNodeClick = (
    _event: ReactMouseEvent,
    node: Node<CodeNodeData>,
  ) => {
    onSelectNode(node.id);

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
        inst.setCenter(n.position.x + 80, n.position.y + 40, {
          zoom: 1.1,
          duration: 200,
        });
        return;
      }
    }

    inst.fitView({ padding: 0.2, duration: 250 });
  };

  return (
    <section className="canvas">
      <div className="canvasGrid" />

      {!hasData ? (
        <div className="emptyState">
          <div className="emptyBadge">
            <Network className="icon emptyBadgeIcon" />
          </div>

          <div className="emptyText">
            <h3>No graph data generated</h3>
            <p>
              Click Generate to analyze the active file and build initial graph
              data.
            </p>
          </div>

          <div className="emptyActions">
            <button
              className="ctaBtn"
              type="button"
              onClick={onGenerateFromActive}
            >
              <Network className="icon ctaIcon" />
              <span>Generate from Active File</span>
            </button>

            <button
              className="ctaBtn"
              type="button"
              onClick={onUseSelectionAsRoot}
            >
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
          <button
            className="controlBtn"
            type="button"
            title="Zoom in"
            onClick={onZoomIn}
            disabled={!hasData}
          >
            <ZoomIn className="icon" />
          </button>
          <div className="controlSep" />
          <button
            className="controlBtn"
            type="button"
            title="Zoom out"
            onClick={onZoomOut}
            disabled={!hasData}
          >
            <ZoomOut className="icon" />
          </button>
          <div className="controlSep" />
          <button
            className="controlBtn"
            type="button"
            title="Center"
            onClick={onCenter}
            disabled={!hasData}
          >
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