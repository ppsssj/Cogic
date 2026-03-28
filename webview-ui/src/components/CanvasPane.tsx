// import "./../App.css";
import "reactflow/dist/style.css";
import "./CanvasPane.css";
import {
  memo,
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

import { Crosshair, Loader2, Network, Sigma, ZoomIn, ZoomOut } from "lucide-react";
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
  transitionState?: "collapsing" | "expanding";
  searchHit?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  focusPulseToken?: number;
  diagnosticSeverity?: "error" | "warning";
  diagnosticCount?: number;
  warningCount?: number;
  onDoubleClick?: () => void;
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
    onClick?: (event: ReactDomMouseEvent<HTMLDivElement>) => void;
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
  subtitleTitle?: string;
  kind: "file";
  file: string;
  count: number;
  collapsed?: boolean;
  transitionState?: "collapsing" | "expanding";
  onSelect?: () => void;
  onToggleCollapsed?: () => void;
};

type FolderGroupData = {
  title: string;
  subtitle: string;
  subtitleTitle?: string;
  kind: "folder";
  path: string;
  count: number;
  collapsed?: boolean;
  transitionState?: "collapsing" | "expanding";
  onSelect?: () => void;
  onToggleCollapsed?: () => void;
};

type CanvasNodeData = CodeNodeData | FileGroupData | FolderGroupData;
type CollapseLayoutState = {
  key: string;
  collapsedFilePaths: string[];
  collapsingFilePaths: string[];
  expandingFilePaths: string[];
  collapsedFolderPaths: string[];
  collapsingFolderPaths: string[];
  expandingFolderPaths: string[];
};

type NodeWithAbsolutePosition = Node<CanvasNodeData> & {
  positionAbsolute?: { x: number; y: number };
};

function getNodeAbsolutePosition(node: Node<CanvasNodeData>) {
  const absolute = (node as NodeWithAbsolutePosition).positionAbsolute;
  return absolute ?? node.position;
}

function fitGraphView(inst: ReactFlowInstance | null, duration = 400) {
  if (!inst) return;
  inst.fitView({ padding: 0.12, duration });
}

function focusCanvasNode(
  inst: ReactFlowInstance | null,
  node: Node<CanvasNodeData>,
  zoom: number,
  duration: number,
  focusOffset?: { x?: number; y?: number },
) {
  if (!inst) return;
  const pos = getNodeAbsolutePosition(node);
  inst.setCenter(
    pos.x + (node.width ?? 210) / 2 + (focusOffset?.x ?? 0),
    pos.y + (node.height ?? 72) / 2 + (focusOffset?.y ?? 0),
    { zoom, duration },
  );
}

function focusCanvasNodePair(
  inst: ReactFlowInstance | null,
  firstNode: Node<CanvasNodeData>,
  secondNode: Node<CanvasNodeData>,
  zoom: number,
  duration: number,
) {
  if (!inst) return;

  const firstPos = getNodeAbsolutePosition(firstNode);
  const secondPos = getNodeAbsolutePosition(secondNode);
  const firstWidth = firstNode.width ?? 210;
  const firstHeight = firstNode.height ?? 72;
  const secondWidth = secondNode.width ?? 210;
  const secondHeight = secondNode.height ?? 72;
  const centerX =
    (firstPos.x +
      firstWidth / 2 +
      secondPos.x +
      secondWidth / 2) /
    2;
  const centerY =
    (firstPos.y +
      firstHeight / 2 +
      secondPos.y +
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

function isMultiSelectEvent(
  event:
    | ReactMouseEvent
    | ReactDomMouseEvent<HTMLDivElement>
    | ReactDomMouseEvent<HTMLElement>,
) {
  return event.ctrlKey || event.metaKey;
}

function dirName(p: string) {
  const norm = p.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(0, i) : "";
}

function relativePathFromRoot(path: string, workspaceRoot?: string | null) {
  if (!workspaceRoot) return normalizePath(path);
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(workspaceRoot).replace(/\/+$/, "");
  if (!normalizedRoot) return normalizedPath;
  if (normalizedPath === normalizedRoot) return "";
  const prefix = `${normalizedRoot}/`;
  return normalizedPath.startsWith(prefix)
    ? normalizedPath.slice(prefix.length)
    : normalizedPath;
}

function compactDisplayPath(path: string, keepHead = 2, keepTail = 2) {
  const parts = normalizePath(path)
    .split("/")
    .filter(Boolean);
  if (parts.length <= keepHead + keepTail + 1) {
    return parts.join("/");
  }
  return [
    ...parts.slice(0, keepHead),
    "...",
    ...parts.slice(parts.length - keepTail),
  ].join("/");
}

function formatFileGroupSubtitle(filePath: string, workspaceRoot?: string | null) {
  const directoryPath = dirName(filePath);
  const relativeDirectory = relativePathFromRoot(directoryPath, workspaceRoot);
  const fullSubtitle = relativeDirectory || ".";
  return {
    subtitle: compactDisplayPath(fullSubtitle),
    subtitleTitle: fullSubtitle,
  };
}

function folderKeyForFile(filePath: string) {
  const normalizedDir = normalizePath(dirName(filePath));
  return normalizedDir || ".";
}

function getFolderPathChain(folderPath: string, workspaceRoot?: string | null) {
  const normalizedFolder = normalizePath(folderPath) || ".";
  if (normalizedFolder === ".") return ["."];

  const normalizedRoot = workspaceRoot
    ? normalizePath(workspaceRoot).replace(/\/+$/, "")
    : null;
  if (normalizedRoot) {
    if (normalizedFolder === normalizedRoot) {
      return [normalizedFolder];
    }

    const rootPrefix = `${normalizedRoot}/`;
    if (normalizedFolder.startsWith(rootPrefix)) {
      const relativePath = normalizedFolder.slice(rootPrefix.length);
      const segments = relativePath.split("/").filter(Boolean);
      if (!segments.length) {
        return [normalizedFolder];
      }

      let currentPath = normalizedRoot;
      return segments.map((segment) => {
        currentPath = `${currentPath}/${segment}`;
        return currentPath;
      });
    }
  }

  return [normalizedFolder];
}

function getVisibleFolderPathsForFiles(
  filePaths: Iterable<string>,
  workspaceRoot?: string | null,
) {
  const folderPaths = new Set<string>();
  for (const filePath of filePaths) {
    const folderPath = folderKeyForFile(filePath);
    for (const ancestorPath of getFolderPathChain(folderPath, workspaceRoot)) {
      folderPaths.add(ancestorPath);
    }
  }
  return folderPaths;
}

function getCollapsedFolderAncestorForFile(
  filePath: string,
  collapsedFolders: Set<string>,
  workspaceRoot?: string | null,
) {
  const folderPath = folderKeyForFile(filePath);
  const folderChain = getFolderPathChain(folderPath, workspaceRoot);
  return folderChain.find((ancestorPath) => collapsedFolders.has(ancestorPath)) ?? null;
}

function folderTitleForPath(folderPath: string, workspaceRoot?: string | null) {
  if (folderPath === ".") {
    return workspaceRoot ? baseName(workspaceRoot) : "ROOT";
  }
  return baseName(folderPath);
}

function formatFolderGroupSubtitle(folderPath: string, workspaceRoot?: string | null) {
  if (folderPath === ".") {
    const rootName = workspaceRoot ? baseName(workspaceRoot) : "Workspace root";
    return {
      subtitle: rootName,
      subtitleTitle: workspaceRoot ?? rootName,
    };
  }

  const relativeFolder = relativePathFromRoot(folderPath, workspaceRoot) || ".";
  return {
    subtitle: compactDisplayPath(relativeFolder),
    subtitleTitle: relativeFolder,
  };
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

function formatNodeSubtitle(
  kindLabel: string | undefined,
  filePath: string,
  line: number,
) {
  return `${kindLabel ?? "node"} - ${shortFile(filePath)}:${line + 1}`;
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
    (onClick?: (event: ReactDomMouseEvent<HTMLDivElement>) => void) =>
    (event: ReactDomMouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      onClick?.(event);
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
        data.transitionState ? `cgNode--${data.transitionState}` : "",
      ].join(" ")}
      onDoubleClick={handleChildDoubleClick(data.onDoubleClick)}
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
    <div
      className={[
        "cgGroup",
        selected ? "cgGroup--selected" : "",
        data.collapsed ? "cgGroup--collapsed" : "",
        data.transitionState ? `cgGroup--${data.transitionState}` : "",
      ].join(" ")}
    >
      <Handle
        id="in-control"
        type="target"
        position={Position.Left}
        className="cgHandle cgHandle--group"
      />
      <Handle
        id="out-control"
        type="source"
        position={Position.Right}
        className="cgHandle cgHandle--group"
      />
      <Handle
        id="in-dataflow"
        type="target"
        position={Position.Top}
        className="cgHandle cgHandle--group"
      />
      <Handle
        id="out-dataflow"
        type="source"
        position={Position.Bottom}
        className="cgHandle cgHandle--group"
      />
      <button
        className="cgGroupHeader"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          data.onSelect?.();
          data.onToggleCollapsed?.();
        }}
        title={data.collapsed ? "Select and expand file group" : "Select and collapse file group"}
      >
        <div className="cgGroupTitle">{data.title}</div>
        <div className="cgGroupMeta">
          <span className="cgGroupPath" title={data.subtitleTitle ?? data.subtitle}>
            {data.subtitle}
          </span>
          <span className="cgGroupCount">
            {data.collapsed ? `${data.count} hidden` : `${data.count} nodes`}
          </span>
        </div>
      </button>
    </div>
  );
}

