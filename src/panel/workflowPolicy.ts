/** Editor changes during a debug session must not replace the exploration graph. */
export function shouldAutoAnalyzeEditorChange(debugging: boolean, matchesRoot: boolean): boolean {
  return !debugging && matchesRoot;
}

/** Suppress only a redundant activation; edits and saves must still schedule analysis. */
export function shouldSuppressActivationAnalysis(
  origin: "activation" | "change",
  explicit: { sequence: number; fileName: string } | undefined,
  latestSequence: number,
  activeFile: string | undefined,
) {
  return origin === "activation" && explicit !== undefined &&
    explicit.sequence === latestSequence && activeFile === explicit.fileName;
}

export function shouldRetainPendingChange(
  incoming: "activation" | "change",
  pending: "activation" | "change" | undefined,
) {
  return incoming === "activation" && pending === "change";
}
