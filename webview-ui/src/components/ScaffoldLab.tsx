import { useCallback, useMemo, useState } from "react";
import type { DesignGraph, PatchPreview } from "../lib/vscode";
import "./ScaffoldLab.css";

type ScaffoldTemplate =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "service-repository"
  | "file"
  | "folder";

type ScaffoldContextKind = "canvas" | "file" | "folder";

type PatchPreviewState = {
  requestId: string | null;
  patches: PatchPreview[];
  warnings: string[];
  error: string | null;
};

type Props = {
  targetContext: ScaffoldContextKind;
  targetFilePath: string | null;
  targetFolderPath: string | null;
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

type TemplateOption = {
  value: ScaffoldTemplate;
  label: string;
};

type PatchDraftState = {
  key: string;
  selectedPatchIds: string[];
  editedContentByPatchId: Record<string, string>;
};

const FILE_CONTEXT_TEMPLATES: TemplateOption[] = [
  { value: "function", label: "Function" },
  { value: "class", label: "Class" },
  { value: "interface", label: "Interface" },
  { value: "type", label: "Type" },
  { value: "service-repository", label: "Service + Repository" },
];

const FOLDER_CONTEXT_TEMPLATES: TemplateOption[] = [
  { value: "file", label: "File" },
  { value: "folder", label: "Folder" },
];

const CANVAS_CONTEXT_TEMPLATES: TemplateOption[] = [
  ...FILE_CONTEXT_TEMPLATES,
  ...FOLDER_CONTEXT_TEMPLATES,
];

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

function sanitizePath(value: string) {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function normalizePathSegment(value: string, fallback: string) {
  const normalized = toKebabCase(value);
  return normalized || fallback;
}

function buildFileName(rawName: string) {
  const normalized = sanitizePath(rawName);
  if (!normalized) return "new-file.ts";

  const segments = normalized.split("/").filter(Boolean);
  const leaf = segments.pop() ?? "new-file";
  const needsExtension = !/\.[A-Za-z0-9]+$/.test(leaf);
  const normalizedLeaf = needsExtension
    ? `${normalizePathSegment(leaf, "new-file")}.ts`
    : leaf;

  return [...segments.map((segment) => normalizePathSegment(segment, "dir")), normalizedLeaf]
    .join("/");
}

function buildFolderName(rawName: string) {
  const normalized = sanitizePath(rawName);
  if (!normalized) return "new-folder";
  return normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => normalizePathSegment(segment, "folder"))
    .join("/");
}

function buildDesignGraph(args: {
  template: ScaffoldTemplate;
  rawName: string;
  targetContext: ScaffoldContextKind;
  targetFilePath: string | null;
  targetFolderPath: string | null;
  workspaceRoot: string | null;
}): DesignGraph {
  const {
    template,
    rawName,
    targetContext,
    targetFilePath,
    targetFolderPath,
    workspaceRoot,
  } = args;
  const name = rawName.trim();
  const baseDir =
    targetFolderPath ?? workspaceRoot ?? (targetFilePath ? dirName(targetFilePath) : "");

  if (!baseDir && template !== "function" && template !== "class" && template !== "interface" && template !== "type" && template !== "service-repository") {
    throw new Error("Choose a folder or open a workspace folder first.");
  }

  if (targetContext === "file" && !targetFilePath) {
    throw new Error("File scaffolds require a target file.");
  }

  const resolveTargetFilePath = (symbolName: string) =>
    targetContext === "file" && targetFilePath
      ? targetFilePath
      : joinPath(baseDir, buildFileName(symbolName));

  if (template === "file") {
    const filePath = joinPath(baseDir, buildFileName(name));
    return {
      nodes: [
        {
          id: "file",
          kind: "file",
          name: shortFile(filePath),
          filePath,
          source: "scaffold-lab",
        },
      ],
      edges: [],
    };
  }

  if (template === "folder") {
    const folderPath = joinPath(baseDir, buildFolderName(name));
    return {
      nodes: [
        {
          id: "folder",
          kind: "folder",
          name: shortFile(folderPath),
          filePath: folderPath,
          source: "scaffold-lab",
        },
      ],
      edges: [],
    };
  }

  if (template === "function") {
    return {
      nodes: [
        {
          id: "fn",
          kind: "function",
          name,
          filePath: resolveTargetFilePath(name),
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
          filePath: resolveTargetFilePath(name),
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
          filePath: resolveTargetFilePath(name),
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
          filePath: resolveTargetFilePath(name),
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
    targetContext === "file" && targetFilePath ? targetFilePath : null;

  return {
    nodes: [
      {
        id: "repo",
        kind: "interface",
        name: repositoryName,
        filePath: sharedFilePath ?? resolveTargetFilePath(repositoryName),
        exported: true,
        members: [{ kind: "method", name: "findById", returnType: "Promise<unknown>" }],
        source: "scaffold-lab",
      },
      {
        id: "service",
        kind: "class",
        name: serviceName,
        filePath: sharedFilePath ?? resolveTargetFilePath(serviceName),
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

function buildPatchDraftState(
  key: string,
  patches: PatchPreview[],
): PatchDraftState {
  return {
    key,
    selectedPatchIds: patches.map((patch) => patch.id),
    editedContentByPatchId: Object.fromEntries(
      patches.map((patch) => [patch.id, patch.editableContent ?? patch.diffText]),
    ),
  };
}

export function ScaffoldLab({
  targetContext,
  targetFilePath,
  targetFolderPath,
  workspaceRoot,
  previewState,
  isPreviewBusy,
  isApplyBusy,
  onRequestPreview,
  onApplyPreview,
}: Props) {
  const templateOptions = useMemo(() => {
    if (targetContext === "folder") return FOLDER_CONTEXT_TEMPLATES;
    if (targetContext === "file") return FILE_CONTEXT_TEMPLATES;
    return CANVAS_CONTEXT_TEMPLATES;
  }, [targetContext]);
  const defaultTemplate = templateOptions[0]?.value ?? "function";
  const defaultName = targetContext === "folder" ? "new-item" : "User";
  const patchDraftKey = useMemo(
    () =>
      [
        previewState.requestId ?? "draft",
        ...previewState.patches.map((patch) => patch.id),
      ].join(":"),
    [previewState.patches, previewState.requestId],
  );
  const patchById = useMemo(
    () => new Map(previewState.patches.map((patch) => [patch.id, patch] as const)),
    [previewState.patches],
  );

  const [selectedTemplate, setSelectedTemplate] = useState<ScaffoldTemplate>(defaultTemplate);
  const [nameState, setNameState] = useState(() => ({
    value: defaultName,
    lastDefault: defaultName,
  }));
  const [patchDraftState, setPatchDraftState] = useState<PatchDraftState>(() =>
    buildPatchDraftState(patchDraftKey, previewState.patches),
  );

  const template = templateOptions.some((option) => option.value === selectedTemplate)
    ? selectedTemplate
    : defaultTemplate;
  const name =
    nameState.value === nameState.lastDefault ? defaultName : nameState.value;
  const currentPatchDraftState =
    patchDraftState.key === patchDraftKey
      ? patchDraftState
      : buildPatchDraftState(patchDraftKey, previewState.patches);
  const selectedPatchIds = currentPatchDraftState.selectedPatchIds;
  const editedContentByPatchId = currentPatchDraftState.editedContentByPatchId;

  const updatePatchDraftState = useCallback(
    (updater: (current: PatchDraftState) => PatchDraftState) => {
      setPatchDraftState((current) => {
        const base =
          current.key === patchDraftKey
            ? current
            : buildPatchDraftState(patchDraftKey, previewState.patches);
        return updater(base);
      });
    },
    [patchDraftKey, previewState.patches],
  );

  const helperText = useMemo(() => {
    if (targetContext === "file") {
      return targetFilePath
        ? `Target file: ${targetFilePath}`
        : "Right-click a file node to scaffold into that file.";
    }
    if (targetContext === "folder") {
      return targetFolderPath
        ? `Target folder: ${targetFolderPath}`
        : "Right-click a folder node to scaffold into that folder.";
    }
    return targetFolderPath
      ? `Target folder: ${targetFolderPath}`
      : "Right-click a file or folder node to lock the scaffold target.";
  }, [targetContext, targetFilePath, targetFolderPath]);

  const nameLabel =
    template === "file"
      ? "File Name"
      : template === "folder"
        ? "Folder Name"
        : "Base Name";
  const namePlaceholder =
    template === "file"
      ? "user-service.ts"
      : template === "folder"
        ? "services"
        : "User";

  const handlePreview = () => {
    const design = buildDesignGraph({
      template,
      rawName: name,
      targetContext,
      targetFilePath,
      targetFolderPath,
      workspaceRoot,
    });
    onRequestPreview({
      design,
      workspaceRoot,
    });
  };

  const togglePatch = useCallback((patchId: string) => {
    updatePatchDraftState((current) => ({
      ...current,
      selectedPatchIds: current.selectedPatchIds.includes(patchId)
        ? current.selectedPatchIds.filter((id) => id !== patchId)
        : [...current.selectedPatchIds, patchId],
    }));
  }, [updatePatchDraftState]);

  const handleApply = useCallback(() => {
    if (!previewState.requestId) return;
    onApplyPreview(
      previewState.requestId,
      selectedPatchIds,
      selectedPatchIds.map((patchId) => ({
        patchId,
        content: editedContentByPatchId[patchId] ?? patchById.get(patchId)?.editableContent ?? "",
      })),
    );
  }, [
    editedContentByPatchId,
    onApplyPreview,
    patchById,
    previewState.requestId,
    selectedPatchIds,
  ]);

  return (
    <div className="scaffoldLab">
      <section className="scaffoldSection">
        <div className="scaffoldSectionHeader">
          <div className="scaffoldSectionTitle">CONFIG</div>
          <div className="scaffoldSectionMeta">Context-driven scaffold input</div>
        </div>
        <div className="scaffoldSectionBody scaffoldLabForm">
          <label className="scaffoldField">
            <span className="scaffoldFieldLabel">Template</span>
            <select
              className="scaffoldInput"
              value={template}
              onChange={(event) =>
                setSelectedTemplate(event.target.value as ScaffoldTemplate)
              }
            >
              {templateOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="scaffoldField">
            <span className="scaffoldFieldLabel">{nameLabel}</span>
            <input
              className="scaffoldInput"
              value={name}
              onChange={(event) =>
                setNameState({
                  value: event.target.value,
                  lastDefault: defaultName,
                })
              }
              placeholder={namePlaceholder}
            />
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
              onClick={handleApply}
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
                        updatePatchDraftState((current) => ({
                          ...current,
                          editedContentByPatchId: {
                            ...current.editedContentByPatchId,
                            [patch.id]: event.target.value,
                          },
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
