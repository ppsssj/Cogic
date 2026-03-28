import { analyzeTypeScriptWithTypes, analyzeWithWorkspace } from "./analyze";
import type { FrameworkSemanticAdapter } from "./adapters";
export {
  defaultFrameworkSemanticAdapters,
  resolveFrameworkCallbackHook,
  resolveFrameworkStateHook,
} from "./adapters";
export type {
  FrameworkCallbackHookResolution,
  FrameworkSemanticAdapter,
  FrameworkStateHookResolution,
} from "./adapters";

export function analyzeActiveFile(args: {
  code: string;
  fileName: string;
  languageId: string;
  adapters?: readonly FrameworkSemanticAdapter[];
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
}) {
  return analyzeWithWorkspace(args);
}
