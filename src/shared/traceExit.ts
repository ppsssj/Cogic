import { mayApplyActiveResult } from "./requestOwnership";

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

/** What the normal graph is analyzed from after a trace, following the graph root rules. */
export type TraceExitAnalysisTarget = { kind: "root-file"; path: string } | { kind: "active-file" } | null;

// Same comparison as App's normalizeComparablePath(dirName(...)) for a folder root.
const comparable = (p: string) => p.split("\\").join("/").toLowerCase();
const directoryOf = (p: string) => {
  const normalized = p.split("\\").join("/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : normalized;
};

/**
 * A file root is analyzed itself. A folder root analyzes the active file only when the file is
 * directly in that folder, as when the folder is chosen as a root and as the extension's
 * matchesGraphRoot; otherwise there is nothing to analyze and no file is picked for it.
 * Without a root, the active file is analyzed.
 */
export function traceExitAnalysisTarget(
  root: TraceExitRoot,
  activeFilePath: string | null,
): TraceExitAnalysisTarget {
  if (root?.kind === "file") {
    return { kind: "root-file", path: root.path };
  }
  if (!activeFilePath) {
    return null;
  }
  if (root?.kind === "folder" && comparable(directoryOf(activeFilePath)) !== comparable(root.path)) {
    return null;
  }
  return { kind: "active-file" };
}

export type ActiveResultState = {
  latestUserId: string | null;
  userPending: boolean;
  userSequence?: number;
  latestAppliedSequence: number;
  traceModeActive: boolean;
  /** The highest request sequence started when the last trace ended; null before any trace. */
  traceExitBoundary: number | null;
};

export type ActiveResultVerdict =
  | "apply"
  | "not-owner"
  | "stale"
  | "from-ended-trace"
  | "trace-after-exit";

/**
 * Whether an active-lane result may replace the graph. Ownership and the stale sequence rule
 * are the existing ones; after a trace, every request started during it is over, whatever its
 * origin and payload (trace, normal or empty), and a trace payload never applies outside a trace.
 */
export function gateActiveResult(
  result: {
    requestId: string;
    sequence: number;
    hasTrace: boolean;
    /** Requested in trace mode (request reason "trace"), whatever the payload. */
    traceRequest: boolean;
  },
  state: ActiveResultState,
): ActiveResultVerdict {
  if (!mayApplyActiveResult(result.requestId, state.latestUserId, state.userPending, result.sequence, state.userSequence)) {
    return "not-owner";
  }
  if (result.sequence < state.latestAppliedSequence) {
    return "stale";
  }
  if (state.traceExitBoundary !== null && result.sequence <= state.traceExitBoundary) {
    return "from-ended-trace";
  }
  // The request reason tells a trace analysis apart even when its payload is empty or has no
  // trace, and when its start was reported only after the exit.
  if ((result.hasTrace || result.traceRequest) && !state.traceModeActive) {
    return "trace-after-exit";
  }
  return "apply";
}

/**
 * A restored graph keeps the generation of the last applied trace result. A request the extension
 * started after it (its messages may still be on the way) moved the extension to a newer one, and
 * expanding with the old one would be refused. So the restore is confirmed by the generation the
 * extension reports when it leaves trace mode; until then expansions wait.
 */
export type RestoreCheck = { generation: number; queued: string[] };

export function queueExpandDuringCheck(
  check: RestoreCheck | null,
  filePath: string,
): { check: RestoreCheck | null; send: boolean } {
  if (!check) {
    return { check, send: true };
  }
  return { check: { ...check, queued: [...check.queued, filePath] }, send: false };
}

export function settleRestoreCheck(
  check: RestoreCheck | null,
  reported: { traceMode: boolean; generation: number },
): { outcome: "none" | "confirmed" | "reanalyze"; expand: string[] } {
  if (!check || reported.traceMode) {
    return { outcome: "none", expand: [] };
  }
  if (reported.generation === check.generation) {
    return { outcome: "confirmed", expand: check.queued };
  }
  return { outcome: "reanalyze", expand: [] };
}
