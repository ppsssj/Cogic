import { analyzeWithWorkspace, createAnalysisSession } from "./analyze";
import type { GraphPayload, GraphTraceEvent, TraceScope } from "../shared/protocol";

/**
 * Depth traversal used by the Code Graph panel (`CodeGraphPanel.analyzeWorkspaceWithDepth`), kept free of the VS Code
 * API so the same code path can be measured outside the extension host (P12-B). Behaviour is unchanged from the panel
 * implementation it was moved from, except that a Depth >= 2 run shares one `AnalysisSession` (Program structure reuse
 * with a fresh TypeChecker per analysis).
 */

export type DepthAnalysisResult = ReturnType<typeof analyzeWithWorkspace>;

type DebugLogger = (event: string, detail?: Record<string, unknown>) => void;

export function normalizeComparablePath(filePath: string) {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

export function guessLanguageId(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) {
    return "typescriptreact";
  }
  if (lower.endsWith(".ts")) {
    return "typescript";
  }
  if (lower.endsWith(".jsx")) {
    return "javascriptreact";
  }
  if (lower.endsWith(".js")) {
    return "javascript";
  }
  return "typescript";
}

export function mergeGraphPayload(
  prev: GraphPayload | undefined,
  next: GraphPayload | undefined,
) {
  if (!next) {return prev;}
  if (!prev) {return next;}

  const nodeById = new Map(
    prev.nodes.map((node) => [String((node as { id: string }).id), node]),
  );
  for (const node of next.nodes) {
    nodeById.set(String((node as { id: string }).id), node);
  }

  const edgeById = new Map(
    prev.edges.map((edge) => [String((edge as { id: string }).id), edge]),
  );
  for (const edge of next.edges) {
    edgeById.set(String((edge as { id: string }).id), edge);
  }

  return {
    nodes: [...nodeById.values()],
    edges: [...edgeById.values()],
  };
}

function getTraceEventKey(event: GraphTraceEvent) {
  return event.type === "node" ? `node:${event.node.id}` : `edge:${event.edge.id}`;
}

export function mergeTracePayload(
  prev: GraphTraceEvent[] | undefined,
  next: GraphTraceEvent[] | undefined,
) {
  if (!next) {return prev;}
  if (!prev) {return next;}

  const merged = [...prev];
  const seen = new Set(prev.map(getTraceEventKey));

  for (const event of next) {
    const key = getTraceEventKey(event);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(event);
  }

  return merged;
}

export function pruneGraphToFile(graph: GraphPayload, filePath: string) {
  const comparableFilePath = normalizeComparablePath(filePath);
  const keptNodes = graph.nodes.filter(
    (node) => normalizeComparablePath(node.file) === comparableFilePath,
  );
  const keptNodeIds = new Set(keptNodes.map((node) => node.id));
  const keptEdges = graph.edges.filter(
    (edge) => keptNodeIds.has(edge.source) && keptNodeIds.has(edge.target),
  );

  return {
    nodes: keptNodes,
    edges: keptEdges,
  };
}

export function collectDepthExpansionFiles(
  graph: GraphPayload,
  comparableWorkspacePaths: Set<string>,
  analyzedFiles: Set<string>,
) {
  const discovered = new Set<string>();

  for (const node of graph.nodes) {
    if (node.kind !== "external") {
      continue;
    }

    const comparable = normalizeComparablePath(node.file);
    if (
      analyzedFiles.has(comparable) ||
      !comparableWorkspacePaths.has(comparable) ||
      comparable.endsWith(".d.ts")
    ) {
      continue;
    }

    discovered.add(node.file);
  }

  return [...discovered];
}

export async function analyzeWorkspaceDepth(args: {
  code: string;
  fileName: string;
  languageId: string;
  traceMode: boolean;
  graphDepth: number;
  traceScope: TraceScope;
  workspaceRoot: string | null;
  filePaths: string[];
  cacheEnabled: boolean;
  /** Reads an expansion target (the panel uses `vscode.workspace.fs.readFile`). */
  readFile: (filePath: string) => Promise<string>;
  debug?: DebugLogger;
  /** P12-B Program session for Depth >= 2 runs. Default true; false restores the per-analysis Program path. */
  programSession?: boolean;
}): Promise<DepthAnalysisResult> {
  const { workspaceRoot, filePaths, cacheEnabled, debug } = args;
  const comparableWorkspacePaths = new Set(
    filePaths.map((filePath) => normalizeComparablePath(filePath)),
  );
  const analyzedFiles = new Set<string>([
    normalizeComparablePath(args.fileName),
  ]);
  const expands =
    args.graphDepth >= 2 && !(args.traceMode && args.traceScope === "single-file");
  const session =
    expands && cacheEnabled && args.programSession !== false ? createAnalysisSession() : undefined;

  try {
    const baseResult = analyzeWithWorkspace({
      active: {
        code: args.code,
        fileName: args.fileName,
        languageId: args.languageId,
      },
      workspaceRoot,
      filePaths,
      debug,
      cacheEnabled,
      session,
    });

    if (!baseResult.graph) {
      return baseResult;
    }
    if (args.traceMode && args.traceScope === "single-file") {
      return {
        ...baseResult,
        graph: pruneGraphToFile(baseResult.graph, args.fileName),
      };
    }
    if (args.graphDepth <= 0) {
      return {
        ...baseResult,
        graph: pruneGraphToFile(baseResult.graph, args.fileName),
      };
    }
    if (args.graphDepth === 1) {
      return baseResult;
    }

    let mergedGraph = baseResult.graph;
    let mergedTrace = baseResult.trace;
    let frontier = collectDepthExpansionFiles(
      baseResult.graph,
      comparableWorkspacePaths,
      analyzedFiles,
    );

    for (let hop = 0; hop < args.graphDepth - 1; hop += 1) {
      if (frontier.length === 0) {
        break;
      }

      const nextFrontier = new Set<string>();

      for (const targetFile of frontier) {
        const comparable = normalizeComparablePath(targetFile);
        analyzedFiles.add(comparable);

        try {
          const code = await args.readFile(targetFile);
          const expandedResult = analyzeWithWorkspace({
            active: {
              code,
              fileName: targetFile,
              languageId: guessLanguageId(targetFile),
            },
            workspaceRoot,
            filePaths,
            debug,
            cacheEnabled,
            session,
          });

          mergedGraph = mergeGraphPayload(mergedGraph, expandedResult.graph) ?? mergedGraph;
          if (args.traceMode) {
            mergedTrace = mergeTracePayload(mergedTrace, expandedResult.trace) ?? mergedTrace;
          }

          for (const discoveredFile of collectDepthExpansionFiles(
            expandedResult.graph,
            comparableWorkspacePaths,
            analyzedFiles,
          )) {
            nextFrontier.add(discoveredFile);
          }
        } catch {
          // ignore unreadable expansion targets
        }
      }

      frontier = [...nextFrontier];
    }

    return {
      ...baseResult,
      graph: mergedGraph,
      trace: args.traceMode ? mergedTrace : baseResult.trace,
    };
  } finally {
    session?.dispose();
  }
}
