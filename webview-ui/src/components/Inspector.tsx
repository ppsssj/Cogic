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
  GraphNode,
  GraphPayload,
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

export type InspectorPlacement = "auto" | "right" | "bottom";
export type EffectiveInspectorPlacement = Exclude<InspectorPlacement, "auto">;
type CollapseDirection = "vertical" | "horizontal";
type SectionKey =
  | "snapshot"
  | "root"
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
  notice?: UINotice | null;
  onOpenDiagnostic: (diagnostic: CodeDiagnostic) => void;
  onSelectGraphNode: (nodeId: string) => void;
  onActivateGraphNode: (nodeId: string) => void;
  onFocusParamFlow: (flow: {
    edgeId: string;
    sourceId: string;
    targetId: string;
  }) => void;
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
  selected: true,
  selection: true,
  flow: true,
  analysis: true,
};

function shortFile(p: string) {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function fmtRange(n: GraphNode) {
  const s = n.range.start;
  const e = n.range.end;
  return `${s.line + 1}:${s.character + 1} -> ${e.line + 1}:${e.character + 1}`;
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
  notice,
  onOpenDiagnostic,
  onSelectGraphNode,
  onActivateGraphNode,
  onFocusParamFlow,
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
  const settingsRef = useRef<HTMLDivElement | null>(null);
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

  const toggleSection = (key: SectionKey) => {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
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
            {paramFlows.length === 0 ? (
              <div className="mutedText">
                {selectedNode
                  ? "No parameter flow for selected node."
                  : "No parameter flow detected."}
              </div>
            ) : (
              <div className="kvList">
                {paramFlows.map((f) => (
                  <div
                    className="kvRow inspectorFlowRow"
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
