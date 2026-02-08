import * as path from "path";
import * as fs from "fs";
import * as ts from "typescript";
import type {
  AnalysisCallV2,
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeKind,
  GraphPayload,
} from "../shared/protocol";

/**
 * Single-file analysis (in-memory program with only the active file as root).
 * Keeps behavior stable for MVP / fallback.
 */
export function analyzeTypeScriptWithTypes(args: {
  code: string;
  fileName: string;
  languageId: string;
}): {
  imports: Array<{
    source: string;
    specifiers: string[];
    kind: "named" | "default" | "namespace" | "side-effect" | "unknown";
  }>;
  exports: Array<{
    name: string;
    kind: "function" | "class" | "type" | "interface" | "const" | "unknown";
  }>;
  calls: Array<AnalysisCallV2>;
  graph: GraphPayload;
  meta: { mode: "single-file" };
} {
  const { code, fileName, languageId } = args;

  const scriptKind = pickScriptKind(fileName, languageId);

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.React,
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    strict: false,
  };

  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const inMemoryFileName = fileName;

  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile: (
      requested,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    ) => {
      if (path.resolve(requested) === path.resolve(inMemoryFileName)) {
        return ts.createSourceFile(
          requested,
          code,
          languageVersion,
          true,
          scriptKind,
        );
      }
      return defaultHost.getSourceFile(
        requested,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
    },
  };

  const program = ts.createProgram([inMemoryFileName], compilerOptions, host);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(inMemoryFileName);

  if (!sf) {
    return {
      imports: [],
      exports: [],
      calls: [],
      graph: { nodes: [], edges: [] },
      meta: { mode: "single-file" },
    };
  }

  const imports = extractImports(sf);
  const exports = extractExports(sf);
  const calls = extractCallsResolved(sf, checker);

  // single-file graph: external nodes still possible (but likely null since program has one file)
  const graph = buildActiveFileGraph(sf, checker);

  return { imports, exports, calls, graph, meta: { mode: "single-file" } };
}

/**
 * Workspace-aware analysis. Builds a multi-file Program so declarations can resolve across files.
 * - Uses tsconfig.json in workspaceRoot if present (preferred)
 * - Otherwise uses filePaths as program roots (fallback)
 * - Always overrides active file source with in-memory code (so unsaved edits are included)
 */
export function analyzeWithWorkspace(args: {
  active: { code: string; fileName: string; languageId: string };
  workspaceRoot: string | null;
  filePaths: string[];
}): {
  imports: Array<{
    source: string;
    specifiers: string[];
    kind: "named" | "default" | "namespace" | "side-effect" | "unknown";
  }>;
  exports: Array<{
    name: string;
    kind: "function" | "class" | "type" | "interface" | "const" | "unknown";
  }>;
  calls: Array<AnalysisCallV2>;
  graph: GraphPayload;
  meta: {
    mode: "workspace";
    rootFiles: number;
    usedTsconfig: boolean;
    projectRoot?: string;
  };
} {
  const { active, workspaceRoot, filePaths } = args;
  const activeFile = active.fileName;

  // no workspace: fall back to single-file behavior
  if (!workspaceRoot) {
    const r = analyzeTypeScriptWithTypes({
      code: active.code,
      fileName: active.fileName,
      languageId: active.languageId,
    });
    return {
      ...r,
      meta: { mode: "workspace", rootFiles: 1, usedTsconfig: false },
    };
  }

  const { rootNames, options, usedTsconfig, projectRoot } = buildWorkspaceRoots(
    {
      workspaceRoot,
      filePaths,
    },
  );

  const scriptKind = pickScriptKind(active.fileName, active.languageId);

  const defaultHost = ts.createCompilerHost(options, true);
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (fileName) => {
      if (samePath(fileName, activeFile)) return true;
      return defaultHost.fileExists(fileName);
    },
    readFile: (fileName) => {
      if (samePath(fileName, activeFile)) return active.code;
      return defaultHost.readFile(fileName);
    },
    getSourceFile: (
      requested,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    ) => {
      if (samePath(requested, activeFile)) {
        return ts.createSourceFile(
          requested,
          active.code,
          languageVersion,
          true,
          scriptKind,
        );
      }
      return defaultHost.getSourceFile(
        requested,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
    },
  };

  const program = ts.createProgram(rootNames, options, host);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(activeFile);

  if (!sf) {
    // rare: if activeFile not in roots, still try single-file
    const r = analyzeTypeScriptWithTypes({
      code: active.code,
      fileName: active.fileName,
      languageId: active.languageId,
    });
    return {
      ...r,
      meta: {
        mode: "workspace",
        rootFiles: rootNames.length,
        usedTsconfig,
        projectRoot,
      },
    };
  }

  const imports = extractImports(sf);
  const exports = extractExports(sf);
  const calls = extractCallsResolved(sf, checker);

  // workspace graph (external nodes enabled)
  const graph = buildActiveFileGraph(sf, checker);

  return {
    imports,
    exports,
    calls,
    graph,
    meta: {
      mode: "workspace",
      rootFiles: rootNames.length,
      usedTsconfig,
      projectRoot,
    },
  };
}

