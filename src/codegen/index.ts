import * as fs from "fs";
import * as path from "path";
import type {
  DesignEdge,
  DesignGraph,
  DesignNode,
  DesignNodeKind,
  PatchPreview,
} from "../shared/protocol";

type FilePatchOperation =
  | {
      kind: "create";
      filePath: string;
      fullText: string;
    }
  | {
      kind: "update";
      filePath: string;
      prependText: string;
      appendText: string;
    };

export type GeneratedPatchPlan = {
  preview: PatchPreview;
  operation: FilePatchOperation;
};

type ResolvedDesignNode = DesignNode & {
  resolvedFilePath: string;
};

type BuildPatchPreviewArgs = {
  design: DesignGraph;
  workspaceRoot: string | null;
};

export function buildPatchPreview(
  args: BuildPatchPreviewArgs,
): { patches: GeneratedPatchPlan[]; warnings: string[] } {
  const { design, workspaceRoot } = args;
  const warnings: string[] = [];

  if (!design.nodes.length) {
    throw new Error("Design graph is empty.");
  }

  const fileBaseDir = workspaceRoot ?? process.cwd();
  const nodeById = new Map(design.nodes.map((node) => [node.id, node]));
  const resolvedNodes = design.nodes
    .filter((node) => node.kind !== "file")
    .map((node) =>
      resolveNodeFilePath({
        node,
        nodeById,
        fileBaseDir,
      }),
    );

  const resolvedNodeById = new Map(
    resolvedNodes.map((node) => [node.id, node]),
  );
  const fileNodes = design.nodes.filter((node) => node.kind === "file");

  const assignedFilePaths = new Set(
    fileNodes
      .map((node) =>
        resolveFileNodePath({
          fileNode: node,
          fileBaseDir,
        }),
      )
      .filter(Boolean),
  );

  for (const node of resolvedNodes) {
    assignedFilePaths.add(node.resolvedFilePath);
  }

  const relationContextByNodeId = buildRelationContext(
    design.edges,
    resolvedNodeById,
  );

  const nodesByFile = new Map<string, ResolvedDesignNode[]>();
  for (const node of resolvedNodes) {
    const list = nodesByFile.get(node.resolvedFilePath) ?? [];
    list.push(node);
    nodesByFile.set(node.resolvedFilePath, list);
  }

  const duplicateConflicts = collectDuplicateDeclarationConflicts(nodesByFile);
  if (duplicateConflicts.length) {
    throw new Error(duplicateConflicts.join("\n"));
  }

  const patches: GeneratedPatchPlan[] = [];
  for (const filePath of [...assignedFilePaths].sort()) {
    const fileNodesInTarget = nodesByFile.get(filePath) ?? [];
    if (!fileNodesInTarget.length) {continue;}

    const existingText = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf8")
      : "";
    const fileWarnings: string[] = [];
    const declarationBlocks: string[] = [];
    const importLines = new Set<string>();

    for (const node of fileNodesInTarget) {
      const context = relationContextByNodeId.get(node.id);
      const emitted = emitNodeBlock({
        node,
        context,
      });
      declarationBlocks.push(emitted.block);
      for (const warning of emitted.warnings) {
        fileWarnings.push(warning);
      }

      for (const importTargetId of [
        ...(context?.dependsOn ?? []),
        ...(context?.extends ?? []),
        ...(context?.implements ?? []),
      ]) {
        const targetNode = resolvedNodeById.get(importTargetId);
        if (!targetNode) {continue;}
        if (targetNode.resolvedFilePath === filePath) {continue;}

        const importName = targetNode.name;
        const relativeImport = toImportPath(filePath, targetNode.resolvedFilePath);
        const importLine = `import { ${importName} } from "${relativeImport}";`;
        if (!existingText.includes(importLine)) {
          importLines.add(importLine);
        }
      }
    }

    const importsText = [...importLines].sort().join("\n");
    const declarationsText = declarationBlocks.join("\n\n").trim();
    if (!declarationsText) {continue;}

    if (!fs.existsSync(filePath)) {
      const fullText = `${importsText ? `${importsText}\n\n` : ""}${declarationsText}\n`;
      const previewWarnings = uniqWarnings(fileWarnings);
      patches.push({
        preview: {
          id: patchId(filePath),
          filePath,
          kind: "create",
          summary: `Create ${path.basename(filePath)} with ${fileNodesInTarget.length} scaffolded declaration${fileNodesInTarget.length > 1 ? "s" : ""}`,
          diffText: buildCreatePreview(filePath, fullText),
          editableContent: fullText.trimEnd(),
          ...(previewWarnings.length ? { warnings: previewWarnings } : {}),
        },
        operation: {
          kind: "create",
          filePath,
          fullText,
        },
      });
      warnings.push(...previewWarnings);
      continue;
    }

    const prependText = importsText ? `${importsText}\n` : "";
    const appendPrefix = existingText.endsWith("\n") ? "\n" : "\n\n";
    const appendText = `${appendPrefix}${declarationsText}\n`;
    const previewWarnings = uniqWarnings(fileWarnings);

    patches.push({
      preview: {
        id: patchId(filePath),
        filePath,
        kind: "update",
        summary: `Update ${path.basename(filePath)} with ${fileNodesInTarget.length} scaffolded declaration${fileNodesInTarget.length > 1 ? "s" : ""}`,
        diffText: buildUpdatePreview(filePath, prependText, appendText),
        editableContent: declarationsText,
        ...(previewWarnings.length ? { warnings: previewWarnings } : {}),
      },
      operation: {
        kind: "update",
        filePath,
        prependText,
        appendText,
      },
    });
    warnings.push(...previewWarnings);
  }

  return {
    patches,
    warnings: uniqWarnings(warnings),
  };
}

