/** Editor changes during a debug session must not replace the exploration graph. */
export function shouldAutoAnalyzeEditorChange(debugging: boolean, matchesRoot: boolean): boolean {
  return !debugging && matchesRoot;
}
