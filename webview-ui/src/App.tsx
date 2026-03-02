import { useEffect, useMemo, useRef, useState } from "react";
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

export default function App() {
  const [activeFile, setActiveFile] = useState<ActiveFilePayload>(null);
  const [selection, setSelection] = useState<SelectionPayload>(null);
  const [analysis, setAnalysis] = useState<AnalysisPayload>(null);

  // Graph is merged over time (external expansions)
  const [graphState, setGraphState] = useState<GraphPayload | undefined>(
    undefined,
  );

  // Avoid re-expanding the same external file repeatedly (cache-only; no re-render needed)
  const expandedFilesRef = useRef<Set<string>>(new Set());

  const [activeChip, setActiveChip] = useState<ChipKey>("functions");
  const [searchQuery, setSearchQuery] = useState("");

  // Selected graph node id (Inspector binding)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Rooting
  const [pendingUseSelectionAsRoot, setPendingUseSelectionAsRoot] =
    useState(false);
  const [rootNodeId, setRootNodeId] = useState<string | null>(null);

  // Keep latest values for the message handler without re-registering listeners
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

        // Handle "Use Selection as Root" using refs (no listener re-registering)
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
        if (g) setGraphState((prev) => mergeGraph(prev, g));

        if (!msg.payload) {
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

  const graph = graphState;
  const hasGraphData = Boolean(graph && graph.nodes.length > 0);

  const selectedNode: GraphNode | null = useMemo(() => {
    return findNodeById(graph, selectedNodeId);
  }, [graph, selectedNodeId]);

  const projectName = activeFile?.fileName ? activeFile.fileName : "Active File";

  const resetGraph = () => {
    setGraphState(undefined);
    expandedFilesRef.current.clear();
    setSelectedNodeId(null);
    setRootNodeId(null);
  };

  const expandExternalFile = (filePath: string) => {
    if (!filePath) return;

    if (expandedFilesRef.current.has(filePath)) return;
    expandedFilesRef.current.add(filePath);
    vscode.postMessage({ type: "expandNode", payload: { filePath } });
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
          vscode.postMessage({ type: "analyzeActiveFile" });
        }}
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
            vscode.postMessage({ type: "analyzeActiveFile" })
          }
          onUseSelectionAsRoot={() => {
            setPendingUseSelectionAsRoot(true);
            vscode.postMessage({ type: "requestSelection" });
          }}
          onClearRoot={() => setRootNodeId(null)}
          onExpandExternal={expandExternalFile}
        />

        <Inspector
          activeFile={activeFile}
          selection={selection}
          analysis={analysis}
          selectedNode={selectedNode}
          onRefreshActive={() => vscode.postMessage({ type: "requestActiveFile" })}
          onResetGraph={resetGraph}
          onExpandExternal={expandExternalFile}
          rootNode={findNodeById(graph, rootNodeId)}
          onClearRoot={() => setRootNodeId(null)}
        />
      </div>
    </div>
  );
}