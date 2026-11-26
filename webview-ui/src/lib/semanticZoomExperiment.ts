import { useSyncExternalStore } from "react";
import type { Viewport } from "reactflow";

/**
 * P15-Z0 experiment switch, for the benchmark harness only. The default is the baseline, and
 * nothing in the product UI changes it. The mode changes only through
 * window.__cgSemanticZoomExperiment.setMode, never during pan or zoom.
 *
 * - baseline: the graph as it is;
 * - overview: every leaf folder and every file collapsed (see src/shared/semanticOverview.ts);
 * - local: one fixed overlay with the selected function's details.
 */
export type SemanticZoomMode = "baseline" | "overview" | "local";

type Counters = {
  canvas: number;
  codeNode: number;
  fileGroup: number;
  folderGroup: number;
  customEdge: number;
  overlay: number;
};

type ExperimentApi = {
  getMode: () => SemanticZoomMode;
  setMode: (mode: SemanticZoomMode) => void;
  /** Render calls of Cogic's own components since the last reset (not React commits). */
  counters: Counters;
  resetCounters: () => void;
  /** Registered by the canvas: puts the view at an exact viewport. */
  setViewport?: (viewport: Viewport) => void;
  /** Registered by the canvas: expands every file and folder (the baseline's heavy state). */
  expandAll?: () => void;
};

declare global {
  interface Window {
    __cgSemanticZoomExperiment?: ExperimentApi;
  }
}

let mode: SemanticZoomMode = "baseline";
const listeners = new Set<() => void>();
const zero = (): Counters => ({ canvas: 0, codeNode: 0, fileGroup: 0, folderGroup: 0, customEdge: 0, overlay: 0 });

export const experiment: ExperimentApi = {
  getMode: () => mode,
  setMode: (next) => {
    if (next === mode) return;
    mode = next;
    listeners.forEach((listener) => listener());
  },
  counters: zero(),
  resetCounters: () => {
    experiment.counters = zero();
  },
};
window.__cgSemanticZoomExperiment = experiment;

export function countRender(kind: keyof Counters) {
  experiment.counters[kind] += 1;
}

export function useSemanticZoomMode(): SemanticZoomMode {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => mode,
  );
}
