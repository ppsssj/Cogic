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
export type EdgeStyle = "default" | "static-dash" | "static-solid";

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
  /**
   * P15-Z0A: edge stroke style, as classes on the canvas container only (no React render):
   * "default" as shipped, "static-dash" stops the dash animation, "static-solid" also draws
   * solid strokes. React Flow's `animated` flag and every node and edge stay as they are.
   */
  setEdgeStyle: (style: EdgeStyle) => EdgeStyle | null;
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
  setEdgeStyle: (style) => {
    const canvas = document.querySelector<HTMLElement>(".canvasFlow");
    if (!canvas) return null;
    canvas.classList.toggle("cgExp--staticEdges", style !== "default");
    canvas.classList.toggle("cgExp--solidEdges", style === "static-solid");
    return style;
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
