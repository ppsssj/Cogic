import { useEffect, useMemo, useState } from "react";
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

export default function App() {
  const [activeFile, setActiveFile] = useState<ActiveFilePayload>(null);
  const [selection, setSelection] = useState<SelectionPayload>(null);
  const [analysis, setAnalysis] = useState<AnalysisPayload>(null);

  const [activeChip, setActiveChip] = useState<ChipKey>("functions");

  // Selected graph node id (Inspector binding)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isExtToWebviewMessage(event.data)) return;

      const msg = event.data;
      if (msg.type === "activeFile") setActiveFile(msg.payload);
      if (msg.type === "selection") setSelection(msg.payload);
      if (msg.type === "analysisResult") setAnalysis(msg.payload);
    };

    window.addEventListener("message", onMessage);

    vscode.postMessage({ type: "requestActiveFile" });
    vscode.postMessage({ type: "requestSelection" });

    return () => window.removeEventListener("message", onMessage);
  }, []);

  const graph = analysis?.graph;
  const hasGraphData = Boolean(graph && graph.nodes.length > 0);

  /**
   * ✅ IMPORTANT:
   * Do NOT "fix up" selectedNodeId inside an effect.
   * Instead, derive selectedNode from (graph, selectedNodeId).
   * If the node disappeared after auto-refresh, selectedNode becomes null and UI shows "No node selected".
   */
  const selectedNode: GraphNode | null = useMemo(() => {
    return findNodeById(graph, selectedNodeId);
  }, [graph, selectedNodeId]);

  // Optional: computed value; avoid useMemo to satisfy React Compiler
  const projectName = activeFile?.fileName
    ? activeFile.fileName
    : "Active File";

  return (
    <div className="appRoot">
      <Topbar
        projectName={projectName}
        onRefresh={() => {
          vscode.postMessage({ type: "requestActiveFile" });
          vscode.postMessage({ type: "requestSelection" });
        }}
        onGenerate={() => {
          vscode.postMessage({ type: "analyzeActiveFile" });
        }}
      />

      <FiltersBar active={activeChip} onChange={setActiveChip} />

      <div className="main">
        <CanvasPane
          hasData={hasGraphData}
          graph={graph}
          selectedNodeId={selectedNodeId}
          onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
          onClearSelection={() => setSelectedNodeId(null)}
          onGenerateFromActive={() => {
            vscode.postMessage({ type: "analyzeActiveFile" });
          }}
          onUseSelectionAsRoot={() => {
            vscode.postMessage({ type: "requestSelection" });
          }}
        />

        <Inspector
          activeFile={activeFile}
          selection={selection}
          analysis={analysis}
          selectedNode={selectedNode}
          onRefreshActive={() => {
            vscode.postMessage({ type: "requestActiveFile" });
          }}
        />
      </div>
    </div>
  );
}