function collectDuplicateDeclarationConflicts(
  nodesByFile: Map<string, ResolvedDesignNode[]>,
) {
  const conflicts: string[] = [];

  for (const [filePath, nodes] of nodesByFile.entries()) {
    const existingText = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf8")
      : "";
    const seenKeys = new Set<string>();

    for (const node of nodes) {
      const key = `${node.kind}:${node.name}`;
      if (seenKeys.has(key)) {
        conflicts.push(
          `Duplicate scaffold request in ${path.basename(filePath)}: ${node.kind} ${node.name}.`,
        );
        continue;
      }
      seenKeys.add(key);

      if (hasExistingSymbol(existingText, node)) {
        conflicts.push(
          `Duplicate declaration blocked in ${path.basename(filePath)}: ${node.kind} ${node.name} already exists.`,
        );
      }
    }
  }

  return uniqWarnings(conflicts);
}

function resolveNodeFilePath(args: {
  node: DesignNode;
  nodeById: Map<string, DesignNode>;
  fileBaseDir: string;
}): ResolvedDesignNode {
  const { node, nodeById, fileBaseDir } = args;
  if (node.filePath) {
    return {
      ...node,
      resolvedFilePath: path.resolve(node.filePath),
    };
  }

  const parentFile = findParentFileNode(node, nodeById);
  if (parentFile) {
    const filePath = resolveFileNodePath({
      fileNode: parentFile,
      fileBaseDir,
    });
    if (filePath) {
      return {
        ...node,
        resolvedFilePath: filePath,
      };
    }
  }

  const fallbackName = `${toKebabCase(node.name)}.ts`;
  return {
    ...node,
    resolvedFilePath: path.resolve(fileBaseDir, fallbackName),
  };
}

function findParentFileNode(
  node: DesignNode,
  nodeById: Map<string, DesignNode>,
): DesignNode | null {
  let cursor = node.parentId ? nodeById.get(node.parentId) ?? null : null;
  while (cursor) {
    if (cursor.kind === "file") {return cursor;}
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) ?? null : null;
  }
  return null;
}

function resolveFileNodePath(args: {
  fileNode: DesignNode;
  fileBaseDir: string;
}) {
  const { fileNode, fileBaseDir } = args;
  if (fileNode.filePath) {
    return path.resolve(fileNode.filePath);
  }
  if (fileNode.name.endsWith(".ts") || fileNode.name.endsWith(".tsx")) {
    return path.resolve(fileBaseDir, fileNode.name);
  }
  return path.resolve(fileBaseDir, `${toKebabCase(fileNode.name)}.ts`);
}

function buildRelationContext(
  edges: DesignEdge[],
  nodes: Map<string, ResolvedDesignNode>,
) {
  const ctx = new Map<
    string,
    {
      dependsOn: string[];
      extends: string[];
      implements: string[];
    }
  >();

  for (const edge of edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {continue;}
    const current = ctx.get(edge.source) ?? {
      dependsOn: [],
      extends: [],
      implements: [],
    };
    if (edge.kind === "dependsOn") {
      current.dependsOn.push(edge.target);
    } else if (edge.kind === "extends") {
      current.extends.push(edge.target);
    } else if (edge.kind === "implements") {
      current.implements.push(edge.target);
    }
    ctx.set(edge.source, current);
  }

  return ctx;
}

function emitNodeBlock(args: {
  node: ResolvedDesignNode;
  context?: {
    dependsOn: string[];
    extends: string[];
    implements: string[];
  };
}): { block: string; warnings: string[] } {
  const { node, context } = args;
  const warnings: string[] = [];

  if (node.kind === "function") {
    return {
      block: emitFunction(node),
      warnings,
    };
  }

  if (node.kind === "interface") {
    return {
      block: emitInterface(node),
      warnings,
    };
  }

  if (node.kind === "type") {
    return {
      block: emitTypeAlias(node),
      warnings,
    };
  }

  if (node.kind === "class") {
    return {
      block: emitClass(node, context),
      warnings,
    };
  }

  warnings.push(`Unsupported node kind: ${node.kind}`);
  return { block: "", warnings };
}

