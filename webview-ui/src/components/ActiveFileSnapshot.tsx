// import "./../App.css";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";
import "./ActiveFileSnapshot.css";

type CollapseDirection = "vertical" | "horizontal";

type Props = {
  title?: string;
  collapsedLabel?: string;
  fileName?: string;
  languageId?: string;
  text?: string;
  onRefresh: () => void;
  className?: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  headerActions?: ReactNode;
  collapseDirection?: CollapseDirection;
};

function clipText(text: string, maxLines: number) {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join("\n")}\n\n// truncated`;
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

export function ActiveFileSnapshot({
  title = "ACTIVE FILE SNAPSHOT",
  collapsedLabel = "Active File",
  fileName,
  languageId,
  text,
  onRefresh,
  className,
  collapsed = false,
  onToggleCollapsed,
  headerActions,
  collapseDirection = "vertical",
}: Props) {
  const body = text ? clipText(text, 200) : "";
  const headerLabel =
    collapsed && collapseDirection === "horizontal" ? collapsedLabel : title;

  return (
    <div
      className={[
        "panel",
        className ?? "",
        collapsed ? "panel--collapsed" : "",
      ]
        .join(" ")
        .trim()}
    >
      <div className="panelHeader panelHeader--collapsible" style={{ gap: 10 }}>
        <div className="panelHeaderTitleWrap">
          {onToggleCollapsed ? (
            <button
              className="panelToggleBtn"
              type="button"
              aria-expanded={!collapsed}
              aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
              title={title}
              onClick={onToggleCollapsed}
            >
              <PanelChevron
                collapsed={collapsed}
                collapseDirection={collapseDirection}
              />
            </button>
          ) : null}
          <span className="panelHeaderTitleText" title={title}>
            {headerLabel}
          </span>
        </div>

        {!collapsed ? (
          <div className="panelHeaderActions">
            {headerActions}
            <button
              className="iconBtn subtle"
              type="button"
              title="Refresh"
              onClick={onRefresh}
            >
              <RefreshCw className="icon" />
            </button>
          </div>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="panelBody" style={{ gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FileText className="icon" />
            <span style={{ fontWeight: 900, fontSize: 12 }}>
              {fileName ?? "NO FILE"}
            </span>
            <span className="mono" style={{ opacity: 0.75, fontSize: 11 }}>
              {languageId ?? ""}
            </span>
          </div>

          <pre
            className="mono"
            style={{
              margin: 0,
              maxHeight: 240,
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
            {body || "Select a file in the editor"}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
