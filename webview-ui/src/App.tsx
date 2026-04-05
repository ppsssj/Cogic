import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toJpeg } from "html-to-image";
import { Topbar } from "./components/Topbar";
import { FiltersBar, type ChipKey } from "./components/FiltersBar";
import { CanvasPane } from "./components/CanvasPane";
import { Inspector } from "./components/Inspector";
import { ScaffoldLab } from "./components/ScaffoldLab";
import {
  getVSCodeApi,
  isExtToWebviewMessage,
  type DesignGraph,
  type ExtToWebviewMessage,
  type CodeDiagnostic,
  type GraphNode,
  type GraphPayload,
  type GraphTraceEvent,
  type PatchPreview,
  type RuntimeDebugPayload,
  type UINotice,
  type WebviewToExtMessage,
} from "./lib/vscode";
import {
  pushWebviewDebugEvent,
} from "./lib/debugLog";
import "./styles/index.css";

const vscode = getVSCodeApi();

type ActiveFilePayload = Extract<
  ExtToWebviewMessage,
  { type: "activeFile" }
>["payload"];
type SelectionPayload = Extract<
  ExtToWebviewMessage,
  { type: "selection" }
>["payload"];
type WorkspaceFilesPayload = Extract<
  ExtToWebviewMessage,
  { type: "workspaceFiles" }
>["payload"];
type AnalysisPayload = Extract<
  ExtToWebviewMessage,
  { type: "analysisResult" }
>["payload"];
type AnalysisRequest = Extract<
  ExtToWebviewMessage,
  { type: "analysisResult" }
>["request"];
type FlowExportResultPayload = Extract<
  ExtToWebviewMessage,
  { type: "flowExportResult" }
>["payload"];
type RuntimeDebugState = Extract<
  ExtToWebviewMessage,
  { type: "runtimeDebug" }
>["payload"];
type PatchPreviewResultPayload = Extract<
  ExtToWebviewMessage,
  { type: "patchPreviewResult" }
>["payload"];
type PatchApplyResultPayload = Extract<
  ExtToWebviewMessage,
  { type: "patchApplyResult" }
>["payload"];
type HostStatePayload = Extract<
  ExtToWebviewMessage,
  { type: "hostState" }
>["payload"];
type NoticeSeverity = UINotice["severity"];
type OpenLocationPayload = Extract<
  WebviewToExtMessage,
  { type: "openLocation" }
>["payload"];
type InspectorSelectionOrigin =
  | "graph"
  | "runtime"
  | "selected-evidence"
  | "analysis-graph"
  | "analysis-import"
  | "analysis-call"
  | "analysis-diagnostic";

const ENABLE_OPEN_LOCATION = true;

function findNodeById(graph: GraphPayload | undefined, id: string | null) {
  if (!graph || !id) return null;
  return graph.nodes.find((n) => n.id === id) ?? null;
}

function getGraphCounts(graph: GraphPayload | undefined) {
  return {
    hasGraph: Boolean(graph),
    nodes: graph?.nodes.length ?? 0,
    edges: graph?.edges.length ?? 0,
  };
}

function getAnalysisPayloadCounts(payload: AnalysisPayload) {
  return {
    hasPayload: Boolean(payload),
    graphNodes: payload?.graph?.nodes.length ?? 0,
    graphEdges: payload?.graph?.edges.length ?? 0,
    traceEvents: payload?.trace?.length ?? 0,
    diagnostics: payload?.diagnostics?.length ?? 0,
  };
}

function getNodeDebugInfo(node: GraphNode | null) {
  if (!node) return {};
  return {
    nodeId: node.id,
    nodeKind: node.kind,
    filePath: node.file,
    line: node.range.start.line + 1,
  };
}

function isNodeModulesPath(filePath: string | null | undefined) {
  if (!filePath) return false;
  return filePath.replace(/\\/g, "/").includes("/node_modules/");
}

function mergeGraph(
  prev: GraphPayload | undefined,
  next: GraphPayload | undefined,
): GraphPayload | undefined {
  if (!next) return prev;
  if (!prev) return next;

  const nodeById = new Map(prev.nodes.map((n) => [n.id, n]));
  for (const n of next.nodes) nodeById.set(n.id, n);

  const edgeById = new Map(prev.edges.map((e) => [e.id, e]));
  for (const e of next.edges) edgeById.set(e.id, e);

  return { nodes: [...nodeById.values()], edges: [...edgeById.values()] };
}

function graphFromTraceEvent(e: GraphTraceEvent): GraphPayload {
  if (e.type === "node") return { nodes: [e.node], edges: [] };
  return { nodes: [], edges: [e.edge] };
}

function buildGraphFromTrace(
  events: GraphTraceEvent[],
  steps: number,
): GraphPayload | undefined {
  if (!events.length || steps <= 0) return undefined;
  const clamped = Math.min(events.length, Math.max(0, steps));
  let g: GraphPayload | undefined = undefined;
  for (let i = 0; i < clamped; i++) {
    g = mergeGraph(g, graphFromTraceEvent(events[i]));
  }
  return g;
}

