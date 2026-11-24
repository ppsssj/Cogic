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

/** Suppress only activation of the selected or currently programmatically shown file. */
export function shouldSuppressPendingSelectionActivation(origin: "activation" | "change", pendingFile: string | undefined, activeFile: string | undefined, showingFile?: string): boolean {
  return origin === "activation" && pendingFile !== undefined && activeFile !== undefined &&
    (activeFile === pendingFile || activeFile === showingFile);
}

/** Only an identical, still-valid delivered result can make a later activation redundant. */
export function shouldSuppressDeliveredActivation(origin: "activation" | "change", currentKey: string | undefined, deliveredKey: string | undefined): boolean {
  return origin === "activation" && currentKey !== undefined && currentKey === deliveredKey;
}

export function activationFingerprint(identity: {
  file: string; languageId: string; codeHash: string; graphDepth: number;
  traceMode: boolean; traceScope: string; cacheEpoch: number; graphRootEpoch: number;
}): string {
  return JSON.stringify(identity);
}
