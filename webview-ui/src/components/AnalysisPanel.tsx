// import "./../App.css";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Network,
  Sigma,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  CodeDiagnostic,
  ExtToWebviewMessage,
  GraphNode,
  GraphPayload,
} from "../lib/vscode";
import "./AnalysisPanel.css";

type AnalysisPayload = Extract<
  ExtToWebviewMessage,
  { type: "analysisResult" }
>["payload"];

type CollapseDirection = "vertical" | "horizontal";

type Props = {
  analysis: AnalysisPayload;
  graph?: GraphPayload;
  selectedNodeId?: string | null;
  selectedNodeOrigin?:
    | "graph"
    | "runtime"
    | "selected-evidence"
    | "analysis-graph"
    | "analysis-import"
    | "analysis-call"
    | "analysis-diagnostic";
  className?: string;
  collapsedLabel?: string;
  onOpenDiagnostic?: (diagnostic: CodeDiagnostic) => void;
  onSelectGraphNode?: (
    nodeId: string,
    origin?:
      | "graph"
      | "runtime"
      | "selected-evidence"
      | "analysis-graph"
      | "analysis-import"
      | "analysis-call"
      | "analysis-diagnostic",
  ) => void;
  onActivateGraphNode?: (
    nodeId: string,
    origin?:
      | "graph"
      | "runtime"
      | "selected-evidence"
      | "analysis-graph"
      | "analysis-import"
      | "analysis-call"
      | "analysis-diagnostic",
  ) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  collapseDirection?: CollapseDirection;
};

type CallV1 = { name: string; count: number };
type CallV2 = {
  calleeName: string;
  count: number;
  declFile: string | null;
  declRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  } | null;
  isExternal: boolean;
};

function isCallV2(c: CallV1 | CallV2): c is CallV2 {
  return "calleeName" in c;
}

function shortFile(p: string) {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function normalizePath(p: string) {
  return p.replace(/\\/g, "/");
}

function comparePos(
  a: { line: number; character: number },
  b: { line: number; character: number },
) {
  if (a.line !== b.line) return a.line - b.line;
  return a.character - b.character;
}

function rangeSize(range: GraphNode["range"]) {
  return (
    (range.end.line - range.start.line) * 1_000_000 +
    (range.end.character - range.start.character)
  );
}

function rangesOverlap(
  a: GraphNode["range"],
  b: NonNullable<CodeDiagnostic["range"]>,
) {
  return comparePos(a.start, b.end) <= 0 && comparePos(b.start, a.end) <= 0;
}

function distanceToRange(
  pos: { line: number; character: number },
  range: GraphNode["range"],
) {
  if (comparePos(pos, range.start) < 0) {
    return (
      (range.start.line - pos.line) * 1_000_000 +
      (range.start.character - pos.character)
    );
  }
  if (comparePos(pos, range.end) > 0) {
    return (
      (pos.line - range.end.line) * 1_000_000 +
      (pos.character - range.end.character)
    );
  }
  return 0;
}

function stripNodeDisplayMeta(name: string) {
  return name.replace(/\s+\([^)]*\)(?:\s+\[lib\])?$/, "").trim();
}

function stripCtorPrefix(name: string) {
  return name.replace(/^new\s+/, "").trim();
}