function FolderGroupNode({
  data,
  selected,
}: {
  data: FolderGroupData;
  selected?: boolean;
}) {
  return (
    <div
      className={[
        "cgFolder",
        selected ? "cgFolder--selected" : "",
        data.collapsed ? "cgFolder--collapsed" : "",
        data.transitionState ? `cgFolder--${data.transitionState}` : "",
      ].join(" ")}
    >
      <Handle
        id="in-control"
        type="target"
        position={Position.Left}
        className="cgHandle cgHandle--folder"
      />
      <Handle
        id="out-control"
        type="source"
        position={Position.Right}
        className="cgHandle cgHandle--folder"
      />
      <Handle
        id="in-dataflow"
        type="target"
        position={Position.Top}
        className="cgHandle cgHandle--folder"
      />
      <Handle
        id="out-dataflow"
        type="source"
        position={Position.Bottom}
        className="cgHandle cgHandle--folder"
      />
      <button
        className="cgFolderHeader"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          data.onSelect?.();
          data.onToggleCollapsed?.();
        }}
        title={data.collapsed ? "Expand folder group" : "Collapse folder group"}
      >
        <div className="cgFolderTitle">{data.title}</div>
        <div className="cgFolderMeta">
          <span className="cgFolderPath" title={data.subtitleTitle ?? data.subtitle}>
            {data.subtitle}
          </span>
          <span className="cgFolderCount">
            {data.collapsed ? `${data.count} files hidden` : `${data.count} files`}
          </span>
        </div>
      </button>
    </div>
  );
}