function emitFunction(node: ResolvedDesignNode) {
  const exported = node.exported ?? true;
  const params = (node.signature?.params ?? [])
    .map((param) => {
      const optional = param.optional ? "?" : "";
      const type = param.type ?? "unknown";
      return `${param.name}${optional}: ${type}`;
    })
    .join(", ");
  const returnType = node.signature?.returnType ?? "void";
  const exportPrefix = exported ? "export " : "";
  return `${exportPrefix}function ${node.name}(${params}): ${returnType} {\n  throw new Error("Not implemented");\n}`;
}

function emitInterface(node: ResolvedDesignNode) {
  const exported = node.exported ?? true;
  const exportPrefix = exported ? "export " : "";
  const members = (node.members ?? []).filter(
    (member) => member.kind === "method",
  );
  const body =
    members.length > 0
      ? members
          .map(
            (member) =>
              `  ${member.name}(): ${member.returnType ?? "void"};`,
          )
          .join("\n")
      : "  // TODO: define members";
  return `${exportPrefix}interface ${node.name} {\n${body}\n}`;
}

function emitTypeAlias(node: ResolvedDesignNode) {
  const exported = node.exported ?? true;
  const exportPrefix = exported ? "export " : "";
  return `${exportPrefix}type ${node.name} = {\n  // TODO: define shape\n};`;
}

function emitClass(
  node: ResolvedDesignNode,
  context?: {
    dependsOn: string[];
    extends: string[];
    implements: string[];
  },
) {
  const exported = node.exported ?? true;
  const exportPrefix = exported ? "export " : "";
  const extendsClause =
    context?.extends?.length ? ` extends ${context.extends[0]}` : "";
  const implementsClause = context?.implements?.length
    ? ` implements ${context.implements.join(", ")}`
    : "";

  const fields = (node.members ?? [])
    .filter((member) => member.kind === "field")
    .map((member) => {
      const readonly = member.readonly ? "readonly " : "";
      return `  ${readonly}${member.name}: ${member.type ?? "unknown"};`;
    });

  const ctorParams = (context?.dependsOn ?? []).map((targetName) => {
    const argName = toLowerCamel(targetName);
    return `private readonly ${argName}: ${targetName}`;
  });
  const ctorBlock = ctorParams.length
    ? `  constructor(${ctorParams.join(", ")}) {}\n`
    : "";

  const methods = (node.members ?? [])
    .filter((member) => member.kind === "method")
    .map(
      (member) =>
        `  ${member.name}(): ${member.returnType ?? "void"} {\n    throw new Error("Not implemented");\n  }`,
    );

  const bodyParts = [...fields];
  if (ctorBlock) {
    bodyParts.push(ctorBlock.trimEnd());
  }
  if (methods.length) {
    bodyParts.push(...methods);
  }
  if (!bodyParts.length) {
    bodyParts.push('  // TODO: add members');
  }

  return `${exportPrefix}class ${node.name}${extendsClause}${implementsClause} {\n${bodyParts.join("\n\n")}\n}`;
}

function patchId(filePath: string) {
  return `patch:${filePath.replace(/\\/g, "/")}`;
}

function buildCreatePreview(filePath: string, fullText: string) {
  return `### Create ${path.basename(filePath)}\n\n${fullText}`;
}

function buildUpdatePreview(
  filePath: string,
  prependText: string,
  appendText: string,
) {
  const sections: string[] = [`### Update ${path.basename(filePath)}`];
  if (prependText.trim()) {
    sections.push(`-- Insert at top --\n${prependText}`);
  }
  if (appendText.trim()) {
    sections.push(`-- Append at end --\n${appendText}`);
  }
  return sections.join("\n\n");
}

function toKebabCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function toLowerCamel(value: string) {
  const sanitized = value.replace(/[^A-Za-z0-9]+/g, " ").trim();
  if (!sanitized) {return "dependency";}
  const parts = sanitized.split(/\s+/);
  const joined = parts
    .map((part, index) => {
      const normalized = part.replace(/^[^A-Za-z]+/, "");
      if (!normalized) {return "";}
      if (index === 0) {
        return normalized.charAt(0).toLowerCase() + normalized.slice(1);
      }
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join("");
  if (joined) {return joined;}
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function toImportPath(fromFilePath: string, targetFilePath: string) {
  const relativePath = path.relative(
    path.dirname(fromFilePath),
    targetFilePath,
  );
  const withoutExt = relativePath.replace(/\.(ts|tsx|js|jsx)$/, "");
  const normalized = withoutExt.replace(/\\/g, "/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function hasExistingSymbol(text: string, node: { kind: DesignNodeKind; name: string }) {
  if (!text.trim()) {return false;}
  const escaped = escapeRegExp(node.name);
  if (node.kind === "class") {
    return new RegExp(`\\bclass\\s+${escaped}\\b`).test(text);
  }
  if (node.kind === "function") {
    return new RegExp(`\\bfunction\\s+${escaped}\\b`).test(text);
  }
  if (node.kind === "interface") {
    return new RegExp(`\\binterface\\s+${escaped}\\b`).test(text);
  }
  if (node.kind === "type") {
    return new RegExp(`\\btype\\s+${escaped}\\b`).test(text);
  }
  return false;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqWarnings(values: string[]) {
  return [...new Set(values)];
}
