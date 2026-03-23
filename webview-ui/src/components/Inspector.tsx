import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  CodeDiagnostic,
  ExtToWebviewMessage,
  GraphEdge,
  GraphNode,
  GraphPayload,
  RuntimeDebugPayload,
  UINotice,
} from "../lib/vscode";
import { ActiveFileSnapshot } from "./ActiveFileSnapshot";
import { AnalysisPanel } from "./AnalysisPanel";
import "./Inspector.css";

type ActiveFilePayload = Extract<
  ExtToWebviewMessage,
  { type: "activeFile" }
>["payload"];
type SelectionPayload = Extract<
  ExtToWebviewMessage,
  { type: "selection" }
>["payload"];
type AnalysisPayload = Extract<
  ExtToWebviewMessage,
  { type: "analysisResult" }
>["payload"];
type RuntimeDebugState = Extract<
  ExtToWebviewMessage,
  { type: "runtimeDebug" }
>["payload"];

export type InspectorPlacement = "auto" | "right" | "bottom";
export type EffectiveInspectorPlacement = Exclude<InspectorPlacement, "auto">;
type CollapseDirection = "vertical" | "horizontal";
type SectionKey =
  | "snapshot"
  | "root"
  | "runtime"
  | "selected"
  | "selection"
  | "flow"
  | "analysis";

type Props = {
  activeFile: ActiveFilePayload;
  selection: SelectionPayload;
  analysis: AnalysisPayload;
  graph?: GraphPayload;
  selectedNode: GraphNode | null;
  runtimeDebug?: RuntimeDebugState | null;
  runtimeActiveNode?: GraphNode | null;
  notice?: UINotice | null;
  onOpenDiagnostic: (diagnostic: CodeDiagnostic) => void;
  onSelectGraphNode: (nodeId: string) => void;
  onActivateGraphNode: (nodeId: string) => void;
  onFocusParamFlow: (flow: {
    edgeId: string;
    sourceId: string;
    targetId: string;
  }) => void;
  activeFlowPreview?: {
    edgeId: string;
    sourceId: string;
    targetId: string;
    origin: "manual" | "trace";
  } | null;
  onRefreshActive: () => void;
  onResetGraph: () => void;
  onExpandExternal: (filePath: string) => void;
  rootNode?: GraphNode | null;
  onClearRoot?: () => void;
  collapsed?: boolean;
  width?: number;
  height?: number;
  placement: InspectorPlacement;
  effectivePlacement: EffectiveInspectorPlacement;
  onPlacementChange: (placement: InspectorPlacement) => void;
  onToggleCollapsed?: () => void;
};

const SECTION_STORAGE_KEY = "cg.inspector.sections";
const DEFAULT_SECTION_STATE: Record<SectionKey, boolean> = {
  snapshot: true,
  root: true,
  runtime: false,
  selected: true,
  selection: true,
  flow: true,
  analysis: true,
};
const RUNTIME_VAR_HOVER_DELAY_MS = 300;
const AUTO_EXPAND_SECTION_KEYS: SectionKey[] = ["selected", "flow"];

