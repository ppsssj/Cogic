// import "./../App.css";
import { FileText, RefreshCw } from "lucide-react";
import "./ActiveFileSnapshot.css";
type Props = {
  title?: string;
  fileName?: string;
  languageId?: string;
  text?: string;
  onRefresh: () => void;
};

function clipText(text: string, maxLines: number) {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + "\n\n// …(truncated)";
}

export function ActiveFileSnapshot({
  title = "ACTIVE FILE SNAPSHOT",
  fileName,
  languageId,
  text,
  onRefresh,
}: Props) {
  const body = text ? clipText(text, 200) : "";

  return (
    <div className="panel">
      <div className="panelHeader" style={{ gap: 10 }}>
        <span>{title}</span>

        <button
          className="iconBtn subtle"
          type="button"
          title="Refresh"
          onClick={onRefresh}
        >
          <RefreshCw className="icon" />
        </button>
      </div>

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
    </div>
  );
}
