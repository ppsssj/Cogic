// import "./../App.css";
import { Settings } from "lucide-react";
import type { ExtToWebviewMessage, GraphNode } from "../lib/vscode";
import { ActiveFileSnapshot } from "./ActiveFileSnapshot";
import { AnalysisPanel } from "./AnalysisPanel";
import "./Inspector.css";
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

type Props = {
  activeFile: ActiveFilePayload;
  selection: SelectionPayload;
  analysis: AnalysisPayload;
  selectedNode: GraphNode | null;
  onRefreshActive: () => void;
};

function shortFile(p: string) {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function fmtRange(n: GraphNode) {
  const s = n.range.start;
  const e = n.range.end;
  return `${s.line + 1}:${s.character + 1} → ${e.line + 1}:${e.character + 1}`;
}

export function Inspector({
  activeFile,
  selection,
  analysis,
  selectedNode,
  onRefreshActive,
}: Props) {
  return (
    <aside className="inspector">
      <div className="inspectorHeader">
        <div>
          <h1>Inspector</h1>
          <p>COMPONENT ANALYSIS</p>
        </div>
        <button className="iconBtn subtle" type="button" title="Settings">
          <Settings className="icon" />
        </button>
      </div>

      <div className="inspectorBody">
        <div className="inspectorPad">
          <ActiveFileSnapshot
            fileName={activeFile?.fileName}
            languageId={activeFile?.languageId}
            text={activeFile?.text}
            onRefresh={onRefreshActive}
          />

          {/* ✅ Selected node details (P0) */}
          <div className="panel">
            <div className="panelHeader">
              <span>SELECTED NODE</span>
            </div>
            <div className="panelBody" style={{ gap: 10 }}>
              {!selectedNode ? (
                <div className="mutedText">
                  No node selected. Click a node in the graph.
                </div>
              ) : (
                <>
                  <div className="kvList">
                    <div className="kvRow">
                      <div className="kvKey mono">kind</div>
                      <div className="kvVal mono">{selectedNode.kind}</div>
                    </div>
                    <div className="kvRow">
                      <div className="kvKey mono">name</div>
                      <div className="kvVal mono">{selectedNode.name}</div>
                    </div>
                    <div className="kvRow">
                      <div className="kvKey mono">file</div>
                      <div className="kvVal mono">
                        {shortFile(selectedNode.file)}
                      </div>
                    </div>
                    <div className="kvRow">
                      <div className="kvKey mono">range</div>
                      <div className="kvVal mono">{fmtRange(selectedNode)}</div>
                    </div>
                    <div className="kvRow">
                      <div className="kvKey mono">signature</div>
                      <div className="kvVal mono">
                        {selectedNode.signature?.trim()
                          ? selectedNode.signature
                          : "(none)"}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panelHeader">
              <span>SELECTION</span>
            </div>
            <div className="panelBody">
              <div className="mono" style={{ fontSize: 11, opacity: 0.85 }}>
                {selection
                  ? `${selection.start.line + 1}:${selection.start.character} → ${selection.end.line + 1}:${
                      selection.end.character
                    }`
                  : "No selection"}
              </div>

              <pre
                className="mono"
                style={{
                  margin: 0,
                  maxHeight: 140,
                  overflow: "auto",
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.03)",
                  fontSize: 12,
                  lineHeight: 1.45,
                  whiteSpace: "pre",
                }}
              >
                {selection?.selectionText || ""}
              </pre>
            </div>
          </div>

          <AnalysisPanel analysis={analysis} />
        </div>
      </div>
    </aside>
  );
}
