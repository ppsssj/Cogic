// import "./../App.css";
import { ArrowDownLeft, ArrowUpRight, Sigma, Network } from "lucide-react";
import type { ExtToWebviewMessage } from "../lib/vscode";
import "./AnalysisPanel.css";
type AnalysisPayload = Extract<
  ExtToWebviewMessage,
  { type: "analysisResult" }
>["payload"];

type Props = {
  analysis: AnalysisPayload;
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

export function AnalysisPanel({ analysis }: Props) {
  if (!analysis) {
    return (
      <div className="panel">
        <div className="panelHeader">
          <span>ANALYSIS</span>
        </div>
        <div className="panelBody">
          <div className="mutedText">
            No analysis result yet. Click Generate.
          </div>
        </div>
      </div>
    );
  }

  const nodesLen = analysis.graph?.nodes?.length ?? 0;
  const edgesLen = analysis.graph?.edges?.length ?? 0;

  return (
    <div className="panel">
      <div className="panelHeader">
        <span>ANALYSIS</span>
        <span className="mono" style={{ opacity: 0.75 }}>
          {analysis.stats.lines} lines · {analysis.stats.chars} chars
        </span>
      </div>

      <div className="panelBody" style={{ gap: 14 }}>
        {/* Graph */}
        <Section
          title={`Graph (${nodesLen} nodes · ${edgesLen} edges)`}
          icon={<Network className="icon" />}
        >
          {analysis.graph ? (
            <div className="kvList">
              <div className="kvRow">
                <div className="kvKey mono">nodes</div>
                <div className="kvVal mono">{nodesLen}</div>
              </div>
              <div className="kvRow">
                <div className="kvKey mono">edges</div>
                <div className="kvVal mono">{edgesLen}</div>
              </div>
            </div>
          ) : (
            <div className="mutedText">
              No graph payload found in analysisResult.
            </div>
          )}
        </Section>

        {/* Imports */}
        <Section
          title={`Imports (${analysis.imports.length})`}
          icon={<ArrowDownLeft className="icon" />}
        >
          {analysis.imports.length === 0 ? (
            <div className="mutedText">No imports detected.</div>
          ) : (
            <div className="kvList">
              {analysis.imports.slice(0, 30).map((imp, idx) => (
                <div className="kvRow" key={`${imp.source}-${idx}`}>
                  <div className="kvKey mono">{imp.source}</div>
                  <div className="kvVal mono">
                    {imp.kind === "side-effect"
                      ? "(side-effect)"
                      : imp.specifiers.length
                        ? imp.specifiers.join(", ")
                        : "(none)"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Exports */}
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

        {/* Calls */}
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

                return (
                  <div
                    className="kvRow"
                    key={key}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
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
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
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
