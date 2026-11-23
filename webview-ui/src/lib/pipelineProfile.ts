import type { WebviewToExtMessage } from "./vscode";

export const pipelineEnabled = Boolean(document.querySelector('meta[name="cogic-pipeline-profile"][content="on"]'));
let send: ((message: WebviewToExtMessage) => void) | undefined;

export function configurePipelineProfile(post: (message: WebviewToExtMessage) => void) {
  if (pipelineEnabled) send = post;
}

export function profileWebview(event: string, requestId: string | null, detail: Record<string, unknown> = {}) {
  if (!pipelineEnabled || !requestId || !send) return;
  try {
    send({ type: "debugEvent", payload: { event: `pipeline.${event}`, detail: {
      requestId, monotonicMs: performance.now(), timeOrigin: performance.timeOrigin,
      wallTime: new Date().toISOString(), ...detail,
    } } });
  } catch {
    // Diagnostics must not interrupt the UI.
  }
}

export function newProfileRequestId() {
  return `web-${crypto.randomUUID()}`;
}