function buildWorkspaceRoots(args: {
  workspaceRoot: string;
  filePaths: string[];
}): {
  rootNames: string[];
  options: ts.CompilerOptions;
  usedTsconfig: boolean;
  projectRoot?: string;
} {
  const { workspaceRoot, filePaths } = args;

  const tsconfigPath = path.join(workspaceRoot, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) {
    try {
      const cfg = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(
        cfg.config,
        ts.sys,
        workspaceRoot,
      );
      const rootNames = parsed.fileNames.length ? parsed.fileNames : filePaths;
      const options: ts.CompilerOptions = {
        ...parsed.options,
        noEmit: true,
        skipLibCheck: parsed.options.skipLibCheck ?? true,
      };
      return {
        rootNames,
        options,
        usedTsconfig: true,
        projectRoot: workspaceRoot,
      };
    } catch {
      // fallback
    }
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.React,
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    strict: false,
  };

  return {
    rootNames: filePaths,
    options,
    usedTsconfig: false,
    projectRoot: workspaceRoot,
  };
}

function samePath(a: string, b: string) {
  return path.resolve(a) === path.resolve(b);
}

function pickScriptKind(fileName: string, languageId: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx") || languageId === "typescriptreact")
    return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx") || languageId === "javascriptreact")
    return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || languageId === "javascript")
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isExported(node: ts.Node): boolean {
  const mods = ts.getCombinedModifierFlags(node as ts.Declaration);
  return (mods & ts.ModifierFlags.Export) !== 0;
}

function hasDefaultModifier(node: ts.Node): boolean {
  const mods = ts.getCombinedModifierFlags(node as ts.Declaration);
  return (mods & ts.ModifierFlags.Default) !== 0;
}

function extractImports(sf: ts.SourceFile): Array<{
  source: string;
  specifiers: string[];
  kind: "named" | "default" | "namespace" | "side-effect" | "unknown";
}> {
  const imports: Array<{
    source: string;
    specifiers: string[];
    kind: "named" | "default" | "namespace" | "side-effect" | "unknown";
  }> = [];

  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;

    const source = ts.isStringLiteral(st.moduleSpecifier)
      ? st.moduleSpecifier.text
      : st.moduleSpecifier.getText(sf);

    if (!st.importClause) {
      imports.push({ source, specifiers: [], kind: "side-effect" });
      continue;
    }

    const specifiers: string[] = [];
    const { name, namedBindings } = st.importClause;

    if (name) specifiers.push(name.text);

    if (namedBindings) {
      if (ts.isNamespaceImport(namedBindings)) {
        specifiers.push(namedBindings.name.text);
        imports.push({ source, specifiers, kind: "namespace" });
        continue;
      }
      if (ts.isNamedImports(namedBindings)) {
        for (const el of namedBindings.elements) {
          const imported = el.propertyName?.text ?? el.name.text;
          const local = el.name.text;
          specifiers.push(
            imported === local ? imported : `${imported} as ${local}`,
          );
        }
        imports.push({ source, specifiers, kind: "named" });
        continue;
      }
    }

    if (name && !namedBindings) {
      imports.push({ source, specifiers, kind: "default" });
      continue;
    }

    imports.push({ source, specifiers, kind: "unknown" });
  }

  return imports;
}

