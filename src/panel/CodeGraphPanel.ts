import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { getWebviewHtml } from "../webview/html";
import {
  analyzeWorkspaceActive,
  clearAnalyzerCaches,
  invalidateAnalyzerFileCaches,
} from "../analyzer";
import { buildPatchPreview, type GeneratedPatchPlan } from "../codegen";
import type {
  AnalysisRequestMeta,
  AnalysisRequestReason,
  ExtToWebviewMessage,
  GraphPayload,
  GraphTraceEvent,
  TraceScope,
  UINotice,
  WebviewToExtMessage,
} from "../shared/protocol";
import {
  dumpPanelDebugBuffer,
  pushPanelDebugEvent,
} from "./debugLog";
import { RuntimeDebugBridge } from "./runtimeDebug";
import { shouldAutoAnalyzeEditorChange } from "./workflowPolicy";

type DepthAnalysisResult = ReturnType<typeof analyzeWorkspaceActive>;

type AnalysisCacheEntry = {
  result: DepthAnalysisResult;
  lastAccessedAt: number;
};

const MAX_ANALYSIS_RESULT_CACHE_ENTRIES = 40;
const CONFIG_SECTION = "cogic";
const ANALYSIS_CACHE_ENABLED_SETTING = "analysisCache.enabled";
const ANALYSIS_CACHE_STATE_KEY = "cogic.analysisCache.enabled";

function getGraphCounts(payload?: { nodes: unknown[]; edges: unknown[] }) {
  return {
    graphNodes: payload?.nodes.length ?? 0,
    graphEdges: payload?.edges.length ?? 0,
  };
}