type Pos = { line: number; character: number };
function cmpPos(a: Pos, b: Pos) {
  if (a.line !== b.line) return a.line - b.line;
  return a.character - b.character;
}
function inRange(pos: Pos, start: Pos, end: Pos) {
  return cmpPos(pos, start) >= 0 && cmpPos(pos, end) <= 0;
}
function normalizePath(p: string) {
  return p.replace(/\\/g, "/");
}
function shortBaseName(p: string) {
  const norm = normalizePath(p);
  const parts = norm.split("/");
  return parts[parts.length - 1] || p;
}
function dirName(p: string) {
  const norm = normalizePath(p);
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx) : norm;
}
function normalizeComparablePath(p: string) {
  return normalizePath(p).toLowerCase();
}
function clampGraphDepth(depth: number) {
  if (!Number.isFinite(depth)) {return 0;}
  return Math.max(0, Math.min(3, Math.round(depth)));
}
function describeDepth(graphDepth: number) {
  if (graphDepth <= 0) return "file only";
  if (graphDepth === 1) return "direct connections";
  return `${graphDepth} hops`;
}
function uriToFsPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  let p = decodeURIComponent(uri.replace("file://", ""));
  if (p.match(/^\/[A-Za-z]:\//)) p = p.slice(1); // windows /C:/...
  return p;
}
function fsPathToUri(filePath: string): string {
  const normalized = normalizePath(filePath);
  const uriPath = normalized.match(/^[A-Za-z]:\//)
    ? `/${normalized}`
    : normalized;
  return `file://${encodeURI(uriPath)}`;
}
function inferLanguageIdFromPath(filePath: string): string {
  const normalized = normalizePath(filePath).toLowerCase();
  if (normalized.endsWith(".tsx")) return "typescriptreact";
  if (normalized.endsWith(".ts")) return "typescript";
  if (normalized.endsWith(".jsx")) return "javascriptreact";
  if (normalized.endsWith(".js")) return "javascript";
  return "plaintext";
}
function getPrimaryGraphFilePath(graph: GraphPayload | undefined): string | null {
  if (!graph?.nodes.length) return null;

  const localCounts = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.kind === "file" || node.kind === "external") continue;
    localCounts.set(node.file, (localCounts.get(node.file) ?? 0) + 1);
  }

  if (localCounts.size > 0) {
    return [...localCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  const fileNode = graph.nodes.find((node) => node.kind === "file");
  return fileNode?.file ?? graph.nodes[0]?.file ?? null;
}
function rangeSize(range: GraphNode["range"]) {
  return (
    (range.end.line - range.start.line) * 1_000_000 +
    (range.end.character - range.start.character)
  );
}
function distanceToRange(pos: Pos, range: GraphNode["range"]) {
  if (cmpPos(pos, range.start) < 0) {
    return (
      (range.start.line - pos.line) * 1_000_000 +
      (range.start.character - pos.character)
    );
  }
  if (cmpPos(pos, range.end) > 0) {
    return (
      (pos.line - range.end.line) * 1_000_000 +
      (pos.character - range.end.character)
    );
  }
  return 0;
}
function findGraphNodeForRuntimeFrame(
  graph: GraphPayload | undefined,
  frame: RuntimeDebugPayload["frame"],
) {
  if (!graph || !frame?.filePath || frame.line === undefined) return null;

  const filePath = normalizeComparablePath(frame.filePath);
  const pos = {
    line: frame.line,
    character: frame.column ?? 0,
  };

  const sameFileNodes = graph.nodes.filter(
    (node) => normalizeComparablePath(node.file) === filePath,
  );
  if (sameFileNodes.length === 0) return null;

  const containing = sameFileNodes
    .filter((node) => inRange(pos, node.range.start, node.range.end))
    .sort((a, b) => {
      const filePenaltyA = a.kind === "file" ? 1 : 0;
      const filePenaltyB = b.kind === "file" ? 1 : 0;
      if (filePenaltyA !== filePenaltyB) return filePenaltyA - filePenaltyB;
      return rangeSize(a.range) - rangeSize(b.range);
    });
  if (containing.length > 0) return containing[0] ?? null;

  const nearest = sameFileNodes.sort((a, b) => {
    const distanceDiff = distanceToRange(pos, a.range) - distanceToRange(pos, b.range);
    if (distanceDiff !== 0) return distanceDiff;
    const filePenaltyA = a.kind === "file" ? 1 : 0;
    const filePenaltyB = b.kind === "file" ? 1 : 0;
    if (filePenaltyA !== filePenaltyB) return filePenaltyA - filePenaltyB;
    return rangeSize(a.range) - rangeSize(b.range);
  });
  return nearest[0] ?? null;
}

type TracePreviewTarget = {
  requestId: string;
  title: string;
  subtitle: string;
  description: string;
  filePath: string;
  range: GraphNode["range"];
};

function findGraphNode(
  primary: GraphPayload | undefined,
  secondary: GraphPayload | undefined,
  id: string,
) {
  return primary?.nodes.find((n) => n.id === id) ?? secondary?.nodes.find((n) => n.id === id) ?? null;
}

function buildTracePreviewTarget(
  event: GraphTraceEvent | null,
  liveGraph: GraphPayload | undefined,
  fullGraph: GraphPayload | undefined,
  traceCursor: number,
  traceTotal: number,
): TracePreviewTarget | null {
  if (!event) return null;

  const stepLabel =
    traceTotal > 0 ? `Step ${traceCursor} / ${traceTotal}` : `Step ${traceCursor}`;

  if (event.type === "node") {
    return {
      requestId: `trace-node-${traceCursor}-${event.node.id}`,
      title: `${stepLabel} · ${event.node.kind}`,
      subtitle: `${event.node.name} · ${shortBaseName(event.node.file)}`,
      description: "Current trace step is introducing this node into the graph.",
      filePath: event.node.file,
      range: event.node.range,
    };
  }

  const sourceNode = findGraphNode(liveGraph, fullGraph, event.edge.source);
  const targetNode = findGraphNode(liveGraph, fullGraph, event.edge.target);
  const primaryNode = sourceNode ?? targetNode;
  if (!primaryNode) return null;

  return {
    requestId: `trace-edge-${traceCursor}-${event.edge.id}`,
    title: `${stepLabel} · ${event.edge.kind}`,
    subtitle: `${sourceNode?.name ?? event.edge.source} -> ${targetNode?.name ?? event.edge.target}`,
    description: "Current trace step is connecting these nodes. The preview shows the source-side code context.",
    filePath: primaryNode.file,
    range: primaryNode.range,
  };
}

function summarizeDiagnostics(diagnostics: CodeDiagnostic[]): UINotice | null {
  if (!diagnostics.length) return null;

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const top = diagnostics[0];
  const labelParts: string[] = [];
  if (errorCount) labelParts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
  if (warningCount) {
    labelParts.push(`${warningCount} warning${warningCount > 1 ? "s" : ""}`);
  }
  if (!labelParts.length) {
    labelParts.push(`${diagnostics.length} diagnostic${diagnostics.length > 1 ? "s" : ""}`);
  }

  return {
    id: `diagnostics-${Date.now()}`,
    scope: "canvas",
    severity: errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "info",
    message: `TypeScript reported ${labelParts.join(" and ")}`,
    detail: top.filePath
      ? `${shortBaseName(top.filePath)} · TS${top.code}: ${top.message}`
      : `TS${top.code}: ${top.message}`,
    source: "typescript-diagnostics",
  };
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function downloadDataUrl(filename: string, dataUrl: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function dataUrlToBase64(dataUrl: string) {
  const [, base64 = ""] = dataUrl.split(",", 2);
  return base64;
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function isHostedInVSCode() {
  return typeof window.acquireVsCodeApi === "function";
}

const SCAFFOLD_PANEL_GUTTER = 12;
const SCAFFOLD_PANEL_DEFAULT_WIDTH = 360;
const SCAFFOLD_PANEL_DEFAULT_HEIGHT = 520;
const SCAFFOLD_PANEL_MIN_WIDTH = 280;
const SCAFFOLD_PANEL_MIN_HEIGHT = 260;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function clampScaffoldPanelSize(args: {
  appRect: DOMRect;
  width: number;
  height: number;
  left?: number;
  top?: number;
}) {
  const maxWidth = Math.max(
    220,
    args.appRect.width - (args.left ?? SCAFFOLD_PANEL_GUTTER) - SCAFFOLD_PANEL_GUTTER,
  );
  const maxHeight = Math.max(
    220,
    args.appRect.height - (args.top ?? SCAFFOLD_PANEL_GUTTER) - SCAFFOLD_PANEL_GUTTER,
  );
  const minWidth = Math.min(SCAFFOLD_PANEL_MIN_WIDTH, maxWidth);
  const minHeight = Math.min(SCAFFOLD_PANEL_MIN_HEIGHT, maxHeight);

  return {
    width: clamp(args.width, minWidth, maxWidth),
    height: clamp(args.height, minHeight, maxHeight),
  };
}

function clampScaffoldPanelPosition(args: {
  appRect: DOMRect;
  left: number;
  top: number;
  panelWidth: number;
  panelHeight: number;
}) {
  const maxLeft = Math.max(
    SCAFFOLD_PANEL_GUTTER,
    args.appRect.width - args.panelWidth - SCAFFOLD_PANEL_GUTTER,
  );
  const maxTop = Math.max(
    SCAFFOLD_PANEL_GUTTER,
    args.appRect.height - args.panelHeight - SCAFFOLD_PANEL_GUTTER,
  );

  return {
    left: clamp(args.left, SCAFFOLD_PANEL_GUTTER, maxLeft),
    top: clamp(args.top, SCAFFOLD_PANEL_GUTTER, maxTop),
  };
}

function placeScaffoldPanelAtPointer(args: {
  appRect: DOMRect;
  clientX: number;
  clientY: number;
  panelWidth: number;
  panelHeight: number;
}) {
  return clampScaffoldPanelPosition({
    appRect: args.appRect,
    left: args.clientX - args.appRect.left + 10,
    top: args.clientY - args.appRect.top + 10,
    panelWidth: args.panelWidth,
    panelHeight: args.panelHeight,
  });
}

type ToastKind = "info" | "success" | "warning" | "error";
type ToastState = { open: boolean; kind: ToastKind; message: string };
type InspectorPlacement = "auto" | "left" | "right" | "bottom";
type EffectiveInspectorPlacement = Exclude<InspectorPlacement, "auto">;
type ExportFormat = "json" | "jpg";
type FocusedFlowState = {
  edgeId: string;
  sourceId: string;
  targetId: string;
};
type FlowPreviewState = FocusedFlowState & {
  origin: "manual" | "trace";
};
type InspectorFocusRequest = {
  nodeId: string;
  token: number;
};
type ScaffoldPanelPosition = {
  left: number;
  top: number;
};
type ScaffoldPanelSize = {
  width: number;
  height: number;
};
type ScaffoldPanelLayout = ScaffoldPanelPosition & ScaffoldPanelSize;
type ScaffoldContextKind = "canvas" | "file" | "folder";
type OpenScaffoldPanelArgs = {
  clientX: number;
  clientY: number;
  targetContext?: ScaffoldContextKind;
  targetFilePath?: string | null;
  targetFolderPath?: string | null;
};
type ScaffoldTargetContext = {
  targetContext: ScaffoldContextKind;
  targetFilePath: string | null;
  targetFolderPath: string | null;
};
type GraphRootTarget =
  | {
      kind: "file" | "folder";
      path: string;
    }
  | null;
type ScaffoldPreviewState = {
  requestId: string | null;
  patches: PatchPreview[];
  warnings: string[];
  error: string | null;
};
type AnalysisLoadingState = {
  active: boolean;
  message: string;
  detail?: string;
};

export default function App() {
  const [hostState, setHostState] = useState<HostStatePayload>({
    currentHost: "panel",
    sidebarLocation: "left",
  });
  const [activeFile, setActiveFile] = useState<ActiveFilePayload>(null);
  const [workspaceFiles, setWorkspaceFiles] =
    useState<WorkspaceFilesPayload | null>(null);
  const [selection, setSelection] = useState<SelectionPayload>(null);
  const [analysis, setAnalysis] = useState<AnalysisPayload>(null);

  const [graphState, setGraphState] = useState<GraphPayload | undefined>(
    undefined,
  );

  const expandedFilesRef = useRef<Set<string>>(new Set());

  const [activeChip, setActiveChip] = useState<ChipKey[]>(["all"]);
  const [searchQuery, setSearchQuery] = useState("");
  const [traceMode, setTraceMode] = useState(false);
  const LS_GRAPH_DEPTH = "cg.graphDepth";
  const [graphDepth, setGraphDepth] = useState<number>(() => {
    try {
      return clampGraphDepth(Number(localStorage.getItem(LS_GRAPH_DEPTH) ?? "0"));
    } catch {
      return 0;
    }
  });
  const [traceEvents, setTraceEvents] = useState<GraphTraceEvent[] | null>(null);
  const [traceCursor, setTraceCursor] = useState(0);
  const [autoLayoutTick, setAutoLayoutTick] = useState(0);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [inspectorSelectionOrigin, setInspectorSelectionOrigin] =
    useState<InspectorSelectionOrigin>("graph");
  const [focusedFlow, setFocusedFlow] = useState<FocusedFlowState | null>(null);
  const [inspectorFocusRequest, setInspectorFocusRequest] =
    useState<InspectorFocusRequest | null>(null);
  const [runtimeDebug, setRuntimeDebug] = useState<RuntimeDebugState | null>(null);
  const [scaffoldPreview, setScaffoldPreview] = useState<ScaffoldPreviewState>({
    requestId: null,
    patches: [],
    warnings: [],
    error: null,
  });
  const [scaffoldPreviewBusy, setScaffoldPreviewBusy] = useState(false);
  const [scaffoldApplyBusy, setScaffoldApplyBusy] = useState(false);
  const [scaffoldModalOpen, setScaffoldModalOpen] = useState(false);
  const [scaffoldTargetContext, setScaffoldTargetContext] = useState<ScaffoldTargetContext>({
    targetContext: "canvas",
    targetFilePath: null,
    targetFolderPath: null,
  });
  const [scaffoldPanelPosition, setScaffoldPanelPosition] =
    useState<ScaffoldPanelPosition>({ left: 24, top: 96 });
  const [scaffoldPanelSize, setScaffoldPanelSize] = useState<ScaffoldPanelSize>({
    width: SCAFFOLD_PANEL_DEFAULT_WIDTH,
    height: SCAFFOLD_PANEL_DEFAULT_HEIGHT,
  });
  const scaffoldPanelRef = useRef<HTMLDivElement | null>(null);
  const scaffoldPanelPositionRef = useRef<ScaffoldPanelPosition>({
    left: 24,
    top: 96,
  });
  const scaffoldPanelSizeRef = useRef<ScaffoldPanelSize>({
    width: SCAFFOLD_PANEL_DEFAULT_WIDTH,
    height: SCAFFOLD_PANEL_DEFAULT_HEIGHT,
  });
  const pendingScaffoldPanelLayoutRef = useRef<Partial<ScaffoldPanelLayout> | null>(
    null,
  );
  const scaffoldPanelRafRef = useRef<number | null>(null);
  const [isDraggingScaffoldPanel, setIsDraggingScaffoldPanel] = useState(false);
  const [isResizingScaffoldPanel, setIsResizingScaffoldPanel] = useState(false);
  const [scaffoldPanelInactive, setScaffoldPanelInactive] = useState(false);

  const [rootTarget, setRootTarget] = useState<GraphRootTarget>(null);

  // Inspector UI
  const LS_INSPECTOR_OPEN = "cg.inspector.open";
  const LS_INSPECTOR_WIDTH = "cg.inspector.width";
  const LS_INSPECTOR_HEIGHT = "cg.inspector.height";
  const LS_INSPECTOR_PLACEMENT = "cg.inspector.placement";
  const appRootRef = useRef<HTMLDivElement | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(LS_INSPECTOR_OPEN);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });
  const [inspectorWidth, setInspectorWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem(LS_INSPECTOR_WIDTH);
      const n = v ? Number(v) : 360;
      return Number.isFinite(n) ? Math.min(720, Math.max(260, n)) : 360;
    } catch {
      return 360;
    }
  });
  const [inspectorHeight, setInspectorHeight] = useState<number>(() => {
    try {
      const v = localStorage.getItem(LS_INSPECTOR_HEIGHT);
      const n = v ? Number(v) : 280;
      return Number.isFinite(n) ? Math.min(520, Math.max(180, n)) : 280;
    } catch {
      return 280;
    }
  });
  const [inspectorPlacement, setInspectorPlacement] =
    useState<InspectorPlacement>(() => {
      try {
        const v = localStorage.getItem(LS_INSPECTOR_PLACEMENT);
        return v === "left" || v === "right" || v === "bottom" ? v : "auto";
      } catch {
        return "auto";
      }
    });
  const [appWidth, setAppWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 1280;
    return window.innerWidth;
  });
  const [appHeight, setAppHeight] = useState<number>(() => {
    if (typeof window === "undefined") return 720;
    return window.innerHeight;
  });
  const [isResizingInspector, setIsResizingInspector] = useState(false);

  // Toast + export status
  const [toast, setToast] = useState<ToastState>({
    open: false,
    kind: "info",
    message: "",
  });
  const [canvasNotice, setCanvasNotice] = useState<UINotice | null>(null);
  const [inspectorNotice, setInspectorNotice] = useState<UINotice | null>(null);
  const [analysisLoading, setAnalysisLoading] =
    useState<AnalysisLoadingState | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "done">(
    "idle",
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);

  const postMessage = useCallback((
    origin: string,
    message: WebviewToExtMessage,
    detail?: Record<string, unknown>,
  ) => {
    pushWebviewDebugEvent(`webview.postMessage.${message.type}`, {
      origin,
      ...detail,
    });
    vscode.postMessage(message);
  }, []);

  const postOpenLocation = useCallback((
    origin: string,
    payload: OpenLocationPayload,
    detail?: Record<string, unknown>,
  ) => {
    if (!ENABLE_OPEN_LOCATION) {
      pushWebviewDebugEvent("openLocation.disabled", {
        origin,
        filePath: payload.filePath,
        preserveFocus: payload.preserveFocus ?? false,
        startLine: payload.range?.start.line ?? null,
        endLine: payload.range?.end.line ?? null,
        ...detail,
      });
      return;
    }

    postMessage(
      origin,
      {
        type: "openLocation",
        payload,
      },
      detail,
    );
  }, [postMessage]);

  const finishExport = () => {
    setExportStatus("done");
    window.setTimeout(() => setExportStatus("idle"), 900);
    setExportFormat(null);
  };

  const showToast = useCallback((kind: ToastKind, message: string, ms = 1800) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ open: true, kind, message });
    toastTimerRef.current = window.setTimeout(() => {
      setToast((t) => ({ ...t, open: false }));
      toastTimerRef.current = null;
    }, ms);
  }, []);

  const noticeSeverityToToastKind = (severity: NoticeSeverity): ToastKind => {
    if (severity === "warning") return "warning";
    if (severity === "error") return "error";
    return "info";
  };

  const applyNotice = useEffectEvent((notice: UINotice) => {
    if (
      notice.scope === "canvas" ||
      notice.source === "analyzeActiveFile" ||
      notice.source === "analyzeWorkspace" ||
      notice.source === "expandNode" ||
      notice.source === "auto-analysis"
    ) {
      setAnalysisLoading(null);
    }

    if (notice.scope === "toast") {
      const text = notice.detail
        ? `${notice.message}: ${notice.detail}`
        : notice.message;
      showToast(noticeSeverityToToastKind(notice.severity), text, 2600);
      return;
    }

    if (notice.scope === "canvas") {
      setCanvasNotice(notice);
      return;
    }

    setInspectorNotice(notice);
  });

  const handleFlowExportResult = useEffectEvent(
    (result: FlowExportResultPayload) => {
      if (result.ok) {
        finishExport();
        showToast("success", "Export complete", 1500);
        return;
      }

      setExportStatus("idle");
      setExportFormat(null);
      if (result.canceled) return;
      showToast("error", result.error || "Export failed");
    },
  );

  const handlePatchPreviewResult = useEffectEvent(
    (result: PatchPreviewResultPayload) => {
      setScaffoldPreviewBusy(false);
      if (!result.ok) {
        setScaffoldPreview({
          requestId: result.requestId,
          patches: [],
          warnings: result.warnings ?? [],
          error: result.error ?? "Patch preview failed",
        });
        showToast("error", result.error || "Patch preview failed");
        return;
      }

      setScaffoldPreview({
        requestId: result.requestId,
        patches: result.patches ?? [],
        warnings: result.warnings ?? [],
        error: null,
      });
      showToast("success", "Patch preview ready", 1200);
    },
  );

  const handlePatchApplyResult = useEffectEvent(
    (result: PatchApplyResultPayload) => {
      setScaffoldApplyBusy(false);
      if (!result.ok) {
        showToast("error", result.error || "Patch apply failed");
        return;
      }

      setScaffoldModalOpen(false);
      const appliedCount = result.appliedFiles?.length ?? 0;
      showToast(
        "success",
        appliedCount > 0
          ? `Applied ${appliedCount} scaffold patch${appliedCount > 1 ? "es" : ""}`
          : "Scaffold applied",
      );
    },
  );

  const getScaffoldAppRect = () => appRootRef.current?.getBoundingClientRect() ?? null;

  const flushScaffoldPanelLayout = useCallback(() => {
    const panel = scaffoldPanelRef.current;
    const pending = pendingScaffoldPanelLayoutRef.current;
    if (!panel || !pending) return;

    if (pending.left !== undefined) panel.style.left = `${pending.left}px`;
    if (pending.top !== undefined) panel.style.top = `${pending.top}px`;
    if (pending.width !== undefined) panel.style.width = `${pending.width}px`;
    if (pending.height !== undefined) panel.style.height = `${pending.height}px`;
    pendingScaffoldPanelLayoutRef.current = null;
  }, []);

  const scheduleScaffoldPanelLayout = useCallback((layout: Partial<ScaffoldPanelLayout>) => {
    pendingScaffoldPanelLayoutRef.current = {
      ...(pendingScaffoldPanelLayoutRef.current ?? {}),
      ...layout,
    };
    if (scaffoldPanelRafRef.current !== null) return;

    scaffoldPanelRafRef.current = window.requestAnimationFrame(() => {
      scaffoldPanelRafRef.current = null;
      flushScaffoldPanelLayout();
    });
  }, [flushScaffoldPanelLayout]);

  const openScaffoldPanelAt = useCallback((args: OpenScaffoldPanelArgs) => {
    const appRect = getScaffoldAppRect();
    const activeContextFilePath = activeFile ? uriToFsPath(activeFile.uri) : null;
    const workspaceRootPath = workspaceFiles?.rootPath ?? null;
    const resolvedTargetContext: ScaffoldContextKind = rootTarget?.kind ??
      args.targetContext ??
      "canvas";
    const resolvedTargetFilePath =
      rootTarget?.kind === "file"
        ? rootTarget.path
        : args.targetFilePath ?? activeContextFilePath;
    const resolvedTargetFolderPath = rootTarget?.kind === "folder"
      ? rootTarget.path
      : rootTarget?.kind === "file"
        ? dirName(rootTarget.path)
      : args.targetFolderPath ??
        (args.targetFilePath ? dirName(args.targetFilePath) : null) ??
        workspaceRootPath ??
        (activeContextFilePath ? dirName(activeContextFilePath) : null);

    setScaffoldTargetContext({
      targetContext: resolvedTargetContext,
      targetFilePath: resolvedTargetFilePath,
      targetFolderPath: resolvedTargetFolderPath,
    });
    setScaffoldPanelInactive(false);
    if (!appRect) {
      setScaffoldModalOpen(true);
      return;
    }

    const nextSize = clampScaffoldPanelSize({
      appRect,
      width: scaffoldPanelSizeRef.current.width,
      height: scaffoldPanelSizeRef.current.height,
    });
    setScaffoldPanelSize(nextSize);
    setScaffoldPanelPosition(
      placeScaffoldPanelAtPointer({
        appRect,
        clientX: args.clientX,
        clientY: args.clientY,
        panelWidth: nextSize.width,
        panelHeight: nextSize.height,
      }),
    );
    setScaffoldModalOpen(true);
  }, [activeFile, rootTarget, workspaceFiles]);

  const graphRef = useRef<GraphPayload | undefined>(undefined);
  const activeGraphGenerationRef = useRef(-1);
  const latestActiveSequenceRef = useRef(0);

  useEffect(() => {
    graphRef.current = graphState;
  }, [graphState]);

  useEffect(() => {
    pushWebviewDebugEvent("app.graphState.changed", {
      ...getGraphCounts(graphState),
      traceMode,
    });
  }, [graphState, traceMode]);

  useEffect(() => {
    pushWebviewDebugEvent("app.selectedNode.changed", {
      selectedNodeId,
      selectedNodeIds,
    });
  }, [selectedNodeId, selectedNodeIds]);

  useEffect(() => {
    const root = appRootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;

    const updateBounds = (nextWidth?: number, nextHeight?: number) => {
      const width = nextWidth ?? root.clientWidth;
      const height = nextHeight ?? root.clientHeight;
      if (width > 0) setAppWidth(width);
      if (height > 0) setAppHeight(height);
    };

    updateBounds();

    const observer = new ResizeObserver((entries) => {
      updateBounds(
        entries[0]?.contentRect.width,
        entries[0]?.contentRect.height,
      );
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isExtToWebviewMessage(event.data)) return;

      const msg = event.data;

      if (msg.type === "hostState") {
        const payload: HostStatePayload = msg.payload;
        setHostState(payload);
        return;
      }

      if (msg.type === "activeFile") {
        setActiveFile(msg.payload);
        return;
      }

      if (msg.type === "workspaceFiles") {
        setWorkspaceFiles(msg.payload);
        return;
      }

      if (msg.type === "selection") {
        setSelection(msg.payload);
        return;
      }

      if (msg.type === "uiNotice") {
        applyNotice(msg.payload);
        return;
      }

      if (msg.type === "flowExportResult") {
        handleFlowExportResult(msg.payload);
        return;
      }

      if (msg.type === "patchPreviewResult") {
        handlePatchPreviewResult(msg.payload);
        return;
      }

      if (msg.type === "patchApplyResult") {
        handlePatchApplyResult(msg.payload);
        return;
      }

      if (msg.type === "runtimeDebug") {
        setRuntimeDebug(msg.payload);
        return;
      }

      if (msg.type === "analysisResult") {
        const request: AnalysisRequest = msg.request;
        const payload = msg.payload;
        const diagnosticsNotice = payload?.diagnostics
          ? summarizeDiagnostics(payload.diagnostics)
          : null;

        pushWebviewDebugEvent("analysisResult.received", {
          lane: request.lane,
          reason: request.reason,
          requestId: request.requestId,
          generation: request.generation,
          sequence: request.sequence,
          ...getAnalysisPayloadCounts(payload),
        });

        if (request.lane === "active") {
          finishAnalysisLoading();
          if (request.sequence < latestActiveSequenceRef.current) {
            pushWebviewDebugEvent("analysisResult.dropped.active.stale", {
              requestId: request.requestId,
              generation: request.generation,
              sequence: request.sequence,
              latestAppliedSequence: latestActiveSequenceRef.current,
            });
            return;
          }

          latestActiveSequenceRef.current = request.sequence;
          activeGraphGenerationRef.current = request.generation;
          setAnalysis(payload);

          if (!payload) {
            pushWebviewDebugEvent("analysisResult.applied.active.empty", {
              requestId: request.requestId,
              generation: request.generation,
            });
            activeGraphGenerationRef.current = -1;
            setTraceEvents(null);
            setTraceCursor(0);
            setGraphState(undefined);
            expandedFilesRef.current.clear();
            clearSelectedNodes();
            setFocusedFlow(null);
            setInspectorFocusRequest(null);
            syncGraphRoot(null);
            setCanvasNotice(null);
            return;
          }

          const g = payload.graph;
          const trace = payload.trace;
          expandedFilesRef.current.clear();
          clearSelectedNodes();
          setFocusedFlow(null);
          setInspectorFocusRequest(null);

          if (trace && trace.length > 0) {
            pushWebviewDebugEvent("analysisResult.applied.active.trace", {
              requestId: request.requestId,
              generation: request.generation,
              traceEvents: trace.length,
              graphNodes: g?.nodes.length ?? 0,
              graphEdges: g?.edges.length ?? 0,
            });
            const maxEvents = 800;
            const events = trace.slice(0, maxEvents);
            setTraceEvents(events);
            setTraceCursor(0);
            setGraphState(undefined);
            setCanvasNotice(diagnosticsNotice);
            showToast("info", `Trace ready: 0 / ${events.length}`, 1500);
            return;
          }

          pushWebviewDebugEvent("analysisResult.applied.active.graph", {
            requestId: request.requestId,
            generation: request.generation,
            ...getGraphCounts(g),
          });
          setTraceEvents(null);
          setTraceCursor(0);
          setGraphState(g);
          setCanvasNotice(diagnosticsNotice);
          return;
        }

        finishAnalysisLoading();
        if (request.generation !== activeGraphGenerationRef.current) {
          pushWebviewDebugEvent("analysisResult.dropped.expand.stale", {
            requestId: request.requestId,
            generation: request.generation,
            activeGeneration: activeGraphGenerationRef.current,
          });
          return;
        }

        if (payload?.graph) {
          setGraphState((prev) => {
            const merged = mergeGraph(prev, payload.graph);
            pushWebviewDebugEvent("analysisResult.applied.expand.merge", {
              requestId: request.requestId,
              generation: request.generation,
              prevNodes: prev?.nodes.length ?? 0,
              prevEdges: prev?.edges.length ?? 0,
              nextNodes: payload.graph?.nodes.length ?? 0,
              nextEdges: payload.graph?.edges.length ?? 0,
              mergedNodes: merged?.nodes.length ?? 0,
              mergedEdges: merged?.edges.length ?? 0,
            });
            return merged;
          });
          setCanvasNotice(diagnosticsNotice);
        }
      }
    };

    window.addEventListener("message", onMessage);

    postMessage("app.mount", { type: "requestActiveFile" });
    postMessage("app.mount", { type: "requestWorkspaceFiles" });
    postMessage("app.mount", { type: "requestSelection" });
    postMessage("app.mount", { type: "requestHostState" });

    return () => window.removeEventListener("message", onMessage);
  }, []);

  // ✅ ESLint no-empty 해결: 빈 catch 제거
  useEffect(() => {
    try {
      localStorage.setItem(LS_INSPECTOR_OPEN, inspectorOpen ? "1" : "0");
    } catch (e) {
      void e;
    }
  }, [inspectorOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_INSPECTOR_WIDTH, String(inspectorWidth));
    } catch (e) {
      void e;
    }
  }, [inspectorWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_INSPECTOR_HEIGHT, String(inspectorHeight));
    } catch (e) {
      void e;
    }
  }, [inspectorHeight]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_INSPECTOR_PLACEMENT, inspectorPlacement);
    } catch (e) {
      void e;
    }
  }, [inspectorPlacement]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      // ✅ no-explicit-any 해결: any 제거
      const isTyping =
        tag === "input" || tag === "textarea" || Boolean(el?.isContentEditable);

      if (!isTyping && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        setInspectorOpen((v) => !v);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    scaffoldPanelPositionRef.current = scaffoldPanelPosition;
    scheduleScaffoldPanelLayout(scaffoldPanelPosition);
  }, [scaffoldPanelPosition, scheduleScaffoldPanelLayout]);

  useEffect(() => {
    scaffoldPanelSizeRef.current = scaffoldPanelSize;
    scheduleScaffoldPanelLayout(scaffoldPanelSize);
  }, [scaffoldPanelSize, scheduleScaffoldPanelLayout]);

  useEffect(() => {
    return () => {
      if (scaffoldPanelRafRef.current !== null) {
        window.cancelAnimationFrame(scaffoldPanelRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!scaffoldModalOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setScaffoldModalOpen(false);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (scaffoldPanelRef.current?.contains(target)) {
        setScaffoldPanelInactive(false);
        return;
      }
      setScaffoldPanelInactive(true);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [scaffoldModalOpen]);

  useEffect(() => {
    if (!scaffoldModalOpen) return;
    const appRect = getScaffoldAppRect();
    if (!appRect) return;

    const nextSize = clampScaffoldPanelSize({
      appRect,
      width: scaffoldPanelSize.width,
      height: scaffoldPanelSize.height,
      left: scaffoldPanelPosition.left,
      top: scaffoldPanelPosition.top,
    });
    const nextPosition = clampScaffoldPanelPosition({
      appRect,
      left: scaffoldPanelPosition.left,
      top: scaffoldPanelPosition.top,
      panelWidth: nextSize.width,
      panelHeight: nextSize.height,
    });

    if (
      nextSize.width !== scaffoldPanelSize.width ||
      nextSize.height !== scaffoldPanelSize.height
    ) {
      setScaffoldPanelSize(nextSize);
    }
    if (
      nextPosition.left !== scaffoldPanelPosition.left ||
      nextPosition.top !== scaffoldPanelPosition.top
    ) {
      setScaffoldPanelPosition(nextPosition);
    }
  }, [
    appHeight,
    appWidth,
    scaffoldModalOpen,
    scaffoldPanelPosition.left,
    scaffoldPanelPosition.top,
    scaffoldPanelSize.height,
    scaffoldPanelSize.width,
  ]);

  const clampInspectorWidth = (w: number) => Math.min(720, Math.max(260, w));
  const clampInspectorHeight = (h: number) => Math.min(520, Math.max(180, h));
  const effectiveInspectorPlacement: EffectiveInspectorPlacement =
    inspectorPlacement === "auto"
      ? appWidth <= 720
        ? "bottom"
        : "right"
      : inspectorPlacement;

  const beginResizeInspector = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!inspectorOpen) return;

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizingInspector(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = inspectorWidth;
    const startHeight = inspectorHeight;

    const onMove = (ev: PointerEvent) => {
      if (effectiveInspectorPlacement === "bottom") {
        const dy = startY - ev.clientY;
        setInspectorHeight(clampInspectorHeight(startHeight + dy));
        return;
      }

      const dx =
        effectiveInspectorPlacement === "left"
          ? ev.clientX - startX
          : startX - ev.clientX;
      setInspectorWidth(clampInspectorWidth(startWidth + dx));
    };

    const onUp = () => {
      setIsResizingInspector(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const beginDragScaffoldPanel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, select, a")) {
      return;
    }

    const appRect = getScaffoldAppRect();
    if (!appRect) return;

    e.preventDefault();
    setScaffoldPanelInactive(false);
    setIsDraggingScaffoldPanel(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = scaffoldPanelPositionRef.current.left;
    const startTop = scaffoldPanelPositionRef.current.top;
    const panelWidth = scaffoldPanelSizeRef.current.width;
    const panelHeight = scaffoldPanelSizeRef.current.height;

    const onMove = (ev: PointerEvent) => {
      const nextPosition = clampScaffoldPanelPosition({
        appRect,
        left: startLeft + (ev.clientX - startX),
        top: startTop + (ev.clientY - startY),
        panelWidth,
        panelHeight,
      });
      scaffoldPanelPositionRef.current = nextPosition;
      scheduleScaffoldPanelLayout(nextPosition);
    };

    const onUp = () => {
      setIsDraggingScaffoldPanel(false);
      setScaffoldPanelPosition((current) => {
        const next = scaffoldPanelPositionRef.current;
        if (current.left === next.left && current.top === next.top) {
          return current;
        }
        return next;
      });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const beginResizeScaffoldPanel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const appRect = getScaffoldAppRect();
    if (!appRect) return;

    e.preventDefault();
    e.stopPropagation();
    setScaffoldPanelInactive(false);
    setIsResizingScaffoldPanel(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = scaffoldPanelSizeRef.current.width;
    const startHeight = scaffoldPanelSizeRef.current.height;
    const panelLeft = scaffoldPanelPositionRef.current.left;
    const panelTop = scaffoldPanelPositionRef.current.top;

    const onMove = (ev: PointerEvent) => {
      const nextSize = clampScaffoldPanelSize({
        appRect,
        width: startWidth + (ev.clientX - startX),
        height: startHeight + (ev.clientY - startY),
        left: panelLeft,
        top: panelTop,
      });
      scaffoldPanelSizeRef.current = nextSize;
      scheduleScaffoldPanelLayout(nextSize);
    };

    const onUp = () => {
      setIsResizingScaffoldPanel(false);
      setScaffoldPanelSize((current) => {
        const next = scaffoldPanelSizeRef.current;
        if (current.width === next.width && current.height === next.height) {
          return current;
        }
        return next;
      });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const graph = graphState;
  const hasGraphData = Boolean(graph && graph.nodes.length > 0);
  const exportEnabled = hasGraphData && exportStatus !== "exporting";
  const traceFocusEvent =
    traceEvents && traceCursor > 0 ? traceEvents[traceCursor - 1] : null;
  const tracePreviewTarget = useMemo(
    () =>
      buildTracePreviewTarget(
        traceFocusEvent,
        graph,
        analysis?.graph,
        traceCursor,
        traceEvents?.length ?? 0,
      ),
    [analysis?.graph, graph, traceCursor, traceEvents, traceFocusEvent],
  );
  const traceFocusedFlow = useMemo<FlowPreviewState | null>(() => {
    if (!traceFocusEvent || traceFocusEvent.type !== "edge") return null;
    if (traceFocusEvent.edge.kind !== "dataflow") return null;
    return {
      edgeId: traceFocusEvent.edge.id,
      sourceId: traceFocusEvent.edge.source,
      targetId: traceFocusEvent.edge.target,
      origin: "trace",
    };
  }, [traceFocusEvent]);
  const effectiveFocusedFlow = traceFocusedFlow ?? (
    focusedFlow
      ? {
          ...focusedFlow,
          origin: "manual" as const,
        }
      : null
  );
  const highlightedNodeIds = useMemo(
    () =>
      effectiveFocusedFlow
        ? [effectiveFocusedFlow.sourceId, effectiveFocusedFlow.targetId]
        : [],
    [effectiveFocusedFlow],
  );
  const traceActiveNodeId =
    traceFocusEvent?.type === "node" ? traceFocusEvent.node.id : null;
  const runtimeActiveNode = useMemo(() => {
    if (!runtimeDebug || runtimeDebug.state !== "paused") return null;
    return findGraphNodeForRuntimeFrame(graph, runtimeDebug.frame);
  }, [graph, runtimeDebug]);
  const runtimeActiveNodeId = runtimeActiveNode?.id ?? null;
  const runtimeFocusKey = useMemo(() => {
    if (!runtimeDebug || runtimeDebug.state !== "paused" || !runtimeActiveNodeId) {
      return null;
    }

    const frame = runtimeDebug.frame;
    return [
      runtimeDebug.session?.id ?? "no-session",
      runtimeActiveNodeId,
      frame?.id ?? "no-frame",
      frame?.filePath ?? "no-file",
      frame?.line ?? "no-line",
      frame?.column ?? "no-column",
      runtimeDebug.reason ?? "paused",
    ].join("|");
  }, [runtimeActiveNodeId, runtimeDebug]);
  const runtimeFocusRequest = useMemo(() => {
    if (!runtimeFocusKey || !runtimeActiveNodeId) {
      return null;
    }
    return {
      nodeId: runtimeActiveNodeId,
      token: hashString(runtimeFocusKey),
    };
  }, [runtimeActiveNodeId, runtimeFocusKey]);

  const selectedNode: GraphNode | null = useMemo(() => {
    return findNodeById(graph, selectedNodeId);
  }, [graph, selectedNodeId]);

  const replaceSelectedNodes = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setSelectedNodeIds(nodeId ? [nodeId] : []);
  }, []);

  const clearSelectedNodes = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
  }, []);

  const toggleSelectedNode = useCallback((nodeId: string) => {
    setSelectedNodeIds((current) => {
      if (current.includes(nodeId)) {
        const next = current.filter((id) => id !== nodeId);
        setSelectedNodeId((currentPrimary) =>
          currentPrimary === nodeId ? (next[next.length - 1] ?? null) : currentPrimary,
        );
        return next;
      }

      setSelectedNodeId(nodeId);
      return [...current, nodeId];
    });
  }, []);

  const activeFilePath = activeFile ? uriToFsPath(activeFile.uri) : null;
  const rootFilePath = rootTarget?.kind === "file" ? rootTarget.path : null;
  const rootFolderPath = rootTarget?.kind === "folder" ? rootTarget.path : null;
  const graphFilePath = rootFilePath ?? activeFilePath;
  const workspaceRoot = workspaceFiles?.rootPath ?? null;
  const scaffoldTargetFilePath =
    rootFilePath ?? scaffoldTargetContext.targetFilePath ?? activeFilePath;
  const scaffoldTargetFolderPath = rootFolderPath
    ? rootFolderPath
    : rootFilePath
      ? dirName(rootFilePath)
    : scaffoldTargetContext.targetFolderPath ??
      workspaceRoot ??
      (scaffoldTargetFilePath ? dirName(scaffoldTargetFilePath) : null);
  const scaffoldTargetKind: ScaffoldContextKind = rootTarget?.kind ??
    scaffoldTargetContext.targetContext;
  const projectName = graphFilePath ? shortBaseName(graphFilePath) : "Select file";
  const exportBaseName =
    shortBaseName(graphFilePath ?? activeFile?.fileName ?? "cogic")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 64) || "cogic";

  const syncGraphRoot = useCallback((nextRoot: GraphRootTarget) => {
    setRootTarget(nextRoot);
    postMessage("app.graphRoot.sync", {
      type: "setGraphRoot",
      payload: { root: nextRoot },
    });
  }, [postMessage]);

  const beginAnalysisLoading = useCallback((message: string, detail?: string) => {
    setAnalysisLoading({ active: true, message, detail });
  }, []);

  const finishAnalysisLoading = useCallback(() => {
    setAnalysisLoading(null);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_GRAPH_DEPTH, String(graphDepth));
    } catch {
      // ignore persistence failures
    }

    postMessage("app.graphDepth.sync", {
      type: "setGraphDepth",
      payload: { graphDepth },
    });
  }, [graphDepth]);

  const resetGraph = useCallback(() => {
    pushWebviewDebugEvent("app.resetGraph", {
      ...getGraphCounts(graphRef.current),
      activeGeneration: activeGraphGenerationRef.current,
    });
    activeGraphGenerationRef.current = -1;
    setTraceEvents(null);
    setTraceCursor(0);
    setGraphState(undefined);
    expandedFilesRef.current.clear();
    clearSelectedNodes();
    setFocusedFlow(null);
    setInspectorFocusRequest(null);
    syncGraphRoot(null);
    setInspectorNotice(null);
  }, [clearSelectedNodes, syncGraphRoot]);

  const stepTraceTo = useCallback((nextCursor: number) => {
    if (!traceEvents || traceEvents.length === 0) return;
    const c = Math.max(0, Math.min(traceEvents.length, nextCursor));
    setTraceCursor(c);
    setGraphState(buildGraphFromTrace(traceEvents, c));
  }, [traceEvents]);

  const stepTracePrev = useCallback(() => stepTraceTo(traceCursor - 1), [stepTraceTo, traceCursor]);
  const stepTraceNext = useCallback(() => stepTraceTo(traceCursor + 1), [stepTraceTo, traceCursor]);
  const finishTraceMode = useCallback(() => {
    setTraceMode(false);
    setTraceEvents(null);
    setTraceCursor(0);
  }, []);
  const toggleTraceMode = useCallback(() => {
    setTraceMode((prev) => {
      const next = !prev;
      if (next) {
        resetGraph();
        beginAnalysisLoading(
          "Loading trace graph...",
          "Tracing the active file and preparing a step-by-step graph view.",
        );
        postMessage("trace.toggle.on", {
          type: "analyzeActiveFile",
          payload: { traceMode: true },
        });
      } else {
        setTraceEvents(null);
        setTraceCursor(0);
      }
      return next;
    });
  }, [beginAnalysisLoading, postMessage, resetGraph]);

  const expandExternalFile = useCallback((filePath: string) => {
    if (!filePath) {
      pushWebviewDebugEvent("expandNode.skipped.empty-file", {});
      return;
    }
    if (expandedFilesRef.current.has(filePath)) {
      pushWebviewDebugEvent("expandNode.skipped.already-expanded", {
        filePath,
        generation: activeGraphGenerationRef.current,
      });
      return;
    }
    expandedFilesRef.current.add(filePath);
    beginAnalysisLoading(
      `Expanding ${shortBaseName(filePath)}...`,
      "Analyzing the connected file and merging it into the current graph.",
    );
    postMessage("expandExternalFile", {
      type: "expandNode",
      payload: {
        filePath,
        generation:
          activeGraphGenerationRef.current >= 0
            ? activeGraphGenerationRef.current
            : undefined,
      },
    });
  }, [beginAnalysisLoading, postMessage]);

  useEffect(() => {
    if (!runtimeDebug || runtimeDebug.state !== "paused") return;
    if (runtimeActiveNodeId) return;
    if (activeGraphGenerationRef.current < 0) return;
    const filePath = runtimeDebug.frame?.filePath;
    if (!filePath) return;
    const hasAnyNodeInFile = Boolean(
      graph?.nodes.some(
        (node) => normalizeComparablePath(node.file) === normalizeComparablePath(filePath),
      ),
    );
    if (hasAnyNodeInFile) return;
    expandExternalFile(filePath);
  }, [graph, runtimeActiveNodeId, runtimeDebug]);

  const openDiagnostic = (diagnostic: CodeDiagnostic) => {
    if (!diagnostic.filePath) return;
    postOpenLocation(
      "inspector.openDiagnostic",
      {
        filePath: diagnostic.filePath,
        range: diagnostic.range,
        preserveFocus: false,
      },
      {
        filePath: diagnostic.filePath,
        code: diagnostic.code,
        severity: diagnostic.severity,
      },
    );
  };

  const handleCanvasSelectNode = useCallback(
    (nodeId: string, options?: { toggle?: boolean }) => {
      pushWebviewDebugEvent("canvas.selection.request", {
        nodeId,
        toggle: options?.toggle ?? false,
      });
      setFocusedFlow(null);
      setInspectorSelectionOrigin("graph");
      if (options?.toggle) {
        toggleSelectedNode(nodeId);
        return;
      }
      replaceSelectedNodes(nodeId);
    },
    [replaceSelectedNodes, toggleSelectedNode],
  );

  const handleCanvasClearSelection = useCallback(() => {
    pushWebviewDebugEvent("canvas.selection.clear", {});
    clearSelectedNodes();
    setInspectorSelectionOrigin("graph");
    setFocusedFlow(null);
  }, [clearSelectedNodes]);

  const handleCanvasOpenNode = useCallback((n: GraphNode) => {
    if (isNodeModulesPath(n.file)) {
      pushWebviewDebugEvent("canvas.onOpenNode.blocked.nodeModules", {
        ...getNodeDebugInfo(n),
      });
      showToast("info", "node_modules declaration files stay collapsed in the graph");
      return;
    }
    postOpenLocation(
      "canvas.onOpenNode",
      {
        filePath: n.file,
        range: n.range,
        preserveFocus: false,
      },
      getNodeDebugInfo(n),
    );
    if (n.kind === "external") {
      pushWebviewDebugEvent("canvas.external.expand-requested", {
        ...getNodeDebugInfo(n),
      });
    }
  }, [postOpenLocation, showToast]);

  const handleGenerateFromActive = useCallback(() => {
    beginAnalysisLoading(
      traceMode ? "Loading trace graph..." : "Rendering graph...",
      traceMode
        ? "Tracing the active file and preparing a step-by-step graph view."
        : `Analyzing ${shortBaseName(graphFilePath ?? activeFilePath ?? "the active file")} with ${describeDepth(graphDepth)}.`,
    );
    if (!traceMode && graphFilePath) {
      postMessage("canvas.emptyState.generate.rootFile", {
        type: "selectWorkspaceFile",
        payload: { filePath: graphFilePath, graphDepth },
      });
      return;
    }
    postMessage("canvas.emptyState.generate", {
      type: "analyzeActiveFile",
      payload: { traceMode, graphDepth },
    });
  }, [activeFilePath, beginAnalysisLoading, graphDepth, graphFilePath, postMessage, traceMode]);

  const handleUseSelectedFileAsRoot = useCallback(() => {
    if (!selectedNode?.file || selectedNode.kind !== "file") {
      return;
    }
    const nextRootFilePath = selectedNode.file;
    syncGraphRoot({ kind: "file", path: nextRootFilePath });
    setInspectorNotice(null);
    if (normalizeComparablePath(nextRootFilePath) === normalizeComparablePath(graphFilePath ?? "")) {
      return;
    }
    activeGraphGenerationRef.current = -1;
    setTraceEvents(null);
    setTraceCursor(0);
    setGraphState(undefined);
    expandedFilesRef.current.clear();
    clearSelectedNodes();
    setFocusedFlow(null);
    setInspectorFocusRequest(null);
    beginAnalysisLoading(
      `Locking graph to ${shortBaseName(nextRootFilePath)}...`,
      `Rebuilding the graph with ${describeDepth(graphDepth)}.`,
    );
    postMessage("canvas.useSelectedFileAsRoot", {
      type: "selectWorkspaceFile",
      payload: { filePath: nextRootFilePath, graphDepth },
    });
  }, [
    beginAnalysisLoading,
    clearSelectedNodes,
    graphDepth,
    graphFilePath,
    postMessage,
    selectedNode,
    syncGraphRoot,
  ]);

  const handleUseSelectedFolderAsRoot = useCallback((folderPath: string) => {
    if (!folderPath) {
      return;
    }
    syncGraphRoot({ kind: "folder", path: folderPath });
    setInspectorNotice(null);
    if (activeFilePath && normalizeComparablePath(dirName(activeFilePath)) === normalizeComparablePath(folderPath)) {
      resetGraph();
      beginAnalysisLoading(
        `Locking graph to ${shortBaseName(folderPath)}...`,
        `Rebuilding the graph with ${describeDepth(graphDepth)}.`,
      );
      postMessage("canvas.useSelectedFolderAsRoot", {
        type: "analyzeActiveFile",
        payload: { traceMode: false, graphDepth },
      });
    }
  }, [activeFilePath, beginAnalysisLoading, graphDepth, postMessage, resetGraph, syncGraphRoot]);

  const handleClearRoot = useCallback(() => {
    syncGraphRoot(null);
    setInspectorNotice(null);
  }, [syncGraphRoot]);

  const activateGraphNode = (
    nodeId: string,
    origin: InspectorSelectionOrigin = "graph",
  ) => {
    setFocusedFlow(null);
    replaceSelectedNodes(nodeId);
    setInspectorSelectionOrigin(origin);
    setInspectorFocusRequest({ nodeId, token: Date.now() });
    const targetNode = findNodeById(graph, nodeId);
    pushWebviewDebugEvent("inspector.node.activate", {
      requestedNodeId: nodeId,
      ...getNodeDebugInfo(targetNode),
      ...getGraphCounts(graph),
    });
    if (!targetNode) return;
    postOpenLocation(
      "inspector.node.activate",
      {
        filePath: targetNode.file,
        range: targetNode.range,
        preserveFocus: false,
      },
      getNodeDebugInfo(targetNode),
    );
  };

  const selectGraphNodeFromInspector = (
    nodeId: string,
    origin: InspectorSelectionOrigin = "graph",
  ) => {
    const targetNode = findNodeById(graph, nodeId);
    pushWebviewDebugEvent("inspector.node.select", {
      requestedNodeId: nodeId,
      ...getNodeDebugInfo(targetNode),
      ...getGraphCounts(graph),
    });
    replaceSelectedNodes(nodeId);
    setInspectorSelectionOrigin(origin);
  };

  const focusParamFlow = (flow: FocusedFlowState) => {
    pushWebviewDebugEvent("inspector.paramFlow.focus", {
      edgeId: flow.edgeId,
      sourceId: flow.sourceId,
      targetId: flow.targetId,
    });
    setFocusedFlow(flow);
  };

  const requestScaffoldPreview = (payload: {
    design: DesignGraph;
    workspaceRoot: string | null;
  }) => {
    setScaffoldPreviewBusy(true);
    setScaffoldPreview((current) => ({
      ...current,
      error: null,
    }));
    postMessage("scaffold.preview", {
      type: "requestPatchPreview",
      payload: {
        design: payload.design,
        options: {
          workspaceRoot: payload.workspaceRoot,
        },
      },
    });
  };

  const applyScaffoldPreview = (
    requestId: string,
    selectedPatchIds: string[],
    editedPatches: Array<{ patchId: string; content: string }>,
  ) => {
    setScaffoldApplyBusy(true);
    postMessage("scaffold.apply", {
      type: "applyPatchPreview",
      payload: {
        requestId,
        selectedPatchIds,
        editedPatches,
      },
    });
  };

  const buildFlowExportPayload = () => {
    const graphPrimaryFilePath = getPrimaryGraphFilePath(graph);
    const exportFilePath =
      rootFilePath ?? graphPrimaryFilePath ?? (activeFile ? uriToFsPath(activeFile.uri) : null);
    const exportActiveFile =
      exportFilePath
        ? {
            uri: fsPathToUri(exportFilePath),
            fileName: shortBaseName(exportFilePath),
            languageId:
              activeFile && uriToFsPath(activeFile.uri) === exportFilePath
                ? activeFile.languageId
                : inferLanguageIdFromPath(exportFilePath),
          }
        : null;

    return {
      schema: "codegraph.flow.v1",
      exportedAt: new Date().toISOString(),
      ui: {
        activeFilter: activeChip,
        graphDepth,
        searchQuery,
        rootTarget,
        selectedNodeId,
        selectedNodeIds,
        inspector: {
          open: inspectorOpen,
          placement: inspectorPlacement,
          effectivePlacement: effectiveInspectorPlacement,
          width: inspectorWidth,
          height: inspectorHeight,
        },
      },
      activeFile: exportActiveFile,
      analysisMeta: analysis?.meta ?? null,
      graph,
    };
  };

  const saveExportText = (
    suggestedFileName: string,
    text: string,
    title: string,
    saveLabel: string,
    filters: Record<string, string[]>,
  ) => {
    if (isHostedInVSCode()) {
      vscode.postMessage({
        type: "saveExportFile",
        payload: {
          suggestedFileName,
          content: { kind: "text", text },
          title,
          saveLabel,
          filters,
        },
      });
      return;
    }

    downloadText(suggestedFileName, text, "application/json;charset=utf-8");
    finishExport();
    showToast("success", "Export complete", 1500);
  };

  const saveExportDataUrl = (
    suggestedFileName: string,
    dataUrl: string,
    title: string,
    saveLabel: string,
    filters: Record<string, string[]>,
  ) => {
    if (isHostedInVSCode()) {
      vscode.postMessage({
        type: "saveExportFile",
        payload: {
          suggestedFileName,
          content: { kind: "base64", base64: dataUrlToBase64(dataUrl) },
          title,
          saveLabel,
          filters,
        },
      });
      return;
    }

    downloadDataUrl(suggestedFileName, dataUrl);
    finishExport();
    showToast("success", "Export complete", 1500);
  };

  const exportGraphAsJson = async () => {
    if (!hasGraphData || !graph) {
      showToast("info", "No graph to export");
      return;
    }
    if (exportStatus === "exporting") return;

    try {
      setExportStatus("exporting");
      setExportFormat("json");
      showToast("info", "Preparing JSON export...", 1200);

      await new Promise((r) => setTimeout(r, 0));

      const exportedAt = new Date().toISOString().replace(/[:.]/g, "-");
      const suggestedFileName = `${exportBaseName}.flow.${exportedAt}.json`;
      const text = JSON.stringify(buildFlowExportPayload(), null, 2);

      saveExportText(
        suggestedFileName,
        text,
        "Save Cogic JSON Export",
        "Save JSON Export",
        { "JSON Files": ["json"] },
      );
    } catch {
      setExportStatus("idle");
      setExportFormat(null);
      showToast("error", "JSON export failed");
    }
  };

  const exportGraphAsJpg = async () => {
    if (!hasGraphData) {
      showToast("info", "No graph to export");
      return;
    }
    if (exportStatus === "exporting") return;

    try {
      setExportStatus("exporting");
      setExportFormat("jpg");
      showToast("info", "Preparing JPG snapshot...", 1200);

      await new Promise((r) => setTimeout(r, 0));

      const canvasRoot = appRootRef.current?.querySelector(
        ".canvasFlow .react-flow",
      ) as HTMLElement | null;
      if (!canvasRoot) {
        throw new Error("Graph canvas is not ready");
      }

      const dataUrl = await toJpeg(canvasRoot, {
        cacheBust: true,
        pixelRatio: 2,
        quality: 0.94,
        backgroundColor: "#081226",
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;
          return !(
            node.classList.contains("canvasControls") ||
            node.classList.contains("selectionBanner") ||
            node.classList.contains("rootBanner") ||
            node.classList.contains("canvasNotice")
          );
        },
      });

      const exportedAt = new Date().toISOString().replace(/[:.]/g, "-");
      const suggestedFileName = `${exportBaseName}.flow.${exportedAt}.jpg`;

      saveExportDataUrl(
        suggestedFileName,
        dataUrl,
        "Save Cogic JPG Export",
        "Save JPG Export",
        { "JPEG Images": ["jpg", "jpeg"] },
      );
    } catch {
      setExportStatus("idle");
      setExportFormat(null);
      showToast("error", "JPG export failed");
    }
  };

  useEffect(() => {
    if (!traceEvents || !tracePreviewTarget) return;

    postOpenLocation(
      "trace.preview",
      {
        filePath: tracePreviewTarget.filePath,
        range: tracePreviewTarget.range,
        preserveFocus: true,
      },
      {
        requestId: tracePreviewTarget.requestId,
        filePath: tracePreviewTarget.filePath,
        title: tracePreviewTarget.title,
      },
    );
  }, [traceEvents, tracePreviewTarget]);

  return (
    <div className="appRoot" ref={appRootRef}>
      <Topbar
        projectName={projectName}
        workspaceRootName={workspaceFiles?.rootName ?? null}
        workspaceFiles={workspaceFiles?.files ?? []}
        activeFilePath={graphFilePath}
        onPickFile={(filePath) => {
          resetGraph();
          syncGraphRoot({ kind: "file", path: filePath });
          beginAnalysisLoading(
            `Loading ${shortBaseName(filePath)}...`,
            `Building the graph with ${describeDepth(graphDepth)}.`,
          );
          postMessage("topbar.pickFile", {
            type: "selectWorkspaceFile",
            payload: { filePath, graphDepth },
          });
        }}
        graphDepth={graphDepth}
        onGraphDepthChange={(nextDepth) => {
          const normalized = clampGraphDepth(nextDepth);
          if (normalized === graphDepth) {return;}
          setGraphDepth(normalized);
          if (traceMode) {return;}
          resetGraph();
          if (graphFilePath) {
            syncGraphRoot({ kind: "file", path: graphFilePath });
          }
          beginAnalysisLoading(
            "Rebuilding graph...",
            `Updating the view for ${describeDepth(normalized)}.`,
          );
          if (graphFilePath) {
            postMessage("topbar.graphDepth.change.rootFile", {
              type: "selectWorkspaceFile",
              payload: { filePath: graphFilePath, graphDepth: normalized },
            });
            return;
          }
          if (!activeFilePath) {return;}
          postMessage("topbar.graphDepth.change", {
            type: "analyzeActiveFile",
            payload: { traceMode: false, graphDepth: normalized },
          });
        }}
        onRefresh={() => {
          postMessage("topbar.refresh", { type: "requestActiveFile" });
          postMessage("topbar.refresh", { type: "requestWorkspaceFiles" });
          postMessage("topbar.refresh", { type: "requestSelection" });
        }}
        onGenerate={() => {
          resetGraph();
          if (!traceMode && graphFilePath) {
            syncGraphRoot({ kind: "file", path: graphFilePath });
          }
          beginAnalysisLoading(
            traceMode ? "Loading trace graph..." : "Rendering graph...",
            traceMode
              ? "Tracing the active file and preparing a step-by-step graph view."
              : `Analyzing ${shortBaseName(graphFilePath ?? activeFilePath ?? "the active file")} with ${describeDepth(graphDepth)}.`,
          );
          if (!traceMode && graphFilePath) {
            postMessage("topbar.generate.rootFile", {
              type: "selectWorkspaceFile",
              payload: { filePath: graphFilePath, graphDepth },
            });
            return;
          }
          postMessage("topbar.generate", {
            type: "analyzeActiveFile",
            payload: { traceMode, graphDepth },
          });
        }}
        onAutoLayout={() => setAutoLayoutTick((v) => v + 1)}
        traceMode={traceMode}
        onToggleTraceMode={toggleTraceMode}
        onExportJson={exportGraphAsJson}
        onExportJpg={exportGraphAsJpg}
        exportEnabled={exportEnabled}
        exportStatus={exportStatus}
        exportFormat={exportFormat}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      />

      <FiltersBar active={activeChip} onChange={setActiveChip} />

      <div
        className={[
          "main",
          `main--placement-${inspectorPlacement}`,
          `main--effective-${effectiveInspectorPlacement}`,
        ].join(" ")}
      >
        <CanvasPane
          graph={graph}
          hasData={hasGraphData}
          activeFilePath={graphFilePath}
          activeFilter={activeChip}
          searchQuery={searchQuery}
          rootTarget={rootTarget}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          onSelectNode={handleCanvasSelectNode}
          onClearSelection={handleCanvasClearSelection}
          onOpenNode={handleCanvasOpenNode}
          onGenerateFromActive={handleGenerateFromActive}
          onUseSelectedFileAsRoot={handleUseSelectedFileAsRoot}
          onUseSelectedFolderAsRoot={handleUseSelectedFolderAsRoot}
          onClearRoot={handleClearRoot}
          onExpandExternal={expandExternalFile}
          analysisDiagnostics={analysis?.diagnostics ?? []}
          highlightedNodeIds={highlightedNodeIds}
          highlightedEdgeId={effectiveFocusedFlow?.edgeId ?? null}
          traceActiveNodeId={traceActiveNodeId}
          runtimeActiveNodeId={runtimeActiveNodeId}
          runtimeFocusRequest={runtimeFocusRequest}
          inspectorFocusRequest={inspectorFocusRequest}
          notice={canvasNotice}
          traceVisible={Boolean(traceEvents && traceEvents.length > 0)}
          traceCursor={traceCursor}
          traceTotal={traceEvents?.length ?? 0}
          traceFocusEvent={traceFocusEvent}
          onTracePrev={stepTracePrev}
          onTraceNext={stepTraceNext}
          onTraceFinish={finishTraceMode}
          loadingState={analysisLoading}
          autoLayoutTick={autoLayoutTick}
          workspaceRoot={workspaceRoot}
          onOpenScaffoldModal={openScaffoldPanelAt}
        />

        {inspectorOpen ? (
          <div
            className={
              [
                "inspectorResizer",
                `inspectorResizer--${effectiveInspectorPlacement}`,
                isResizingInspector ? "isDragging" : "",
              ].join(" ").trim()
            }
            onPointerDown={beginResizeInspector}
            role="separator"
            aria-orientation={
              effectiveInspectorPlacement === "bottom" ? "horizontal" : "vertical"
            }
            aria-label="Resize Inspector"
          />
        ) : null}

        <Inspector
          collapsed={!inspectorOpen}
          hostMode={hostState.currentHost}
          sidebarLocation={hostState.sidebarLocation}
          placement={inspectorPlacement}
          effectivePlacement={effectiveInspectorPlacement}
          width={inspectorWidth}
          height={inspectorHeight}
          onPlacementChange={setInspectorPlacement}
          onHostModeChange={(target, sidebarLocation) => {
            postMessage("inspector.hostMode.change", {
              type: "switchHost",
              payload: { target, sidebarLocation },
            });
          }}
          onToggleCollapsed={() => setInspectorOpen((v) => !v)}
          activeFile={activeFile}
          selection={selection}
          analysis={analysis}
          graph={graph}
          selectedNode={selectedNode}
          runtimeDebug={runtimeDebug}
          runtimeActiveNode={runtimeActiveNode}
          notice={inspectorNotice}
          onOpenDiagnostic={openDiagnostic}
          onSelectGraphNode={selectGraphNodeFromInspector}
          onActivateGraphNode={activateGraphNode}
          inspectorSelectionOrigin={inspectorSelectionOrigin}
          onFocusParamFlow={focusParamFlow}
          activeFlowPreview={effectiveFocusedFlow}
          onRefreshActive={() =>
            postMessage("inspector.refreshActive", { type: "requestActiveFile" })
          }
          onResetGraph={resetGraph}
          onExpandExternal={expandExternalFile}
          rootTarget={rootTarget}
          onClearRoot={handleClearRoot}
        />
      </div>

      {scaffoldModalOpen ? (
        <div
          ref={scaffoldPanelRef}
          className={[
            "scaffoldFloatingPanel",
            isDraggingScaffoldPanel ? "isDragging" : "",
            isResizingScaffoldPanel ? "isResizing" : "",
            scaffoldPanelInactive ? "isInactive" : "",
          ]
            .join(" ")
            .trim()}
          style={{
            left: scaffoldPanelPosition.left,
            top: scaffoldPanelPosition.top,
            width: scaffoldPanelSize.width,
            height: scaffoldPanelSize.height,
          }}
          role="dialog"
          aria-modal="false"
          aria-label="Scaffold Lab"
          onPointerDownCapture={() => setScaffoldPanelInactive(false)}
          onFocusCapture={() => setScaffoldPanelInactive(false)}
        >
          <div
            className="scaffoldFloatingHeader inspectorHeader"
            onPointerDown={beginDragScaffoldPanel}
          >
            <div>
              <h1>Scaffold Lab</h1>
              <p>STRUCTURE GENERATOR</p>
            </div>
            <div className="inspectorHeaderActions">
              <button
                className="iconBtn subtle"
                type="button"
                onClick={() => setScaffoldModalOpen(false)}
                aria-label="Close Scaffold Lab"
                title="Close"
              >
                x
              </button>
            </div>
          </div>

          <div className="scaffoldFloatingBody">
            <ScaffoldLab
              targetContext={scaffoldTargetKind}
              targetFilePath={scaffoldTargetFilePath}
              targetFolderPath={scaffoldTargetFolderPath}
              workspaceRoot={workspaceRoot}
              previewState={scaffoldPreview}
              isPreviewBusy={scaffoldPreviewBusy}
              isApplyBusy={scaffoldApplyBusy}
              onRequestPreview={requestScaffoldPreview}
              onApplyPreview={applyScaffoldPreview}
            />
          </div>
          <div
            className="scaffoldResizeHandle"
            onPointerDown={beginResizeScaffoldPanel}
            role="presentation"
            aria-hidden="true"
          />
        </div>
      ) : null}

      {toast.open ? (
        <div className={`cgToast cgToast--${toast.kind}`}>{toast.message}</div>
      ) : null}
    </div>
  );
}