function extractExports(sf: ts.SourceFile): Array<{
  name: string;
  kind: "function" | "class" | "type" | "interface" | "const" | "unknown";
}> {
  const exports: Array<{
    name: string;
    kind: "function" | "class" | "type" | "interface" | "const" | "unknown";
  }> = [];

  const push = (
    name: string,
    kind: "function" | "class" | "type" | "interface" | "const" | "unknown",
  ) => {
    if (!name) return;
    exports.push({ name, kind });
  };

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && isExported(st)) {
      push(
        st.name?.text ?? (hasDefaultModifier(st) ? "default" : ""),
        "function",
      );
      continue;
    }
    if (ts.isClassDeclaration(st) && isExported(st)) {
      push(st.name?.text ?? (hasDefaultModifier(st) ? "default" : ""), "class");
      continue;
    }
    if (ts.isTypeAliasDeclaration(st) && isExported(st)) {
      push(st.name.text, "type");
      continue;
    }
    if (ts.isInterfaceDeclaration(st) && isExported(st)) {
      push(st.name.text, "interface");
      continue;
    }
    if (ts.isVariableStatement(st) && isExported(st)) {
      for (const decl of st.declarationList.declarations) {
        push(
          ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText(sf),
          "const",
        );
      }
      continue;
    }

    if (ts.isExportDeclaration(st)) {
      if (!st.exportClause) {
        push("*", "unknown");
        continue;
      }
      if (ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          const exported = el.name.text;
          const local = el.propertyName?.text ?? el.name.text;
          push(
            exported === local ? exported : `${local} as ${exported}`,
            "unknown",
          );
        }
      }
      continue;
    }

    if (ts.isExportAssignment(st)) {
      push("default", "unknown");
      continue;
    }
  }

  return exports;
}

/**
 * Graph builder (active-file centered)
 * - Always includes file node + local decl nodes
 * - If a call/new resolves to a declaration in another file:
 *   - create an `external` node, and connect edges to it
 */
