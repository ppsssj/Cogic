import { useEffect, useMemo, useState } from "react";
import type { DesignGraph, PatchPreview } from "../lib/vscode";
import "./ScaffoldLab.css";

type ScaffoldTemplate =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "service-repository";

type TargetMode = "new-file" | "active-file";

type PatchPreviewState = {
  requestId: string | null;
  patches: PatchPreview[];
  warnings: string[];
  error: string | null;
};

type Props = {
  appendTargetFilePath: string | null;
  workspaceRoot: string | null;
  previewState: PatchPreviewState;
  isPreviewBusy: boolean;
  isApplyBusy: boolean;
  onRequestPreview: (payload: {
    design: DesignGraph;
    workspaceRoot: string | null;
  }) => void;
  onApplyPreview: (
    requestId: string,
    selectedPatchIds: string[],
    editedPatches: Array<{ patchId: string; content: string }>,
  ) => void;
};

function dirName(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(0, idx) : normalized;
}

function joinPath(dir: string, fileName: string) {
  const prefix = dir.replace(/[\\/]+$/, "");
  return `${prefix}/${fileName}`.replace(/\//g, "\\");
}

function toKebabCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function shortFile(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || filePath;
}

function buildDesignGraph(args: {
  template: ScaffoldTemplate;
  rawName: string;
  targetMode: TargetMode;
  appendTargetFilePath: string | null;
  workspaceRoot: string | null;
}): DesignGraph {
  const { template, rawName, targetMode, appendTargetFilePath, workspaceRoot } = args;
  const name = rawName.trim();
  const baseDir =
    targetMode === "active-file" && appendTargetFilePath
      ? dirName(appendTargetFilePath)
      : workspaceRoot ?? (appendTargetFilePath ? dirName(appendTargetFilePath) : "");

  if (!baseDir) {
    throw new Error("Choose an active file or open a workspace folder first.");
  }

  if (targetMode === "active-file" && !appendTargetFilePath) {
    throw new Error("Active file target requires an open file.");
  }

  const targetFilePath = (symbolName: string) =>
    targetMode === "active-file" && appendTargetFilePath
      ? appendTargetFilePath
      : joinPath(baseDir, `${toKebabCase(symbolName)}.ts`);

  if (template === "function") {
    return {
      nodes: [
        {
          id: "fn",
          kind: "function",
          name,
          filePath: targetFilePath(name),
          exported: true,
          signature: {
            params: [{ name: "input", type: "unknown" }],
            returnType: "void",
          },
          source: "scaffold-lab",
        },
      ],
      edges: [],
    };
  }

  if (template === "class") {
    return {
      nodes: [
        {
          id: "class",
          kind: "class",
          name,
          filePath: targetFilePath(name),
          exported: true,
          members: [{ kind: "method", name: "execute", returnType: "void" }],
          source: "scaffold-lab",
        },
      ],
      edges: [],
    };
  }

  if (template === "interface") {
    return {
      nodes: [
        {
          id: "interface",
          kind: "interface",
          name,
          filePath: targetFilePath(name),
          exported: true,
          members: [{ kind: "method", name: "execute", returnType: "void" }],
          source: "scaffold-lab",
        },
      ],
      edges: [],
    };
  }

  if (template === "type") {
    return {
      nodes: [
        {
          id: "type",
          kind: "type",
          name,
          filePath: targetFilePath(name),
          exported: true,
          source: "scaffold-lab",
        },
      ],
      edges: [],
    };
  }

  const repositoryName = `${name}Repository`;
  const serviceName = `${name}Service`;
  const sharedFilePath =
    targetMode === "active-file" && appendTargetFilePath ? appendTargetFilePath : null;

  return {
    nodes: [
      {
        id: "repo",
        kind: "interface",
        name: repositoryName,
        filePath: sharedFilePath ?? targetFilePath(repositoryName),
        exported: true,
        members: [{ kind: "method", name: "findById", returnType: "Promise<unknown>" }],
        source: "scaffold-lab",
      },
      {
        id: "service",
        kind: "class",
        name: serviceName,
        filePath: sharedFilePath ?? targetFilePath(serviceName),
        exported: true,
        members: [{ kind: "method", name: "execute", returnType: "Promise<void>" }],
        source: "scaffold-lab",
      },
    ],
    edges: [
      {
        id: "service-depends-on-repo",
        kind: "dependsOn",
        source: "service",
        target: "repo",
      },
    ],
  };
}

export function ScaffoldLab({
  appendTargetFilePath,
  workspaceRoot,
  previewState,
  isPreviewBusy,
  isApplyBusy,
  onRequestPreview,
  onApplyPreview,
}: Props) {
  const [template, setTemplate] = useState<ScaffoldTemplate>("service-repository");
  const [targetMode, setTargetMode] = useState<TargetMode>(
    appendTargetFilePath ? "active-file" : "new-file",
  );
  const [name, setName] = useState("User");
  const [selectedPatchIds, setSelectedPatchIds] = useState<string[]>([]);
  const [editedContentByPatchId, setEditedContentByPatchId] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    setSelectedPatchIds(previewState.patches.map((patch) => patch.id));
    setEditedContentByPatchId(
      Object.fromEntries(
        previewState.patches.map((patch) => [
          patch.id,
          patch.editableContent ?? patch.diffText,
        ]),
      ),
    );
  }, [previewState.patches]);

  useEffect(() => {
    if (!appendTargetFilePath && targetMode === "active-file") {
      setTargetMode("new-file");
    }
  }, [appendTargetFilePath, targetMode]);

  const canUseActiveFile = Boolean(appendTargetFilePath);
  const targetFileLabel = appendTargetFilePath ? shortFile(appendTargetFilePath) : null;
  const helperText = useMemo(() => {
    if (targetMode === "active-file") {
      return targetFileLabel
        ? `Target: ${targetFileLabel}`
        : "Open a file to append scaffold into the active editor file.";
    }
    return workspaceRoot
      ? `Target folder: ${workspaceRoot}`
      : "New files will be created next to the active file if no workspace root is open.";
  }, [targetFileLabel, targetMode, workspaceRoot]);

  const handlePreview = () => {
    const design = buildDesignGraph({
      template,
      rawName: name,
      targetMode,
      appendTargetFilePath,
      workspaceRoot,
    });
    onRequestPreview({
      design,
      workspaceRoot,
    });
  };

  const togglePatch = (patchId: string) => {
    setSelectedPatchIds((current) =>
      current.includes(patchId)
        ? current.filter((id) => id !== patchId)
        : [...current, patchId],
    );
  };

  return (
    <div className="scaffoldLab">
      <section className="scaffoldSection">
        <div className="scaffoldSectionHeader">
          <div className="scaffoldSectionTitle">CONFIG</div>
          <div className="scaffoldSectionMeta">Structure-first scaffold input</div>
        </div>
        <div className="scaffoldSectionBody scaffoldLabForm">
          <label className="scaffoldField">
            <span className="scaffoldFieldLabel">Template</span>
            <select
              className="scaffoldInput"
              value={template}
              onChange={(event) =>
                setTemplate(event.target.value as ScaffoldTemplate)
              }
            >
              <option value="service-repository">Service + Repository</option>
              <option value="class">Class</option>
              <option value="function">Function</option>
              <option value="interface">Interface</option>
              <option value="type">Type</option>
            </select>
          </label>

          <label className="scaffoldField">
            <span className="scaffoldFieldLabel">Base Name</span>
            <input
              className="scaffoldInput"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="User"
            />
          </label>

          <label className="scaffoldField">
            <span className="scaffoldFieldLabel">Target</span>
            <select
              className="scaffoldInput"
              value={targetMode}
              onChange={(event) => setTargetMode(event.target.value as TargetMode)}
            >
              <option value="active-file" disabled={!canUseActiveFile}>
                Append to active file
              </option>
              <option value="new-file">Create new file(s)</option>
            </select>
          </label>

          <div className="scaffoldHint">{helperText}</div>

          <div className="scaffoldActions">
            <button
              className="smallBtn"
              type="button"
              onClick={handlePreview}
              disabled={isPreviewBusy || !name.trim()}
            >
              {isPreviewBusy ? "Preparing..." : "Preview Code"}
            </button>
            <button
              className="smallBtn"
              type="button"
              onClick={() =>
                previewState.requestId
                  ? onApplyPreview(
                      previewState.requestId,
                      selectedPatchIds,
                      selectedPatchIds.map((patchId) => ({
                        patchId,
                        content:
                          editedContentByPatchId[patchId] ??
                          previewState.patches.find((patch) => patch.id === patchId)
                            ?.editableContent ??
                          "",
                      })),
                    )
                  : undefined
              }
              disabled={
                isApplyBusy ||
                !previewState.requestId ||
                selectedPatchIds.length === 0
              }
            >
              {isApplyBusy ? "Applying..." : "Apply Selected"}
            </button>
          </div>
        </div>
      </section>

      {previewState.error ? (
        <div className="scaffoldError">{previewState.error}</div>
      ) : null}

      {previewState.warnings.length > 0 ? (
        <div className="scaffoldWarnings">
          {previewState.warnings.map((warning) => (
            <div key={warning} className="scaffoldWarningItem">
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      {previewState.patches.length > 0 ? (
        <section className="scaffoldSection">
          <div className="scaffoldSectionHeader">
            <div className="scaffoldSectionTitle">PATCH PREVIEW</div>
            <div className="scaffoldSectionMeta">
              {previewState.patches.length} file{previewState.patches.length > 1 ? "s" : ""}
            </div>
          </div>
          <div className="scaffoldSectionBody">
            <div className="scaffoldPreviewList">
              {previewState.patches.map((patch) => {
                const checked = selectedPatchIds.includes(patch.id);
                return (
                  <div key={patch.id} className="scaffoldPreviewCard">
                    <label className="scaffoldPreviewHeader">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePatch(patch.id)}
                      />
                      <span className="scaffoldPreviewTitle">{patch.summary}</span>
                    </label>
                    <div className="scaffoldPreviewMeta">
                      {patch.kind.toUpperCase()} {shortFile(patch.filePath)}
                    </div>
                    {patch.warnings?.length ? (
                      <div className="scaffoldPreviewWarnings">
                        {patch.warnings.join(" | ")}
                      </div>
                    ) : null}
                    <textarea
                      className="scaffoldPreviewEditor mono"
                      value={editedContentByPatchId[patch.id] ?? ""}
                      onChange={(event) =>
                        setEditedContentByPatchId((current) => ({
                          ...current,
                          [patch.id]: event.target.value,
                        }))
                      }
                      spellCheck={false}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
