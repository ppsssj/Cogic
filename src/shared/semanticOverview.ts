/**
 * P15-Z0 experiment: the lightest semantic-zoom level as a projection onto the existing collapse
 * state. Nothing new is drawn: every leaf folder (no visible subfolder) and every file is
 * collapsed, so the canvas shows folders and files only, and relations between them are drawn by
 * the existing aggregation (each aggregate keeps its original relations).
 *
 * Folder paths are the canvas folder keys; a folder's parent is the path without its last segment.
 */
export function overviewCollapse(
  visibleFolderPaths: readonly string[],
  visibleFilePaths: readonly string[],
): { folders: Set<string>; files: Set<string> } {
  const folders = new Set(visibleFolderPaths);
  const parentOf = (p: string) => {
    const i = p.lastIndexOf("/");
    return i > 0 ? p.slice(0, i) : null;
  };
  const hasSubfolder = new Set<string>();
  for (const folder of folders) {
    for (let parent = parentOf(folder); parent; parent = parentOf(parent)) {
      if (folders.has(parent)) {
        hasSubfolder.add(parent);
        break;
      }
    }
  }
  return {
    folders: new Set([...folders].filter((folder) => !hasSubfolder.has(folder))),
    files: new Set(visibleFilePaths),
  };
}
