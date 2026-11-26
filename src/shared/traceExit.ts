/**
 * What to show when a trace ends. The trace replaces the normal graph with partial step graphs,
 * so the normal graph has to come back from somewhere:
 * - `restore`: the normal graph from just before the trace, when it still describes what would
 *   be analyzed now;
 * - `reanalyze`: a new normal analysis of the current target;
 * - `empty`: nothing to analyze, the normal "No graph" state.
 */
export type TraceExitAction = "restore" | "reanalyze" | "empty";

export type TraceExitRoot = { kind: "file" | "folder"; path: string } | null;

export type PreTraceTarget = {
  /** The normal graph existed (a trace step graph is never taken as one). */
  hasGraph: boolean;
  root: TraceExitRoot;
  graphDepth: number;
  workspaceRoot: string | null;
  /** Without a root, the graph follows the active editor. */
  activeFileUri: string | null;
};

export type TraceExitState = {
  /** The root now. Starting a trace clears it, so a root here was chosen during the trace. */
  root: TraceExitRoot;
  graphDepth: number;
  workspaceRoot: string | null;
  activeFileUri: string | null;
  /** An open document changed while the trace ran. */
  sourceChanged: boolean;
  /**
   * A trace result was applied. Starting the trace moved the extension to a new graph
   * generation, and only a result carries it; without one, expanding files of the restored graph
   * would be refused as stale.
   */
  generationKnown: boolean;
  /** There is a file to analyze (a root file or an active editor). */
  hasTarget: boolean;
};

const sameRoot = (a: TraceExitRoot, b: TraceExitRoot) =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.path === b.path);

export function decideTraceExit(
  snapshot: PreTraceTarget | null,
  now: TraceExitState,
): TraceExitAction {
  const unchanged =
    snapshot !== null &&
    snapshot.hasGraph &&
    (now.root === null || sameRoot(now.root, snapshot.root)) &&
    // Without a root on either side, another active editor is another target.
    (snapshot.root !== null || now.root !== null || now.activeFileUri === snapshot.activeFileUri) &&
    now.graphDepth === snapshot.graphDepth &&
    now.workspaceRoot === snapshot.workspaceRoot &&
    !now.sourceChanged &&
    now.generationKnown;
  if (unchanged) {
    return "restore";
  }
  return now.hasTarget ? "reanalyze" : "empty";
}
