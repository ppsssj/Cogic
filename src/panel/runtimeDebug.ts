import * as path from "path";
import * as vscode from "vscode";
import type {
  RuntimeDebugFrame,
  RuntimeDebugPayload,
  RuntimeDebugVariablePreview,
} from "../shared/protocol";
import { pushPanelDebugEvent } from "./debugLog";

type DapSource = {
  name?: string;
  path?: string;
};

type DapStackFrame = {
  id: number;
  name: string;
  source?: DapSource;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
};

type DapScope = {
  name?: string;
  presentationHint?: string;
  variablesReference?: number;
  expensive?: boolean;
};

type DapVariable = {
  name?: string;
  value?: string;
  type?: string;
  evaluateName?: string;
  variablesReference?: number;
};

type PostRuntimeDebug = (payload: RuntimeDebugPayload) => void;

function isDebugStackFrame(
  item: vscode.DebugThread | vscode.DebugStackFrame | undefined,
): item is vscode.DebugStackFrame {
  return typeof (item as vscode.DebugStackFrame | undefined)?.frameId === "number";
}

function clampText(value: string | undefined, max = 96) {
  if (!value) {
    return "";
  }
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= max) {
    return singleLine;
  }
  return `${singleLine.slice(0, max - 3)}...`;
}

function isMeaningfulVariable(variable: DapVariable) {
  const name = variable.name?.trim();
  if (!name) {
    return false;
  }

  if (
    name === "exports" ||
    name === "module" ||
    name === "require" ||
    name === "__dirname" ||
    name === "__filename" ||
    name === "global" ||
    name === "globalThis"
  ) {
    return false;
  }

  return true;
}

function summarizeVariableValue(variable: DapVariable) {
  const raw = clampText(variable.value, 56);
  if (raw === "[object Object]") {
    return "{...}";
  }
  if (
    variable.variablesReference &&
    variable.variablesReference > 0 &&
    (raw.startsWith("{") ||
      raw.startsWith("[") ||
      raw.includes("Object") ||
      raw.includes("Array"))
  ) {
    return raw.length > 0 ? raw : "{...}";
  }
  return raw;
}

function toZeroBased(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, value - 1);
}

function toSessionInfo(session: vscode.DebugSession) {
  return {
    id: session.id,
    name: session.name,
    type: session.type,
  };
}

function normalizeFilePath(rawPath: unknown) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return undefined;
  }
  if (rawPath.startsWith("file://")) {
    try {
      return vscode.Uri.parse(rawPath).fsPath;
    } catch {
      return rawPath;
    }
  }
  if (!path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.normalize(rawPath);
}

function toFrame(frame: DapStackFrame | undefined): RuntimeDebugFrame | null {
  if (!frame || typeof frame.id !== "number") {
    return null;
  }
  return {
    id: frame.id,
    name: frame.name || "(anonymous frame)",
    sourceName: frame.source?.name,
    filePath: normalizeFilePath(frame.source?.path),
    line: toZeroBased(frame.line),
    column: toZeroBased(frame.column),
    endLine: toZeroBased(frame.endLine),
    endColumn: toZeroBased(frame.endColumn),
  };
}

