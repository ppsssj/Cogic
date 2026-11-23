import { analyzeTypeScriptWithTypes, analyzeWithWorkspace } from "./analyze";
import type { AnalysisSession } from "./analyze";
import type { FrameworkSemanticAdapter } from "./adapters";
export {
  AnalysisSession,
  clearAnalyzerCaches,
  createAnalysisSession,
  getAnalyzerCacheStats,
  invalidateAnalyzerFileCaches,
} from "./analyze";
export {
  AnalysisCancelledError,
  throwIfAnalysisCancelled,
  analyzeWorkspaceDepth,
  collectDepthExpansionFiles,
  guessLanguageId,
  mergeGraphPayload,
  mergeTracePayload,
  normalizeComparablePath,
  pruneGraphToFile,
} from "./depth";
export type { DepthAnalysisResult } from "./depth";
export {
  defaultFrameworkSemanticAdapters,
  resolveFrameworkCallbackHook,
  resolveFrameworkDecoratedMethodOwner,
  resolveFrameworkStateHook,
} from "./adapters";
export type {
  FrameworkCallbackHookResolution,
  FrameworkDecoratedMethodOwnerResolution,
  FrameworkSemanticAdapter,
  FrameworkStateHookResolution,
} from "./adapters";

export function analyzeActiveFile(args: {
  code: string;
  fileName: string;
  languageId: string;
  adapters?: readonly FrameworkSemanticAdapter[];
  debug?: (event: string, detail?: Record<string, unknown>) => void;
  cacheEnabled?: boolean;
}) {
  // backward-compatible entrypoint (single-file only)
  return analyzeTypeScriptWithTypes(args);
}

/**
 * Workspace-aware analysis. If workspaceRoot/filePaths are provided, a multi-file Program is built.
 * - Uses tsconfig.json at workspaceRoot if present (preferred)
 * - Otherwise falls back to provided filePaths as program roots
 * - Always overrides the active file with in-memory code (unsaved edits included)
 */
export function analyzeWorkspaceActive(args: {
  active: { code: string; fileName: string; languageId: string };
  workspaceRoot: string | null;
  filePaths: string[]; // ts/js file paths in the workspace (absolute)
  adapters?: readonly FrameworkSemanticAdapter[];
  debug?: (event: string, detail?: Record<string, unknown>) => void;
  cacheEnabled?: boolean;
  /** P12-B: Program session of a Depth run (see `analyzeWorkspaceDepth`). Optional; omit for a standalone analysis. */
  session?: AnalysisSession;
}) {
  return analyzeWithWorkspace(args);
}
