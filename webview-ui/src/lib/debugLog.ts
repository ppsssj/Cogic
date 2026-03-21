import type { WebviewToExtMessage } from "../../../src/shared/protocol";

type DebugDetail = Record<string, unknown> | undefined;

export type WebviewDebugEntry = {
  seq: number;
  at: string;
  event: string;
  detail?: DebugDetail;
};

type WebviewDebugStore = {
  entries: WebviewDebugEntry[];
  nextSeq: number;
};

const MAX_DEBUG_ENTRIES = 80;

declare global {
  interface Window {
    __CODEGRAPH_WEBVIEW_DEBUG__?: WebviewDebugStore;
  }
}

function getStore(): WebviewDebugStore {
  if (!window.__CODEGRAPH_WEBVIEW_DEBUG__) {
    window.__CODEGRAPH_WEBVIEW_DEBUG__ = {
      entries: [],
      nextSeq: 1,
    };
  }
  return window.__CODEGRAPH_WEBVIEW_DEBUG__;
}

function forwardDebugEventToExtension(message: WebviewToExtMessage) {
  void message;
}

function shouldForwardDebugEvent(event: string, detail?: DebugDetail) {
  void event;
  void detail;
  return false;
}

export function pushWebviewDebugEvent(event: string, detail?: DebugDetail) {
  const store = getStore();
  const entry: WebviewDebugEntry = {
    seq: store.nextSeq++,
    at: new Date().toISOString(),
    event,
    detail,
  };
  store.entries.push(entry);
  if (store.entries.length > MAX_DEBUG_ENTRIES) {
    store.entries.splice(0, store.entries.length - MAX_DEBUG_ENTRIES);
  }
  if (shouldForwardDebugEvent(event, detail)) {
    forwardDebugEventToExtension({
      type: "debugEvent",
      payload: {
        event,
        detail,
        recent: getWebviewDebugBuffer().slice(-12),
      },
    });
  }
  return entry;
}

export function getWebviewDebugBuffer() {
  return [...getStore().entries];
}

export function dumpWebviewDebugBuffer(
  reason: string,
  detail?: DebugDetail,
  recentCount = 25,
) {
  void reason;
  void detail;
  void recentCount;
}