function shortFile(p: string) {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function fmtRange(n: GraphNode) {
  const s = n.range.start;
  const e = n.range.end;
  return `${s.line + 1}:${s.character + 1} -> ${e.line + 1}:${e.character + 1}`;
}

function fmtRuntimeLocation(frame: RuntimeDebugPayload["frame"]) {
  if (!frame) return "(no frame)";
  if (frame.filePath && frame.line !== undefined) {
    const column = frame.column !== undefined ? `:${frame.column + 1}` : "";
    return `${shortFile(frame.filePath)}:${frame.line + 1}${column}`;
  }
  if (frame.sourceName) return frame.sourceName;
  return frame.name;
}

function fmtRuntimeScope(scope: string) {
  const lower = scope.toLowerCase();
  if (lower === "arguments") {
    return "ARG";
  }
  if (lower === "locals") {
    return "LOCAL";
  }
  return scope.toUpperCase();
}

function compactRuntimeValue(value: string, max = 24) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3)}...`;
}

type NodeSig = {
  params: Array<{ name: string; type?: string; optional?: boolean }>;
  returnType?: string;
};

type GraphNodeWithSig = GraphNode & { sig?: NodeSig; signature?: string };

function fmtSig(n: GraphNodeWithSig) {
  if (n.sig && Array.isArray(n.sig.params)) {
    const params = n.sig.params
      .map((p) => {
        const opt = p.optional ? "?" : "";
        const ty = p.type ? `: ${p.type}` : "";
        return `${p.name}${opt}${ty}`;
      })
      .join(", ");
    const ret = n.sig.returnType ? `: ${n.sig.returnType}` : "";
    return `(${params})${ret}`;
  }

  return n.signature?.trim() ? n.signature : "(none)";
}

function fmtAnalyzerMode(mode: string | undefined) {
  if (mode === "workspace") return "Workspace";
  if (mode === "single") return "Single File";
  if (mode === "single-file") return "Single File";
  return mode ?? "Unknown";
}

function describeEdgeReason(
  edge: GraphEdge,
  sourceName: string,
  targetName: string,
) {
  if (edge.kind === "calls") {
    if (edge.label === "jsx") {
      return `${sourceName} renders ${targetName} in JSX.`;
    }
    if (edge.label) {
      return `${sourceName} calls ${targetName} through ${edge.label}.`;
    }
    return `${sourceName} calls ${targetName}.`;
  }
  if (edge.kind === "constructs") {
    return `${sourceName} creates ${targetName}.`;
  }
  if (edge.kind === "dataflow") {
    if (edge.label) {
      return `${sourceName} passes an argument into ${targetName}.`;
    }
    return `${sourceName} passes argument data into ${targetName}.`;
  }
  if (edge.kind === "updates") {
    if (edge.label) {
      return `${sourceName} updates ${targetName} through ${edge.label}.`;
    }
    return `${sourceName} updates ${targetName}.`;
  }
  if (edge.kind === "references") {
    if (edge.label === "reducer") {
      return `${sourceName} uses ${targetName} as its reducer.`;
    }
    if (edge.label === "initializer") {
      return `${sourceName} uses ${targetName} as its initializer.`;
    }
    return `${sourceName} reads from or captures ${targetName}.`;
  }
  return `${sourceName} is connected to ${targetName}.`;
}

function getEvidenceHeading(
  kind: GraphEdge["kind"],
  direction: "incoming" | "outgoing",
) {
  if (kind === "calls") {
    return direction === "outgoing" ? "Calls From This Node" : "Called By";
  }
  if (kind === "constructs") {
    return direction === "outgoing" ? "Creates From This Node" : "Created By";
  }
  if (kind === "dataflow") {
    return direction === "outgoing" ? "Arguments Passed From Here" : "Arguments Passed Into This Node";
  }
  if (kind === "updates") {
    return direction === "outgoing" ? "Updates From This Node" : "Updated By";
  }
  if (kind === "references") {
    return direction === "outgoing" ? "Reads / Captures From Here" : "Referenced By";
  }
  return direction === "outgoing" ? "Outgoing Connection" : "Incoming Connection";
}

function getEvidenceLabelText(
  kind: GraphEdge["kind"],
  label: string | null,
) {
  if (!label) {
    return null;
  }
  if (kind === "dataflow") {
    return `Parameter mapping: ${label}`;
  }
  if (kind === "updates") {
    return `Update trigger: ${label}`;
  }
  if (kind === "references") {
    return `Reference type: ${label}`;
  }
  return `Analyzer label: ${label}`;
}

function loadSectionState() {
  try {
    const raw = localStorage.getItem(SECTION_STORAGE_KEY);
    if (!raw) return DEFAULT_SECTION_STATE;
    const parsed = JSON.parse(raw) as Partial<Record<SectionKey, boolean>>;
    return { ...DEFAULT_SECTION_STATE, ...parsed };
  } catch {
    return DEFAULT_SECTION_STATE;
  }
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

function InspectorPanel({
  title,
  collapsedLabel,
  open,
  onToggle,
  collapseDirection,
  className,
  actions,
  children,
}: {
  title: string;
  collapsedLabel?: string;
  open: boolean;
  onToggle: () => void;
  collapseDirection: CollapseDirection;
  className?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const headerLabel =
    !open && collapseDirection === "horizontal"
      ? (collapsedLabel ?? title)
      : title;
  return (
    <div
      className={[
        "panel",
        className ?? "",
        open ? "" : "panel--collapsed",
      ]
        .join(" ")
        .trim()}
    >
      <div className="panelHeader panelHeader--collapsible">
        <div className="panelHeaderTitleWrap">
          <button
            className="panelToggleBtn"
            type="button"
            aria-expanded={open}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            title={title}
            onClick={onToggle}
          >
            <PanelChevron
              collapsed={!open}
              collapseDirection={collapseDirection}
            />
          </button>
          <span className="panelHeaderTitleText" title={title}>
            {headerLabel}
          </span>
        </div>
        {open && actions ? <div className="panelHeaderActions">{actions}</div> : null}
      </div>
      {open ? <div className="panelBody">{children}</div> : null}
    </div>
  );
}

export function Inspector({
  activeFile,
  selection,
  analysis,
  graph,
  selectedNode,
  runtimeDebug = null,
  runtimeActiveNode = null,
  notice,
  onOpenDiagnostic,
  onSelectGraphNode,
  onActivateGraphNode,
  onFocusParamFlow,
  activeFlowPreview = null,
  onRefreshActive,
  onResetGraph,
  onExpandExternal,
  rootNode = null,
  onClearRoot,
  collapsed = false,
  width,
  height,
  placement,
  effectivePlacement,
  onPlacementChange,
  onToggleCollapsed,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState<Record<SectionKey, boolean>>(
    () => loadSectionState(),
  );
  const [hoveredRuntimeVarKey, setHoveredRuntimeVarKey] = useState<string | null>(null);
  const [pinnedRuntimeVarKeys, setPinnedRuntimeVarKeys] = useState<string[]>([]);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const runtimeVarHoverTimerRef = useRef<number | null>(null);
  const previousAutoExpandFingerprintsRef = useRef<Partial<Record<SectionKey, string>> | null>(
    null,
  );
  const previousSelectedNodeIdRef = useRef<string | null>(selectedNode?.id ?? null);
  const nodeById = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
  const collapseDirection: CollapseDirection =
    effectivePlacement === "bottom" ? "horizontal" : "vertical";

  const paramFlows = (graph?.edges ?? [])
    .filter((e) => e.kind === "dataflow")
    .filter((e) =>
      selectedNode ? e.source === selectedNode.id || e.target === selectedNode.id : true,
    )
    .slice(0, selectedNode ? 40 : 20)
    .map((e) => ({
      id: e.id,
      sourceId: e.source,
      targetId: e.target,
      from: nodeById.get(e.source)?.name ?? e.source,
      to: nodeById.get(e.target)?.name ?? e.target,
      label: e.label ?? "(param flow)",
    }));
  const activeFlowCard = activeFlowPreview
    ? (() => {
        const activeEdge = graph?.edges.find((edge) => edge.id === activeFlowPreview.edgeId);
        if (!activeEdge || activeEdge.kind !== "dataflow") return null;
        return {
          id: activeFlowPreview.edgeId,
          sourceId: activeFlowPreview.sourceId,
          targetId: activeFlowPreview.targetId,
          from: nodeById.get(activeFlowPreview.sourceId)?.name ?? activeFlowPreview.sourceId,
          to: nodeById.get(activeFlowPreview.targetId)?.name ?? activeFlowPreview.targetId,
          label: activeEdge.label ?? "(param flow)",
          origin: activeFlowPreview.origin,
        };
      })()
    : null;
  const visibleParamFlows = activeFlowCard && !paramFlows.some((flow) => flow.id === activeFlowCard.id)
    ? [activeFlowCard, ...paramFlows]
    : paramFlows;
  const selectedNodeEvidence = selectedNode
    ? (graph?.edges ?? [])
        .filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
        .slice(0, 8)
        .map((edge) => {
          const sourceName = nodeById.get(edge.source)?.name ?? edge.source;
          const targetName = nodeById.get(edge.target)?.name ?? edge.target;
          const otherId = edge.source === selectedNode.id ? edge.target : edge.source;
          const otherNode = nodeById.get(otherId) ?? null;
          const direction: "incoming" | "outgoing" =
            edge.source === selectedNode.id ? "outgoing" : "incoming";
          return {
            id: edge.id,
            kind: edge.kind,
            label: edge.label ?? null,
            direction,
            otherId,
            otherName: otherNode?.name ?? otherId,
            otherFile: otherNode?.file ?? null,
            reason: describeEdgeReason(edge, sourceName, targetName),
          };
        })
    : [];
  const activeFlowEdge =
    activeFlowCard
      ? graph?.edges.find((edge) => edge.id === activeFlowCard.id) ?? null
      : null;
  const activeFlowReason =
    activeFlowCard && activeFlowEdge
      ? describeEdgeReason(activeFlowEdge, activeFlowCard.from, activeFlowCard.to)
      : null;
  const selectedSectionFingerprint = JSON.stringify(
    selectedNode
      ? {
          id: selectedNode.id,
          kind: selectedNode.kind,
          name: selectedNode.name,
          file: selectedNode.file,
          range: selectedNode.range,
          signature: fmtSig(selectedNode as GraphNodeWithSig),
          evidence: selectedNodeEvidence.map((edge) => ({
            id: edge.id,
            kind: edge.kind,
            label: edge.label,
            direction: edge.direction,
            otherId: edge.otherId,
          })),
        }
      : null,
  );
  const flowSectionFingerprint = JSON.stringify({
    active: activeFlowCard
      ? {
          id: activeFlowCard.id,
          sourceId: activeFlowCard.sourceId,
          targetId: activeFlowCard.targetId,
          from: activeFlowCard.from,
          to: activeFlowCard.to,
          label: activeFlowCard.label,
          origin: activeFlowCard.origin,
          kind: activeFlowEdge?.kind ?? null,
          reason: activeFlowReason,
        }
      : null,
    flows: visibleParamFlows.map((flow) => ({
      id: flow.id,
      sourceId: flow.sourceId,
      targetId: flow.targetId,
      from: flow.from,
      to: flow.to,
      label: flow.label,
    })),
  });

  useEffect(() => {
    if (!settingsOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(sectionOpen));
    } catch {
      // ignore
    }
  }, [sectionOpen]);

  useEffect(() => {
    setSectionOpen((prev) => {
      const shouldOpen = Boolean(runtimeDebug && runtimeDebug.state !== "inactive");
      if (prev.runtime === shouldOpen) {
        return prev;
      }
      return { ...prev, runtime: shouldOpen };
    });
  }, [runtimeDebug]);

  useEffect(() => {
    const currentSelectedNodeId = selectedNode?.id ?? null;
    const previousSelectedNodeId = previousSelectedNodeIdRef.current;
    const previousFingerprints = previousAutoExpandFingerprintsRef.current;
    const currentFingerprints: Partial<Record<SectionKey, string>> = {
      selected: selectedSectionFingerprint,
      flow: flowSectionFingerprint,
    };

    previousSelectedNodeIdRef.current = currentSelectedNodeId;
    previousAutoExpandFingerprintsRef.current = currentFingerprints;

    if (!currentSelectedNodeId || previousFingerprints === null) {
      return;
    }
    if (previousSelectedNodeId === currentSelectedNodeId) {
      return;
    }

    const changedKeys = AUTO_EXPAND_SECTION_KEYS.filter(
      (key) => currentFingerprints[key] !== previousFingerprints[key],
    );
    if (!changedKeys.length) {
      return;
    }

    setSectionOpen((prev) => {
      let next = prev;
      for (const key of changedKeys) {
        if (next[key]) {
          continue;
        }
        if (next === prev) {
          next = { ...prev };
        }
        next[key] = true;
      }
      return next;
    });
  }, [flowSectionFingerprint, selectedNode?.id, selectedSectionFingerprint]);

  useEffect(() => {
    const variableKeys = new Set(
      (runtimeDebug?.variables ?? []).map((variable) => `${variable.scope}:${variable.name}`),
    );
    setHoveredRuntimeVarKey((current) =>
      current && variableKeys.has(current) ? current : null,
    );
    setPinnedRuntimeVarKeys((current) =>
      current.filter((key) => variableKeys.has(key)),
    );
  }, [runtimeDebug]);

  useEffect(() => {
    return () => {
      if (runtimeVarHoverTimerRef.current !== null) {
        window.clearTimeout(runtimeVarHoverTimerRef.current);
      }
    };
  }, []);

  const toggleSection = (key: SectionKey) => {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const scheduleRuntimeVarHover = (variableKey: string) => {
    if (runtimeVarHoverTimerRef.current !== null) {
      window.clearTimeout(runtimeVarHoverTimerRef.current);
    }
    runtimeVarHoverTimerRef.current = window.setTimeout(() => {
      setHoveredRuntimeVarKey(variableKey);
      runtimeVarHoverTimerRef.current = null;
    }, RUNTIME_VAR_HOVER_DELAY_MS);
  };
  const clearRuntimeVarHover = (variableKey?: string) => {
    if (runtimeVarHoverTimerRef.current !== null) {
      window.clearTimeout(runtimeVarHoverTimerRef.current);
      runtimeVarHoverTimerRef.current = null;
    }
    setHoveredRuntimeVarKey((current) => {
      if (!variableKey || current === variableKey) {
        return null;
      }
      return current;
    });
  };
  const togglePinnedRuntimeVar = (variableKey: string) => {
    const isPinned = pinnedRuntimeVarKeys.includes(variableKey);
    if (isPinned) {
      clearRuntimeVarHover(variableKey);
    }
    setPinnedRuntimeVarKeys((current) => {
      if (current.includes(variableKey)) {
        return current.filter((key) => key !== variableKey);
      }
      return [...current, variableKey];
    });
  };

  const collapseIcon =
    effectivePlacement === "bottom" ? (
      <ChevronDown className="icon" />
    ) : (
      <ChevronRight className="icon" />
    );
  const expandIcon =
    effectivePlacement === "bottom" ? (
      <ChevronUp className="icon" />
    ) : (
      <ChevronLeft className="icon" />
    );
  const expandedStyle =
    effectivePlacement === "bottom"
      ? {
          flexBasis: height ?? 280,
          height: height ?? 280,
          minHeight: 180,
          maxHeight: 520,
          width: "100%",
          maxWidth: "none",
        }
      : width
        ? { width }
        : undefined;

  if (collapsed) {
    return (
      <aside
        className={[
          "inspector",
          "inspector--collapsed",
          `inspector--${effectivePlacement}`,
        ].join(" ")}
        style={
          effectivePlacement === "bottom"
            ? { height: 28, minHeight: 28, maxHeight: 28, width: "100%" }
            : { width: 28, minWidth: 28, maxWidth: 28 }
        }
        aria-label="Inspector (collapsed)"
      >
        <button
          className="inspectorCollapsedBtn"
          type="button"
          onClick={onToggleCollapsed}
          title="Show Inspector (I)"
          aria-label="Show Inspector"
        >
          {expandIcon}
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={["inspector", `inspector--${effectivePlacement}`].join(" ")}
      style={expandedStyle}
    >
      <div className="inspectorHeader">
        <div>
          <h1>Inspector</h1>
          <p>COMPONENT ANALYSIS</p>
        </div>

        <div className="inspectorHeaderActions">
          <button
            className="iconBtn subtle"
            type="button"
            title="Hide Inspector (I)"
            onClick={onToggleCollapsed}
          >
            {collapseIcon}
          </button>
          <div className="inspectorSettingsWrap" ref={settingsRef}>
            <button
              className={[
                "iconBtn",
                "subtle",
                settingsOpen ? "iconBtn--active" : "",
              ].join(" ")}
              type="button"
              title="Inspector Settings"
              aria-haspopup="menu"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <Settings className="icon" />
            </button>

            {settingsOpen ? (
              <div className="inspectorMenu" role="menu" aria-label="Inspector Settings">
                <div className="inspectorMenuHeader">
                  <span>Inspector Position</span>
                  <span className="inspectorMenuHint">
                    {placement === "auto"
                      ? `Auto (${effectivePlacement})`
                      : placement}
                  </span>
                </div>

                {[
                  ["auto", "Auto", "Follow window width"],
                  ["right", "Right", "Keep inspector on the side"],
                  ["bottom", "Bottom", "Keep inspector under the canvas"],
                ].map(([value, label, description]) => {
                  const active = placement === value;
                  return (
                    <button
                      key={value}
                      className={[
                        "inspectorMenuOption",
                        active ? "isActive" : "",
                      ].join(" ")}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        onPlacementChange(value as InspectorPlacement);
                        setSettingsOpen(false);
                      }}
                    >
                      <span className="inspectorMenuOptionText">
                        <strong>{label}</strong>
                        <small>{description}</small>
                      </span>
                      <span className="inspectorMenuCheck" aria-hidden="true">
                        {active ? "ok" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {notice ? (
        <div className={["inspectorNotice", `inspectorNotice--${notice.severity}`].join(" ")}>
          <div className="inspectorNoticeTitle">{notice.message}</div>
          {notice.detail ? (
            <div className="inspectorNoticeDetail">{notice.detail}</div>
          ) : null}
        </div>
      ) : null}

      <div className="inspectorActions">
        <button className="smallBtn" type="button" onClick={onRefreshActive}>
          Refresh Active
        </button>
        <button className="smallBtn" type="button" onClick={onResetGraph}>
          Reset Graph
        </button>
        {selectedNode && selectedNode.kind === "external" ? (
          <button
            className="smallBtn"
            type="button"
            onClick={() => onExpandExternal(selectedNode.file)}
            title={selectedNode.file}
          >
            Expand External
          </button>
        ) : null}
      </div>

      <div className="inspectorBody">
        <div className="inspectorPad">
          <ActiveFileSnapshot
            className="panel--snapshot"
            collapsedLabel="Active File"
            fileName={activeFile?.fileName}
            languageId={activeFile?.languageId}
            text={activeFile?.text}
            onRefresh={onRefreshActive}
            collapsed={!sectionOpen.snapshot}
            onToggleCollapsed={() => toggleSection("snapshot")}
            collapseDirection={collapseDirection}
          />

          <InspectorPanel
            className="panel--root"
            title="ROOT"
            collapsedLabel="Root"
            open={sectionOpen.root}
            onToggle={() => toggleSection("root")}
            collapseDirection={collapseDirection}
            actions={
              rootNode && onClearRoot ? (
                <button className="smallBtn" type="button" onClick={onClearRoot}>
                  Clear Root
                </button>
              ) : null
            }
          >
            {!rootNode ? (
              <div className="mutedText">No root selected.</div>
            ) : (
              <div className="kvList">
                <div className="kvRow">
                  <div className="kvKey mono">kind</div>
                  <div className="kvVal mono">{rootNode.kind}</div>
                </div>
                <div className="kvRow">
                  <div className="kvKey mono">name</div>
                  <div className="kvVal mono">{rootNode.name}</div>
                </div>
                <div className="kvRow">
                  <div className="kvKey mono">file</div>
                  <div className="kvVal mono">{shortFile(rootNode.file)}</div>
                </div>
                <div className="kvRow">
                  <div className="kvKey mono">range</div>
                  <div className="kvVal mono">{fmtRange(rootNode)}</div>
                </div>
              </div>
            )}
          </InspectorPanel>

          <InspectorPanel
            className="panel--runtime"
            title="RUNTIME FRAME"
            collapsedLabel="Runtime"
            open={sectionOpen.runtime}
            onToggle={() => toggleSection("runtime")}
            collapseDirection={collapseDirection}
          >
            {!runtimeDebug || runtimeDebug.state === "inactive" ? (
              <div className="mutedText">No active debug session.</div>
            ) : runtimeDebug.state === "running" ? (
              <div className="kvList">
                <div className="kvRow">
                  <div className="kvKey mono">status</div>
                  <div className="kvVal mono">
                    Running{runtimeDebug.session?.name ? ` in ${runtimeDebug.session.name}` : ""}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid rgba(56, 189, 248, 0.28)",
                    background: "rgba(56, 189, 248, 0.06)",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div className="mono" style={{ fontSize: 11, opacity: 0.75 }}>
                      {runtimeDebug.reason ?? "paused"}
                    </div>
                    {runtimeActiveNode ? (
                      <button
                        className="smallBtn"
                        type="button"
                        onClick={() => onActivateGraphNode(runtimeActiveNode.id)}
                        title={runtimeActiveNode.file}
                      >
                        {runtimeActiveNode.name}
                      </button>
                    ) : null}
                  </div>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 800 }}>
                    {runtimeDebug.frame?.name ?? "(unavailable frame)"}
                  </div>
                  <div className="mono" style={{ fontSize: 12, opacity: 0.8 }}>
                    {fmtRuntimeLocation(runtimeDebug.frame)}
                  </div>
                </div>

                <div>
                  <div className="mono" style={{ fontSize: 11, opacity: 0.75, marginBottom: 8 }}>
                    Key Variables
                  </div>
                  {runtimeDebug.variables && runtimeDebug.variables.length > 0 ? (
                    <div className="kvList">
                      {runtimeDebug.variables.map((variable) => {
                        const variableKey = `${variable.scope}:${variable.name}`;
                        const expanded =
                          pinnedRuntimeVarKeys.includes(variableKey) ||
                          hoveredRuntimeVarKey === variableKey;

                        return (
                          <div
                            className={[
                              "runtimeVarCard",
                              expanded ? "isExpanded" : "",
                              pinnedRuntimeVarKeys.includes(variableKey) ? "isPinned" : "",
                            ].join(" ").trim()}
                            key={variableKey}
                            role="button"
                            tabIndex={0}
                            onMouseEnter={() => scheduleRuntimeVarHover(variableKey)}
                            onMouseLeave={() => clearRuntimeVarHover(variableKey)}
                            onClick={() => togglePinnedRuntimeVar(variableKey)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              togglePinnedRuntimeVar(variableKey);
                            }}
                          >
                            <div className="runtimeVarCardTop">
                              <div className="runtimeVarCardName mono" title={variable.scope}>
                                {fmtRuntimeScope(variable.scope)} {variable.name}
                              </div>
                              <div className="runtimeVarCardValue mono" title={variable.value}>
                                {expanded ? variable.value : compactRuntimeValue(variable.value)}
                              </div>
                            </div>

                            {expanded ? (
                              <div className="runtimeVarCardDetail">
                                {variable.type ? (
                                  <div className="runtimeVarCardMeta mono">{variable.type}</div>
                                ) : null}
                                {variable.evaluateName ? (
                                  <div className="runtimeVarCardMeta mono">
                                    {variable.evaluateName}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mutedText">No useful locals or arguments yet.</div>
                  )}
                </div>
              </div>
            )}
          </InspectorPanel>

          <InspectorPanel
            className="panel--selected"
            title="SELECTED NODE"
            collapsedLabel="Selected"
            open={sectionOpen.selected}
            onToggle={() => toggleSection("selected")}
            collapseDirection={collapseDirection}
          >
            {!selectedNode ? (
              <div className="mutedText">
                No node selected. Click a node in the graph.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div className="kvList">
                  <div className="kvRow">
                    <div className="kvKey mono">kind</div>
                    <div className="kvVal mono">{selectedNode.kind}</div>
                  </div>
                  <div className="kvRow">
                    <div className="kvKey mono">name</div>
                    <div className="kvVal mono">{selectedNode.name}</div>
                  </div>
                  <div className="kvRow">
                    <div className="kvKey mono">file</div>
                    <div className="kvVal mono">{shortFile(selectedNode.file)}</div>
                  </div>
                  <div className="kvRow">
                    <div className="kvKey mono">range</div>
                    <div className="kvVal mono">{fmtRange(selectedNode)}</div>
                  </div>
                  <div className="kvRow">
                    <div className="kvKey mono">signature</div>
                    <div className="kvVal mono">
                      {fmtSig(selectedNode as GraphNodeWithSig)}
                    </div>
                  </div>
                </div>

                <div>
                  <div
                    className="mono"
                    style={{ fontSize: 11, opacity: 0.75, marginBottom: 8 }}
                  >
                    Analyzer Context
                  </div>
                  <div className="kvList">
                    <div className="kvRow">
                      <div className="kvKey mono">mode</div>
                      <div className="kvVal mono">
                        {fmtAnalyzerMode(analysis?.meta?.mode)}
                      </div>
                    </div>
                    <div className="kvRow">
                      <div className="kvKey mono">language</div>
                      <div className="kvVal mono">{analysis?.languageId ?? "(unknown)"}</div>
                    </div>
                    {analysis?.meta?.mode === "workspace" ? (
                      <>
                        <div className="kvRow">
                          <div className="kvKey mono">root files</div>
                          <div className="kvVal mono">{analysis.meta.rootFiles}</div>
                        </div>
                        <div className="kvRow">
                          <div className="kvKey mono">tsconfig</div>
                          <div className="kvVal mono">
                            {analysis.meta.usedTsconfig ? "enabled" : "fallback"}
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div
                    className="mono"
                    style={{ fontSize: 11, opacity: 0.75, marginBottom: 8 }}
                  >
                    How This Node Is Connected
                  </div>
                  <div className="mutedText" style={{ marginBottom: 10 }}>
                    These cards show who calls this node, what values flow into it, and what it
                    reads or updates.
                  </div>
                  {selectedNodeEvidence.length === 0 ? (
                    <div className="mutedText">
                      No graph connections are attached to this node yet.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {selectedNodeEvidence.map((edge) => (
                        <div
                          key={edge.id}
                          style={{
                            padding: 10,
                            borderRadius: 10,
                            border: "1px solid var(--border)",
                            background: "rgba(255,255,255,0.03)",
                            display: "grid",
                            gap: 6,
                          }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              flexWrap: "wrap",
                              }}
                            >
                              <div className="mono" style={{ fontSize: 11, opacity: 0.8 }}>
                                {getEvidenceHeading(edge.kind, edge.direction)}
                              </div>
                              <button
                                className="smallBtn"
                                type="button"
                                onClick={() => onSelectGraphNode(edge.otherId)}
                              title={edge.otherFile ?? edge.otherName}
                            >
                              {edge.otherName}
                            </button>
                          </div>
                          <div className="mutedText">{edge.reason}</div>
                          {getEvidenceLabelText(edge.kind, edge.label) ? (
                            <div className="mono" style={{ fontSize: 11, opacity: 0.72 }}>
                              {getEvidenceLabelText(edge.kind, edge.label)}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </InspectorPanel>

          <InspectorPanel
            className="panel--selection"
            title="SELECTION"
            collapsedLabel="Selection"
            open={sectionOpen.selection}
            onToggle={() => toggleSection("selection")}
            collapseDirection={collapseDirection}
          >
            <div className="mono" style={{ fontSize: 11, opacity: 0.85 }}>
              {selection
                ? `${selection.start.line + 1}:${selection.start.character + 1} -> ${
                    selection.end.line + 1
                  }:${selection.end.character + 1}`
                : "No selection"}
            </div>

            <pre
              className="mono"
              style={{
                margin: 0,
                maxHeight: 140,
                overflow: "auto",
                padding: 10,
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "rgba(255,255,255,0.03)",
                fontSize: 12,
                lineHeight: 1.45,
                whiteSpace: "pre",
              }}
            >
              {selection?.selectionText || ""}
            </pre>
          </InspectorPanel>

          <InspectorPanel
            className="panel--flow"
            title="PARAM FLOW"
            collapsedLabel="Flow"
            open={sectionOpen.flow}
            onToggle={() => toggleSection("flow")}
            collapseDirection={collapseDirection}
          >
            {activeFlowCard ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="inspectorFlowActive">
                  <div className="inspectorFlowActiveTop">
                    <span className="inspectorFlowActiveTitle">
                      {activeFlowCard.origin === "trace" ? "Current Trace Flow" : "Focused Parameter Flow"}
                    </span>
                    <span className="inspectorFlowActiveBadge">
                      {activeFlowCard.origin === "trace" ? "TRACE" : "FOCUS"}
                    </span>
                  </div>
                  <div className="mono inspectorFlowActivePath">
                    {activeFlowCard.from}
                    {" -> "}
                    {activeFlowCard.to}
                  </div>
                  <div className="mutedText mono" title={activeFlowCard.label}>
                    {activeFlowCard.label}
                  </div>
                </div>

                <div className="kvList">
                  <div className="kvRow">
                    <div className="kvKey mono">edge type</div>
                    <div className="kvVal mono">{activeFlowEdge?.kind ?? "dataflow"}</div>
                  </div>
                  <div className="kvRow">
                    <div className="kvKey mono">meaning</div>
                    <div className="kvVal">
                      {activeFlowReason ?? "Analyzer recorded this as the currently focused flow edge."}
                    </div>
                  </div>
                  {activeFlowCard.label ? (
                    <div className="kvRow">
                      <div className="kvKey mono">mapping</div>
                      <div className="kvVal mono">{activeFlowCard.label}</div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {visibleParamFlows.length === 0 ? (
              <div className="mutedText">
                {selectedNode
                  ? "No parameter flow for selected node."
                  : "No parameter flow detected."}
              </div>
            ) : (
              <div className="kvList">
                {visibleParamFlows.map((f) => (
                  <div
                    className={[
                      "kvRow",
                      "inspectorFlowRow",
                      activeFlowCard?.id === f.id ? "inspectorFlowRow--active" : "",
                    ].join(" ")}
                    key={f.id}
                    style={{ display: "block" }}
                    onClick={() =>
                      onFocusParamFlow({
                        edgeId: f.id,
                        sourceId: f.sourceId,
                        targetId: f.targetId,
                      })
                    }
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onFocusParamFlow({
                        edgeId: f.id,
                        sourceId: f.sourceId,
                        targetId: f.targetId,
                      });
                    }}
                  >
                    <div className="mono" style={{ fontSize: 12 }}>
                      {f.from}
                      {" -> "}
                      {f.to}
                    </div>
                    <div className="mutedText mono" title={f.label}>
                      {f.label}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </InspectorPanel>

          <AnalysisPanel
            analysis={analysis}
            graph={graph}
            className="panel--analysis"
            collapsedLabel="Analysis"
            onOpenDiagnostic={onOpenDiagnostic}
            onSelectGraphNode={onSelectGraphNode}
            onActivateGraphNode={onActivateGraphNode}
            collapsed={!sectionOpen.analysis}
            onToggleCollapsed={() => toggleSection("analysis")}
            collapseDirection={collapseDirection}
          />
        </div>
      </div>
    </aside>
  );
}
