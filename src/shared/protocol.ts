export type WebviewToExtMessage =
  | { type: "requestActiveFile" }
  | { type: "requestWorkspaceFiles" }
  | { type: "requestSelection" }
  | { type: "analyzeActiveFile"; payload?: { traceMode?: boolean } }
  | { type: "analyzeWorkspace" }
  | { type: "selectWorkspaceFile"; payload: { filePath: string } }
  | { type: "expandNode"; payload: { filePath: string; generation?: number } }
  | {
      type: "debugEvent";
      payload: {
        event: string;
        detail?: Record<string, unknown>;
        recent?: Array<{
          seq: number;
          at: string;
          event: string;
          detail?: Record<string, unknown>;
        }>;
      };
    }
  | {
      type: "saveExportFile";
      payload: {
        suggestedFileName: string;
        content:
          | {
              kind: "text";
              text: string;
            }
          | {
              kind: "base64";
              base64: string;
            };
        saveLabel: string;
        title: string;
        filters: Record<string, string[]>;
      };
    }
  | {
      type: "openLocation";
      payload: {
        /** Absolute file system path (preferred). */
        filePath: string;
        /** Optional range to reveal/select. */
        range?: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        preserveFocus?: boolean;
      };
    }
  | {
      type: "requestPatchPreview";
      payload: {
        design: DesignGraph;
        options?: {
          workspaceRoot?: string | null;
        };
      };
    }
  | {
      type: "applyPatchPreview";
      payload: {
        requestId: string;
        selectedPatchIds?: string[];
        editedPatches?: Array<{
          patchId: string;
          content: string;
        }>;
      };
    };

export type AnalysisCallV1 = { name: string; count: number };

export type AnalysisCallV2 = {
  calleeName: string;
  count: number;
  declFile: string | null;
  declRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  } | null;
  isExternal: boolean;
};

export type GraphNodeKind =
  | "file"
  | "function"
  | "method"
  | "class"
  | "interface"
  | "external";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  name: string;
  file: string;
  parentId?: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  signature?: string;
  sig?: {
    params: Array<{ name: string; type: string; optional?: boolean }>;
    returnType?: string;
  };
  subkind?: "interface" | "type" | "enum";
};

export type GraphEdgeKind =
  | "calls"
  | "constructs"
  | "dataflow"
  | "references";

export type GraphEdge = {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
  label?: string;
};

export type GraphPayload = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type DesignNodeKind = "file" | "function" | "class" | "interface" | "type";

export type DesignNode = {
  id: string;
  kind: DesignNodeKind;
  name: string;
  filePath?: string;
  parentId?: string;
  exported?: boolean;
  signature?: {
    params?: Array<{ name: string; type?: string; optional?: boolean }>;
    returnType?: string;
    typeParams?: string[];
  };
  members?: Array<
    | { kind: "method"; name: string; returnType?: string }
    | { kind: "field"; name: string; type?: string; readonly?: boolean }
  >;
  source?: "graph" | "imported-from-analysis" | "scaffold-lab";
};

export type DesignEdgeKind =
  | "contains"
  | "dependsOn"
  | "extends"
  | "implements";

export type DesignEdge = {
  id: string;
  kind: DesignEdgeKind;
  source: string;
  target: string;
  label?: string;
};

export type DesignGraph = {
  nodes: DesignNode[];
  edges: DesignEdge[];
};

export type PatchPreview = {
  id: string;
  filePath: string;
  kind: "create" | "update";
  summary: string;
  diffText: string;
  editableContent?: string;
  warnings?: string[];
};

export type GraphTraceEvent =
  | { type: "node"; node: GraphNode }
  | { type: "edge"; edge: GraphEdge };

export type RuntimeDebugVariablePreview = {
  scope: string;
  name: string;
  value: string;
  type?: string;
  evaluateName?: string;
  variablesReference?: number;
};

export type RuntimeDebugSessionInfo = {
  id: string;
  name: string;
  type: string;
};

export type RuntimeDebugFrame = {
  id: number;
  name: string;
  sourceName?: string;
  filePath?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
};

export type RuntimeDebugPayload = {
  state: "inactive" | "running" | "paused";
  session?: RuntimeDebugSessionInfo;
  reason?: string;
  threadId?: number;
  frame?: RuntimeDebugFrame | null;
  variables?: RuntimeDebugVariablePreview[];
  updatedAt: string;
};

export type UINoticeSeverity = "info" | "warning" | "error";
export type UINoticeScope = "toast" | "canvas" | "inspector";
export type UINotice = {
  id: string;
  scope: UINoticeScope;
  severity: UINoticeSeverity;
  message: string;
  detail?: string;
  source?: string;
};

export type CodeDiagnosticSeverity = "error" | "warning" | "info";
export type CodeDiagnostic = {
  code: number;
  source: string;
  severity: CodeDiagnosticSeverity;
  message: string;
  filePath?: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

export type AnalyzerMeta =
  | {
      mode: "single";
    }
  | {
      mode: "workspace";
      rootFiles: number;
      usedTsconfig: boolean;
      projectRoot?: string;
    };

export type AnalysisRequestLane = "active" | "expand";
export type AnalysisRequestReason =
  | "manual"
  | "auto"
  | "select-file"
  | "trace"
  | "expand";

export type AnalysisRequestMeta = {
  lane: AnalysisRequestLane;
  reason: AnalysisRequestReason;
  requestId: string;
  generation: number;
  sequence: number;
  startedAt: string;
};

export type ExtToWebviewMessage =
  | {
      type: "activeFile";
      payload: {
        uri: string;
        fileName: string;
        languageId: string;
        text: string;
        isUntitled: boolean;
      } | null;
    }
  | {
      type: "workspaceFiles";
      payload: {
        rootPath: string | null;
        rootName: string | null;
        files: Array<{
          path: string;
          label: string;
        }>;
      };
    }
  | {
      type: "selection";
      payload: {
        uri: string;
        selectionText: string;
        start: { line: number; character: number };
        end: { line: number; character: number };
      } | null;
    }
  | {
      type: "analysisResult";
      payload: {
        uri: string;
        fileName: string;
        languageId: string;
        stats: { chars: number; lines: number };
        imports: Array<{
          source: string;
          specifiers: string[];
          kind: "named" | "default" | "namespace" | "side-effect" | "unknown";
        }>;
        exports: Array<{
          name: string;
          kind:
            | "function"
            | "class"
            | "type"
            | "interface"
            | "const"
            | "unknown";
        }>;
        // V1/V2 both accepted (webview keeps backwards compatibility)
        calls: Array<AnalysisCallV1 | AnalysisCallV2>;
        diagnostics?: CodeDiagnostic[];

        graph?: GraphPayload;
        trace?: GraphTraceEvent[];

        meta?: AnalyzerMeta;
      } | null;
      request: AnalysisRequestMeta;
    }
  | {
      type: "uiNotice";
      payload: UINotice;
    }
  | {
      type: "flowExportResult";
      payload:
        | {
            ok: true;
            filePath: string;
          }
        | {
            ok: false;
            canceled?: boolean;
            error?: string;
          };
    }
  | {
      type: "runtimeDebug";
      payload: RuntimeDebugPayload;
    }
  | {
      type: "patchPreviewResult";
      payload: {
        requestId: string;
        ok: boolean;
        patches?: PatchPreview[];
        warnings?: string[];
        error?: string;
      };
    }
  | {
      type: "patchApplyResult";
      payload: {
        requestId: string;
        ok: boolean;
        appliedFiles?: string[];
        error?: string;
      };
    };