function buildActiveFileGraph(
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): GraphPayload {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // declStartPos -> nodeId (only for active file decls)
  const idByDeclPos = new Map<number, string>();

  const mkId = (kind: GraphNodeKind, name: string, file: string, pos: number) =>
    `${kind}:${name}@${file}:${pos}`;

  const sourceFileRange = () => {
    const endPos = sf.getEnd();
    const endLC = sf.getLineAndCharacterOfPosition(endPos);
    return {
      start: { line: 0, character: 0 },
      end: { line: endLC.line, character: endLC.character },
    };
  };

  // file root node (top-level owner)
  const filePos = 0;
  const fileNameBase = path.basename(sf.fileName);
  const fileNodeId = mkId("file", fileNameBase, sf.fileName, filePos);
  nodes.push({
    id: fileNodeId,
    kind: "file",
    name: fileNameBase,
    file: sf.fileName,
    range: sourceFileRange(),
  });

  const pushNode = (
    decl: ts.Declaration,
    kind: GraphNodeKind,
    name: string,
  ) => {
    const loc = declLocation(decl);
    const id = mkId(kind, name, loc.fileName, loc.pos);
    idByDeclPos.set(loc.pos, id);

    let signature: string | undefined = undefined;
    try {
      if (
        ts.isFunctionDeclaration(decl) ||
        ts.isMethodDeclaration(decl) ||
        ts.isConstructorDeclaration(decl)
      ) {
        const sig = checker.getSignatureFromDeclaration(
          decl as ts.SignatureDeclaration,
        );
        if (sig) signature = checker.signatureToString(sig);
      }
    } catch {
      // ignore signature extraction failures
    }

    nodes.push({
      id,
      kind,
      name,
      file: sf.fileName,
      range: loc.range,
      signature,
    });
  };

  // collect nodes (top-level + class members)
  const visitDecls = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      pushNode(node, "function", node.name.text);
    } else if (ts.isClassDeclaration(node) && node.name) {
      pushNode(node, "class", node.name.text);
      for (const m of node.members) {
        if (
          ts.isMethodDeclaration(m) &&
          m.name &&
          ts.isIdentifier(m.name) &&
          m.body
        ) {
          pushNode(m, "method", `${node.name!.text}.${m.name.text}`);
        }
      }
    }
    ts.forEachChild(node, visitDecls);
  };
  visitDecls(sf);

  // external node cache (by decl file+pos)
  const externalIdByDecl = new Map<string, string>();

  const ensureExternalNode = (
    name: string,
    loc: ReturnType<typeof declLocation>,
    signature?: string,
  ) => {
    const key = `${loc.fileName}:${loc.pos}`;
    const existing = externalIdByDecl.get(key);
    if (existing) return existing;

    const base = path.basename(loc.fileName);
    const tag = isExternalFile(loc.fileName) ? " [lib]" : "";
    const displayName = `${name} (${base})${tag}`;

    const id = mkId("external", displayName, loc.fileName, loc.pos);
    externalIdByDecl.set(key, id);
    nodes.push({
      id,
      kind: "external",
      name: displayName,
      file: loc.fileName,
      range: loc.range,
      signature,
    });
    return id;
  };

  // edge helper
  const edgeKey = new Set<string>();
  const addEdge = (
    edgeKind: GraphEdgeKind,
    srcId: string,
    tgtId: string,
    label?: string,
    dedupeHint?: string,
  ) => {
    const key = `${edgeKind}:${srcId}->${tgtId}@@${label ?? ""}@@${dedupeHint ?? ""}`;
    if (edgeKey.has(key)) return;
    edgeKey.add(key);
    edges.push({
      id: key,
      kind: edgeKind,
      source: srcId,
      target: tgtId,
      label,
    });
  };

  const clampText = (s: string, max = 80) =>
    s.length <= max ? s : `${s.slice(0, max - 1)}…`;

  const buildDataflowLabel = (
    p: ts.ParameterDeclaration,
    arg: ts.Expression,
  ) => {
    const paramName = clampText(p.name.getText(sf).replace(/\s+/g, " "), 60);
    const argText = clampText(arg.getText(sf).replace(/\s+/g, " "), 80);

    let paramTypeStr = "";
    try {
      if (p.type) {
        paramTypeStr = checker.typeToString(
          checker.getTypeFromTypeNode(p.type),
        );
      } else {
        paramTypeStr = checker.typeToString(checker.getTypeAtLocation(p));
      }
    } catch {
      paramTypeStr = "";
    }

    let argTypeStr = "";
    try {
      argTypeStr = checker.typeToString(checker.getTypeAtLocation(arg));
    } catch {
      argTypeStr = "";
    }

    const left = paramTypeStr ? `${paramName}: ${paramTypeStr}` : paramName;
    const right = argTypeStr ? `${argText}: ${argTypeStr}` : argText;

    return `${left} ← ${right}`;
  };

  const addDataflowEdgesFromSignature = (
    ownerId: string,
    targetId: string,
    sigDecl: ts.SignatureDeclaration | undefined,
    callArgs: readonly ts.Expression[] | undefined,
  ) => {
    if (!sigDecl) return;
    const params = sigDecl.parameters ?? ts.factory.createNodeArray();
    const args = callArgs ?? [];

    const n = Math.min(params.length, args.length);
    for (let i = 0; i < n; i++) {
      const p = params[i];
      const a = args[i];
      if (!p || !a) continue;

      const label = buildDataflowLabel(p, a);
      addEdge("dataflow", ownerId, targetId, label, `arg#${i}`);
    }
  };

  const resolveCallTarget = (node: ts.CallExpression) => {
    try {
      const calleeName = normalizeCalleeName(node.expression, sf, checker);
      const sig = checker.getResolvedSignature(node);
      const declFromSig = sig?.getDeclaration();

      const sym = checker.getSymbolAtLocation(node.expression);
      const declFromSym = sym ? pickBestDeclaration(sym, checker) : undefined;

      const decl = (declFromSig ?? declFromSym) as ts.Declaration | undefined;
      if (!decl) return null;

      const loc = declLocation(decl);

      let signature: string | undefined = undefined;
      try {
        const sigDecl = sig?.getDeclaration() as
          | ts.SignatureDeclaration
          | undefined;
        if (sigDecl) {
          const s = checker.getSignatureFromDeclaration(sigDecl);
          signature = s ? checker.signatureToString(s) : undefined;
        }
      } catch {}

      if (loc.fileName === sf.fileName) {
        const tgtId = idByDeclPos.get(loc.pos);
        return tgtId
          ? {
              tgtId,
              sigDecl: sig?.getDeclaration() as
                | ts.SignatureDeclaration
                | undefined,
            }
          : null;
      }

      const extId = ensureExternalNode(calleeName, loc, signature);
      return {
        tgtId: extId,
        sigDecl: sig?.getDeclaration() as ts.SignatureDeclaration | undefined,
      };
    } catch {
      return null;
    }
  };

  const resolveNewTarget = (node: ts.NewExpression) => {
    try {
      const ctorExpr = node.expression;
      const calleeName = `new ${normalizeCtorName(ctorExpr, sf, checker)}`;

      const t = checker.getTypeAtLocation(ctorExpr);
      const declFromSig = t.getConstructSignatures()[0]?.getDeclaration();

      const sym = checker.getSymbolAtLocation(ctorExpr);
      const declFromSym = sym ? pickBestDeclaration(sym, checker) : undefined;

      const decl = (declFromSig ?? declFromSym) as ts.Declaration | undefined;
      if (!decl) return null;

      const loc = declLocation(decl);

      let sigDecl: ts.SignatureDeclaration | undefined = undefined;
      try {
        sigDecl = t.getConstructSignatures()[0]?.getDeclaration() as
          | ts.SignatureDeclaration
          | undefined;
      } catch {}

      if (loc.fileName === sf.fileName) {
        const tgtId = idByDeclPos.get(loc.pos);
        return tgtId ? { tgtId, sigDecl } : null;
      }

      const extId = ensureExternalNode(calleeName, loc);
      return { tgtId: extId, sigDecl };
    } catch {
      return null;
    }
  };

  // walk bodies with owner tracking
  const walk = (node: ts.Node, ownerId: string) => {
    // owner switches
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const pos = node.getStart(sf, false);
      const id = idByDeclPos.get(pos);
      const nextOwner = id ?? ownerId;
      walk(node.body, nextOwner);
      return;
    }

    if (
      ts.isMethodDeclaration(node) &&
      node.body &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      const pos = node.getStart(sf, false);
      const id = idByDeclPos.get(pos);
      const nextOwner = id ?? ownerId;
      walk(node.body, nextOwner);
      return;
    }

    // edges
    if (ts.isCallExpression(node)) {
      const r = resolveCallTarget(node);
      if (r) {
        addEdge("calls", ownerId, r.tgtId);
        addDataflowEdgesFromSignature(
          ownerId,
          r.tgtId,
          r.sigDecl,
          node.arguments,
        );
      }
    }

    if (ts.isNewExpression(node)) {
      const r = resolveNewTarget(node);
      if (r) {
        addEdge("constructs", ownerId, r.tgtId);
        addDataflowEdgesFromSignature(
          ownerId,
          r.tgtId,
          r.sigDecl,
          node.arguments,
        );
      }
    }

    ts.forEachChild(node, (c) => walk(c, ownerId));
  };

  walk(sf, fileNodeId);

  return { nodes, edges };
}