const nodeTypes = {
  code: CodeNode,
  fileGroup: FileGroupNode,
  folderGroup: FolderGroupNode,
};
type DataflowEdgeData = {
  label?: string;
  highlighted?: boolean;
  muted?: boolean;
  lane?: number;
  collapsedBridge?: boolean;
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
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              opacity: data.muted ? 0.28 : data?.collapsedBridge ? 0.55 : 1,
              borderColor: data.highlighted ? "rgba(56,189,248,0.75)" : undefined,
              zIndex: 7001,
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

function buildFileGroupIdByFile(graph?: GraphPayload) {
  const map = new Map<string, string>();
  if (!graph) return map;

  for (const node of graph.nodes) {
    if (node.kind === "file") {
      map.set(normalizePath(node.file), node.id);
    }
  }

  for (const node of graph.nodes) {
    const fileKey = normalizePath(node.file);
    if (!map.has(fileKey)) {
      map.set(fileKey, `file:${node.file}`);
    }
  }

  return map;
}

function toReactFlowEdges(
  graph?: GraphPayload,
  selectedNodeIds?: string[],
  highlightedEdgeId?: string | null,
  collapsedFilePaths?: Set<string>,
  collapsedFolderPaths?: Set<string>,
  workspaceRoot?: string | null,
): Array<Edge<DataflowEdgeData>> {
  if (!graph) return [];
  const selectedNodeIdSet = new Set(selectedNodeIds ?? []);
  const collapsedFiles = collapsedFilePaths ?? new Set<string>();
  const collapsedFolders = collapsedFolderPaths ?? new Set<string>();

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
  const fileGroupIdByFile = buildFileGroupIdByFile(graph);
  const visibleNodeKindById = new Map<string, GraphNode["kind"] | "fileGroup" | "folderGroup">();
  for (const node of graph.nodes) {
    const fileKey = normalizePath(node.file);
    const collapsedFolderPath = getCollapsedFolderAncestorForFile(
      fileKey,
      collapsedFolders,
      workspaceRoot,
    );
    const visibleId =
      node.kind !== "file" && collapsedFolderPath
        ? `folder:${collapsedFolderPath}`
        : node.kind !== "file" && collapsedFiles.has(fileKey)
          ? (fileGroupIdByFile.get(fileKey) ?? `file:${node.file}`)
          : (parentIdByNodeId.get(node.id) ?? node.id);
    const visibleKind =
      node.kind !== "file" && collapsedFolderPath
        ? "folderGroup"
        : node.kind !== "file" && collapsedFiles.has(fileKey)
          ? "fileGroup"
          : node.kind;
    if (!visibleNodeKindById.has(visibleId)) {
      visibleNodeKindById.set(visibleId, visibleKind);
    }
  }
  const remappedEdges = graph.edges
    .map((e) => {
      const sourceNode = nodeById.get(e.source);
      const targetNode = nodeById.get(e.target);
      if (!sourceNode || !targetNode) {
        return null;
      }

      const sourceFileKey = normalizePath(sourceNode.file);
      const targetFileKey = normalizePath(targetNode.file);
      const sourceCollapsedFolderPath = getCollapsedFolderAncestorForFile(
        sourceFileKey,
        collapsedFolders,
        workspaceRoot,
      );
      const targetCollapsedFolderPath = getCollapsedFolderAncestorForFile(
        targetFileKey,
        collapsedFolders,
        workspaceRoot,
      );
      const sourceFolderCollapsed = Boolean(sourceCollapsedFolderPath);
      const targetFolderCollapsed = Boolean(targetCollapsedFolderPath);
      const sourceFileCollapsed = collapsedFiles.has(sourceFileKey);
      const targetFileCollapsed = collapsedFiles.has(targetFileKey);

      if (
        sourceFolderCollapsed &&
        targetFolderCollapsed &&
        sourceCollapsedFolderPath === targetCollapsedFolderPath
      ) {
        return null;
      }

      if (sourceFileCollapsed && targetFileCollapsed && sourceFileKey === targetFileKey) {
        return null;
      }

      return {
        ...e,
        source: sourceFolderCollapsed
          ? `folder:${sourceCollapsedFolderPath}`
          : sourceFileCollapsed
            ? (fileGroupIdByFile.get(sourceFileKey) ?? `file:${sourceNode.file}`)
            : (parentIdByNodeId.get(e.source) ?? e.source),
        target: targetFolderCollapsed
          ? `folder:${targetCollapsedFolderPath}`
          : targetFileCollapsed
            ? (fileGroupIdByFile.get(targetFileKey) ?? `file:${targetNode.file}`)
            : (parentIdByNodeId.get(e.target) ?? e.target),
        originalSource: e.source,
        originalTarget: e.target,
        sourceHandleId: sourceFolderCollapsed
          ? (e.kind === "dataflow" ? "out-dataflow" : "out-control")
          : sourceFileCollapsed
          ? (e.kind === "dataflow" ? "out-dataflow" : "out-control")
          : (parentIdByNodeId.has(e.source) ? `out-child-${e.source}` : undefined),
        targetHandleId: targetFolderCollapsed
          ? (e.kind === "dataflow" ? "in-dataflow" : "in-control")
          : targetFileCollapsed
          ? (e.kind === "dataflow" ? "in-dataflow" : "in-control")
          : (parentIdByNodeId.has(e.target) ? `in-child-${e.target}` : undefined),
        collapsedBridge:
          sourceFolderCollapsed ||
          targetFolderCollapsed ||
          sourceFileCollapsed ||
          targetFileCollapsed,
      };
    })
    .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))
    .filter((e) => e.source !== e.target);

  const dedupedEdges = new Map<string, (typeof remappedEdges)[number]>();
  for (const edge of remappedEdges) {
    const key = `${edge.kind}:${edge.source}:${edge.target}:${edge.sourceHandleId ?? ""}:${edge.targetHandleId ?? ""}:${edge.label ?? ""}`;
    if (!dedupedEdges.has(key)) dedupedEdges.set(key, edge);
  }

  const visibleEdges = [...dedupedEdges.values()].filter((e) => {
    const srcKind = visibleNodeKindById.get(e.source);
    const tgtKind = visibleNodeKindById.get(e.target);
    if (!srcKind || !tgtKind) return false;

    if ((srcKind === "file" || tgtKind === "file") && !e.collapsedBridge) return false;
    if (collapsedNodeIds.has(e.source) || collapsedNodeIds.has(e.target)) return false;
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
      selectedNodeIdSet.size > 0 &&
        (selectedNodeIdSet.has(e.originalSource) ||
          selectedNodeIdSet.has(e.originalTarget)),
    );
    const isFocusedFlow = Boolean(highlightedEdgeId && e.id === highlightedEdgeId);
    const isCollapsedBridge = Boolean(e.collapsedBridge);
    const muted = Boolean(
      isDataflow &&
        ((highlightedEdgeId && !isFocusedFlow) ||
          (!highlightedEdgeId && selectedNodeIdSet.size > 0 && !isSelectedFlow)),
    );
    const showDataflowLabel = Boolean(
      isFocusedFlow || (selectedNodeIdSet.size > 0 && isSelectedFlow),
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
      zIndex: isDataflow ? 3000 : isCollapsedBridge ? 1200 : 1,
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
            opacity: muted ? 0.16 : isCollapsedBridge ? 0.26 : 0.92,
          }
        : isCollapsedBridge
          ? {
              stroke: "rgba(226, 232, 240, 0.58)",
              strokeWidth: 1.7,
              strokeDasharray: "6 6",
              opacity: 0.28,
            }
          : undefined,
      animated: isDataflow && !muted && !isCollapsedBridge,
      data: isDataflow
        ? {
            label: showDataflowLabel ? label : undefined,
            highlighted: isFocusedFlow || isSelectedFlow,
            muted,
            lane,
            collapsedBridge: isCollapsedBridge,
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

function matchesAnyChipFilter(node: GraphNode, chips: ChipKey[]): boolean {
  if (chips.length === 0 || chips.includes("all")) {
    return true;
  }

  return chips.some((chip) => matchesChipFilter(node, chip));
}

function filterGraph(
  graph: GraphPayload | undefined,
  chips: ChipKey[],
): GraphPayload | undefined {
  if (!graph) return undefined;

  const matched = graph.nodes.filter((n) => matchesAnyChipFilter(n, chips));
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
  selectedNodeIds?: string[],
  collapsedFilePaths?: Set<string>,
  collapsingFilePaths?: Set<string>,
  expandingFilePaths?: Set<string>,
  collapsedFolderPaths?: Set<string>,
  collapsingFolderPaths?: Set<string>,
  expandingFolderPaths?: Set<string>,
  workspaceRoot?: string | null,
  traceActiveNodeId?: string | null,
  runtimeActiveNodeId?: string | null,
  focusPulseRequests?: Array<{
    nodeId: string;
    visibleNodeId: string;
    token: number;
  }>,
  onSelectChildNode?: (
    nodeId: string,
    visibleNodeId: string,
    options?: { toggle?: boolean; focusOffsetY?: number },
  ) => void,
  onOpenChildNode?: (nodeId: string) => void,
  onSelectFileGroup?: (nodeId: string) => void,
  onSelectFolderGroup?: (nodeId: string) => void,
  onToggleFileGroup?: (filePath: string) => void,
  onToggleFolderGroup?: (folderPath: string) => void,
): Array<Node<CanvasNodeData>> {
  if (!graph) return [];
  const orderedFocusPulseRequests = [...(focusPulseRequests ?? [])].reverse();
  const focusPulseRequestByVisibleNodeId = new Map(
    orderedFocusPulseRequests.map((request) => [request.visibleNodeId, request] as const),
  );
  const focusPulseRequestByNodeId = new Map(
    orderedFocusPulseRequests.map((request) => [request.nodeId, request] as const),
  );
  const existingNodeIds = new Set(graph.nodes.map((n) => n.id));
  const selectedNodeIdSet = new Set(selectedNodeIds ?? []);
  const collapsedFiles = collapsedFilePaths ?? new Set<string>();
  const collapsingFiles = collapsingFilePaths ?? new Set<string>();
  const expandingFiles = expandingFilePaths ?? new Set<string>();
  const collapsedFolders = collapsedFolderPaths ?? new Set<string>();
  const collapsingFolders = collapsingFolderPaths ?? new Set<string>();
  const expandingFolders = expandingFolderPaths ?? new Set<string>();

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
  const pad = 28;
  const headerH = 96;
  const folderPad = 34;
  const folderHeaderH = 88;

  const groups = [...byFile.entries()].map(([file, children]) => {
    const fileKey = normalizePath(file);
    const collapsed = collapsedFiles.has(fileKey);
    const transitionState: CodeNodeData["transitionState"] = collapsingFiles.has(fileKey)
      ? "collapsing"
      : expandingFiles.has(fileKey)
        ? "expanding"
        : undefined;
    const childRowH = Math.max(
      190,
      ...children.map((n) => {
        const childItems = childItemsByParentId.get(n.id) ?? [];
        return childItems.length > 0 ? 126 + childItems.length * 62 : 190;
      }),
    );
    const layout = collapsed
      ? {
          positions: new Map<string, Positioned>(),
          width: 320,
          height: headerH + pad * 2 + 24,
        }
      : layoutChildrenByFlow(children, graph, {
          pad,
          headerH,
          colW: childColW,
          rowH: childRowH,
        });
    return {
      file,
      children,
      collapsed,
      transitionState,
      childRowH,
      positions: layout.positions,
      width: layout.width,
      height: layout.height,
    };
  });

  const hasSelectedDescendant = (children: GraphNode[]) =>
    children.some((child) => {
      const childItems = childItemsByParentId.get(child.id) ?? [];
      return (
        selectedNodeIdSet.has(child.id) ||
        traceActiveNodeId === child.id ||
        runtimeActiveNodeId === child.id ||
        childItems.some(
          (grandchild) =>
            selectedNodeIdSet.has(grandchild.id) ||
            traceActiveNodeId === grandchild.id ||
            runtimeActiveNodeId === grandchild.id,
        )
      );
    });

  const directFileGroupsByFolder = groups.reduce((map, group) => {
    const folderPath = folderKeyForFile(group.file);
    const current = map.get(folderPath) ?? [];
    current.push(group);
    map.set(folderPath, current);
    return map;
  }, new Map<string, typeof groups>());

  const folderPathSet = new Set<string>();
  for (const folderPath of directFileGroupsByFolder.keys()) {
    for (const ancestorPath of getFolderPathChain(folderPath, workspaceRoot)) {
      folderPathSet.add(ancestorPath);
    }
  }

  const parentFolderPathByFolder = new Map<string, string | null>();
  const childFolderPathsByFolder = new Map<string, string[]>();
  for (const folderPath of folderPathSet) {
    const folderChain = getFolderPathChain(folderPath, workspaceRoot);
    const parentFolderPath =
      folderChain.length > 1 ? folderChain[folderChain.length - 2] : null;
    parentFolderPathByFolder.set(
      folderPath,
      parentFolderPath && folderPathSet.has(parentFolderPath) ? parentFolderPath : null,
    );
    childFolderPathsByFolder.set(folderPath, []);
  }

  for (const [folderPath, parentFolderPath] of parentFolderPathByFolder.entries()) {
    if (!parentFolderPath) continue;
    childFolderPathsByFolder.get(parentFolderPath)?.push(folderPath);
  }

  const folderLayoutStateByPath = new Map<
    string,
    {
      folderPath: string;
      directFileGroups: typeof groups;
      childFolderPaths: string[];
      collapsed: boolean;
      transitionState?: FolderGroupData["transitionState"];
      localFilePositions: Map<string, Positioned>;
      localFolderPositions: Map<string, Positioned>;
      width: number;
      height: number;
      fileCount: number;
      hasSelectedDescendant: boolean;
    }
  >();

  const sortedFolderPaths = [...folderPathSet].sort((a, b) => {
    const depthDiff =
      getFolderPathChain(b, workspaceRoot).length - getFolderPathChain(a, workspaceRoot).length;
    if (depthDiff !== 0) return depthDiff;
    return a.localeCompare(b);
  });

  for (const folderPath of sortedFolderPaths) {
    const directFileGroups = [...(directFileGroupsByFolder.get(folderPath) ?? [])].sort((a, b) =>
      a.file.localeCompare(b.file),
    );
    const childFolderPaths = [...(childFolderPathsByFolder.get(folderPath) ?? [])].sort((a, b) =>
      a.localeCompare(b),
    );

    const collapsed = collapsedFolders.has(folderPath);
    const transitionState: FolderGroupData["transitionState"] = collapsingFolders.has(folderPath)
      ? "collapsing"
      : expandingFolders.has(folderPath)
        ? "expanding"
        : undefined;
    const localGroupGapX = 170;
    const localGroupGapY = 180;
    const localMaxRowWidth = 1800;
    let localCursorX = 0;
    let localCursorY = 0;
    let localRowH = 0;
    let contentWidth = 0;
    let contentHeight = 0;
    const localFilePositions = new Map<string, Positioned>();
    const localFolderPositions = new Map<string, Positioned>();

    if (!collapsed) {
      const layoutItems = [
        ...directFileGroups.map((group) => ({
          kind: "file" as const,
          key: group.file,
          width: group.width,
          height: group.height,
        })),
        ...childFolderPaths.map((childFolderPath) => {
          const childFolderState = folderLayoutStateByPath.get(childFolderPath);
          return {
            kind: "folder" as const,
            key: childFolderPath,
            width: childFolderState?.width ?? 360,
            height: childFolderState?.height ?? 188,
          };
        }),
      ];

      for (const item of layoutItems) {
        if (localCursorX > 0 && localCursorX + item.width > localMaxRowWidth) {
          localCursorX = 0;
          localCursorY += localRowH + localGroupGapY;
          localRowH = 0;
        }

        const localPosition = {
          x: folderPad + localCursorX,
          y: folderHeaderH + folderPad + localCursorY,
        };
        if (item.kind === "file") {
          localFilePositions.set(item.key, localPosition);
        } else {
          localFolderPositions.set(item.key, localPosition);
        }
        contentWidth = Math.max(contentWidth, localPosition.x + item.width);
        contentHeight = Math.max(contentHeight, localPosition.y + item.height);
        localCursorX += item.width + localGroupGapX;
        localRowH = Math.max(localRowH, item.height);
      }
    }

    const subtreeFileCount =
      directFileGroups.length +
      childFolderPaths.reduce(
        (sum, childFolderPath) =>
          sum + (folderLayoutStateByPath.get(childFolderPath)?.fileCount ?? 0),
        0,
      );
    const hasNestedSelection =
      directFileGroups.some((group) => hasSelectedDescendant(group.children)) ||
      childFolderPaths.some(
        (childFolderPath) =>
          folderLayoutStateByPath.get(childFolderPath)?.hasSelectedDescendant ?? false,
      );

    folderLayoutStateByPath.set(folderPath, {
      folderPath,
      directFileGroups,
      childFolderPaths,
      collapsed,
      transitionState,
      localFilePositions,
      localFolderPositions,
      width: collapsed ? 360 : Math.max(420, contentWidth + folderPad),
      height: collapsed
        ? folderHeaderH + folderPad * 2 + 18
        : Math.max(188, contentHeight + folderPad),
      fileCount: subtreeFileCount,
      hasSelectedDescendant: hasNestedSelection,
    });
  }

  const topLevelFolderPaths = [...folderPathSet]
    .filter((folderPath) => !parentFolderPathByFolder.get(folderPath))
    .sort((a, b) => a.localeCompare(b));

  const folderGapX = 220;
  const folderGapY = 220;
  const folderMaxRowWidth = 2500;
  let folderCursorX = 0;
  let folderCursorY = 0;
  let folderRowHeight = 0;

  const reactFlowNodes: Array<Node<CanvasNodeData>> = [];

  const appendCodeNodesForFileGroup = (
    group: (typeof groups)[number],
    parentId: string,
  ) => {
    if (group.collapsed) return;

    for (let i = 0; i < group.children.length; i++) {
      const n = group.children[i];
      const childItems = childItemsByParentId.get(n.id) ?? [];
      const sk = getInterfaceSubkind(n);
      const kindLabel = String(n.kind) === "interface" && sk ? sk : n.kind;
      const subtitle = formatNodeSubtitle(kindLabel, n.file, n.range.start.line);
      const pos = group.positions.get(n.id) ?? {
        x: pad,
        y: headerH + pad + i * group.childRowH,
      };
      const hasSelectedChild = childItems.some((child) => selectedNodeIdSet.has(child.id));
      const hasTraceActiveChild = childItems.some((child) => child.id === traceActiveNodeId);
      const hasRuntimeActiveChild = childItems.some((child) => child.id === runtimeActiveNodeId);
      const visiblePulseRequest = focusPulseRequestByVisibleNodeId.get(n.id);

      const data: CodeNodeData = {
        ...(diagnosticSummaryByNode.get(n.id) ?? {}),
        title: nodeTitle(n),
        subtitle,
        kind: n.kind,
        subkind: sk,
        transitionState: group.transitionState,
        highlighted: Boolean(highlightedNodeIds?.has(n.id)),
        searchHit: Boolean(searchHitIds?.has(n.id)),
        selected:
          selectedNodeIdSet.has(n.id) ||
          traceActiveNodeId === n.id ||
          runtimeActiveNodeId === n.id ||
          hasSelectedChild ||
          hasTraceActiveChild ||
          hasRuntimeActiveChild,
        onDoubleClick: onOpenChildNode ? () => onOpenChildNode(n.id) : undefined,
        focusPulseToken: visiblePulseRequest?.token,
        childItems: childItems.map((child) => {
          const childPulseRequest = focusPulseRequestByNodeId.get(child.id);
          return {
            id: child.id,
            kind: childKindLabel(child),
            title: childTitle(n, child),
            selected:
              selectedNodeIdSet.has(child.id) ||
              traceActiveNodeId === child.id ||
              runtimeActiveNodeId === child.id,
            focusPulseToken: childPulseRequest?.token,
            subtitle: formatNodeSubtitle(
              childKindLabel(child),
              child.file,
              child.range.start.line,
            ),
            ...(diagnosticSummaryByNode.get(child.id) ?? {}),
            onClick:
              onSelectChildNode
                ? (event) =>
                    onSelectChildNode(child.id, n.id, {
                      toggle: isMultiSelectEvent(event),
                      focusOffsetY:
                        (() => {
                          const childEl = event.currentTarget;
                          const parentNodeEl = childEl.closest(".cgNode") as HTMLElement | null;
                          if (!parentNodeEl) return 0;
                          const childRect = childEl.getBoundingClientRect();
                          const parentRect = parentNodeEl.getBoundingClientRect();
                          const childCenterDelta =
                            childRect.top +
                            childRect.height / 2 -
                            (parentRect.top + parentRect.height / 2);
                          return childCenterDelta + 78;
                        })(),
                    })
                : undefined,
            onDoubleClick:
              onOpenChildNode ? () => onOpenChildNode(child.id) : undefined,
          };
        }),
        file: n.file,
      };
      const nodeHeight = childItems.length > 0 ? 94 + childItems.length * 62 : undefined;

      reactFlowNodes.push({
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
  };

  const appendFileGroupNode = (
    group: (typeof groups)[number],
    folderId: string,
    position: Positioned,
  ) => {
    const existingFileNode = fileNodeByPath.get(group.file);
    const parentId = existingFileNode?.id ?? `file:${group.file}`;
    const groupSubtitle = formatFileGroupSubtitle(group.file, workspaceRoot);

    reactFlowNodes.push({
      id: parentId,
      type: "fileGroup",
      position,
      parentNode: folderId,
      extent: "parent",
      draggable: false,
      selectable: true,
      focusable: true,
      selected: hasSelectedDescendant(group.children) || selectedNodeIdSet.has(parentId),
      data: {
        title: baseName(group.file),
        subtitle: groupSubtitle.subtitle,
        subtitleTitle: groupSubtitle.subtitleTitle,
        kind: "file",
        file: group.file,
        count: group.children.length,
        collapsed: group.collapsed,
        transitionState: group.transitionState,
        onSelect: onSelectFileGroup ? () => onSelectFileGroup(parentId) : undefined,
        onToggleCollapsed: onToggleFileGroup
          ? () => onToggleFileGroup(group.file)
          : undefined,
      },
      style: {
        width: group.width,
        height: group.height,
        zIndex: 1,
        transition: "width 180ms ease, height 180ms ease",
      },
    });

    appendCodeNodesForFileGroup(group, parentId);
  };

  const appendFolderNode = (
    folderPath: string,
    position: Positioned,
    parentFolderId?: string,
  ) => {
    const folderState = folderLayoutStateByPath.get(folderPath);
    if (!folderState) return;

    const folderId = `folder:${folderPath}`;
    const folderSubtitle = formatFolderGroupSubtitle(folderPath, workspaceRoot);

    reactFlowNodes.push({
      id: folderId,
      type: "folderGroup",
      position,
      parentNode: parentFolderId,
      extent: parentFolderId ? "parent" : undefined,
      draggable: false,
      selectable: true,
      focusable: true,
      selected: folderState.hasSelectedDescendant || selectedNodeIdSet.has(folderId),
      data: {
        title: folderTitleForPath(folderPath, workspaceRoot),
        subtitle: folderSubtitle.subtitle,
        subtitleTitle: folderSubtitle.subtitleTitle,
        kind: "folder",
        path: folderPath,
        count: folderState.fileCount,
        collapsed: folderState.collapsed,
        transitionState: folderState.transitionState,
        onSelect: onSelectFolderGroup ? () => onSelectFolderGroup(folderId) : undefined,
        onToggleCollapsed: onToggleFolderGroup
          ? () => onToggleFolderGroup(folderPath)
          : undefined,
      },
      style: {
        width: folderState.width,
        height: folderState.height,
        zIndex: 0,
        transition: "width 180ms ease, height 180ms ease",
      },
    });

    if (folderState.collapsed) return;

    for (const childFolderPath of folderState.childFolderPaths) {
      appendFolderNode(
        childFolderPath,
        folderState.localFolderPositions.get(childFolderPath) ?? {
          x: folderPad,
          y: folderHeaderH + folderPad,
        },
        folderId,
      );
    }

    for (const directFileGroup of folderState.directFileGroups) {
      appendFileGroupNode(
        directFileGroup,
        folderId,
        folderState.localFilePositions.get(directFileGroup.file) ?? {
          x: folderPad,
          y: folderHeaderH + folderPad,
        },
      );
    }
  };

  for (const folderPath of topLevelFolderPaths) {
    const folderState = folderLayoutStateByPath.get(folderPath);
    if (!folderState) continue;

    if (folderCursorX > 0 && folderCursorX + folderState.width > folderMaxRowWidth) {
      folderCursorX = 0;
      folderCursorY += folderRowHeight + folderGapY;
      folderRowHeight = 0;
    }

    appendFolderNode(folderPath, { x: folderCursorX, y: folderCursorY });
    folderCursorX += folderState.width + folderGapX;
    folderRowHeight = Math.max(folderRowHeight, folderState.height);
  }

  return reactFlowNodes;
}

export const CanvasPane = memo(function CanvasPane({
  hasData,
  graph,
  loadingState,
  activeFilePath,
  activeFilter,
  searchQuery,
  rootTarget,
  onClearRoot,
  selectedNodeId,
  selectedNodeIds,
  onSelectNode,
  onClearSelection,
  onOpenNode,
  onGenerateFromActive,
  onUseSelectedFileAsRoot,
  onUseSelectedFolderAsRoot,
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
  workspaceRoot,
  onOpenScaffoldModal,
}: Props) {
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const canvasFlowRef = useRef<HTMLDivElement | null>(null);
  const lastVisibleHasDataRef = useRef<boolean | null>(null);
  const lastRecoveryAtRef = useRef(0);
  const snapshotTimersRef = useRef<number[]>([]);
  const canvasFocusTimerRef = useRef<number | null>(null);
  const clearPendingCanvasFocus = useCallback(() => {
    if (canvasFocusTimerRef.current !== null) {
      window.clearTimeout(canvasFocusTimerRef.current);
      canvasFocusTimerRef.current = null;
    }
  }, []);
  const [recoveryTick, setRecoveryTick] = useState(0);
  const [canvasFocusRequest, setCanvasFocusRequest] = useState<{
    visibleNodeId: string;
    token: number;
    focusOffsetY?: number;
  } | null>(null);
  const [focusPulseRequest, setFocusPulseRequest] = useState<{
    nodeId: string;
    visibleNodeId: string;
    token: number;
  } | null>(null);
  const handledGroupFollowTokenRef = useRef<number>(0);
  const [groupFollowRequest, setGroupFollowRequest] = useState<{
    nodeId: string;
    token: number;
  } | null>(null);
  const [layoutState, setLayoutState] = useState<CollapseLayoutState>({
    key: "",
    collapsedFilePaths: [],
    collapsingFilePaths: [],
    expandingFilePaths: [],
    collapsedFolderPaths: [],
    collapsingFolderPaths: [],
    expandingFolderPaths: [],
  });
  const filteredGraph = useMemo(
    () => filterGraph(graph, activeFilter),
    [graph, activeFilter],
  );
  const visibleFilePathSet = useMemo(() => {
    if (!filteredGraph) return new Set<string>();
    return new Set(filteredGraph.nodes.map((node) => normalizePath(node.file)));
  }, [filteredGraph]);
  const visibleFolderPathSet = useMemo(() => {
    if (!filteredGraph) return new Set<string>();
    return getVisibleFolderPathsForFiles(
      filteredGraph.nodes.map((node) => node.file),
      workspaceRoot,
    );
  }, [filteredGraph, workspaceRoot]);
  const activeFolderPaths = useMemo(
    () =>
      activeFilePath
        ? getFolderPathChain(folderKeyForFile(activeFilePath), workspaceRoot)
        : [],
    [activeFilePath, workspaceRoot],
  );
  const activeFileKey = useMemo(
    () => (activeFilePath ? normalizePath(activeFilePath) : null),
    [activeFilePath],
  );
  const visibleFilePaths = useMemo(
    () => [...visibleFilePathSet].sort((a, b) => a.localeCompare(b)),
    [visibleFilePathSet],
  );
  const visibleFolderPaths = useMemo(
    () => [...visibleFolderPathSet].sort((a, b) => a.localeCompare(b)),
    [visibleFolderPathSet],
  );
  const layoutStateKey = useMemo(
    () =>
      JSON.stringify({
        hasGraph: Boolean(filteredGraph),
        activeFileKey,
        activeFolderPaths,
        visibleFilePaths,
        visibleFolderPaths,
      }),
    [activeFileKey, activeFolderPaths, filteredGraph, visibleFilePaths, visibleFolderPaths],
  );
  const defaultLayoutState = useMemo<CollapseLayoutState>(
    () => ({
      key: layoutStateKey,
      collapsedFilePaths: filteredGraph
        ? visibleFilePaths.filter((filePath) => filePath !== activeFileKey)
        : [],
      collapsingFilePaths: [],
      expandingFilePaths: [],
      collapsedFolderPaths: filteredGraph
        ? visibleFolderPaths.filter((folderPath) => !activeFolderPaths.includes(folderPath))
        : [],
      collapsingFolderPaths: [],
      expandingFolderPaths: [],
    }),
    [
      activeFileKey,
      activeFolderPaths,
      filteredGraph,
      layoutStateKey,
      visibleFilePaths,
      visibleFolderPaths,
    ],
  );
  const effectiveLayoutState =
    layoutState.key === layoutStateKey ? layoutState : defaultLayoutState;
  const {
    collapsedFilePaths,
    collapsingFilePaths,
    expandingFilePaths,
    collapsedFolderPaths,
    collapsingFolderPaths,
    expandingFolderPaths,
  } = effectiveLayoutState;
  const updateLayoutState = useCallback(
    (updater: (current: CollapseLayoutState) => CollapseLayoutState) => {
      setLayoutState((current) =>
        updater(current.key === layoutStateKey ? current : defaultLayoutState),
      );
    },
    [defaultLayoutState, layoutStateKey],
  );
  const collapsedFilePathSet = useMemo(() => {
    if (!filteredGraph) return new Set<string>();
    return new Set(
      collapsedFilePaths
        .map((filePath) => normalizePath(filePath))
        .filter((filePath) => visibleFilePathSet.has(filePath)),
    );
  }, [collapsedFilePaths, filteredGraph, visibleFilePathSet]);
  const collapsingFilePathSet = useMemo(
    () =>
      new Set(
        collapsingFilePaths
          .map((filePath) => normalizePath(filePath))
          .filter((filePath) => visibleFilePathSet.has(filePath)),
      ),
    [collapsingFilePaths, visibleFilePathSet],
  );
  const expandingFilePathSet = useMemo(
    () =>
      new Set(
        expandingFilePaths
          .map((filePath) => normalizePath(filePath))
          .filter((filePath) => visibleFilePathSet.has(filePath)),
      ),
    [expandingFilePaths, visibleFilePathSet],
  );
  const collapsedFolderPathSet = useMemo(() => {
    if (!filteredGraph) return new Set<string>();
    return new Set(
      collapsedFolderPaths.filter((folderPath) => visibleFolderPathSet.has(folderPath)),
    );
  }, [collapsedFolderPaths, filteredGraph, visibleFolderPathSet]);
  const collapsingFolderPathSet = useMemo(
    () =>
      new Set(
        collapsingFolderPaths.filter((folderPath) => visibleFolderPathSet.has(folderPath)),
      ),
    [collapsingFolderPaths, visibleFolderPathSet],
  );
  const expandingFolderPathSet = useMemo(
    () =>
      new Set(
        expandingFolderPaths.filter((folderPath) => visibleFolderPathSet.has(folderPath)),
      ),
    [expandingFolderPaths, visibleFolderPathSet],
  );
  const fileGroupIdByFile = useMemo(() => buildFileGroupIdByFile(graph), [graph]);
  useEffect(() => {
    if (!collapsingFilePaths.length) return;

    const timerIds = collapsingFilePaths.map((filePath) =>
      window.setTimeout(() => {
        const normalized = normalizePath(filePath);
        updateLayoutState((current) => ({
          ...current,
          collapsingFilePaths: current.collapsingFilePaths.filter(
            (item) => normalizePath(item) !== normalized,
          ),
          collapsedFilePaths: current.collapsedFilePaths.some(
            (item) => normalizePath(item) === normalized,
          )
            ? current.collapsedFilePaths
            : [...current.collapsedFilePaths, normalized],
        }));
      }, 180),
    );

    return () => {
      for (const timerId of timerIds) {
        window.clearTimeout(timerId);
      }
    };
  }, [collapsingFilePaths, updateLayoutState]);

  useEffect(() => {
    if (!expandingFilePaths.length) return;

    const timerIds = expandingFilePaths.map((filePath) =>
      window.setTimeout(() => {
        const normalized = normalizePath(filePath);
        updateLayoutState((current) => ({
          ...current,
          expandingFilePaths: current.expandingFilePaths.filter(
            (item) => normalizePath(item) !== normalized,
          ),
        }));
      }, 220),
    );

    return () => {
      for (const timerId of timerIds) {
        window.clearTimeout(timerId);
      }
    };
  }, [expandingFilePaths, updateLayoutState]);

  useEffect(() => {
    if (!collapsingFolderPaths.length) return;

    const timerIds = collapsingFolderPaths.map((folderPath) =>
      window.setTimeout(() => {
        updateLayoutState((current) => ({
          ...current,
          collapsingFolderPaths: current.collapsingFolderPaths.filter(
            (item) => item !== folderPath,
          ),
          collapsedFolderPaths: current.collapsedFolderPaths.includes(folderPath)
            ? current.collapsedFolderPaths
            : [...current.collapsedFolderPaths, folderPath],
        }));
      }, 180),
    );

    return () => {
      for (const timerId of timerIds) {
        window.clearTimeout(timerId);
      }
    };
  }, [collapsingFolderPaths, updateLayoutState]);

  useEffect(() => {
    if (!expandingFolderPaths.length) return;

    const timerIds = expandingFolderPaths.map((folderPath) =>
      window.setTimeout(() => {
        updateLayoutState((current) => ({
          ...current,
          expandingFolderPaths: current.expandingFolderPaths.filter(
            (item) => item !== folderPath,
          ),
        }));
      }, 220),
    );

    return () => {
      for (const timerId of timerIds) {
        window.clearTimeout(timerId);
      }
    };
  }, [expandingFolderPaths, updateLayoutState]);

  const handleToggleFileGroup = useCallback(
    (filePath: string) => {
      const normalized = normalizePath(filePath);
      const groupNodeId = fileGroupIdByFile.get(normalized) ?? `file:${filePath}`;
      const isCollapsed = collapsedFilePathSet.has(normalized);
      const isCollapsing = collapsingFilePathSet.has(normalized);

      setGroupFollowRequest((current) => ({
        nodeId: groupNodeId,
        token: (current?.token ?? 0) + 1,
      }));

      if (isCollapsed || isCollapsing) {
        updateLayoutState((current) => ({
          ...current,
          collapsedFilePaths: current.collapsedFilePaths.filter(
            (item) => normalizePath(item) !== normalized,
          ),
          collapsingFilePaths: current.collapsingFilePaths.filter(
            (item) => normalizePath(item) !== normalized,
          ),
          expandingFilePaths: current.expandingFilePaths.some(
            (item) => normalizePath(item) === normalized,
          )
            ? current.expandingFilePaths
            : [...current.expandingFilePaths, normalized],
        }));
        return;
      }

      updateLayoutState((current) => ({
        ...current,
        expandingFilePaths: current.expandingFilePaths.filter(
          (item) => normalizePath(item) !== normalized,
        ),
        collapsingFilePaths: current.collapsingFilePaths.some(
          (item) => normalizePath(item) === normalized,
        )
          ? current.collapsingFilePaths
          : [...current.collapsingFilePaths, normalized],
      }));
    },
    [
      collapsedFilePathSet,
      collapsingFilePathSet,
      fileGroupIdByFile,
      updateLayoutState,
    ],
  );

  const handleToggleFolderGroup = useCallback(
    (folderPath: string) => {
      const isCollapsed = collapsedFolderPathSet.has(folderPath);
      const isCollapsing = collapsingFolderPathSet.has(folderPath);

      setGroupFollowRequest((current) => ({
        nodeId: `folder:${folderPath}`,
        token: (current?.token ?? 0) + 1,
      }));

      if (isCollapsed || isCollapsing) {
        updateLayoutState((current) => ({
          ...current,
          collapsedFolderPaths: current.collapsedFolderPaths.filter(
            (item) => item !== folderPath,
          ),
          collapsingFolderPaths: current.collapsingFolderPaths.filter(
            (item) => item !== folderPath,
          ),
          expandingFolderPaths: current.expandingFolderPaths.includes(folderPath)
            ? current.expandingFolderPaths
            : [...current.expandingFolderPaths, folderPath],
        }));
        return;
      }

      updateLayoutState((current) => ({
        ...current,
        expandingFolderPaths: current.expandingFolderPaths.filter(
          (item) => item !== folderPath,
        ),
        collapsingFolderPaths: current.collapsingFolderPaths.includes(folderPath)
          ? current.collapsingFolderPaths
          : [...current.collapsingFolderPaths, folderPath],
      }));
    },
    [collapsedFolderPathSet, collapsingFolderPathSet, updateLayoutState],
  );

  const resolveVisibleNodeId = useCallback(
    (nodeId: string | null | undefined) => {
      if (!graph || !nodeId) return nodeId ?? null;
      const target = graph.nodes.find((node) => node.id === nodeId);
      if (!target) return nodeId;

      const normalizedFile = normalizePath(target.file);
      const collapsedFolderPath = getCollapsedFolderAncestorForFile(
        normalizedFile,
        collapsedFolderPathSet,
        workspaceRoot,
      );
      const collapsedFileGroupId = fileGroupIdByFile.get(normalizePath(target.file));
      if (collapsedFolderPath) {
        return `folder:${collapsedFolderPath}`;
      }

      if (target.kind === "file") {
        return collapsedFileGroupId ?? nodeId;
      }

      if (collapsedFilePathSet.has(normalizedFile)) {
        return collapsedFileGroupId ?? nodeId;
      }

      const hasParent = Boolean(
        target.parentId && graph.nodes.some((node) => node.id === target.parentId),
      );
      return hasParent ? (target.parentId as string) : target.id;
    },
    [collapsedFilePathSet, collapsedFolderPathSet, fileGroupIdByFile, graph, workspaceRoot],
  );
  const searchHitIds = useMemo(
    () => getSearchHitIds(filteredGraph, searchQuery),
    [filteredGraph, searchQuery],
  );
  const visibleHighlightedNodeIds = useMemo(() => {
    if (!graph || !highlightedNodeIds?.length) return new Set<string>();
    return new Set(
      highlightedNodeIds
        .map((nodeId) => resolveVisibleNodeId(nodeId))
        .filter((nodeId): nodeId is string => Boolean(nodeId)),
    );
  }, [graph, highlightedNodeIds, resolveVisibleNodeId]);
  const visibleInspectorFocusNodeId = useMemo(() => {
    return resolveVisibleNodeId(inspectorFocusRequest?.nodeId);
  }, [inspectorFocusRequest?.nodeId, resolveVisibleNodeId]);
  const visibleSelectedNodeId = useMemo(() => {
    return resolveVisibleNodeId(selectedNodeId);
  }, [resolveVisibleNodeId, selectedNodeId]);
  const visibleTraceActiveNodeId = useMemo(() => {
    return resolveVisibleNodeId(traceActiveNodeId);
  }, [resolveVisibleNodeId, traceActiveNodeId]);
  const visibleRuntimeActiveNodeId = useMemo(() => {
    return resolveVisibleNodeId(runtimeActiveNodeId);
  }, [resolveVisibleNodeId, runtimeActiveNodeId]);
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

  const nodes = useMemo<Array<Node<CanvasNodeData>>>(
    () =>
      toReactFlowNodes(
        filteredGraph,
        searchHitIds,
        analysisDiagnostics,
        visibleHighlightedNodeIds,
        selectedNodeIds,
        collapsedFilePathSet,
        collapsingFilePathSet,
        expandingFilePathSet,
        collapsedFolderPathSet,
        collapsingFolderPathSet,
        expandingFolderPathSet,
        workspaceRoot,
        traceActiveNodeId,
        runtimeActiveNodeId,
        focusPulseRequests,
        (nodeId, visibleNodeId, options) => {
          const target = graph?.nodes.find((node) => node.id === nodeId);
          pushWebviewDebugEvent("canvas.embedded-node.click", {
            nodeId,
            visibleNodeId,
            nodeKind: target?.kind ?? null,
            filePath: target?.file ?? null,
            isExternal: target?.kind === "external",
            toggle: options?.toggle ?? false,
            focusOffsetY: options?.focusOffsetY ?? 0,
            ...getGraphCounts(graph),
          });
          setFocusPulseRequest((current) => ({
            nodeId,
            visibleNodeId,
            token: (current?.token ?? 0) + 1,
          }));
          onSelectNode(nodeId, options);
          setCanvasFocusRequest((current) => ({
            visibleNodeId,
            token: (current?.token ?? 0) + 1,
            focusOffsetY: options?.focusOffsetY,
          }));
        },
        (nodeId) => {
          const target = graph?.nodes.find((node) => node.id === nodeId);
          pushWebviewDebugEvent("canvas.embedded-node.doubleClick", {
            nodeId,
            nodeKind: target?.kind ?? null,
            filePath: target?.file ?? null,
          });
          clearPendingCanvasFocus();
          if (!target) return;
          onOpenNode?.(target);
        },
        (nodeId) => {
          const target = graph?.nodes.find((node) => node.id === nodeId);
          pushWebviewDebugEvent("canvas.file-group.select", {
            nodeId,
            nodeKind: target?.kind ?? null,
            filePath: target?.file ?? null,
            ...getGraphCounts(graph),
          });
          onSelectNode(nodeId);
        },
        (nodeId) => {
          pushWebviewDebugEvent("canvas.folder-group.select", {
            nodeId,
            ...getGraphCounts(graph),
          });
          onSelectNode(nodeId);
        },
        handleToggleFileGroup,
        handleToggleFolderGroup,
      ),
    [
      analysisDiagnostics,
      clearPendingCanvasFocus,
      collapsedFilePathSet,
      collapsingFilePathSet,
      expandingFilePathSet,
      collapsedFolderPathSet,
      collapsingFolderPathSet,
      expandingFolderPathSet,
      filteredGraph,
      graph,
      handleToggleFileGroup,
      handleToggleFolderGroup,
      onExpandExternal,
      onOpenNode,
      onSelectNode,
      selectedNodeIds,
      traceActiveNodeId,
      runtimeActiveNodeId,
      searchHitIds,
      focusPulseRequests,
      visibleHighlightedNodeIds,
      workspaceRoot,
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
    () =>
      toReactFlowEdges(
        filteredGraph,
        selectedNodeIds,
        highlightedEdgeId,
        collapsedFilePathSet,
        collapsedFolderPathSet,
        workspaceRoot,
      ),
    [
      collapsedFilePathSet,
      collapsedFolderPathSet,
      filteredGraph,
      highlightedEdgeId,
      selectedNodeIds,
      workspaceRoot,
    ],
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
  const selectedVisibleNode = useMemo(
    () => (selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) ?? null : null),
    [nodes, selectedNodeId],
  );

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
      rootTarget,
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
    rootTarget,
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
    event: ReactMouseEvent,
    node: Node<CanvasNodeData>,
  ) => {
    const toggle = isMultiSelectEvent(event);
    const graphNode = graph?.nodes.find((n) => n.id === node.id);
    pushWebviewDebugEvent("canvas.node.click", {
      nodeId: node.id,
      visibleNodeId: node.id,
      visibleKind: node.data.kind,
      graphNodeKind: graphNode?.kind ?? null,
      filePath: "file" in node.data ? node.data.file : null,
      isExternal: node.data.kind === "external",
      toggle,
      renderedNodes: nodes.length,
      renderedEdges: edges.length,
      ...getGraphCounts(graph),
    });
    scheduleCanvasSnapshots("node-click", {
      nodeId: node.id,
      visibleKind: node.data.kind,
    });
    if (
      event.detail >= 2 &&
      node.data.kind !== "file" &&
      node.data.kind !== "folder" &&
      graphNode
    ) {
      clearPendingCanvasFocus();
      onOpenNode?.(graphNode);
      return;
    }
    setFocusPulseRequest((current) => ({
      nodeId: node.id,
      visibleNodeId: node.id,
      token: (current?.token ?? 0) + 1,
    }));
    onSelectNode(node.id, { toggle });
    setCanvasFocusRequest((current) => ({
      visibleNodeId: node.id,
      token: (current?.token ?? 0) + 1,
    }));
  };

  const handleNodeDoubleClick = (
    event: ReactMouseEvent,
    node: Node<CanvasNodeData>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    clearPendingCanvasFocus();
    const graphNode = graph?.nodes.find((n) => n.id === node.id);
    pushWebviewDebugEvent("canvas.node.doubleClick", {
      nodeId: node.id,
      visibleKind: node.data.kind,
      graphNodeKind: graphNode?.kind ?? null,
      filePath: graphNode?.file ?? ("file" in node.data ? node.data.file : null),
    });
    if (node.data.kind === "file" || node.data.kind === "folder" || !graphNode) return;
    onOpenNode?.(graphNode);
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
      targetContext: "canvas",
    });
  };

  const handleNodeContextMenu = (
    event: ReactMouseEvent,
    node: Node<CanvasNodeData>,
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
    const targetFilePath =
      node.data.kind === "folder"
        ? null
        : "file" in node.data
          ? node.data.file
          : graphNode?.file ?? null;
    const targetFolderPath =
      node.data.kind === "folder"
        ? node.data.path
        : targetFilePath
          ? folderKeyForFile(targetFilePath)
          : null;
    if (node.data.kind !== "folder") {
      onSelectNode(node.id);
    }
    onOpenScaffoldModal?.({
      clientX: event.clientX,
      clientY: event.clientY,
      targetContext: node.data.kind === "folder" ? "folder" : "file",
      targetFilePath,
      targetFolderPath,
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
      rootTarget,
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
    rootTarget,
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

    const sourceNodeId = resolveVisibleNodeId(traceFocusEvent.edge.source);
    const targetNodeId = resolveVisibleNodeId(traceFocusEvent.edge.target);
    if (!sourceNodeId || !targetNodeId) return;
    const sourceNode = inst.getNode(sourceNodeId);
    const targetNode = inst.getNode(targetNodeId);
    if (!sourceNode || !targetNode) return;

    if (sourceNode.id === targetNode.id) {
      focusCanvasNode(inst, sourceNode, 1.05, 320);
      return;
    }

    focusCanvasNodePair(inst, sourceNode, targetNode, 0.9, 350);
  }, [
    nodes,
    resolveVisibleNodeId,
    traceCursor,
    traceFocusEvent,
    traceVisible,
    visibleTraceActiveNodeId,
  ]);

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
    if (!runtimeFocusRequest || !visibleRuntimeActiveNodeId) return;

    pushWebviewDebugEvent("canvas.runtime-focus.changed", {
      runtimeNodeId: runtimeFocusRequest.nodeId,
      visibleRuntimeNodeId: visibleRuntimeActiveNodeId,
      runtimeToken: runtimeFocusRequest.token,
      visibleHasData,
      renderedNodes: nodes.length,
      renderedEdges: edges.length,
      ...getGraphCounts(graph),
    });
    scheduleCanvasSnapshots("runtime-focus", {
      runtimeNodeId: runtimeFocusRequest.nodeId,
      visibleRuntimeNodeId: visibleRuntimeActiveNodeId,
      runtimeToken: runtimeFocusRequest.token,
    });
  }, [
    graph,
    nodes.length,
    edges.length,
    runtimeFocusRequest,
    scheduleCanvasSnapshots,
    visibleHasData,
    visibleRuntimeActiveNodeId,
  ]);

  useEffect(() => {
    const inst = rfRef.current;
    if (!inst || !canvasFocusRequest) return;

    clearPendingCanvasFocus();
    canvasFocusTimerRef.current = window.setTimeout(() => {
      const currentInst = rfRef.current;
      if (!currentInst) return;
      const node = currentInst.getNode(canvasFocusRequest.visibleNodeId);
      if (!node) return;
      focusCanvasNode(currentInst, node, 1.2, 260, {
        y: canvasFocusRequest.focusOffsetY ?? 0,
      });
      canvasFocusTimerRef.current = null;
    }, 210);

    return clearPendingCanvasFocus;
  }, [canvasFocusRequest, clearPendingCanvasFocus]);

  useEffect(() => {
    const inst = rfRef.current;
    if (!inst || !groupFollowRequest) return;
    if (handledGroupFollowTokenRef.current === groupFollowRequest.token) return;

    const node = inst.getNode(groupFollowRequest.nodeId);
    if (!node) return;

    focusCanvasNode(inst, node, 1.02, 260);
    handledGroupFollowTokenRef.current = groupFollowRequest.token;
  }, [groupFollowRequest, nodeTopologyKey]);

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

  const renderLoadingState = (mode: "overlay" | "inline") => (
    <div
      className={[
        "canvasLoading",
        mode === "overlay" ? "canvasLoading--overlay" : "canvasLoading--inline",
      ].join(" ")}
    >
      <div className="canvasLoadingIcon">
        <Loader2 size={18} className="spin" />
      </div>
      <div className="canvasLoadingBody">
        <div className="canvasLoadingTitle">
          {loadingState?.message ?? "Rendering graph..."}
        </div>
        <div className="canvasLoadingDetail">
          {loadingState?.detail ?? "Analyzing files and preparing the graph view."}
        </div>
      </div>
    </div>
  );

  return (
    <section className="canvas" onContextMenu={handleCanvasContextMenu}>
      {!hasData ? (
        loadingState?.active ? renderLoadingState("overlay") : renderEmptyState("no-graph")
      ) : (
        <div className="canvasFlow" ref={canvasFlowRef}>
          {loadingState?.active ? renderLoadingState("inline") : null}
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

              <div className="canvasControls canvasOverlay">
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
              {rootTarget ? (
                <div className="rootBanner canvasOverlay">
                  <div className="rootText">
                    Root {rootTarget.kind}: <b>{baseName(rootTarget.path)}</b>
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
                    "canvasOverlay",
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
                {activeFilter.join(",")} {searchQuery}
              </div>

              {/* Selection actions */}
              {selectedVisibleNode?.data.kind === "file" || selectedVisibleNode?.data.kind === "folder" ? (
                <div className="selectionBanner canvasOverlay">
                  {selectedVisibleNode?.data.kind === "file" ? (
                    <button className="btnGhost" onClick={onUseSelectedFileAsRoot}>
                      Use selected file as root
                    </button>
                  ) : (
                    <button
                      className="btnGhost"
                      onClick={() => onUseSelectedFolderAsRoot((selectedVisibleNode.data as FolderGroupData).path)}
                    >
                      Use selected folder as root
                    </button>
                  )}
                </div>
              ) : null}

              {traceVisible ? (
                <div
                  className="canvasOverlay"
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
                    zIndex: 5000,
                  }}
                >
                  {renderTraceControls()}
                </div>
              ) : null}

            </ReactFlow>
          </ReactFlowProvider>
          {!visibleHasData ? renderEmptyState("no-visible") : null}
        </div>
      )}
    </section>
  );
});

type Props = {
  hasData: boolean;
  graph?: GraphPayload;
  loadingState?: {
    active: boolean;
    message: string;
    detail?: string;
  } | null;

  activeFilePath?: string | null;
  activeFilter: ChipKey[];
  searchQuery: string;
  rootTarget:
    | {
        kind: "file" | "folder";
        path: string;
      }
    | null;
  onClearRoot: () => void;

  selectedNodeId: string | null;
  selectedNodeIds: string[];
  onSelectNode: (nodeId: string, options?: { toggle?: boolean }) => void;
  onClearSelection: () => void;

  onOpenNode?: (node: GraphNode) => void;

  onGenerateFromActive: () => void;
  onUseSelectedFileAsRoot: () => void;
  onUseSelectedFolderAsRoot: (folderPath: string) => void;

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
  workspaceRoot?: string | null;
  onOpenScaffoldModal?: (args: {
    clientX: number;
    clientY: number;
    targetContext?: "canvas" | "file" | "folder";
    targetFilePath?: string | null;
    targetFolderPath?: string | null;
  }) => void;
};
