// Webview-side VS Code API shim + message type exports.
//
// Single source of truth:
//   Import all protocol types from ../shared/protocol so the extension and webview
//   never drift.
//
// NOTE: Adjust the relative import path if your webview source lives in a different folder.

export type {
  WebviewToExtMessage,
  ExtToWebviewMessage,
  GraphNode,
  GraphPayload,
  GraphTraceEvent,
} from "../../../src/shared/protocol";

import type {
  WebviewToExtMessage,
  ExtToWebviewMessage,
} from "../../../src/shared/protocol";

export type VSCodeApi = {
  postMessage: (msg: WebviewToExtMessage) => void;
  getState: <T = unknown>() => T | undefined;
  setState: (state: unknown) => void;
};

declare global {
  interface Window {
    acquireVsCodeApi: () => VSCodeApi;
  }
}

export function getVSCodeApi(): VSCodeApi {
  // In the VS Code Webview this function is provided by the host.
  // During local dev (vite) `window.acquireVsCodeApi` is undefined —
  // provide a safe fallback so the UI can run in the browser.
  if (typeof window.acquireVsCodeApi === "function") {
    return window.acquireVsCodeApi();
  }

  // Dev fallback: log posted messages and keep simple state.
  let __vscode_state: unknown = undefined;
  return {
    postMessage: (msg: WebviewToExtMessage) => {
      // eslint-disable-next-line no-console
      console.debug("[vscode.postMessage - dev shim]", msg);
      try {
        window.dispatchEvent(new MessageEvent("message", { data: msg }));
      } catch {
        // ignore
      }
    },
    getState: <T = unknown>() => __vscode_state as T | undefined,
    setState: (s: unknown) => {
      __vscode_state = s;
    },
  };
}

export function isExtToWebviewMessage(x: unknown): x is ExtToWebviewMessage {
  if (!x || typeof x !== "object") return false;
  const t = (x as { type?: unknown }).type;
  return t === "activeFile" || t === "selection" || t === "analysisResult";
}
