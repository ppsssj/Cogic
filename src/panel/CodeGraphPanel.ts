import * as vscode from "vscode";
import * as path from "path";
import { getWebviewHtml } from "../webview/html";
import { analyzeWorkspaceActive } from "../analyzer";
import type {
  ExtToWebviewMessage,
  WebviewToExtMessage,
} from "../shared/protocol";

export class CodeGraphPanel {
  private lastTextEditor: vscode.TextEditor | undefined;
  private lastSelection: vscode.Selection | undefined;
  private analysisTimer: NodeJS.Timeout | undefined;

  // cache workspace file list (ts/js)
  private cachedFilePaths: string[] = [];
  private cachedAt = 0;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
  ) {}

  static open(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
      "codegraph",
      "CodeGraph",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "media", "webview")),
        ],
      },
    );

    const inst = new CodeGraphPanel(context, panel);
    inst.init();
  }

  private init() {
    this.panel.webview.html = getWebviewHtml(this.context, this.panel.webview);

    this.lastTextEditor = vscode.window.activeTextEditor;
    this.lastSelection = vscode.window.activeTextEditor?.selection;

    this.panel.webview.onDidReceiveMessage(
      async (msg: WebviewToExtMessage) => {
        try {
          if (msg.type === "requestActiveFile") return this.postActiveFile();
          if (msg.type === "requestSelection") return this.postSelection();
          if (msg.type === "analyzeActiveFile") return this.postAnalysis(); // workspace-aware
          if (msg.type === "analyzeWorkspace") return this.postAnalysis(); // explicit
          if (msg.type === "expandNode")
            return this.postAnalysisForFile(msg.payload.filePath);
          if (msg.type === "openLocation")
            return this.openLocation(msg.payload);
        } catch (e) {
          console.error("[codegraph] onDidReceiveMessage error:", e);
        }
      },
      undefined,
      this.context.subscriptions,
    );

    // initial push
    this.postActiveFile();
    this.postSelection();

    // ---- auto-analysis for active file changes (debounced) ----
    const scheduleAnalysis = (delayMs: number) => {
      if (this.analysisTimer) clearTimeout(this.analysisTimer);
      this.analysisTimer = setTimeout(
        () => {
          try {
            void this.postAnalysis();
          } catch (e) {
            console.error("[codegraph] auto-analysis error:", e);
          }
        },
        Math.max(0, delayMs),
      );
    };

    const subActive = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        this.lastTextEditor = editor;
        this.lastSelection = editor.selection;
      }
      this.postActiveFile();
      scheduleAnalysis(0);
    });

    const subChange = vscode.workspace.onDidChangeTextDocument((e) => {
      const active =
        this.lastTextEditor?.document ??
        vscode.window.activeTextEditor?.document;
      if (!active) return;
      if (e.document.uri.toString() !== active.uri.toString()) return;

      this.postActiveFile();
      scheduleAnalysis(350);
    });

    const subSave = vscode.workspace.onDidSaveTextDocument((doc) => {
      const active =
        this.lastTextEditor?.document ??
        vscode.window.activeTextEditor?.document;
      if (!active) return;
      if (doc.uri.toString() !== active.uri.toString()) return;

      scheduleAnalysis(0);
    });

    const subSelection = vscode.window.onDidChangeTextEditorSelection((e) => {
      this.lastTextEditor = e.textEditor;
      this.lastSelection = e.selections?.[0];
      this.postSelection();
    });

    // invalidate cache when files change (coarse)
    const subFs = vscode.workspace.onDidCreateFiles(() =>
      this.invalidateWorkspaceCache(),
    );
    const subFs2 = vscode.workspace.onDidDeleteFiles(() =>
      this.invalidateWorkspaceCache(),
    );
    const subFs3 = vscode.workspace.onDidRenameFiles(() =>
      this.invalidateWorkspaceCache(),
    );

    this.panel.onDidDispose(() => {
      subActive.dispose();
      subChange.dispose();
      subSave.dispose();
      subSelection.dispose();
      subFs.dispose();
      subFs2.dispose();
      subFs3.dispose();
      if (this.analysisTimer) clearTimeout(this.analysisTimer);
    });
  }

  private invalidateWorkspaceCache() {
    this.cachedAt = 0;
    this.cachedFilePaths = [];
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

  private async postAnalysis() {
    const editor = this.getEditor();
    if (!editor) {
      this.panel.webview.postMessage({
        type: "analysisResult",
        payload: null,
      } satisfies ExtToWebviewMessage);
      return;
    }

    const doc = editor.document;
    const text = doc.getText();

    const workspaceRoot = this.getWorkspaceRoot();
    const filePaths = await this.getWorkspaceFilePaths();

    const result = analyzeWorkspaceActive({
      active: {
        code: text,
        fileName: doc.fileName,
        languageId: doc.languageId,
      },
      workspaceRoot,
      filePaths,
    });

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
      graph: result.graph,
      meta: result.meta,
    };

    console.log("[analysis.meta]", result.meta);
    console.log(
      "[analysis.graph counts]",
      "nodes=",
      result.graph.nodes.length,
      "edges=",
      result.graph.edges.length,
    );

    this.panel.webview.postMessage({
      type: "analysisResult",
      payload,
    } satisfies ExtToWebviewMessage);
  }

  private async postAnalysisForFile(filePath: string) {
    const workspaceRoot = this.getWorkspaceRoot();
    const filePaths = await this.getWorkspaceFilePaths();

    const uri = vscode.Uri.file(filePath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const code = new TextDecoder("utf-8").decode(bytes);

    const languageId = guessLanguageId(filePath);

    const result = analyzeWorkspaceActive({
      active: { code, fileName: filePath, languageId },
      workspaceRoot,
      filePaths,
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
      graph: result.graph,
      meta: result.meta,
    };

    this.panel.webview.postMessage({
      type: "analysisResult",
      payload,
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
    if (!filePath) return;

    try {
      const uri = vscode.Uri.file(filePath);

      // 1) 이미 화면에 떠 있는(visible) editor가 있으면 그 editor를 재사용
      const existingEditor = vscode.window.visibleTextEditors.find(
        (ed) => ed.document.uri.fsPath === uri.fsPath,
      );

      let editor: vscode.TextEditor;

      if (existingEditor) {
        // 해당 탭으로 포커스 이동(열려있는 탭을 "가리키는" 느낌)
        editor = await vscode.window.showTextDocument(existingEditor.document, {
          viewColumn: existingEditor.viewColumn,
          preserveFocus: Boolean(preserveFocus),
          preview: true,
        });
      } else {
        // 2) 없으면 새로 열기
        editor = await vscode.window.showTextDocument(uri, {
          viewColumn: vscode.ViewColumn.Active,
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
      }
    } catch (e) {
      console.error("[codegraph] openLocation error:", e);
      void vscode.window.showErrorMessage(
        `CodeGraph: Failed to open location: ${filePath}`,
      );
    }
  }
}

function guessLanguageId(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return "typescriptreact";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".jsx")) return "javascriptreact";
  if (lower.endsWith(".js")) return "javascript";
  return "typescript";
}
