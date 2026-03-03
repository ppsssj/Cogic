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
    <div className={["cgNode", selected ? "cgNode--selected" : ""].join(" ")}>
      {/* Handles */}
      <Handle type="target" position={Position.Left} className="cgHandle" />
      <Handle type="source" position={Position.Right} className="cgHandle" />

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
}: EdgeProps<DataflowEdgeData>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className="cgEdgeLabel"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
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

function toReactFlowEdges(graph?: GraphPayload): Array<Edge<DataflowEdgeData>> {
  if (!graph) return [];

  return graph.edges.map((e) => {
    const label = e.label ?? e.kind;
    const isDataflow = e.kind === "dataflow";

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: isDataflow ? "dataflow" : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      // Custom edge renderer reads label from `data.label`.
      // For non-dataflow edges we still set `label` so the default edge can render it.
      data: isDataflow ? { label } : undefined,
      label: isDataflow ? undefined : label,
    };
  });
}
/**
 * Core change:
 * - file nodes are NOT rendered as normal nodes.
 * - we synthesize a fileGroup parent per file path, then place all nodes under it
 *   via parentNode + extent:"parent".
 */
function toReactFlowNodes(
  graph?: GraphPayload,
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
  const childColW = 260;
  const childRowH = 140;
  const pad = 18;
  const headerH = 52;

  // Compute per-file group bounds
  const groups = [...byFile.entries()].map(([file, children]) => {
    const cols = Math.max(
      1,
      Math.min(3, Math.ceil(Math.sqrt(children.length))),
    );
    const rows = Math.max(1, Math.ceil(children.length / cols));
    const width = pad * 2 + cols * childColW;
    const height = headerH + pad * 2 + rows * childRowH;
    return { file, children, cols, rows, width, height };
  });

  // Place file groups on a coarse grid
  const groupGap = 70;
  const groupCols = Math.max(1, Math.floor(Math.sqrt(groups.length)));

  const rfNodes: Array<Node<CodeNodeData | FileGroupData>> = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];

    const existingFileNode = fileNodeByPath.get(g.file);
    const parentId = existingFileNode?.id ?? `file:${g.file}`;

    const gx = (gi % groupCols) * (520 + groupGap);
    const gy = Math.floor(gi / groupCols) * (320 + groupGap);

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
      style: { width: g.width, height: g.height },
    });

    // Child nodes inside the parent
    for (let i = 0; i < g.children.length; i++) {
      const n = g.children[i];
      const col = i % g.cols;
      const row = Math.floor(i / g.cols);

      const sk = getInterfaceSubkind(n);
      const kindLabel = String(n.kind) === "interface" && sk ? sk : n.kind;
      const subtitle = `${kindLabel} · ${shortFile(n.file)}:${n.range.start.line + 1}`;

      const data: CodeNodeData = {
        title: nodeTitle(n),
        subtitle,
        kind: n.kind,
        subkind: sk,
        file: n.file,
      };

      rfNodes.push({
        id: n.id,
        position: {
          x: pad + col * childColW,
          y: headerH + pad + row * childRowH,
        },
        type: "code",
        data,
        parentNode: parentId,
        extent: "parent",
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
}: Props) {
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const nodes = useMemo<Array<Node<CodeNodeData | FileGroupData>>>(
    () => toReactFlowNodes(graph),
    [graph],
  );

  const edges = useMemo<Array<Edge<DataflowEdgeData>>>(
    () => toReactFlowEdges(graph),
    [graph],
  );

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

  return (
    <section className="canvas">
      {!hasData ? (
        <div className="emptyState">
          <div className="emptyIcon">
            <Sigma size={20} />
          </div>
          <div className="emptyTitle">No graph yet</div>
          <div className="emptySub">
            Open a TypeScript/JavaScript file, then click <b>Generate</b>.
          </div>
          <div className="emptyActions">
            <button className="btnPrimary" onClick={onGenerateFromActive}>
              Generate from active file
            </button>
          </div>
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
};