export class RuntimeDebugBridge implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly stoppedThreadIdBySession = new Map<string, number>();
  private readonly syncTimerBySession = new Map<string, NodeJS.Timeout>();
  private lastPayload: RuntimeDebugPayload = {
    state: "inactive",
    updatedAt: new Date().toISOString(),
  };

  constructor(private readonly postRuntimeDebug: PostRuntimeDebug) {
    this.disposables.push(
      vscode.debug.onDidStartDebugSession((session) => {
        pushPanelDebugEvent("runtimeDebug.session.started", {
          sessionId: session.id,
          sessionName: session.name,
          debugType: session.type,
        });
        if (vscode.debug.activeDebugSession?.id === session.id) {
          this.emitRunning(session, "started");
          if (this.shouldAttemptSync(session)) {
            this.scheduleSync(session, "started");
          }
        }
      }),
      vscode.debug.onDidTerminateDebugSession((session) => {
        pushPanelDebugEvent("runtimeDebug.session.terminated", {
          sessionId: session.id,
          sessionName: session.name,
          debugType: session.type,
        });
        this.stoppedThreadIdBySession.delete(session.id);
        this.clearSyncTimer(session.id);
        if (this.lastPayload.session?.id === session.id) {
          const active = vscode.debug.activeDebugSession;
          if (active && active.id !== session.id) {
            this.emitRunning(active, "session-switched");
            this.scheduleSync(active, "session-switched");
          } else {
            this.emitInactive("terminated");
          }
        }
      }),
      vscode.debug.onDidChangeActiveDebugSession((session) => {
        pushPanelDebugEvent("runtimeDebug.activeSession.changed", {
          sessionId: session?.id ?? null,
          sessionName: session?.name ?? null,
          debugType: session?.type ?? null,
        });
        if (!session) {
          this.emitInactive("no-active-session");
          return;
        }
        this.emitRunning(session, "active-session");
        if (this.shouldAttemptSync(session)) {
          this.scheduleSync(session, "active-session");
        }
      }),
      vscode.debug.onDidChangeActiveStackItem((item) => {
        pushPanelDebugEvent("runtimeDebug.activeStackItem.changed", {
          sessionId: item?.session.id ?? null,
          threadId: item?.threadId ?? null,
          frameId: isDebugStackFrame(item) ? item.frameId : null,
        });
        if (!item) {
          const active = vscode.debug.activeDebugSession;
          if (active) {
            this.emitRunning(active, "stack-cleared");
          } else {
            this.emitInactive("no-active-stack-item");
          }
          return;
        }
        if (isDebugStackFrame(item)) {
          this.scheduleSync(item.session, "active-stack-item");
          return;
        }
        this.emitRunning(item.session, "active-thread");
      }),
      vscode.debug.registerDebugAdapterTrackerFactory("*", {
        createDebugAdapterTracker: (session) => ({
          onDidSendMessage: (message: any) => {
            if (!message || message.type !== "event") {
              return;
            }

            if (message.event === "stopped") {
              const threadId =
                typeof message.body?.threadId === "number"
                  ? message.body.threadId
                  : undefined;
              if (threadId !== undefined) {
                this.stoppedThreadIdBySession.set(session.id, threadId);
              }
              this.scheduleSync(
                session,
                "dap.stopped",
                typeof message.body?.reason === "string"
                  ? message.body.reason
                  : undefined,
              );
              return;
            }

            if (message.event === "continued") {
              this.stoppedThreadIdBySession.delete(session.id);
              this.emitRunning(session, "continued");
              return;
            }

            if (message.event === "terminated" || message.event === "exited") {
              if (this.lastPayload.session?.id === session.id) {
                this.emitInactive(message.event);
              }
            }
          },
        }),
      }),
    );

    const activeSession = vscode.debug.activeDebugSession;
    if (activeSession) {
      this.emitRunning(activeSession, "init");
      if (this.shouldAttemptSync(activeSession)) {
        this.scheduleSync(activeSession, "init");
      }
    } else {
      this.emitInactive("init");
    }
  }

  dispose() {
    for (const timer of this.syncTimerBySession.values()) {
      clearTimeout(timer);
    }
    this.syncTimerBySession.clear();
    this.stoppedThreadIdBySession.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  getLastPayload() {
    return this.lastPayload;
  }

  private emit(payload: RuntimeDebugPayload) {
    this.lastPayload = payload;
    this.postRuntimeDebug(payload);
  }

  private emitInactive(reason?: string) {
    this.emit({
      state: "inactive",
      reason,
      updatedAt: new Date().toISOString(),
    });
  }

  private emitRunning(session: vscode.DebugSession, reason?: string) {
    this.emit({
      state: "running",
      session: toSessionInfo(session),
      reason,
      updatedAt: new Date().toISOString(),
    });
  }

  private clearSyncTimer(sessionId: string) {
    const timer = this.syncTimerBySession.get(sessionId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.syncTimerBySession.delete(sessionId);
  }

  private scheduleSync(
    session: vscode.DebugSession,
    origin: string,
    reason?: string,
  ) {
    this.clearSyncTimer(session.id);
    const timer = setTimeout(() => {
      this.syncTimerBySession.delete(session.id);
      void this.syncPausedState(session, origin, reason);
    }, 30);
    this.syncTimerBySession.set(session.id, timer);
  }

  private shouldAttemptSync(session: vscode.DebugSession) {
    const activeItem = vscode.debug.activeStackItem;
    return (
      (activeItem?.session.id === session.id && isDebugStackFrame(activeItem)) ||
      this.stoppedThreadIdBySession.has(session.id)
    );
  }

  private async syncPausedState(
    session: vscode.DebugSession,
    origin: string,
    reason?: string,
  ) {
    try {
      const activeItem = vscode.debug.activeStackItem;
      const activeThreadId =
        activeItem?.session.id === session.id ? activeItem.threadId : undefined;
      const activeFrameId =
        activeItem?.session.id === session.id && isDebugStackFrame(activeItem)
          ? activeItem.frameId
          : undefined;
      const threadId =
        activeThreadId ?? this.stoppedThreadIdBySession.get(session.id);

      if (threadId === undefined) {
        this.emitRunning(session, reason ?? origin);
        return;
      }

      pushPanelDebugEvent("runtimeDebug.sync.begin", {
        sessionId: session.id,
        origin,
        reason: reason ?? null,
        threadId,
        frameId: activeFrameId ?? null,
      });

      const stack = await session.customRequest("stackTrace", {
        threadId,
        startFrame: 0,
        levels: 20,
      });
      const stackFrames = Array.isArray(stack?.stackFrames)
        ? (stack.stackFrames as DapStackFrame[])
        : [];

      const targetFrame =
        (activeFrameId !== undefined
          ? stackFrames.find((frame) => frame.id === activeFrameId)
          : undefined) ?? stackFrames[0];

      const runtimeFrame = toFrame(targetFrame);
      const variables = runtimeFrame
        ? await this.loadVariables(session, runtimeFrame.id)
        : [];

      this.emit({
        state: "paused",
        session: toSessionInfo(session),
        reason: reason ?? "paused",
        threadId,
        frame: runtimeFrame,
        variables,
        updatedAt: new Date().toISOString(),
      });

      pushPanelDebugEvent("runtimeDebug.sync.complete", {
        sessionId: session.id,
        threadId,
        frameId: runtimeFrame?.id ?? null,
        filePath: runtimeFrame?.filePath ?? null,
        line: runtimeFrame?.line ?? null,
        variableCount: variables.length,
      });
    } catch (error) {
      pushPanelDebugEvent("runtimeDebug.sync.failed", {
        sessionId: session.id,
        origin,
        reason: reason ?? null,
        error: getErrorMessage(error),
      });
      this.emit({
        state: "paused",
        session: toSessionInfo(session),
        reason: reason ?? "paused",
        threadId: this.stoppedThreadIdBySession.get(session.id),
        frame: null,
        variables: [],
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private async loadVariables(
    session: vscode.DebugSession,
    frameId: number,
  ): Promise<RuntimeDebugVariablePreview[]> {
    try {
      const scopesResponse = await session.customRequest("scopes", { frameId });
      const scopes = Array.isArray(scopesResponse?.scopes)
        ? (scopesResponse.scopes as DapScope[])
        : [];

      const preferredScopes = [...scopes].sort((a, b) => {
        return this.scopeRank(a) - this.scopeRank(b);
      });

      const out: RuntimeDebugVariablePreview[] = [];
      const seen = new Set<string>();

      for (const scope of preferredScopes) {
        if (out.length >= 5) {
          break;
        }
        if (!scope.variablesReference || scope.variablesReference <= 0) {
          continue;
        }
        if (scope.expensive) {
          continue;
        }

        const variables = await this.fetchVariables(
          session,
          scope.variablesReference,
        );
        for (const variable of variables) {
          if (out.length >= 5) {
            break;
          }
          if (!isMeaningfulVariable(variable)) {
            continue;
          }
          const dedupeKey = `${scope.presentationHint ?? scope.name ?? "variables"}:${variable.name}`;
          if (seen.has(dedupeKey)) {
            continue;
          }
          seen.add(dedupeKey);
          out.push({
            scope: scope.presentationHint ?? scope.name ?? "variables",
            name: variable.name!,
            value: summarizeVariableValue(variable),
            type: variable.type,
            evaluateName: variable.evaluateName,
            variablesReference: variable.variablesReference,
          });
        }
      }

      return out;
    } catch (error) {
      pushPanelDebugEvent("runtimeDebug.variables.failed", {
        frameId,
        error: getErrorMessage(error),
      });
      return [];
    }
  }

  private async fetchVariables(
    session: vscode.DebugSession,
    variablesReference: number,
  ): Promise<DapVariable[]> {
    try {
      const response = await session.customRequest("variables", {
        variablesReference,
        filter: "named",
        start: 0,
        count: 6,
      });
      return Array.isArray(response?.variables)
        ? (response.variables as DapVariable[])
        : [];
    } catch {
      const response = await session.customRequest("variables", {
        variablesReference,
      });
      return Array.isArray(response?.variables)
        ? (response.variables as DapVariable[]).slice(0, 6)
        : [];
    }
  }

  private scopeRank(scope: DapScope) {
    const name = (scope.name ?? "").toLowerCase();
    const hint = (scope.presentationHint ?? "").toLowerCase();
    if (hint === "locals" || name.includes("local")) {
      return 0;
    }
    if (hint === "arguments" || name.includes("arg")) {
      return 1;
    }
    if (!scope.expensive) {
      return 2;
    }
    return 3;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Unknown error";
}
