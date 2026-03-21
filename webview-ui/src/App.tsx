import {
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
import {
  getVSCodeApi,
  isExtToWebviewMessage,
  type ExtToWebviewMessage,
  type CodeDiagnostic,
  type GraphNode,
  type GraphPayload,
  type GraphTraceEvent,
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
type NoticeSeverity = UINotice["severity"];
type OpenLocationPayload = Extract<
  WebviewToExtMessage,
  { type: "openLocation" }
>["payload"];

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
function uriToFsPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  let p = decodeURIComponent(uri.replace("file://", ""));
  if (p.match(/^\/[A-Za-z]:\//)) p = p.slice(1); // windows /C:/...
  return p;
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

/** Pick the most specific node that contains selection.start (same file, smallest range). */
function pickRootNodeFromSelection(
  graph: GraphPayload,
  selection: NonNullable<SelectionPayload>,
): string | null {
  const selFile = normalizePath(uriToFsPath(selection.uri));
  const pos = selection.start;

  let best: GraphNode | null = null;
  let bestSize = Number.POSITIVE_INFINITY;

  for (const n of graph.nodes) {
    const nFile = normalizePath(n.file);
    if (nFile !== selFile && !nFile.endsWith(selFile)) continue;

    const start = n.range?.start;
    const end = n.range?.end;
    if (!start || !end) continue;

    if (!inRange(pos, start, end)) continue;

    const size =
      (end.line - start.line) * 1_000_000 + (end.character - start.character);
    if (size < bestSize) {
      best = n;
      bestSize = size;
    }
  }

  return best?.id ?? null;
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

function isHostedInVSCode() {
  return typeof window.acquireVsCodeApi === "function";
}

type ToastKind = "info" | "success" | "warning" | "error";
type ToastState = { open: boolean; kind: ToastKind; message: string };
type InspectorPlacement = "auto" | "right" | "bottom";
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

export default function App() {
  const [activeFile, setActiveFile] = useState<ActiveFilePayload>(null);
  const [workspaceFiles, setWorkspaceFiles] =
    useState<WorkspaceFilesPayload | null>(null);
  const [selection, setSelection] = useState<SelectionPayload>(null);
  const [analysis, setAnalysis] = useState<AnalysisPayload>(null);

  const [graphState, setGraphState] = useState<GraphPayload | undefined>(
    undefined,
  );

  const expandedFilesRef = useRef<Set<string>>(new Set());

  const [activeChip, setActiveChip] = useState<ChipKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [traceMode, setTraceMode] = useState(false);
  const [traceEvents, setTraceEvents] = useState<GraphTraceEvent[] | null>(null);
  const [traceCursor, setTraceCursor] = useState(0);
  const [autoLayoutTick, setAutoLayoutTick] = useState(0);
  const [frameGraphTick, setFrameGraphTick] = useState(0);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusedFlow, setFocusedFlow] = useState<FocusedFlowState | null>(null);
  const [inspectorFocusRequest, setInspectorFocusRequest] =
    useState<InspectorFocusRequest | null>(null);

  const [pendingUseSelectionAsRoot, setPendingUseSelectionAsRoot] =
    useState(false);
  const [rootNodeId, setRootNodeId] = useState<string | null>(null);

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
        return v === "right" || v === "bottom" ? v : "auto";
      } catch {
        return "auto";
      }
    });
  const [appWidth, setAppWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 1280;
    return window.innerWidth;
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
  const toastTimerRef = useRef<number | null>(null);

  const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "done">(
    "idle",
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);

  const postMessage = (
    origin: string,
    message: WebviewToExtMessage,
    detail?: Record<string, unknown>,
  ) => {
    pushWebviewDebugEvent(`webview.postMessage.${message.type}`, {
      origin,
      ...detail,
    });
    vscode.postMessage(message);
  };

  const postOpenLocation = (
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
  };

  const finishExport = () => {
    setExportStatus("done");
    window.setTimeout(() => setExportStatus("idle"), 900);
    setExportFormat(null);
  };

  const showToast = (kind: ToastKind, message: string, ms = 1800) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ open: true, kind, message });
    toastTimerRef.current = window.setTimeout(() => {
      setToast((t) => ({ ...t, open: false }));
      toastTimerRef.current = null;
    }, ms);
  };

  const noticeSeverityToToastKind = (severity: NoticeSeverity): ToastKind => {
    if (severity === "warning") return "warning";
    if (severity === "error") return "error";
    return "info";
  };

  const applyNotice = useEffectEvent((notice: UINotice) => {
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

  // Keep latest values for selection-root logic
  const pendingRootRef = useRef(false);
  const graphRef = useRef<GraphPayload | undefined>(undefined);
  const activeGraphGenerationRef = useRef(-1);
  const latestActiveSequenceRef = useRef(0);

  useEffect(() => {
    pendingRootRef.current = pendingUseSelectionAsRoot;
  }, [pendingUseSelectionAsRoot]);

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
    });
  }, [selectedNodeId]);

  useEffect(() => {
    const root = appRootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;

    const updateWidth = (nextWidth?: number) => {
      const width = nextWidth ?? root.clientWidth;
      if (width > 0) setAppWidth(width);
    };

    updateWidth();

    const observer = new ResizeObserver((entries) => {
      updateWidth(entries[0]?.contentRect.width);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isExtToWebviewMessage(event.data)) return;

      const msg = event.data;

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

        const pending = pendingRootRef.current;
        const g = graphRef.current;

        if (pending && msg.payload && g) {
          const nextRootId = pickRootNodeFromSelection(g, msg.payload);
          setRootNodeId(nextRootId);
          if (nextRootId) {
            setInspectorNotice(null);
          } else {
            setInspectorNotice({
              id: `root-${Date.now()}`,
              scope: "inspector",
              severity: "warning",
              message: "Could not derive a root from the current selection",
              detail: "Try selecting inside a function, method, or class body.",
              source: "selection-root",
            });
          }
        } else if (pending && !msg.payload) {
          setInspectorNotice({
            id: `selection-${Date.now()}`,
            scope: "inspector",
            severity: "warning",
            message: "Selection is not available",
            detail: "Focus a code editor and try selecting a symbol again.",
            source: "selection-root",
          });
        }

        if (pending) {
          pendingRootRef.current = false;
          setPendingUseSelectionAsRoot(false);
        }
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
            setSelectedNodeId(null);
            setFocusedFlow(null);
            setInspectorFocusRequest(null);
            setRootNodeId(null);
            setCanvasNotice(null);
            return;
          }

          const g = payload.graph;
          const trace = payload.trace;
          expandedFilesRef.current.clear();
          setSelectedNodeId(null);
          setFocusedFlow(null);
          setInspectorFocusRequest(null);
          setRootNodeId(null);

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

      const dx = startX - ev.clientX;
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
  const traceActiveNodeId =
    traceFocusEvent?.type === "node" ? traceFocusEvent.node.id : null;

  const selectedNode: GraphNode | null = useMemo(() => {
    return findNodeById(graph, selectedNodeId);
  }, [graph, selectedNodeId]);

  const projectName = activeFile?.fileName ? activeFile.fileName : "Select file";
  const exportBaseName =
    activeFile?.fileName?.replace(/[^\w.-]+/g, "_")?.slice(0, 64) || "codegraph";

  const resetGraph = () => {
    pushWebviewDebugEvent("app.resetGraph", {
      ...getGraphCounts(graphRef.current),
      activeGeneration: activeGraphGenerationRef.current,
    });
    activeGraphGenerationRef.current = -1;
    setTraceEvents(null);
    setTraceCursor(0);
    setGraphState(undefined);
    expandedFilesRef.current.clear();
    setSelectedNodeId(null);
    setFocusedFlow(null);
    setInspectorFocusRequest(null);
    setRootNodeId(null);
    setInspectorNotice(null);
  };

  const stepTraceTo = (nextCursor: number) => {
    if (!traceEvents || traceEvents.length === 0) return;
    const c = Math.max(0, Math.min(traceEvents.length, nextCursor));
    setTraceCursor(c);
    setGraphState(buildGraphFromTrace(traceEvents, c));
  };

  const stepTracePrev = () => stepTraceTo(traceCursor - 1);
  const stepTraceNext = () => stepTraceTo(traceCursor + 1);
  const finishTraceMode = () => {
    setTraceMode(false);
    setTraceEvents(null);
    setTraceCursor(0);
  };
  const toggleTraceMode = () => {
    setTraceMode((prev) => {
      const next = !prev;
      if (next) {
        resetGraph();
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
  };

  const expandExternalFile = (filePath: string) => {
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
  };

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

  const activateGraphNode = (nodeId: string) => {
    setFocusedFlow(null);
    setSelectedNodeId(nodeId);
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

  const selectGraphNodeFromInspector = (nodeId: string) => {
    const targetNode = findNodeById(graph, nodeId);
    pushWebviewDebugEvent("inspector.node.select", {
      requestedNodeId: nodeId,
      ...getNodeDebugInfo(targetNode),
      ...getGraphCounts(graph),
    });
    setSelectedNodeId(nodeId);
  };

  const focusParamFlow = (flow: FocusedFlowState) => {
    pushWebviewDebugEvent("inspector.paramFlow.focus", {
      edgeId: flow.edgeId,
      sourceId: flow.sourceId,
      targetId: flow.targetId,
    });
    setFocusedFlow(flow);
  };

  const buildFlowExportPayload = () => ({
    schema: "codegraph.flow.v1",
    exportedAt: new Date().toISOString(),
    ui: {
      activeFilter: activeChip,
      searchQuery,
      rootNodeId,
      selectedNodeId,
      inspector: {
        open: inspectorOpen,
        placement: inspectorPlacement,
        effectivePlacement: effectiveInspectorPlacement,
        width: inspectorWidth,
        height: inspectorHeight,
      },
    },
    activeFile: activeFile
      ? {
          uri: activeFile.uri,
          fileName: activeFile.fileName,
          languageId: activeFile.languageId,
        }
      : null,
    analysisMeta: analysis?.meta ?? null,
    graph,
  });

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
        "Save CodeGraph JSON Export",
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
        "Save CodeGraph JPG Export",
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
        activeFilePath={activeFile ? uriToFsPath(activeFile.uri) : null}
        onPickFile={(filePath) => {
          resetGraph();
          postMessage("topbar.pickFile", {
            type: "selectWorkspaceFile",
            payload: { filePath },
          });
        }}
        onRefresh={() => {
          postMessage("topbar.refresh", { type: "requestActiveFile" });
          postMessage("topbar.refresh", { type: "requestWorkspaceFiles" });
          postMessage("topbar.refresh", { type: "requestSelection" });
        }}
        onGenerate={() => {
          resetGraph();
          postMessage("topbar.generate", {
            type: "analyzeActiveFile",
            payload: { traceMode },
          });
        }}
        onAutoLayout={() => setAutoLayoutTick((v) => v + 1)}
        onFitGraph={() => setFrameGraphTick((v) => v + 1)}
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
          activeFilter={activeChip}
          searchQuery={searchQuery}
          rootNodeId={rootNodeId}
          selectedNodeId={selectedNodeId}
          onSelectNode={(nodeId) => {
            pushWebviewDebugEvent("canvas.selection.request", {
              nodeId,
            });
            setFocusedFlow(null);
            setSelectedNodeId(nodeId);
          }}
          onClearSelection={() => {
            pushWebviewDebugEvent("canvas.selection.clear", {});
            setSelectedNodeId(null);
            setFocusedFlow(null);
          }}
          onOpenNode={(n) => {
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
          }}
          onGenerateFromActive={() =>
            postMessage("canvas.emptyState.generate", {
              type: "analyzeActiveFile",
              payload: { traceMode },
            })
          }
          onUseSelectionAsRoot={() => {
            setPendingUseSelectionAsRoot(true);
            postMessage("canvas.useSelectionAsRoot", { type: "requestSelection" });
          }}
          onClearRoot={() => {
            setRootNodeId(null);
            setInspectorNotice(null);
          }}
          onExpandExternal={expandExternalFile}
          analysisDiagnostics={analysis?.diagnostics ?? []}
          highlightedNodeIds={
            effectiveFocusedFlow
              ? [effectiveFocusedFlow.sourceId, effectiveFocusedFlow.targetId]
              : []
          }
          highlightedEdgeId={effectiveFocusedFlow?.edgeId ?? null}
          traceActiveNodeId={traceActiveNodeId}
          inspectorFocusRequest={inspectorFocusRequest}
          notice={canvasNotice}
          traceVisible={Boolean(traceEvents && traceEvents.length > 0)}
          traceCursor={traceCursor}
          traceTotal={traceEvents?.length ?? 0}
          traceFocusEvent={traceFocusEvent}
          onTracePrev={stepTracePrev}
          onTraceNext={stepTraceNext}
          onTraceFinish={finishTraceMode}
          autoLayoutTick={autoLayoutTick}
          frameGraphTick={frameGraphTick}
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
          placement={inspectorPlacement}
          effectivePlacement={effectiveInspectorPlacement}
          width={inspectorWidth}
          height={inspectorHeight}
          onPlacementChange={setInspectorPlacement}
          onToggleCollapsed={() => setInspectorOpen((v) => !v)}
          activeFile={activeFile}
          selection={selection}
          analysis={analysis}
          graph={graph}
          selectedNode={selectedNode}
          notice={inspectorNotice}
          onOpenDiagnostic={openDiagnostic}
          onSelectGraphNode={selectGraphNodeFromInspector}
          onActivateGraphNode={activateGraphNode}
          onFocusParamFlow={focusParamFlow}
          activeFlowPreview={effectiveFocusedFlow}
          onRefreshActive={() =>
            postMessage("inspector.refreshActive", { type: "requestActiveFile" })
          }
          onResetGraph={resetGraph}
          onExpandExternal={expandExternalFile}
          rootNode={findNodeById(graph, rootNodeId)}
          onClearRoot={() => {
            setRootNodeId(null);
            setInspectorNotice(null);
          }}
        />
      </div>

      {toast.open ? (
        <div className={`cgToast cgToast--${toast.kind}`}>{toast.message}</div>
      ) : null}
    </div>
  );
}