function uniqueNames(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function nameMatchScore(node: GraphNode, preferredNames: string[]) {
  if (!preferredNames.length) return 0;

  const rawName = node.name.trim();
  const cleanName = stripNodeDisplayMeta(rawName);
  const cleanNoCtor = stripCtorPrefix(cleanName);

  let best = 0;
  for (const preferred of preferredNames) {
    const cleanPreferred = stripCtorPrefix(preferred);

    if (cleanName === preferred || cleanNoCtor === cleanPreferred) {
      best = Math.max(best, 120);
      continue;
    }
    if (
      cleanName === `new ${cleanPreferred}` ||
      cleanPreferred === `new ${cleanNoCtor}`
    ) {
      best = Math.max(best, 115);
      continue;
    }
    if (cleanName.endsWith(`.${cleanPreferred}`)) {
      best = Math.max(best, 100);
      continue;
    }
    if (cleanNoCtor.endsWith(`.${cleanPreferred}`)) {
      best = Math.max(best, 96);
      continue;
    }
    if (
      rawName.startsWith(`${preferred} (`) ||
      rawName.startsWith(`new ${preferred} (`)
    ) {
      best = Math.max(best, 108);
      continue;
    }
    if (
      cleanName.includes(cleanPreferred) ||
      cleanNoCtor.includes(cleanPreferred)
    ) {
      best = Math.max(best, 72);
    }
  }

  return best;
}

function findBestNodeByLocation(
  graph: GraphPayload | undefined,
  filePath: string,
  range?: CodeDiagnostic["range"] | CallV2["declRange"],
  preferredNames: string[] = [],
) {
  if (!graph) return null;

  const fileCandidates = graph.nodes.filter(
    (node) =>
      node.kind !== "file" && normalizePath(node.file) === normalizePath(filePath),
  );
  if (!fileCandidates.length) return null;

  const candidates = [...fileCandidates];
  candidates.sort((a, b) => {
    const nameScoreDiff =
      nameMatchScore(b, preferredNames) - nameMatchScore(a, preferredNames);
    if (nameScoreDiff !== 0) return nameScoreDiff;

    if (range) {
      const aOverlap = rangesOverlap(a.range, range);
      const bOverlap = rangesOverlap(b.range, range);
      if (aOverlap !== bOverlap) return aOverlap ? -1 : 1;

      const aDistance = distanceToRange(range.start, a.range);
      const bDistance = distanceToRange(range.start, b.range);
      if (aDistance !== bDistance) return aDistance - bDistance;
    }

    const aIsExternal = a.kind === "external";
    const bIsExternal = b.kind === "external";
    if (aIsExternal !== bIsExternal) return aIsExternal ? 1 : -1;

    return rangeSize(a.range) - rangeSize(b.range);
  });

  return candidates[0] ?? null;
}

function findBestNodeByNames(
  graph: GraphPayload | undefined,
  preferredNames: string[],
) {
  if (!graph || preferredNames.length === 0) return null;

  const ranked = graph.nodes
    .filter((node) => node.kind !== "file")
    .map((node) => ({ node, score: nameMatchScore(node, preferredNames) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if ((a.node.kind === "external") !== (b.node.kind === "external")) {
        return a.node.kind === "external" ? -1 : 1;
      }
      return rangeSize(a.node.range) - rangeSize(b.node.range);
    });

  return ranked[0]?.node ?? null;
}

function candidateNamesFromImport(source: string, specifiers: string[]) {
  const names: string[] = [];
  for (const specifier of specifiers) {
    const parts = specifier.split(/\s+as\s+/i).map((part) => part.trim());
    names.push(...parts);
  }

  const sourceBase = source.split("/").pop()?.replace(/\.[^.]+$/, "");
  if (sourceBase) names.push(sourceBase);

  return uniqueNames(names);
}

function candidateNamesFromCall(call: CallV1 | CallV2) {
  const raw = isCallV2(call) ? call.calleeName : call.name;
  return uniqueNames([raw, stripCtorPrefix(raw)]);
}

function PanelChevron({
  collapsed,
  collapseDirection,
}: {
  collapsed: boolean;
  collapseDirection: CollapseDirection;
}) {
  if (collapseDirection === "horizontal") {
    return collapsed ? (
      <ChevronRight className="icon" />
    ) : (
      <ChevronLeft className="icon" />
    );
  }

  return collapsed ? (
    <ChevronRight className="icon" />
  ) : (
    <ChevronDown className="icon" />
  );
}

export function AnalysisPanel({
  analysis,
  graph,
  selectedNodeId = null,
  selectedNodeOrigin = "graph",
  className,
  collapsedLabel = "Analysis",
  onOpenDiagnostic,
  onSelectGraphNode,
  onActivateGraphNode,
  collapsed = false,
  onToggleCollapsed,
  collapseDirection = "vertical",
}: Props) {
  const headerLabel =
    collapsed && collapseDirection === "horizontal"
      ? collapsedLabel
      : "ANALYSIS";
  const panelClassName = [
    "panel",
    className ?? "",
    collapsed ? "panel--collapsed" : "",
  ]
    .join(" ")
    .trim();

  if (!analysis) {
    return (
      <div className={panelClassName}>
        <div className="panelHeader panelHeader--collapsible">
          <div className="panelHeaderTitleWrap">
            {onToggleCollapsed ? (
              <button
                className="panelToggleBtn"
                type="button"
                aria-expanded={!collapsed}
                aria-label={collapsed ? "Expand Analysis" : "Collapse Analysis"}
                title="ANALYSIS"
                onClick={onToggleCollapsed}
              >
                <PanelChevron
                  collapsed={collapsed}
                  collapseDirection={collapseDirection}
                />
              </button>
            ) : null}
            <span className="panelHeaderTitleText" title="ANALYSIS">
              {headerLabel}
            </span>
          </div>
        </div>
        {!collapsed ? (
          <div className="panelBody">
            <div className="mutedText">No analysis result yet. Click Generate.</div>
          </div>
        ) : null}
      </div>
    );
  }

  const nodesLen = analysis.graph?.nodes?.length ?? 0;
  const edgesLen = analysis.graph?.edges?.length ?? 0;
  const diagnostics = analysis.diagnostics ?? [];
  const graphNodes =
    (graph ?? analysis.graph)?.nodes?.filter((node) => node.kind !== "file") ?? [];

  const activateNode = (
    nodeId: string,
    origin:
      | "analysis-graph"
      | "analysis-import"
      | "analysis-call"
      | "analysis-diagnostic",
  ) => {
    if (onActivateGraphNode) {
      onActivateGraphNode(nodeId, origin);
      return;
    }
    onSelectGraphNode?.(nodeId, origin);
  };

  return (
    <div className={panelClassName}>
      <div className="panelHeader panelHeader--collapsible">
        <div className="panelHeaderTitleWrap">
          {onToggleCollapsed ? (
            <button
              className="panelToggleBtn"
              type="button"
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand Analysis" : "Collapse Analysis"}
              title="ANALYSIS"
              onClick={onToggleCollapsed}
            >
              <PanelChevron
                collapsed={collapsed}
                collapseDirection={collapseDirection}
              />
            </button>
          ) : null}
          <span className="panelHeaderTitleText" title="ANALYSIS">
            {headerLabel}
          </span>
        </div>
        {!collapsed ? (
          <span className="panelHeaderMeta mono" style={{ opacity: 0.75 }}>
            {analysis.stats.lines} lines · {analysis.stats.chars} chars
          </span>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="panelBody" style={{ gap: 14 }}>
          <Section
            title={`Diagnostics (${diagnostics.length})`}
            icon={<Network className="icon" />}
          >
            {diagnostics.length === 0 ? (
              <div className="mutedText">No TypeScript diagnostics detected.</div>
            ) : (
              <div className="kvList">
                {diagnostics.slice(0, 12).map((diag, idx) => {
                  const location =
                    diag.filePath && diag.range
                      ? `${shortFile(diag.filePath)}:${diag.range.start.line + 1}:${diag.range.start.character + 1}`
                      : diag.filePath
                        ? shortFile(diag.filePath)
                        : "workspace";
                  const targetNode =
                    diag.filePath && diag.range
                      ? findBestNodeByLocation(graph, diag.filePath, diag.range)
                      : null;

                  return (
                    <div
                      className={[
                        "kvRow",
                        diag.filePath && diag.range ? "analysisInteractiveRow" : "",
                        targetNode?.id === selectedNodeId &&
                        selectedNodeOrigin === "analysis-diagnostic"
                          ? "isActive"
                          : "",
                      ].join(" ")}
                      key={`${diag.code}-${location}-${idx}`}
                      style={{ display: "flex", flexDirection: "column", gap: 6 }}
                      onClick={() => {
                        if (diag.filePath && diag.range) {
                          if (targetNode) activateNode(targetNode.id, "analysis-diagnostic");
                          onOpenDiagnostic?.(diag);
                        }
                      }}
                      role={diag.filePath && diag.range ? "button" : undefined}
                      tabIndex={diag.filePath && diag.range ? 0 : undefined}
                      onKeyDown={(event) => {
                        if (
                          diag.filePath &&
                          diag.range &&
                          (event.key === "Enter" || event.key === " ")
                        ) {
                          event.preventDefault();
                          if (targetNode) activateNode(targetNode.id, "analysis-diagnostic");
                          onOpenDiagnostic?.(diag);
                        }
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          width: "100%",
                        }}
                      >
                        <span className="mono" style={{ opacity: 0.95 }}>
                          TS{diag.code}
                        </span>
                        <span className="mono" style={{ opacity: 0.72 }}>
                          {diag.severity.toUpperCase()}
                        </span>
                      </div>
                      <div className="mutedText" title={diag.message}>
                        {diag.message}
                      </div>
                      <div className="mutedText mono" title={location}>
                        {location}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section
            title={`Graph (${nodesLen} nodes · ${edgesLen} edges)`}
            icon={<Network className="icon" />}
          >
            {analysis.graph ? (
              <div className="kvList" style={{ gap: 8 }}>
                <div className="kvRow">
                  <div className="kvKey mono">nodes</div>
                  <div className="kvVal mono">{nodesLen}</div>
                </div>
                <div className="kvRow">
                  <div className="kvKey mono">edges</div>
                  <div className="kvVal mono">{edgesLen}</div>
                </div>
                {graphNodes.slice(0, 12).map((node) => (
                  <button
                    key={node.id}
                    className={[
                      "analysisInteractiveRow",
                      "analysisInteractiveButton",
                      selectedNodeId === node.id &&
                      selectedNodeOrigin === "analysis-graph"
                        ? "isActive"
                        : "",
                    ].join(" ")}
                    type="button"
                    onClick={() => activateNode(node.id, "analysis-graph")}
                  >
                    <span
                      className="mono analysisInteractivePrimary"
                      title={node.name}
                    >
                      {node.name}
                    </span>
                    <span className="mono analysisInteractiveMeta">{node.kind}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mutedText">
                No graph payload found in analysisResult.
              </div>
            )}
          </Section>

          <Section
            title={`Imports (${analysis.imports.length})`}
            icon={<ArrowDownLeft className="icon" />}
          >
            {analysis.imports.length === 0 ? (
              <div className="mutedText">No imports detected.</div>
            ) : (
              <div className="kvList">
                {analysis.imports.slice(0, 30).map((imp, idx) => {
                  const targetNode = findBestNodeByNames(
                    graph,
                    candidateNamesFromImport(imp.source, imp.specifiers),
                  );
                  return (
                    <button
                      className={[
                        "analysisInteractiveButton",
                        targetNode ? "analysisInteractiveRow" : "",
                        targetNode?.id === selectedNodeId &&
                        selectedNodeOrigin === "analysis-import"
                          ? "isActive"
                          : "",
                      ].join(" ")}
                      type="button"
                      key={`${imp.source}-${idx}`}
                      onClick={() => {
                        if (targetNode) activateNode(targetNode.id, "analysis-import");
                      }}
                      disabled={!targetNode}
                    >
                      <div className="kvKey mono">{imp.source}</div>
                      <div className="kvVal mono">
                        {imp.kind === "side-effect"
                          ? "(side-effect)"
                          : imp.specifiers.length
                            ? imp.specifiers.join(", ")
                            : "(none)"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          <Section
            title={`Exports (${analysis.exports.length})`}
            icon={<ArrowUpRight className="icon" />}
          >
            {analysis.exports.length === 0 ? (
              <div className="mutedText">No exports detected.</div>
            ) : (
              <div className="tagGrid">
                {analysis.exports.slice(0, 40).map((ex, idx) => (
                  <span className="tag" key={`${ex.name}-${idx}`}>
                    <span className="tagKind">{ex.kind}</span>
                    <span className="tagName mono">{ex.name}</span>
                  </span>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={`Calls (top ${Math.min(analysis.calls.length, 20)})`}
            icon={<Sigma className="icon" />}
          >
            {analysis.calls.length === 0 ? (
              <div className="mutedText">No calls detected.</div>
            ) : (
              <div className="kvList">
                {analysis.calls.slice(0, 20).map((c, idx) => {
                  const rawLabel = isCallV2(c) ? c.calleeName : c.name;
                  const safeLabel =
                    typeof rawLabel === "string" && rawLabel.trim().length > 0
                      ? rawLabel
                      : "(unknown)";

                  let meta: string | null = null;
                  if (isCallV2(c)) {
                    if (c.declFile && c.declRange) {
                      const s = c.declRange.start;
                      meta = `${shortFile(c.declFile)}:${s.line + 1}:${s.character + 1}${
                        c.isExternal ? " (External)" : ""
                      }`;
                    } else if (c.isExternal) {
                      meta = "External";
                    } else {
                      meta = "Unresolved";
                    }
                  }

                  const key = isCallV2(c)
                    ? `${safeLabel}-${c.declFile ?? "null"}-${c.declRange?.start.line ?? "n"}-${idx}`
                    : `${safeLabel}-${idx}`;
                  const targetNode = isCallV2(c)
                    ? c.declFile
                      ? findBestNodeByLocation(
                          graph,
                          c.declFile,
                          c.declRange,
                          candidateNamesFromCall(c),
                        )
                      : findBestNodeByNames(
                          graph,
                          candidateNamesFromCall(c),
                        )
                    : null;

                  return (
                    <div
                      className={[
                        "kvRow",
                        isCallV2(c) && c.declFile ? "analysisInteractiveRow" : "",
                        targetNode?.id === selectedNodeId &&
                        selectedNodeOrigin === "analysis-call"
                          ? "isActive"
                          : "",
                      ].join(" ")}
                      key={key}
                      style={{ display: "flex", flexDirection: "column", gap: 4 }}
                      onClick={() => {
                        if (!isCallV2(c)) return;
                        if (targetNode) activateNode(targetNode.id, "analysis-call");
                      }}
                      role={isCallV2(c) ? "button" : undefined}
                      tabIndex={isCallV2(c) ? 0 : undefined}
                      onKeyDown={(event) => {
                        if (!isCallV2(c)) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        if (targetNode) activateNode(targetNode.id, "analysis-call");
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          width: "100%",
                        }}
                      >
                        <span
                          className="mono"
                          title={safeLabel}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {safeLabel}
                        </span>

                        <span className="mono" style={{ opacity: 0.75 }}>
                          ()
                        </span>

                        <span className="mono" style={{ opacity: 0.9 }}>
                          {c.count}
                        </span>
                      </div>

                      {meta ? (
                        <div className="mutedText mono" title={meta}>
                          {meta}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="sectionTitle">
        <span className="sectionTitleLeft">
          {icon}
          <span>{title}</span>
        </span>
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}