/** calls: normalize + resolve declaration location (cross-file enabled by Program) */
function extractCallsResolved(
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): Array<AnalysisCallV2> {
  type Key = string;
  const map = new Map<Key, AnalysisCallV2 & { _declPos: number | null }>();

  const bump = (item: AnalysisCallV2 & { declPos: number | null }) => {
    const key = `${item.calleeName}@@${item.declFile ?? "null"}@@${item.declPos ?? "null"}`;
    const prev = map.get(key);
    if (prev) {
      prev.count += 1;
      return;
    }
    map.set(key, {
      calleeName: item.calleeName,
      count: 1,
      declFile: item.declFile,
      declRange: item.declRange,
      isExternal: item.isExternal,
      _declPos: item.declPos,
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      bump(resolveCallToDeclaration(node, sf, checker));
    } else if (ts.isNewExpression(node)) {
      bump(resolveNewToDeclaration(node, sf, checker));
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);

  return [...map.values()]
    .map(({ _declPos, ...rest }) => rest)
    .sort((a, b) => b.count - a.count)
    .slice(0, 60);
}

function resolveCallToDeclaration(
  call: ts.CallExpression,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): AnalysisCallV2 & { declPos: number | null } {
  const calleeName = normalizeCalleeName(call.expression, sf, checker);

  const sig = checker.getResolvedSignature(call);
  const declFromSig = sig?.getDeclaration();

  const sym = checker.getSymbolAtLocation(call.expression);
  const declFromSym = sym ? pickBestDeclaration(sym, checker) : undefined;

  const decl = declFromSig ?? declFromSym ?? null;
  const loc = decl ? declLocation(decl) : null;

  const isExternal = loc ? isExternalFile(loc.fileName) : false;

  return {
    calleeName,
    count: 1,
    declFile: loc ? loc.fileName : null,
    declRange: loc ? loc.range : null,
    isExternal,
    declPos: loc ? loc.pos : null,
  };
}

function resolveNewToDeclaration(
  node: ts.NewExpression,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): AnalysisCallV2 & { declPos: number | null } {
  const ctorExpr = node.expression;
  const calleeName = `new ${normalizeCtorName(ctorExpr, sf, checker)}`;

  const t = checker.getTypeAtLocation(ctorExpr);
  const constructSigs = t.getConstructSignatures();
  const declFromSig = constructSigs[0]?.getDeclaration();

  const sym = checker.getSymbolAtLocation(ctorExpr);
  const declFromSym = sym ? pickBestDeclaration(sym, checker) : undefined;

  const decl = declFromSig ?? declFromSym ?? null;
  const loc = decl ? declLocation(decl) : null;

  const isExternal = loc ? isExternalFile(loc.fileName) : false;

  return {
    calleeName,
    count: 1,
    declFile: loc ? loc.fileName : null,
    declRange: loc ? loc.range : null,
    isExternal,
    declPos: loc ? loc.pos : null,
  };
}

function normalizeCalleeName(
  expr: ts.Expression,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): string {
  if (ts.isIdentifier(expr)) return expr.text;

  if (ts.isPropertyAccessExpression(expr)) {
    const method = expr.name.text;
    const recv = expr.expression;

    const t = checker.getTypeAtLocation(recv);
    const recvTypeName = friendlyTypeName(t, checker);

    return recvTypeName
      ? `${recvTypeName}.${method}`
      : `${recv.getText(sf)}.${method}`;
  }

  if (ts.isElementAccessExpression(expr)) {
    return `${expr.expression.getText(sf)}[...]`;
  }

  if (ts.isParenthesizedExpression(expr)) {
    return normalizeCalleeName(expr.expression, sf, checker);
  }

  return expr.getText(sf);
}

function normalizeCtorName(
  expr: ts.Expression,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const t = checker.getTypeAtLocation(expr);
    const name = friendlyTypeName(t, checker);
    return name || expr.getText(sf);
  }
  return expr.getText(sf);
}

function friendlyTypeName(type: ts.Type, checker: ts.TypeChecker): string {
  const sym = type.getSymbol();
  if (sym) {
    const aliased =
      sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const name = aliased.getName();
    if (name && name !== "__type") return name;
  }
  return checker.typeToString(type);
}

function pickBestDeclaration(
  sym: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Declaration | undefined {
  const s =
    sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  const decls = s.getDeclarations();
  if (!decls || decls.length === 0) return undefined;

  // implementation preferred
  const impl = decls.find(
    (d) =>
      ts.isMethodDeclaration(d) ||
      ts.isFunctionDeclaration(d) ||
      ts.isFunctionExpression(d) ||
      ts.isClassDeclaration(d) ||
      ts.isInterfaceDeclaration(d),
  );

  return impl ?? decls[0];
}

function declLocation(decl: ts.Declaration): {
  fileName: string;
  pos: number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
} {
  const sf = decl.getSourceFile();
  const start = decl.getStart(sf, false);
  const end = decl.getEnd();

  const s = sf.getLineAndCharacterOfPosition(start);
  const e = sf.getLineAndCharacterOfPosition(end);

  return {
    fileName: sf.fileName,
    pos: start,
    range: {
      start: { line: s.line, character: s.character },
      end: { line: e.line, character: e.character },
    },
  };
}

function isExternalFile(fileName: string): boolean {
  const norm = fileName.replace(/\\/g, "/");
  return norm.includes("/node_modules/") || norm.includes("/typescript/lib/");
}
export function analyzeWorkspaceWithTypes(args: {
  code: string; // active editor text
  fileName: string; // active file absolute path
  languageId: string;
  workspaceRoot: string; // vscode.workspace.workspaceFolders[0].uri.fsPath
  tsconfigPath?: string; // workspaceRoot/tsconfig.json (있으면)
}) {
  // 1) tsconfig가 있으면 읽어서 rootNames + options 생성
  // 2) CompilerHost는 기본 host 사용 + active file만 in-memory로 override
  // 3) createProgram(rootNames, options, host)
  // 4) checker로 calls/graph 생성 (지금 로직 재사용)
}