function normalizeComparablePath(filePath: string) {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

function normalizeDirectoryPath(filePath: string) {
  return normalizeComparablePath(path.dirname(filePath));
}

function hashText(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cloneAnalysisResult(result: DepthAnalysisResult): DepthAnalysisResult {
  return JSON.parse(JSON.stringify(result)) as DepthAnalysisResult;
}

function getDefaultAnalysisCacheEnabled() {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>(ANALYSIS_CACHE_ENABLED_SETTING, true);
}

function clampGraphDepth(depth: number | undefined) {
  if (!Number.isFinite(depth)) {return 0;}
  return Math.max(0, Math.min(3, Math.round(depth ?? 0)));
}

function mergeGraphPayload(
  prev: GraphPayload | undefined,
  next: GraphPayload | undefined,
) {
  if (!next) {return prev;}
  if (!prev) {return next;}

  const nodeById = new Map(
    prev.nodes.map((node) => [String((node as { id: string }).id), node]),
  );
  for (const node of next.nodes) {
    nodeById.set(String((node as { id: string }).id), node);
  }

  const edgeById = new Map(
    prev.edges.map((edge) => [String((edge as { id: string }).id), edge]),
  );
  for (const edge of next.edges) {
    edgeById.set(String((edge as { id: string }).id), edge);
  }

  return {
    nodes: [...nodeById.values()],
    edges: [...edgeById.values()],
  };
}

function getTraceEventKey(event: GraphTraceEvent) {
  return event.type === "node" ? `node:${event.node.id}` : `edge:${event.edge.id}`;
}

function mergeTracePayload(
  prev: GraphTraceEvent[] | undefined,
  next: GraphTraceEvent[] | undefined,
) {
  if (!next) {return prev;}
  if (!prev) {return next;}

  const merged = [...prev];
  const seen = new Set(prev.map(getTraceEventKey));

  for (const event of next) {
    const key = getTraceEventKey(event);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(event);
  }

  return merged;
}

function pruneGraphToFile(graph: GraphPayload, filePath: string) {
  const comparableFilePath = normalizeComparablePath(filePath);
  const keptNodes = graph.nodes.filter(
    (node) => normalizeComparablePath(node.file) === comparableFilePath,
  );
  const keptNodeIds = new Set(keptNodes.map((node) => node.id));
  const keptEdges = graph.edges.filter(
    (edge) => keptNodeIds.has(edge.source) && keptNodeIds.has(edge.target),
  );

  return {
    nodes: keptNodes,
    edges: keptEdges,
  };
}

function pruneTraceToGraph(
  trace: GraphTraceEvent[] | undefined,
  graph: GraphPayload | undefined,
) {
  if (!trace || !graph) {
    return trace;
  }

  const keptNodeIds = new Set(graph.nodes.map((node) => node.id));

  return trace.filter((event) => {
    if (event.type === "node") {
      return keptNodeIds.has(event.node.id);
    }
    return keptNodeIds.has(event.edge.source) && keptNodeIds.has(event.edge.target);
  });
}

function summarizeInboundMessage(msg: WebviewToExtMessage) {
  if (msg.type === "requestHostState") {
    return {};
  }
  if (msg.type === "requestAnalysisCacheState") {
    return {};
  }
  if (msg.type === "switchHost") {
    return {
      target: msg.payload.target,
    };
  }
  if (msg.type === "setTraceState") {
    return {
      traceMode: msg.payload.traceMode,
      traceScope: msg.payload.traceScope ?? null,
    };
  }
  if (msg.type === "debugEvent") {
    return {
      event: msg.payload.event,
      recentCount: msg.payload.recent?.length ?? 0,
    };
  }
  if (msg.type === "openLocation") {
    return {
      filePath: msg.payload.filePath,
      preserveFocus: msg.payload.preserveFocus ?? false,
      startLine: msg.payload.range?.start.line ?? null,
    };
  }
  if (msg.type === "expandNode") {
    return {
      filePath: msg.payload.filePath,
      generation: msg.payload.generation ?? null,
    };
  }
  if (msg.type === "selectWorkspaceFile") {
    return {
      filePath: msg.payload.filePath,
      graphDepth: msg.payload.graphDepth ?? null,
      traceScope: msg.payload.traceScope ?? null,
    };
  }
  if (msg.type === "setGraphRoot") {
    return {
      rootKind: msg.payload.root?.kind ?? null,
      path: msg.payload.root?.path ?? null,
    };
  }
  if (msg.type === "analyzeActiveFile") {
    return {
      traceMode: msg.payload?.traceMode ?? false,
      graphDepth: msg.payload?.graphDepth ?? null,
      traceScope: msg.payload?.traceScope ?? null,
    };
  }
  if (msg.type === "setGraphDepth") {
    return {
      graphDepth: msg.payload.graphDepth,
    };
  }
  if (msg.type === "setAnalysisCacheEnabled") {
    return {
      enabled: msg.payload.enabled,
    };
  }
  if (msg.type === "requestPatchPreview") {
    return {
      nodes: msg.payload.design.nodes.length,
      edges: msg.payload.design.edges.length,
    };
  }
  if (msg.type === "applyPatchPreview") {
    return {
      requestId: msg.payload.requestId,
      selectedPatchIds: msg.payload.selectedPatchIds?.length ?? 0,
    };
  }
  return {};
}

type HostKind = "panel" | "sidebar";
type SidebarLocation = "left" | "right";

export class CodeGraphPanel {
  private static currentPanel: vscode.WebviewPanel | undefined;
  private static currentSidebarView: vscode.WebviewView | undefined;
  private lastTextEditor: vscode.TextEditor | undefined;
  private lastSelection: vscode.Selection | undefined;
  private analysisTimer: NodeJS.Timeout | undefined;
  private debugEpoch = 0;
  private readonly suppressedAutoAnalysisUris = new Map<string, number>();
  private graphRoot:
    | {
        kind: "file" | "folder";
        path: string;
      }
    | null = null;
  private traceModeActive = false;
  private traceScope: TraceScope = "single-file";
  private traceAnchorFilePath: string | null = null;
  private analysisGeneration = 0;
  private analysisSequence = 0;
  private latestActiveAnalysisSequence = 0;
  private traceHighlightTimer: NodeJS.Timeout | undefined;
  private runtimeDebugBridge: RuntimeDebugBridge | undefined;
  private readonly patchPreviewStore = new Map<string, GeneratedPatchPlan[]>();
  private readonly traceHighlightDecoration =
    vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(56, 189, 248, 0.14)",
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: "rgba(56, 189, 248, 0.55)",
      overviewRulerColor: "rgba(56, 189, 248, 0.85)",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

  // cache workspace file list (ts/js)
  private cachedFilePaths: string[] = [];
  private cachedAt = 0;
  private readonly analysisResultCache = new Map<string, AnalysisCacheEntry>();
  private graphDepth = 0;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel | vscode.WebviewView,
    private readonly hostKind: HostKind,
  ) {}

  private static getInitialPanelColumn(): vscode.ViewColumn {
    const activeColumn = vscode.window.activeTextEditor?.viewColumn;
    if (activeColumn !== undefined) {
      return vscode.ViewColumn.Beside;
    }
    return vscode.ViewColumn.Beside;
  }

  static open(context: vscode.ExtensionContext) {
    if (CodeGraphPanel.currentPanel) {
      CodeGraphPanel.currentPanel.reveal(
        CodeGraphPanel.currentPanel.viewColumn ?? CodeGraphPanel.getInitialPanelColumn(),
        false,
      );
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "codegraph",
      "Cogic",
      CodeGraphPanel.getInitialPanelColumn(),
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "media", "webview")),
        ],
      },
    );
    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, "assets", "logo.svg"),
      dark: vscode.Uri.joinPath(context.extensionUri, "assets", "logo2.svg"),
    };
    CodeGraphPanel.currentPanel = panel;

    panel.onDidDispose(() => {
      if (CodeGraphPanel.currentPanel === panel) {
        CodeGraphPanel.currentPanel = undefined;
      }
    });

    const inst = new CodeGraphPanel(context, panel, "panel");
    inst.init();
  }

  static resolveView(
    context: vscode.ExtensionContext,
    view: vscode.WebviewView,
  ) {
    CodeGraphPanel.currentSidebarView = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, "media", "webview")),
      ],
    };

    view.onDidDispose(() => {
      if (CodeGraphPanel.currentSidebarView === view) {
        CodeGraphPanel.currentSidebarView = undefined;
      }
    });

    const inst = new CodeGraphPanel(context, view, "sidebar");
    inst.init();
  }

  static async revealSidebar() {
    if (CodeGraphPanel.currentSidebarView) {
      CodeGraphPanel.currentSidebarView.show(false);
      return;
    }

    try {
      await vscode.commands.executeCommand("codegraph.sidebar.focus");
    } catch {
      await vscode.commands.executeCommand("workbench.view.extension.codegraph");
    }
  }

  private init() {
    this.panel.webview.html = getWebviewHtml(this.context, this.panel.webview);
    this.postHostState();
    this.runtimeDebugBridge = new RuntimeDebugBridge((payload) => {
      this.panel.webview.postMessage({
        type: "runtimeDebug",
        payload,
      } satisfies ExtToWebviewMessage);
    });

    this.lastTextEditor = vscode.window.activeTextEditor;
    this.lastSelection = vscode.window.activeTextEditor?.selection;

    this.panel.webview.onDidReceiveMessage(
      async (msg: WebviewToExtMessage) => {
        try {
          pushPanelDebugEvent("panel.message.received", {
            type: msg.type,
            ...summarizeInboundMessage(msg),
          });
          if (msg.type === "requestActiveFile") {
            return this.postActiveFile();
          }
          if (msg.type === "requestWorkspaceFiles") {
            return await this.postWorkspaceFiles();
          }
          if (msg.type === "requestSelection") {
            return this.postSelection();
          }
          if (msg.type === "requestHostState") {
            return this.postHostState();
          }
          if (msg.type === "requestAnalysisCacheState") {
            return this.postAnalysisCacheState();
          }
          if (msg.type === "switchHost") {
            return await this.switchHost(
              msg.payload.target,
              msg.payload.sidebarLocation,
            );
          }
          if (msg.type === "setTraceState") {
            this.traceModeActive = msg.payload.traceMode;
            this.traceScope = msg.payload.traceScope ?? "single-file";
            if (!this.traceModeActive) {
              this.traceAnchorFilePath = null;
            }
            return;
          }
          if (msg.type === "analyzeActiveFile") {
            if (msg.payload?.graphDepth !== undefined) {
              this.graphDepth = clampGraphDepth(msg.payload.graphDepth);
            }
            this.traceModeActive = Boolean(msg.payload?.traceMode);
            this.traceScope = msg.payload?.traceScope ?? "single-file";
            if (!this.traceModeActive) {
              this.traceAnchorFilePath = null;
            } else if (this.traceScope === "current-depth") {
              this.traceAnchorFilePath = this.getEditor()?.document.fileName ?? this.traceAnchorFilePath;
            } else {
              this.traceAnchorFilePath = null;
            }
            return await this.postAnalysis(
              Boolean(msg.payload?.traceMode),
              msg.payload?.traceMode ? "trace" : "manual",
              msg.payload?.traceScope,
            ); // workspace-aware
          }
          if (msg.type === "analyzeWorkspace") {
            if (msg.payload?.graphDepth !== undefined) {
              this.graphDepth = clampGraphDepth(msg.payload.graphDepth);
            }
            return await this.postAnalysis(false, "manual"); // explicit
          }
          if (msg.type === "selectWorkspaceFile") {
            if (msg.payload.graphDepth !== undefined) {
              this.graphDepth = clampGraphDepth(msg.payload.graphDepth);
            }
            this.traceModeActive = Boolean(msg.payload.traceMode);
            this.traceScope = msg.payload.traceScope ?? "single-file";
            if (!this.traceModeActive) {
              this.traceAnchorFilePath = null;
            } else if (this.traceScope === "current-depth") {
              this.traceAnchorFilePath = msg.payload.filePath;
            } else {
              this.traceAnchorFilePath = null;
            }
            return await this.selectWorkspaceFile(
              msg.payload.filePath,
              Boolean(msg.payload.traceMode),
              msg.payload.traceScope,
            );
          }
          if (msg.type === "setGraphRoot") {
            this.graphRoot = msg.payload.root;
            return;
          }
          if (msg.type === "setGraphDepth") {
            this.graphDepth = clampGraphDepth(msg.payload.graphDepth);
            return;
          }
          if (msg.type === "setAnalysisCacheEnabled") {
            return await this.setAnalysisCacheEnabled(msg.payload.enabled);
          }
          if (msg.type === "debugEvent") {
            return this.handleForwardedWebviewDebug(msg.payload);
          }
          if (msg.type === "expandNode") {
            return await this.postAnalysisForFile(
              msg.payload.filePath,
              msg.payload.generation,
            );
          }
          if (msg.type === "saveExportFile") {
            return await this.saveExportFile(msg.payload);
          }
          if (msg.type === "openLocation") {
            return await this.openLocation(msg.payload);
          }
          if (msg.type === "requestPatchPreview") {
            return await this.postPatchPreview(msg.payload);
          }
          if (msg.type === "applyPatchPreview") {
            return await this.applyPatchPreview(msg.payload);
          }
        } catch (e) {
          this.handleRequestError(msg.type, e);
        }
      },
      undefined,
      this.context.subscriptions,
    );

    // initial push
    this.postActiveFile();
    void this.postWorkspaceFiles();
    this.postSelection();
    this.postAnalysisCacheState();
    const runtimePayload = this.runtimeDebugBridge?.getLastPayload();
    if (runtimePayload) {
      this.panel.webview.postMessage({
        type: "runtimeDebug",
        payload: runtimePayload,
      } satisfies ExtToWebviewMessage);
    }

    // ---- auto-analysis for active file changes (debounced) ----
    const scheduleAnalysis = (delayMs: number) => {
      if (this.analysisTimer) {
        clearTimeout(this.analysisTimer);
      }
      this.analysisTimer = setTimeout(
        () => {
          if (vscode.debug.activeDebugSession) {
            return;
          }
          void this.postAnalysis(
            this.traceModeActive,
            this.traceModeActive ? "trace" : "auto",
            this.traceScope,
          ).catch((e) => {
            this.postNotice(
              "canvas",
              "warning",
              "Auto-analysis failed",
              getErrorMessage(e),
              "auto-analysis",
            );
          });
        },
        Math.max(0, delayMs),
      );
    };

    const subActive = vscode.window.onDidChangeActiveTextEditor((editor) => {
      pushPanelDebugEvent("editor.active.changed", {
        hasEditor: Boolean(editor),
        filePath: editor?.document.fileName ?? null,
      });

      if (editor) {
        this.lastTextEditor = editor;
        this.lastSelection = editor.selection;
      }
      this.postActiveFile();
      void this.postWorkspaceFiles();

      // Webview/panel focus transitions can temporarily leave VS Code without an
      // active text editor. Treat that as a focus change, not as a new analysis trigger.
      if (!editor) {
        pushPanelDebugEvent("analysis.auto.skipped.no-active-editor", {});
        return;
      }

      if (this.consumeSuppressedAutoAnalysis(editor.document.uri.toString())) {
        pushPanelDebugEvent("analysis.auto.suppressed", {
          filePath: editor.document.fileName,
        });
        return;
      }

      if (!shouldAutoAnalyzeEditorChange(Boolean(vscode.debug.activeDebugSession), this.matchesGraphRoot(editor.document.fileName))) {
        pushPanelDebugEvent("analysis.auto.skipped.graph-root-lock", {
          filePath: editor.document.fileName,
          graphRoot: this.graphRoot,
        });
        return;
      }

      pushPanelDebugEvent("analysis.auto.scheduled.from-active-editor", {
        filePath: editor.document.fileName,
      });
      scheduleAnalysis(0);
    });

    const subChange = vscode.workspace.onDidChangeTextDocument((e) => {
      this.invalidateCachesForFiles("document-change", [e.document.fileName]);

      const active =
        this.lastTextEditor?.document ??
        vscode.window.activeTextEditor?.document;
      if (!active) {
        return;
      }
      if (e.document.uri.toString() !== active.uri.toString()) {
        return;
      }

      if (!this.matchesGraphRoot(active.fileName)) {
        pushPanelDebugEvent("analysis.auto.skipped.document-change.graph-root-lock", {
          filePath: active.fileName,
          graphRoot: this.graphRoot,
        });
        this.postActiveFile();
        return;
      }

      this.postActiveFile();
      scheduleAnalysis(350);
    });

    const subSave = vscode.workspace.onDidSaveTextDocument((doc) => {
      this.invalidateCachesForFiles("document-save", [doc.fileName]);

      const active =
        this.lastTextEditor?.document ??
        vscode.window.activeTextEditor?.document;
      if (!active) {
        return;
      }
      if (doc.uri.toString() !== active.uri.toString()) {
        return;
      }

      if (!this.matchesGraphRoot(active.fileName)) {
        pushPanelDebugEvent("analysis.auto.skipped.save.graph-root-lock", {
          filePath: active.fileName,
          graphRoot: this.graphRoot,
        });
        return;
      }

      scheduleAnalysis(0);
    });

    const subDebugStart = vscode.debug.onDidStartDebugSession(() => {
      this.debugEpoch++;
      if (this.analysisTimer) {
        clearTimeout(this.analysisTimer);
      }
    });

    const subSelection = vscode.window.onDidChangeTextEditorSelection((e) => {
      this.lastTextEditor = e.textEditor;
      this.lastSelection = e.selections?.[0];
      this.postSelection();
    });

    const subConfig = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("cogic.analysisCache.enabled")) {
        return;
      }

      this.invalidateCachesForFiles("analysis-cache-setting-change");
      pushPanelDebugEvent("analysis.cache.setting.changed", {
        enabled: this.isAnalysisCacheEnabled(),
      });
      this.postAnalysisCacheState();
    });

    // invalidate cache when files change (coarse)
    const subFs = vscode.workspace.onDidCreateFiles((e) =>
      this.invalidateAndPostWorkspaceFiles("files-created", e.files.map((uri) => uri.fsPath)),
    );
    const subFs2 = vscode.workspace.onDidDeleteFiles((e) =>
      this.invalidateAndPostWorkspaceFiles("files-deleted", e.files.map((uri) => uri.fsPath)),
    );
    const subFs3 = vscode.workspace.onDidRenameFiles((e) =>
      this.invalidateAndPostWorkspaceFiles(
        "files-renamed",
        e.files.flatMap((file) => [file.oldUri.fsPath, file.newUri.fsPath]),
      ),
    );
    const sourceFileWatcher = vscode.workspace.createFileSystemWatcher(
      "**/*.{ts,tsx,js,jsx}",
    );
    const tsconfigWatcher = vscode.workspace.createFileSystemWatcher(
      "**/tsconfig*.json",
    );
    const subWatcherChange = sourceFileWatcher.onDidChange((uri) =>
      this.invalidateCachesForFiles("filesystem-change", [uri.fsPath]),
    );
    const subWatcherCreate = sourceFileWatcher.onDidCreate((uri) =>
      this.invalidateAndPostWorkspaceFiles("filesystem-create", [uri.fsPath]),
    );
    const subWatcherDelete = sourceFileWatcher.onDidDelete((uri) =>
      this.invalidateAndPostWorkspaceFiles("filesystem-delete", [uri.fsPath]),
    );
    const subTsconfigChange = tsconfigWatcher.onDidChange((uri) =>
      this.invalidateCachesForFiles("tsconfig-change", [uri.fsPath]),
    );
    const subTsconfigCreate = tsconfigWatcher.onDidCreate((uri) =>
      this.invalidateCachesForFiles("tsconfig-create", [uri.fsPath]),
    );
    const subTsconfigDelete = tsconfigWatcher.onDidDelete((uri) =>
      this.invalidateCachesForFiles("tsconfig-delete", [uri.fsPath]),
    );

    this.panel.onDidDispose(() => {
      subActive.dispose();
      subDebugStart.dispose();
      subChange.dispose();
      subSave.dispose();
      subSelection.dispose();
      subFs.dispose();
      subFs2.dispose();
      subFs3.dispose();
      subConfig.dispose();
      subWatcherChange.dispose();
      subWatcherCreate.dispose();
      subWatcherDelete.dispose();
      subTsconfigChange.dispose();
      subTsconfigCreate.dispose();
      subTsconfigDelete.dispose();
      sourceFileWatcher.dispose();
      tsconfigWatcher.dispose();
      if (this.analysisTimer) {
        clearTimeout(this.analysisTimer);
      }
      if (this.traceHighlightTimer) {
        clearTimeout(this.traceHighlightTimer);
      }
      this.runtimeDebugBridge?.dispose();
      this.runtimeDebugBridge = undefined;
      this.traceHighlightDecoration.dispose();
    });
  }

  private postHostState() {
    const payload: Extract<
      ExtToWebviewMessage,
      { type: "hostState" }
    >["payload"] =
      this.hostKind === "sidebar"
        ? {
            currentHost: "sidebar",
            sidebarLocation: this.getSidebarLocation(),
          }
        : {
            currentHost: "panel",
            sidebarLocation: this.getSidebarLocation(),
          };

    this.panel.webview.postMessage({
      type: "hostState",
      payload,
    } satisfies ExtToWebviewMessage);
  }

  private postAnalysisCacheState() {
    this.panel.webview.postMessage({
      type: "analysisCacheState",
      payload: {
        enabled: this.isAnalysisCacheEnabled(),
      },
    } satisfies ExtToWebviewMessage);
  }

  private isAnalysisCacheEnabled() {
    return (
      this.context.workspaceState.get<boolean>(ANALYSIS_CACHE_STATE_KEY) ??
      getDefaultAnalysisCacheEnabled()
    );
  }

  private async setAnalysisCacheEnabled(enabled: boolean) {
    const current = this.isAnalysisCacheEnabled();
    await this.context.workspaceState.update(ANALYSIS_CACHE_STATE_KEY, enabled);

    if (current === enabled) {
      this.postAnalysisCacheState();
      return;
    }

    this.invalidateCachesForFiles("analysis-cache-setting-update");
    pushPanelDebugEvent("analysis.cache.setting.updated", { enabled });
    this.postAnalysisCacheState();
  }

  private async switchHost(target: HostKind, sidebarLocation?: SidebarLocation) {
    if (target === this.hostKind) {
      if (target === "sidebar" && sidebarLocation) {
        await this.setSidebarLocation(sidebarLocation);
      }
      this.postHostState();
      return;
    }

    if (target === "panel") {
      CodeGraphPanel.open(this.context);
      if (this.hostKind === "sidebar") {
        await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
      }
      return;
    }

    if (sidebarLocation) {
      await this.setSidebarLocation(sidebarLocation);
    }
    await CodeGraphPanel.revealSidebar();
    if (this.hostKind === "panel" && "dispose" in this.panel) {
      this.panel.dispose();
    }
  }

  private getSidebarLocation(): SidebarLocation {
    const configured = vscode.workspace
      .getConfiguration("workbench")
      .get<string>("sideBar.location");
    return configured === "right" ? "right" : "left";
  }

  private async setSidebarLocation(location: SidebarLocation) {
    if (this.getSidebarLocation() === location) {
      return;
    }

    await vscode.commands.executeCommand("workbench.action.toggleSidebarPosition");
  }

  private invalidateWorkspaceCache() {
    this.cachedAt = 0;
    this.cachedFilePaths = [];
  }

  private invalidateCachesForFiles(
    reason: string,
    filePaths: readonly string[] = [],
  ) {
    const normalizedFilePaths = filePaths.filter((filePath) => filePath.trim());
    const analysisEntries = this.analysisResultCache.size;

    this.analysisResultCache.clear();
    if (normalizedFilePaths.length > 0) {
      invalidateAnalyzerFileCaches(normalizedFilePaths, pushPanelDebugEvent);
    } else {
      clearAnalyzerCaches(pushPanelDebugEvent);
    }

    pushPanelDebugEvent("analysis.cache.invalidate", {
      reason,
      files: normalizedFilePaths.length,
      analysisEntries,
    });
  }

  private suppressAutoAnalysis(uri: string) {
    const count = this.suppressedAutoAnalysisUris.get(uri) ?? 0;
    this.suppressedAutoAnalysisUris.set(uri, count + 1);
  }

  private consumeSuppressedAutoAnalysis(uri: string) {
    const count = this.suppressedAutoAnalysisUris.get(uri) ?? 0;
    if (count <= 0) {
      return false;
    }

    if (count === 1) {
      this.suppressedAutoAnalysisUris.delete(uri);
    } else {
      this.suppressedAutoAnalysisUris.set(uri, count - 1);
    }

    return true;
  }

  private matchesGraphRoot(filePath: string) {
    if (
      this.traceModeActive &&
      this.traceScope === "current-depth" &&
      this.traceAnchorFilePath
    ) {
      return normalizeComparablePath(filePath) === normalizeComparablePath(this.traceAnchorFilePath);
    }

    if (!this.graphRoot) {
      return true;
    }

    if (this.graphRoot.kind === "file") {
      return normalizeComparablePath(filePath) === normalizeComparablePath(this.graphRoot.path);
    }

    return normalizeDirectoryPath(filePath) === normalizeComparablePath(this.graphRoot.path);
  }

  private beginActiveAnalysis(reason: AnalysisRequestReason): AnalysisRequestMeta {
    const generation = ++this.analysisGeneration;
    const sequence = ++this.analysisSequence;
    this.latestActiveAnalysisSequence = sequence;
    return {
      lane: "active",
      reason,
      requestId: `active-${generation}-${sequence}`,
      generation,
      sequence,
      startedAt: new Date().toISOString(),
    };
  }

  private beginExpandAnalysis(generation = this.analysisGeneration): AnalysisRequestMeta {
    const sequence = ++this.analysisSequence;
    return {
      lane: "expand",
      reason: "expand",
      requestId: `expand-${generation}-${sequence}`,
      generation,
      sequence,
      startedAt: new Date().toISOString(),
    };
  }

  private invalidateAndPostWorkspaceFiles(
    reason = "workspace-files",
    filePaths: readonly string[] = [],
  ) {
    this.invalidateCachesForFiles(reason, filePaths);
    this.invalidateWorkspaceCache();
    void this.postWorkspaceFiles();
  }

  private handleForwardedWebviewDebug(payload: Extract<
    WebviewToExtMessage,
    { type: "debugEvent" }
  >["payload"]) {
    pushPanelDebugEvent("webview.debug.forwarded", {
      event: payload.event,
      recentCount: payload.recent?.length ?? 0,
      ...(payload.detail ?? {}),
    });
  }

  private postNotice(
    scope: UINotice["scope"],
    severity: UINotice["severity"],
    message: string,
    detail?: string,
    source?: string,
  ) {
    this.panel.webview.postMessage({
      type: "uiNotice",
      payload: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        scope,
        severity,
        message,
        detail,
        source,
      },
    } satisfies ExtToWebviewMessage);
  }

  private handleRequestError(action: WebviewToExtMessage["type"], error: unknown) {
    const detail = getErrorMessage(error);

    if (
      action === "analyzeActiveFile" ||
      action === "analyzeWorkspace" ||
      action === "expandNode"
    ) {
      this.postNotice("canvas", "error", "Analysis failed", detail, action);
      return;
    }

    if (action === "openLocation") {
      this.postNotice("toast", "error", "Failed to open code location", detail, action);
      return;
    }

    if (action === "saveExportFile") {
      this.panel.webview.postMessage({
        type: "flowExportResult",
        payload: { ok: false, error: detail },
      } satisfies ExtToWebviewMessage);
      return;
    }

    if (action === "requestPatchPreview") {
      this.panel.webview.postMessage({
        type: "patchPreviewResult",
        payload: {
          requestId: `patch-preview-error-${Date.now()}`,
          ok: false,
          error: detail,
        },
      } satisfies ExtToWebviewMessage);
      return;
    }

    if (action === "applyPatchPreview") {
      this.panel.webview.postMessage({
        type: "patchApplyResult",
        payload: {
          requestId: `patch-apply-error-${Date.now()}`,
          ok: false,
          error: detail,
        },
      } satisfies ExtToWebviewMessage);
      return;
    }

    this.postNotice("toast", "error", "Request failed", detail, action);
  }

  private getPreferredEditorColumn(): vscode.ViewColumn {
    if ("viewColumn" in this.panel) {
      const panelColumn = this.panel.viewColumn;
      const visibleTextEditor = vscode.window.visibleTextEditors.find(
        (editor) => editor.viewColumn && editor.viewColumn !== panelColumn,
      );

      if (visibleTextEditor?.viewColumn) {
        return visibleTextEditor.viewColumn;
      }
    }

    return (
      vscode.window.activeTextEditor?.viewColumn ??
      vscode.window.visibleTextEditors[0]?.viewColumn ??
      vscode.ViewColumn.Beside
    );
  }

  private getEditor(): vscode.TextEditor | undefined {
    return this.lastTextEditor ?? vscode.window.activeTextEditor;
  }

  private getWorkspaceRoot(): string | null {
    const ws = vscode.workspace.workspaceFolders?.[0];
    return ws?.uri.fsPath ?? null;
  }

  private async getWorkspaceFilePaths(): Promise<string[]> {
    const now = Date.now();
    // refresh every 10 seconds at most (cheap throttle)
    if (this.cachedFilePaths.length && now - this.cachedAt < 10_000) {
      return this.cachedFilePaths;
    }

    const files = await vscode.workspace.findFiles(
      "**/*.{ts,tsx,js,jsx}",
      "**/{node_modules,dist,build,out,.next}/**",
      4000,
    );
    this.cachedFilePaths = files.map((u) => u.fsPath);
    this.cachedAt = now;
    return this.cachedFilePaths;
  }

  private async postWorkspaceFiles() {
    const rootPath = this.getWorkspaceRoot();
    const files = await this.getWorkspaceFilePaths();

    const payload: Extract<
      ExtToWebviewMessage,
      { type: "workspaceFiles" }
    >["payload"] = {
      rootPath,
      rootName: rootPath ? path.basename(rootPath) : null,
      files: files.map((filePath) => ({
        path: filePath,
        label: vscode.workspace.asRelativePath(filePath, false),
      })),
    };

    this.panel.webview.postMessage({
      type: "workspaceFiles",
      payload,
    } satisfies ExtToWebviewMessage);
  }

  private postActiveFile() {
    const editor = this.getEditor();
    const message: ExtToWebviewMessage = editor
      ? {
          type: "activeFile",
          payload: {
            uri: editor.document.uri.toString(),
            fileName: path.basename(editor.document.fileName),
            languageId: editor.document.languageId,
            text: editor.document.getText(),
            isUntitled: editor.document.isUntitled,
          },
        }
      : { type: "activeFile", payload: null };

    this.panel.webview.postMessage(message);
  }

  private postSelection() {
    const editor = this.getEditor();
    if (!editor) {
      this.panel.webview.postMessage({
        type: "selection",
        payload: null,
      } satisfies ExtToWebviewMessage);
      return;
    }

    const sel = this.lastSelection ?? editor.selection;
    const selectionText = editor.document.getText(sel);

    const message: ExtToWebviewMessage = {
      type: "selection",
      payload: {
        uri: editor.document.uri.toString(),
        selectionText,
        start: { line: sel.start.line, character: sel.start.character },
        end: { line: sel.end.line, character: sel.end.character },
      },
    };

    this.panel.webview.postMessage(message);
  }

  private async postAnalysis(
    traceMode = false,
    reason: AnalysisRequestReason = "manual",
    traceScope: TraceScope = "single-file",
  ) {
    const debugEpoch = this.debugEpoch;
    const request = this.beginActiveAnalysis(reason);
    pushPanelDebugEvent("analysis.active.begin", {
      requestId: request.requestId,
      generation: request.generation,
      sequence: request.sequence,
      reason,
      traceMode,
      traceScope,
    });
    const editor = this.getEditor();
    if (!editor) {
      pushPanelDebugEvent("analysis.active.post.empty", {
        requestId: request.requestId,
        generation: request.generation,
      });
      this.panel.webview.postMessage({
        type: "analysisResult",
        payload: null,
        request,
      } satisfies ExtToWebviewMessage);
      return;
    }

    const doc = editor.document;
    const text = doc.getText();

    const result = await this.analyzeWorkspaceWithDepth({
      code: text,
      fileName: doc.fileName,
      languageId: doc.languageId,
      traceMode,
      graphDepth: this.graphDepth,
      traceScope,
    });
    const singleFileTrace = traceMode && (
      traceScope === "single-file" || this.graphDepth <= 0
    );
    const traceScopedGraph =
      singleFileTrace && result.graph ? pruneGraphToFile(result.graph, doc.fileName) : result.graph;
    const traceScopedTrace = traceMode
      ? pruneTraceToGraph(result.trace, traceScopedGraph)
      : result.trace;

    const payload: Extract<
      ExtToWebviewMessage,
      { type: "analysisResult" }
    >["payload"] = {
      uri: doc.uri.toString(),
      fileName: path.basename(doc.fileName),
      languageId: doc.languageId,
      stats: {
        chars: text.length,
        lines: text.split(/\r?\n/).length,
      },
      imports: result.imports,
      exports: result.exports,
      calls: result.calls,
      diagnostics: result.diagnostics,
      graph: traceScopedGraph,
      trace: traceMode ? traceScopedTrace : undefined,
      meta: result.meta,
    };

    if (request.sequence !== this.latestActiveAnalysisSequence ||
        (reason === "auto" && (debugEpoch !== this.debugEpoch || Boolean(vscode.debug.activeDebugSession)))) {
      pushPanelDebugEvent("analysis.active.drop.stale", {
        requestId: request.requestId,
        generation: request.generation,
        sequence: request.sequence,
        latestActiveSequence: this.latestActiveAnalysisSequence,
        file: doc.fileName,
      });
      return;
    }
    pushPanelDebugEvent("analysis.active.post", {
      requestId: request.requestId,
      generation: request.generation,
      sequence: request.sequence,
      filePath: doc.fileName,
      traceEvents: traceMode ? traceScopedTrace?.length ?? 0 : 0,
      diagnostics: result.diagnostics.length,
      ...getGraphCounts(traceScopedGraph),
    });

    this.panel.webview.postMessage({
      type: "analysisResult",
      payload,
      request,
    } satisfies ExtToWebviewMessage);
  }

  private async postAnalysisForFile(filePath: string, generation?: number) {
    if (generation !== undefined && generation !== this.analysisGeneration) {
      pushPanelDebugEvent("analysis.expand.skip.stale-request", {
        filePath,
        requestGeneration: generation,
        currentGeneration: this.analysisGeneration,
      });
      return;
    }

    const request = this.beginExpandAnalysis(generation ?? this.analysisGeneration);
    pushPanelDebugEvent("analysis.expand.begin", {
      requestId: request.requestId,
      generation: request.generation,
      sequence: request.sequence,
      filePath,
    });
    const uri = vscode.Uri.file(filePath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const code = new TextDecoder("utf-8").decode(bytes);

    const languageId = guessLanguageId(filePath);

    const result = await this.analyzeWorkspaceWithDepth({
      code,
      fileName: filePath,
      languageId,
      graphDepth: 0,
      traceMode: false,
      traceScope: "single-file",
    });

    const payload: Extract<
      ExtToWebviewMessage,
      { type: "analysisResult" }
    >["payload"] = {
      uri: uri.toString(),
      fileName: path.basename(filePath),
      languageId,
      stats: {
        chars: code.length,
        lines: code.split(/\r?\n/).length,
      },
      imports: result.imports,
      exports: result.exports,
      calls: result.calls,
      diagnostics: result.diagnostics,
      graph: result.graph,
      meta: result.meta,
    };

    if (request.generation !== this.analysisGeneration) {
      pushPanelDebugEvent("analysis.expand.drop.stale", {
        requestId: request.requestId,
        generation: request.generation,
        currentGeneration: this.analysisGeneration,
        filePath,
      });
      return;
    }

    pushPanelDebugEvent("analysis.expand.post", {
      requestId: request.requestId,
      generation: request.generation,
      sequence: request.sequence,
      filePath,
      diagnostics: result.diagnostics.length,
      ...getGraphCounts(result.graph),
    });
    this.panel.webview.postMessage({
      type: "analysisResult",
      payload,
      request,
    } satisfies ExtToWebviewMessage);
  }

  private getAnalysisCacheKey(args: {
    code: string;
    fileName: string;
    languageId: string;
    traceMode: boolean;
    graphDepth: number;
    traceScope: TraceScope;
  }, workspaceRoot: string | null, filePaths: readonly string[]) {
    const workspaceFilesHash = hashText(
      filePaths.map((filePath) => normalizeComparablePath(filePath)).sort().join("\n"),
    );

    return JSON.stringify({
      version: 1,
      fileName: normalizeComparablePath(args.fileName),
      languageId: args.languageId,
      codeHash: hashText(args.code),
      graphDepth: clampGraphDepth(args.graphDepth),
      traceMode: args.traceMode,
      traceScope: args.traceScope,
      workspaceRoot: workspaceRoot ? normalizeComparablePath(workspaceRoot) : null,
      workspaceFilesHash,
    });
  }

  private getCachedAnalysisResult(
    cacheKey: string,
    args: {
      fileName: string;
      graphDepth: number;
      traceMode: boolean;
      traceScope: TraceScope;
    },
  ) {
    const cached = this.analysisResultCache.get(cacheKey);
    if (!cached) {
      pushPanelDebugEvent("analysis.cache.miss", {
        filePath: args.fileName,
        graphDepth: args.graphDepth,
        traceMode: args.traceMode,
        traceScope: args.traceScope,
      });
      return null;
    }

    cached.lastAccessedAt = Date.now();
    pushPanelDebugEvent("analysis.cache.hit", {
      filePath: args.fileName,
      graphDepth: args.graphDepth,
      traceMode: args.traceMode,
      traceScope: args.traceScope,
      entries: this.analysisResultCache.size,
    });
    return cloneAnalysisResult(cached.result);
  }

  private storeAnalysisResult(cacheKey: string, result: DepthAnalysisResult) {
    this.analysisResultCache.set(cacheKey, {
      result: cloneAnalysisResult(result),
      lastAccessedAt: Date.now(),
    });
    this.pruneAnalysisResultCache();
    pushPanelDebugEvent("analysis.cache.store", {
      entries: this.analysisResultCache.size,
    });
  }

  private pruneAnalysisResultCache() {
    if (this.analysisResultCache.size <= MAX_ANALYSIS_RESULT_CACHE_ENTRIES) {
      return;
    }

    const sorted = [...this.analysisResultCache.entries()].sort(
      (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt,
    );
    const removeCount = this.analysisResultCache.size - MAX_ANALYSIS_RESULT_CACHE_ENTRIES;
    for (const [cacheKey] of sorted.slice(0, removeCount)) {
      this.analysisResultCache.delete(cacheKey);
    }
  }

  private async selectWorkspaceFile(
    filePath: string,
    traceMode = false,
    traceScope: TraceScope = "single-file",
  ) {
    if (!filePath) {
      return;
    }

    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: this.getPreferredEditorColumn(),
      preserveFocus: false,
      preview: true,
    });

    this.lastTextEditor = editor;
    this.lastSelection = editor.selection;

    this.postActiveFile();
    this.postSelection();
    await this.postAnalysis(
      traceMode,
      traceMode ? "trace" : "select-file",
      traceScope,
    );
  }

  private async analyzeWorkspaceWithDepth(args: {
    code: string;
    fileName: string;
    languageId: string;
    traceMode: boolean;
    graphDepth: number;
    traceScope: TraceScope;
  }) {
    const workspaceRoot = this.getWorkspaceRoot();
    const filePaths = await this.getWorkspaceFilePaths();
    const cacheEnabled = this.isAnalysisCacheEnabled();
    const cacheKey = cacheEnabled
      ? this.getAnalysisCacheKey(args, workspaceRoot, filePaths)
      : null;

    if (cacheKey) {
      const cached = this.getCachedAnalysisResult(cacheKey, args);
      if (cached) {
        return cached;
      }
    } else {
      pushPanelDebugEvent("analysis.cache.disabled", {
        filePath: args.fileName,
        graphDepth: args.graphDepth,
        traceMode: args.traceMode,
        traceScope: args.traceScope,
      });
    }

    const comparableWorkspacePaths = new Set(
      filePaths.map((filePath) => normalizeComparablePath(filePath)),
    );
    const analyzedFiles = new Set<string>([
      normalizeComparablePath(args.fileName),
    ]);

    const baseResult = analyzeWorkspaceActive({
      active: {
        code: args.code,
        fileName: args.fileName,
        languageId: args.languageId,
      },
      workspaceRoot,
      filePaths,
      debug: pushPanelDebugEvent,
      cacheEnabled,
    });

    let result: DepthAnalysisResult;

    if (!baseResult.graph) {
      result = baseResult;
    } else if (args.traceMode && args.traceScope === "single-file") {
      result = {
        ...baseResult,
        graph: pruneGraphToFile(baseResult.graph, args.fileName),
      };
    } else if (args.graphDepth <= 0) {
      result = {
        ...baseResult,
        graph: pruneGraphToFile(baseResult.graph, args.fileName),
      };
    } else if (args.graphDepth === 1) {
      result = baseResult;
    } else {
      let mergedGraph = baseResult.graph;
      let mergedTrace = baseResult.trace;
      let frontier = this.collectDepthExpansionFiles(
        baseResult.graph,
        comparableWorkspacePaths,
        analyzedFiles,
      );

      for (let hop = 0; hop < args.graphDepth - 1; hop += 1) {
        if (frontier.length === 0) {
          break;
        }

        const nextFrontier = new Set<string>();

        for (const targetFile of frontier) {
          const comparable = normalizeComparablePath(targetFile);
          analyzedFiles.add(comparable);

          try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(targetFile));
            const code = new TextDecoder("utf-8").decode(bytes);
            const expandedResult = analyzeWorkspaceActive({
              active: {
                code,
                fileName: targetFile,
                languageId: guessLanguageId(targetFile),
              },
              workspaceRoot,
              filePaths,
              debug: pushPanelDebugEvent,
              cacheEnabled,
            });

            mergedGraph = mergeGraphPayload(mergedGraph, expandedResult.graph) ?? mergedGraph;
            if (args.traceMode) {
              mergedTrace = mergeTracePayload(mergedTrace, expandedResult.trace) ?? mergedTrace;
            }

            for (const discoveredFile of this.collectDepthExpansionFiles(
              expandedResult.graph,
              comparableWorkspacePaths,
              analyzedFiles,
            )) {
              nextFrontier.add(discoveredFile);
            }
          } catch {
            // ignore unreadable expansion targets
          }
        }

        frontier = [...nextFrontier];
      }

      result = {
        ...baseResult,
        graph: mergedGraph,
        trace: args.traceMode ? mergedTrace : baseResult.trace,
      };
    }

    if (cacheKey) {
      this.storeAnalysisResult(cacheKey, result);
    }
    return result;
  }

  private collectDepthExpansionFiles(
    graph: NonNullable<ReturnType<typeof analyzeWorkspaceActive>["graph"]>,
    comparableWorkspacePaths: Set<string>,
    analyzedFiles: Set<string>,
  ) {
    const discovered = new Set<string>();

    for (const node of graph.nodes) {
      if (node.kind !== "external") {
        continue;
      }

      const comparable = normalizeComparablePath(node.file);
      if (
        analyzedFiles.has(comparable) ||
        !comparableWorkspacePaths.has(comparable) ||
        comparable.endsWith(".d.ts")
      ) {
        continue;
      }

      discovered.add(node.file);
    }

    return [...discovered];
  }

  private async saveExportFile(payload: {
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
  }) {
    const editor = this.getEditor();
    const workspaceRoot = this.getWorkspaceRoot();
    const defaultDir =
      workspaceRoot ??
      (editor?.document.isUntitled ? undefined : path.dirname(editor?.document.fileName ?? ""));

    const defaultUri = defaultDir
      ? vscode.Uri.file(path.join(defaultDir, payload.suggestedFileName))
      : undefined;

    const targetUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: payload.filters,
      saveLabel: payload.saveLabel,
      title: payload.title,
    });

    if (!targetUri) {
      this.panel.webview.postMessage({
        type: "flowExportResult",
        payload: { ok: false, canceled: true },
      } satisfies ExtToWebviewMessage);
      return;
    }

    const bytes =
      payload.content.kind === "text"
        ? new TextEncoder().encode(payload.content.text)
        : decodeBase64(payload.content.base64);

    await vscode.workspace.fs.writeFile(targetUri, bytes);

    this.panel.webview.postMessage({
      type: "flowExportResult",
      payload: { ok: true, filePath: targetUri.fsPath },
    } satisfies ExtToWebviewMessage);
  }

  private async openLocation(payload: {
    filePath: string;
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    preserveFocus?: boolean;
  }) {
    const { filePath, range, preserveFocus } = payload;
    if (!filePath) {
      return;
    }

    try {
      pushPanelDebugEvent("openLocation.begin", {
        filePath,
        preserveFocus: Boolean(preserveFocus),
        startLine: range?.start.line ?? null,
        endLine: range?.end.line ?? null,
      });
      const uri = vscode.Uri.file(filePath);
      if (!preserveFocus) {
        // Graph-click navigation should not replace the current graph via auto-analysis.
        this.suppressAutoAnalysis(uri.toString());
      }

      // 1) 이미 화면에 떠 있는(visible) editor가 있으면 그 editor를 재사용
      const existingEditor = vscode.window.visibleTextEditors.find(
        (ed) => ed.document.uri.fsPath === uri.fsPath,
      );

      let editor: vscode.TextEditor;

      if (existingEditor) {
        // 해당 탭으로 포커스 이동(열려있는 탭을 "가리키는" 느낌)
        editor = await vscode.window.showTextDocument(existingEditor.document, {
          viewColumn:
            existingEditor.viewColumn ?? this.getPreferredEditorColumn(),
          preserveFocus: Boolean(preserveFocus),
          preview: true,
        });
      } else {
        // 2) 없으면 새로 열기
        editor = await vscode.window.showTextDocument(uri, {
          viewColumn: this.getPreferredEditorColumn(),
          preserveFocus: Boolean(preserveFocus),
          preview: true,
        });
      }

      // 3) range reveal/selection
      if (range) {
        const r = new vscode.Range(
          new vscode.Position(range.start.line, range.start.character),
          new vscode.Position(range.end.line, range.end.character),
        );
        editor.selection = new vscode.Selection(r.start, r.end);
        editor.revealRange(r, vscode.TextEditorRevealType.InCenter);
        this.flashTraceHighlight(editor, r);
      }
      pushPanelDebugEvent("openLocation.success", {
        filePath,
        preserveFocus: Boolean(preserveFocus),
        reusedVisibleEditor: Boolean(existingEditor),
        viewColumn: editor.viewColumn ?? null,
        startLine: range?.start.line ?? null,
      });
    } catch (e) {
      dumpPanelDebugBuffer("openLocation.error", {
        filePath,
        preserveFocus: Boolean(preserveFocus),
        error: getErrorMessage(e),
      });
      this.postNotice(
        "toast",
        "error",
        "Failed to open code location",
        `${path.basename(filePath)}: ${getErrorMessage(e)}`,
        "openLocation",
      );
    }
  }

  private flashTraceHighlight(editor: vscode.TextEditor, range: vscode.Range) {
    for (const visibleEditor of vscode.window.visibleTextEditors) {
      visibleEditor.setDecorations(this.traceHighlightDecoration, []);
    }

    editor.setDecorations(this.traceHighlightDecoration, [range]);

    if (this.traceHighlightTimer) {
      clearTimeout(this.traceHighlightTimer);
    }
    this.traceHighlightTimer = setTimeout(() => {
      for (const visibleEditor of vscode.window.visibleTextEditors) {
        visibleEditor.setDecorations(this.traceHighlightDecoration, []);
      }
      this.traceHighlightTimer = undefined;
    }, 1200);
  }

  private async postPatchPreview(payload: Extract<
    WebviewToExtMessage,
    { type: "requestPatchPreview" }
  >["payload"]) {
    const requestId = `patch-preview-${Date.now()}`;
    const workspaceRoot = payload.options?.workspaceRoot ?? this.getWorkspaceRoot();
    const result = buildPatchPreview({
      design: payload.design,
      workspaceRoot,
    });

    this.patchPreviewStore.set(requestId, result.patches);
    this.panel.webview.postMessage({
      type: "patchPreviewResult",
      payload: {
        requestId,
        ok: true,
        patches: result.patches.map((patch) => patch.preview),
        warnings: result.warnings,
      },
    } satisfies ExtToWebviewMessage);
  }

  private async applyPatchPreview(payload: Extract<
    WebviewToExtMessage,
    { type: "applyPatchPreview" }
  >["payload"]) {
    const plans = this.patchPreviewStore.get(payload.requestId);
    if (!plans?.length) {
      this.panel.webview.postMessage({
        type: "patchApplyResult",
        payload: {
          requestId: payload.requestId,
          ok: false,
          error: "Patch preview request was not found.",
        },
      } satisfies ExtToWebviewMessage);
      return;
    }

    const selectedIds = new Set(payload.selectedPatchIds ?? []);
    const editedContentByPatchId = new Map(
      (payload.editedPatches ?? []).map((item) => [item.patchId, item.content]),
    );
    const effectivePlans =
      selectedIds.size > 0
        ? plans.filter((plan) => selectedIds.has(plan.preview.id))
        : plans;

    if (!effectivePlans.length) {
      this.panel.webview.postMessage({
        type: "patchApplyResult",
        payload: {
          requestId: payload.requestId,
          ok: false,
          error: "No patches were selected.",
        },
      } satisfies ExtToWebviewMessage);
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const appliedFiles: string[] = [];

    for (const plan of effectivePlans) {
      const editedContent = editedContentByPatchId.get(plan.preview.id);
      const operation = editedContent
        ? applyEditedContent(plan, editedContent)
        : plan.operation;

      switch (operation.kind) {
        case "mkdir": {
          const uri = vscode.Uri.file(operation.filePath);
          await vscode.workspace.fs.createDirectory(uri);
          appliedFiles.push(operation.filePath);
          break;
        }
        case "create": {
          const uri = vscode.Uri.file(operation.filePath);
          const parentDir = path.dirname(operation.filePath);
          if (parentDir && parentDir !== "." && parentDir !== operation.filePath) {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(parentDir));
          }
          edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
          edit.insert(uri, new vscode.Position(0, 0), operation.fullText);
          appliedFiles.push(operation.filePath);
          break;
        }
        case "update": {
          const uri = vscode.Uri.file(operation.filePath);
          if (operation.prependText) {
            edit.insert(uri, new vscode.Position(0, 0), operation.prependText);
          }

          const doc = await vscode.workspace.openTextDocument(uri);
          const lastLine = Math.max(0, doc.lineCount - 1);
          const lastCharacter = doc.lineAt(lastLine).text.length;
          edit.insert(
            uri,
            new vscode.Position(lastLine, lastCharacter),
            operation.appendText,
          );
          appliedFiles.push(operation.filePath);
          break;
        }
      }
    }

    const ok = await vscode.workspace.applyEdit(edit);
    this.panel.webview.postMessage({
      type: "patchApplyResult",
      payload: ok
        ? {
            requestId: payload.requestId,
            ok: true,
            appliedFiles,
          }
        : {
            requestId: payload.requestId,
            ok: false,
            error: "VS Code could not apply the generated patch.",
          },
    } satisfies ExtToWebviewMessage);
  }
}

function applyEditedContent(
  plan: GeneratedPatchPlan,
  editedContent: string,
): GeneratedPatchPlan["operation"] {
  const normalized = editedContent.replace(/\r\n/g, "\n").trimEnd();
  switch (plan.operation.kind) {
    case "mkdir":
      return plan.operation;
    case "create":
      return {
        ...plan.operation,
        fullText: normalized ? `${normalized}\n` : "",
      };
    case "update": {
      const leading = plan.operation.appendText.match(/^\s*/)?.[0] ?? "\n\n";
      return {
        ...plan.operation,
        appendText: normalized ? `${leading}${normalized}\n` : leading,
      };
    }
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Unknown error";
}

function decodeBase64(base64: string): Uint8Array {
  const buffer = Buffer.from(base64, "base64");
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function guessLanguageId(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) {
    return "typescriptreact";
  }
  if (lower.endsWith(".ts")) {
    return "typescript";
  }
  if (lower.endsWith(".jsx")) {
    return "javascriptreact";
  }
  if (lower.endsWith(".js")) {
    return "javascript";
  }
  return "typescript";
}
