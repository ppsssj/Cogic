import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Topbar } from "./components/Topbar";
import { FiltersBar, type ChipKey } from "./components/FiltersBar";
import { CanvasPane } from "./components/CanvasPane";
import { Inspector } from "./components/Inspector";
import {
  getVSCodeApi,
  isExtToWebviewMessage,
  type ExtToWebviewMessage,
  type GraphNode,
  type GraphPayload,
  type GraphTraceEvent,
} from "./lib/vscode";
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
type AnalysisPayload = Extract<
  ExtToWebviewMessage,
  { type: "analysisResult" }
>["payload"];

function findNodeById(graph: GraphPayload | undefined, id: string | null) {
  if (!graph || !id) return null;
  return graph.nodes.find((n) => n.id === id) ?? null;
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
function uriToFsPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  let p = decodeURIComponent(uri.replace("file://", ""));
  if (p.match(/^\/[A-Za-z]:\//)) p = p.slice(1); // windows /C:/...
  return p;
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

function downloadJson(filename: string, data: unknown) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
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

type ToastKind = "info" | "success" | "error";
type ToastState = { open: boolean; kind: ToastKind; message: string };

export default function App() {
  const [activeFile, setActiveFile] = useState<ActiveFilePayload>(null);
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
  const [fitViewTick, setFitViewTick] = useState(0);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [pendingUseSelectionAsRoot, setPendingUseSelectionAsRoot] =
    useState(false);
  const [rootNodeId, setRootNodeId] = useState<string | null>(null);

  // Inspector UI
  const LS_INSPECTOR_OPEN = "cg.inspector.open";
  const LS_INSPECTOR_WIDTH = "cg.inspector.width";
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
  const [isResizingInspector, setIsResizingInspector] = useState(false);

  // Toast + download status
  const [toast, setToast] = useState<ToastState>({
    open: false,
    kind: "info",
    message: "",
  });
  const toastTimerRef = useRef<number | null>(null);

  const [downloadStatus, setDownloadStatus] = useState<
    "idle" | "downloading" | "done"
  >("idle");

  const showToast = (kind: ToastKind, message: string, ms = 1800) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ open: true, kind, message });
    toastTimerRef.current = window.setTimeout(() => {
      setToast((t) => ({ ...t, open: false }));
      toastTimerRef.current = null;
    }, ms);
  };

  // Keep latest values for selection-root logic
  const pendingRootRef = useRef(false);
  const graphRef = useRef<GraphPayload | undefined>(undefined);

  useEffect(() => {
    pendingRootRef.current = pendingUseSelectionAsRoot;
  }, [pendingUseSelectionAsRoot]);

  useEffect(() => {
    graphRef.current = graphState;
  }, [graphState]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isExtToWebviewMessage(event.data)) return;

      const msg = event.data;

      if (msg.type === "activeFile") {
        setActiveFile(msg.payload);
        return;
      }

      if (msg.type === "selection") {
        setSelection(msg.payload);

        const pending = pendingRootRef.current;
        const g = graphRef.current;

        if (pending && msg.payload && g) {
          setRootNodeId(pickRootNodeFromSelection(g, msg.payload));
        }

        if (pending) {
          pendingRootRef.current = false;
          setPendingUseSelectionAsRoot(false);
        }
        return;
      }

      if (msg.type === "analysisResult") {
        setAnalysis(msg.payload);

        const g = msg.payload?.graph;
        const trace = msg.payload?.trace;
        if (trace && trace.length > 0) {
          const maxEvents = 800;
          const events = trace.slice(0, maxEvents);
          setTraceEvents(events);
          setTraceCursor(0);
          setGraphState(undefined);
          setSelectedNodeId(null);
          setRootNodeId(null);
          showToast("info", `Trace ready: 0 / ${events.length}`, 1500);
        } else if (g) {
          setTraceEvents(null);
          setTraceCursor(0);
          setGraphState((prev) => mergeGraph(prev, g));
        }

        if (!msg.payload) {
          setTraceEvents(null);
          setTraceCursor(0);
          setGraphState(undefined);
          expandedFilesRef.current.clear();
          setSelectedNodeId(null);
          setRootNodeId(null);
        }
      }
    };

    window.addEventListener("message", onMessage);

    vscode.postMessage({ type: "requestActiveFile" });
    vscode.postMessage({ type: "requestSelection" });

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

  const beginResizeInspector = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!inspectorOpen) return;

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizingInspector(true);

    const startX = e.clientX;
    const startWidth = inspectorWidth;

    const onMove = (ev: PointerEvent) => {
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
  const downloadEnabled = hasGraphData && downloadStatus !== "downloading";

  const selectedNode: GraphNode | null = useMemo(() => {
    return findNodeById(graph, selectedNodeId);
  }, [graph, selectedNodeId]);

  const projectName = activeFile?.fileName ? activeFile.fileName : "Active File";

  const resetGraph = () => {
    setTraceEvents(null);
    setTraceCursor(0);
    setGraphState(undefined);
    expandedFilesRef.current.clear();
    setSelectedNodeId(null);
    setRootNodeId(null);
  };

  const stepTraceTo = (nextCursor: number) => {
    if (!traceEvents || traceEvents.length === 0) return;
    const c = Math.max(0, Math.min(traceEvents.length, nextCursor));
    setTraceCursor(c);
    setGraphState(buildGraphFromTrace(traceEvents, c));
  };

  const stepTracePrev = () => stepTraceTo(traceCursor - 1);
  const stepTraceNext = () => stepTraceTo(traceCursor + 1);
  const toggleTraceMode = () => {
    setTraceMode((prev) => {
      const next = !prev;
      if (next) {
        resetGraph();
        vscode.postMessage({
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
    if (!filePath) return;
    if (expandedFilesRef.current.has(filePath)) return;
    expandedFilesRef.current.add(filePath);
    vscode.postMessage({ type: "expandNode", payload: { filePath } });
  };

  const downloadFlow = async () => {
    if (!hasGraphData || !graph) {
      showToast("info", "No graph to download");
      return;
    }
    if (downloadStatus === "downloading") return;

    try {
      setDownloadStatus("downloading");
      showToast("info", "Downloading…", 1200);

      await new Promise((r) => setTimeout(r, 0));

      const exportedAt = new Date().toISOString().replace(/[:.]/g, "-");
      const base =
        activeFile?.fileName?.replace(/[^\w.-]+/g, "_")?.slice(0, 64) ||
        "codegraph";

      const payload = {
        schema: "codegraph.flow.v1",
        exportedAt: new Date().toISOString(),
        ui: {
          activeFilter: activeChip,
          searchQuery,
          rootNodeId,
          selectedNodeId,
          inspector: { open: inspectorOpen, width: inspectorWidth },
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
      };

      downloadJson(`${base}.flow.${exportedAt}.json`, payload);

      setDownloadStatus("done");
      showToast("success", "Download complete", 1500);

      window.setTimeout(() => setDownloadStatus("idle"), 900);
    } catch (e) {
      console.error("[codegraph] downloadFlow error:", e);
      setDownloadStatus("idle");
      showToast("error", "Download failed");
    }
  };

  return (
    <div className="appRoot">
      <Topbar
        projectName={projectName}
        onRefresh={() => {
          vscode.postMessage({ type: "requestActiveFile" });
          vscode.postMessage({ type: "requestSelection" });
        }}
        onGenerate={() => {
          resetGraph();
          vscode.postMessage({
            type: "analyzeActiveFile",
            payload: { traceMode },
          });
        }}
        onAutoLayout={() => setAutoLayoutTick((v) => v + 1)}
        onFitToScreen={() => setFitViewTick((v) => v + 1)}
        traceMode={traceMode}
        onToggleTraceMode={toggleTraceMode}
        onDownloadFlow={downloadFlow}
        downloadEnabled={downloadEnabled}
        downloadStatus={downloadStatus}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      />

      <FiltersBar active={activeChip} onChange={setActiveChip} />

      <div className="main">
        <CanvasPane
          graph={graph}
          hasData={hasGraphData}
          activeFilter={activeChip}
          searchQuery={searchQuery}
          rootNodeId={rootNodeId}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onClearSelection={() => setSelectedNodeId(null)}
          // ✅ 노드 클릭 → 코드 위치 이동 복구
          onOpenNode={(n) => {
            vscode.postMessage({
              type: "openLocation",
              payload: {
                filePath: n.file,
                range: n.range,
                preserveFocus: false,
              },
            });
          }}
          onGenerateFromActive={() =>
            vscode.postMessage({
              type: "analyzeActiveFile",
              payload: { traceMode },
            })
          }
          onUseSelectionAsRoot={() => {
            setPendingUseSelectionAsRoot(true);
            vscode.postMessage({ type: "requestSelection" });
          }}
          onClearRoot={() => setRootNodeId(null)}
          onExpandExternal={expandExternalFile}
          traceVisible={Boolean(traceEvents && traceEvents.length > 0)}
          traceCursor={traceCursor}
          traceTotal={traceEvents?.length ?? 0}
          onTracePrev={stepTracePrev}
          onTraceNext={stepTraceNext}
          autoLayoutTick={autoLayoutTick}
          fitViewTick={fitViewTick}
        />

        {inspectorOpen ? (
          <div
            className={
              isResizingInspector
                ? "inspectorResizer isDragging"
                : "inspectorResizer"
            }
            onPointerDown={beginResizeInspector}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Inspector"
          />
        ) : null}

        <Inspector
          collapsed={!inspectorOpen}
          width={inspectorWidth}
          onToggleCollapsed={() => setInspectorOpen((v) => !v)}
          activeFile={activeFile}
          selection={selection}
          analysis={analysis}
          graph={graph}
          selectedNode={selectedNode}
          onRefreshActive={() =>
            vscode.postMessage({ type: "requestActiveFile" })
          }
          onResetGraph={resetGraph}
          onExpandExternal={expandExternalFile}
          rootNode={findNodeById(graph, rootNodeId)}
          onClearRoot={() => setRootNodeId(null)}
        />
      </div>

      {toast.open ? (
        <div className={`cgToast cgToast--${toast.kind}`}>{toast.message}</div>
      ) : null}
    </div>
  );
}
