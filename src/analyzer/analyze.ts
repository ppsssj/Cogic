import * as path from "path";
import * as fs from "fs";
import * as ts from "typescript";
import type {
  AnalysisCallV2,
  CodeDiagnostic,
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeKind,
  GraphPayload,
  GraphTraceEvent,
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
  diagnostics: CodeDiagnostic[];
  graph: GraphPayload;
  trace: GraphTraceEvent[];
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
  const resolveModuleLocation = createModuleLocationResolver(
    program,
    compilerOptions,
    host,
  );

  if (!sf) {
    return {
      imports: [],
      exports: [],
      calls: [],
      diagnostics: [],
      graph: { nodes: [], edges: [] },
      trace: [],
      meta: { mode: "single-file" },
    };
  }

  const imports = extractImports(sf);
  const exports = extractExports(sf);
  const calls = extractCallsResolved(sf, checker, resolveModuleLocation);
  const diagnostics = collectDiagnostics(program, sf);

  // single-file graph: external nodes still possible (but likely null since program has one file)
  const { graph, trace } = buildActiveFileGraph(
    sf,
    checker,
    resolveModuleLocation,
  );

  return {
    imports,
    exports,
    calls,
    diagnostics,
    graph,
    trace,
    meta: { mode: "single-file" },
  };
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
  diagnostics: CodeDiagnostic[];
  graph: GraphPayload;
  trace: GraphTraceEvent[];
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
      trace: r.trace,
      meta: { mode: "workspace", rootFiles: 1, usedTsconfig: false },
    };
  }

  const { rootNames, options, usedTsconfig, projectRoot } = buildWorkspaceRoots(
    {
      workspaceRoot,
      filePaths,
    },
  );

  // Ensure the active file is part of the Program roots.
  // In strict tsconfig setups, the active file may be excluded and `program.getSourceFile(activeFile)` would be null.
  if (!rootNames.some((p) => samePath(p, activeFile))) {
    rootNames.push(activeFile);
  }

  const scriptKind = pickScriptKind(active.fileName, active.languageId);

  const defaultHost = ts.createCompilerHost(options, true);
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (fileName) => {
      if (samePath(fileName, activeFile)) {return true;}
      return defaultHost.fileExists(fileName);
    },
    readFile: (fileName) => {
      if (samePath(fileName, activeFile)) {return active.code;}
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
  const resolveModuleLocation = createModuleLocationResolver(
    program,
    options,
    host,
  );

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
  const calls = extractCallsResolved(sf, checker, resolveModuleLocation);
  const diagnostics = collectDiagnostics(program, sf);

  // workspace graph (external nodes enabled)
  const { graph, trace } = buildActiveFileGraph(
    sf,
    checker,
    resolveModuleLocation,
  );

  return {
    imports,
    exports,
    calls,
    diagnostics,
    graph,
    trace,
    meta: {
      mode: "workspace",
      rootFiles: rootNames.length,
      usedTsconfig,
      projectRoot,
    },
  };
}

function collectDiagnostics(
  program: ts.Program,
  sourceFile: ts.SourceFile,
): CodeDiagnostic[] {
  const all = [
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ];

  const seen = new Set<string>();
  const out: CodeDiagnostic[] = [];

  for (const diagnostic of all) {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n",
    ).trim();
    const filePath = diagnostic.file?.fileName;
    const key = [
      diagnostic.code,
      diagnostic.category,
      filePath ?? "global",
      diagnostic.start ?? -1,
      message,
    ].join("@@");

    if (seen.has(key)) {continue;}
    seen.add(key);

    const severity: CodeDiagnostic["severity"] =
      diagnostic.category === ts.DiagnosticCategory.Error
        ? "error"
        : diagnostic.category === ts.DiagnosticCategory.Warning
          ? "warning"
          : "info";

    let range: CodeDiagnostic["range"] | undefined;
    if (
      diagnostic.file &&
      typeof diagnostic.start === "number" &&
      typeof diagnostic.length === "number"
    ) {
      const start = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start,
      );
      const end = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start + diagnostic.length,
      );
      range = {
        start: { line: start.line, character: start.character },
        end: { line: end.line, character: end.character },
      };
    }

    out.push({
      code: diagnostic.code,
      source: "typescript",
      severity,
      message,
      ...(filePath ? { filePath } : null),
      ...(range ? { range } : null),
    });
  }

  return out;
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

type FileTargetLocation = {
  fileName: string;
  pos: number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

function sourceFileLocation(sf: ts.SourceFile): FileTargetLocation {
  const endPos = sf.getEnd();
  const endLC = sf.getLineAndCharacterOfPosition(endPos);
  return {
    fileName: sf.fileName,
    pos: 0,
    range: {
      start: { line: 0, character: 0 },
      end: { line: endLC.line, character: endLC.character },
    },
  };
}

function createModuleLocationResolver(
  program: ts.Program,
  options: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
) {
  return (moduleText: string, containingFile: string): FileTargetLocation | null => {
    const resolved = ts.resolveModuleName(
      moduleText,
      containingFile,
      options,
      host,
    ).resolvedModule;
    if (!resolved?.resolvedFileName) {return null;}

    const targetSourceFile = program.getSourceFile(resolved.resolvedFileName);
    if (targetSourceFile) {
      return sourceFileLocation(targetSourceFile);
    }

    if (!fs.existsSync(resolved.resolvedFileName)) {
      return null;
    }

    try {
      const sourceText = fs.readFileSync(resolved.resolvedFileName, "utf8");
      const fallbackSourceFile = ts.createSourceFile(
        resolved.resolvedFileName,
        sourceText,
        ts.ScriptTarget.ES2022,
        true,
        pickScriptKind(resolved.resolvedFileName, ""),
      );
      return sourceFileLocation(fallbackSourceFile);
    } catch {
      return null;
    }
  };
}

function pickScriptKind(fileName: string, languageId: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx") || languageId === "typescriptreact")
    {return ts.ScriptKind.TSX;}
  if (lower.endsWith(".jsx") || languageId === "javascriptreact")
    {return ts.ScriptKind.JSX;}
  if (lower.endsWith(".js") || languageId === "javascript")
    {return ts.ScriptKind.JS;}
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
    if (!ts.isImportDeclaration(st)) {continue;}

    const source = ts.isStringLiteral(st.moduleSpecifier)
      ? st.moduleSpecifier.text
      : st.moduleSpecifier.getText(sf);

    if (!st.importClause) {
      imports.push({ source, specifiers: [], kind: "side-effect" });
      continue;
    }

    const specifiers: string[] = [];
    const { name, namedBindings } = st.importClause;

    if (name) {specifiers.push(name.text);}

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
    if (!name) {return;}
    exports.push({ name, kind });
  };

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && isExported(st)) {
      push(
        hasDefaultModifier(st) ? "default" : (st.name?.text ?? ""),
        "function",
      );
      continue;
    }
    if (ts.isClassDeclaration(st) && isExported(st)) {
      push(hasDefaultModifier(st) ? "default" : (st.name?.text ?? ""), "class");
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
  resolveModuleLocation?: (moduleText: string, containingFile: string) => FileTargetLocation | null,
): { graph: GraphPayload; trace: GraphTraceEvent[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const trace: GraphTraceEvent[] = [];
  const nodeNameById = new Map<string, string>();

  // declStartPos -> nodeId (only for active file decls)
  const idByDeclPos = new Map<number, string>();
  const ownerDeclById = new Map<string, ts.Node>();
  const hookSourceIdByBindingDeclPos = new Map<number, string>();
  const pendingHookReferences: Array<{
    hookId: string;
    parentId: string;
    expr: ts.Expression;
    label: string;
  }> = [];

  // IMPORTANT: Node IDs must be stable. Never derive IDs from display names.
  // Use only kind + filePath + position (or range) so merges/expansions don't create duplicates.
  const mkId = (kind: GraphNodeKind, file: string, pos: number) =>
    `${kind}:${file}:${pos}`;

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
  const fileNodeId = mkId("file", sf.fileName, filePos);
  nodes.push({
    id: fileNodeId,
    kind: "file",
    name: fileNameBase,
    file: sf.fileName,
    range: sourceFileRange(),
  });
  trace.push({
    type: "node",
    node: {
      id: fileNodeId,
      kind: "file",
      name: fileNameBase,
      file: sf.fileName,
      range: sourceFileRange(),
    },
  });

  type SigParts = {
    params: Array<{ name: string; type: string; optional?: boolean }>;
    returnType?: string;
  };

  const getSigParts = (
    decl: ts.SignatureDeclarationBase,
  ): SigParts | undefined => {
    try {
      const sig = checker.getSignatureFromDeclaration(
        decl as ts.SignatureDeclaration,
      );
      if (!sig) {return undefined;}
      const params = sig.getParameters().map((sym) => {
        const name = sym.getName();
        const t = checker.getTypeOfSymbolAtLocation(sym, decl);
        const optional = Boolean(
          (sym.flags & ts.SymbolFlags.Optional) !== 0 ||
          decl.parameters.some((p) =>
            ts.isIdentifier(p.name)
              ? p.name.text === name && (!!p.questionToken || !!p.initializer)
              : false,
          ),
        );
        return {
          name,
          type: checker.typeToString(t),
          ...(optional ? { optional } : null),
        } as { name: string; type: string; optional?: boolean };
      });
      const returnType = checker.typeToString(sig.getReturnType());
      return { params, returnType };
    } catch {
      return undefined;
    }
  };

  const pushNode = (
    decl: ts.Declaration,
    kind: GraphNodeKind,
    name: string,
    extra?: Partial<GraphNode>,
  ) => {
    const loc = declLocation(decl);
    const id = mkId(kind, loc.fileName, loc.pos);
    idByDeclPos.set(loc.pos, id);
    ownerDeclById.set(id, decl as ts.Node);

    let signature: string | undefined = undefined;
    let sigParts: SigParts | undefined = undefined;
    try {
      // ArrowFunction / FunctionExpression / MethodDeclaration / FunctionDeclaration etc.
      if (ts.isFunctionLike(decl as ts.Node)) {
        const sig = checker.getSignatureFromDeclaration(
          decl as unknown as ts.SignatureDeclaration,
        );
        if (sig) {signature = checker.signatureToString(sig);}
        sigParts = getSigParts(decl as unknown as ts.SignatureDeclarationBase);
      }
    } catch {
      // ignore signature extraction failures
    }

    nodes.push({
      id,
      kind,
      name,
      file: loc.fileName,
      range: loc.range,
      signature,
      sig: sigParts,
      ...(extra ?? {}),
    });
    trace.push({
      type: "node",
      node: {
        id,
        kind,
        name,
        file: loc.fileName,
        range: loc.range,
        signature,
        sig: sigParts,
        ...(extra ?? {}),
      },
    });
    nodeNameById.set(id, name);

    return id;
  };

  const pushSyntheticNode = (
    anchor: ts.Node,
    kind: GraphNodeKind,
    name: string,
    extra?: Partial<GraphNode>,
  ) => {
    const loc = declLocation(anchor as ts.Declaration);
    const id = mkId(kind, loc.fileName, loc.pos);
    if (nodeNameById.has(id)) {
      return id;
    }

    nodes.push({
      id,
      kind,
      name,
      file: loc.fileName,
      range: loc.range,
      ...(extra ?? {}),
    });
    trace.push({
      type: "node",
      node: {
        id,
        kind,
        name,
        file: loc.fileName,
        range: loc.range,
        ...(extra ?? {}),
      },
    });
    nodeNameById.set(id, name);

    return id;
  };

  const propertyNameText = (name: ts.PropertyName): string | null => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    return null;
  };

  const REACT_CALLBACK_HOOKS = new Set([
    "useEffect",
    "useLayoutEffect",
    "useInsertionEffect",
    "useMemo",
    "useCallback",
  ]);
  const REACT_STATE_HOOKS = new Set(["useState", "useReducer"]);

  const hookCallbackCountByOwner = new Map<string, Map<string, number>>();
  const hookSourceCountByOwner = new Map<string, Map<string, number>>();

  const getImportDeclaration = (
    node: ts.Node | undefined,
  ): ts.ImportDeclaration | null => {
    let current = node;
    while (current) {
      if (ts.isImportDeclaration(current)) {
        return current;
      }
      current = current.parent;
    }
    return null;
  };

  const isReactImportDeclaration = (node: ts.Node | undefined): boolean => {
    const importDecl = getImportDeclaration(node);
    return !!(
      importDecl &&
      ts.isStringLiteral(importDecl.moduleSpecifier) &&
      importDecl.moduleSpecifier.text === "react"
    );
  };

  const getReactImportKind = (symbol: ts.Symbol | undefined): string | null => {
    if (!symbol) {
      return null;
    }

    for (const decl of symbol.declarations ?? []) {
      if (!isReactImportDeclaration(decl)) {
        continue;
      }
      if (ts.isImportSpecifier(decl)) {
        return (decl.propertyName ?? decl.name).text;
      }
      if (ts.isNamespaceImport(decl)) {
        return "*";
      }
      if (ts.isImportClause(decl) && decl.name) {
        return "default";
      }
    }

    return null;
  };

  const getReactHookName = (
    expr: ts.LeftHandSideExpression,
    allowedHooks: Set<string>,
  ): string | null => {
    if (ts.isIdentifier(expr)) {
      const symbol = checker.getSymbolAtLocation(expr);
      const importedName = getReactImportKind(symbol);
      if (importedName && allowedHooks.has(importedName)) {
        return importedName;
      }
      return null;
    }

    if (ts.isPropertyAccessExpression(expr) && allowedHooks.has(expr.name.text)) {
      const baseSymbol = checker.getSymbolAtLocation(expr.expression);
      const importKind = getReactImportKind(baseSymbol);
      if (importKind === "default" || importKind === "*") {
        return expr.name.text;
      }
    }

    return null;
  };

  const getHookCallbackName = (ownerId: string, hookName: string) => {
    const ownerName = nodeNameById.get(ownerId) ?? "scope";
    const countByHook = hookCallbackCountByOwner.get(ownerId) ?? new Map<string, number>();
    const nextCount = (countByHook.get(hookName) ?? 0) + 1;
    countByHook.set(hookName, nextCount);
    hookCallbackCountByOwner.set(ownerId, countByHook);
    return `${ownerName}.${hookName}#${nextCount}`;
  };

  const getHookSourceName = (ownerId: string, hookName: string) => {
    const ownerName = nodeNameById.get(ownerId) ?? "scope";
    const countByHook = hookSourceCountByOwner.get(ownerId) ?? new Map<string, number>();
    const nextCount = (countByHook.get(hookName) ?? 0) + 1;
    countByHook.set(hookName, nextCount);
    hookSourceCountByOwner.set(ownerId, countByHook);
    return `${ownerName}.${hookName}#${nextCount}`;
  };

  const registerStateHookSource = (
    decl: ts.VariableDeclaration,
    call: ts.CallExpression,
    parentId: string,
  ) => {
    const hookName = getReactHookName(call.expression, REACT_STATE_HOOKS);
    if (!hookName || !ts.isArrayBindingPattern(decl.name)) {
      return false;
    }

    const stateBinding = decl.name.elements[0];
    const setterBinding = decl.name.elements[1];
    if (!setterBinding || ts.isOmittedExpression(setterBinding)) {
      return false;
    }
    if (!ts.isBindingElement(setterBinding) || !ts.isIdentifier(setterBinding.name)) {
      return false;
    }

    let signature: string | undefined;
    try {
      const sig = checker.getResolvedSignature(call);
      if (sig) {
        signature = checker.signatureToString(sig);
      }
    } catch {
      signature = undefined;
    }

    const hookId = pushSyntheticNode(
      call,
      "function",
      getHookSourceName(parentId, hookName),
      {
        parentId,
        signature,
      },
    );
    if (
      stateBinding &&
      !ts.isOmittedExpression(stateBinding) &&
      ts.isBindingElement(stateBinding) &&
      ts.isIdentifier(stateBinding.name)
    ) {
      hookSourceIdByBindingDeclPos.set(declLocation(stateBinding).pos, hookId);
    }
    hookSourceIdByBindingDeclPos.set(declLocation(setterBinding).pos, hookId);

    if (hookName === "useReducer") {
      const reducerArg = call.arguments[0];
      if (reducerArg) {
        pendingHookReferences.push({
          hookId,
          parentId,
          expr: reducerArg,
          label: "reducer",
        });
      }

      const initializerArg = call.arguments[2];
      if (initializerArg) {
        pendingHookReferences.push({
          hookId,
          parentId,
          expr: initializerArg,
          label: "initializer",
        });
      }
    }

    return true;
  };

  const visitHookCallback = (
    call: ts.CallExpression,
    parentId: string,
  ) => {
    const hookName = getReactHookName(call.expression, REACT_CALLBACK_HOOKS);
    if (!hookName) {
      return false;
    }

    const callback = call.arguments[0];
    if (
      !callback ||
      (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
    ) {
      return false;
    }

    const callbackId = pushNode(
      callback as unknown as ts.Declaration,
      "function",
      getHookCallbackName(parentId, hookName),
      { parentId },
    );

    if (ts.isBlock(callback.body)) {
      ts.forEachChild(callback.body, (child) => visitDecls(child, callbackId));
    }

    return true;
  };

  const visitObjectLiteralMembers = (
    literal: ts.ObjectLiteralExpression,
    ownerPath: string,
    parentId?: string,
  ) => {
    for (const prop of literal.properties) {
      if (ts.isMethodDeclaration(prop) && prop.name && prop.body) {
        const memberName = propertyNameText(prop.name);
        if (!memberName) {continue;}

        const methodId = pushNode(prop, "method", `${ownerPath}.${memberName}`, {
          ...(parentId ? { parentId } : {}),
        });
        ts.forEachChild(prop.body, (child) => visitDecls(child, methodId));
        continue;
      }

      if (ts.isPropertyAssignment(prop) && prop.name) {
        const memberName = propertyNameText(prop.name);
        if (!memberName) {continue;}

        const nextOwnerPath = `${ownerPath}.${memberName}`;
        const init = prop.initializer;
        if (ts.isObjectLiteralExpression(init)) {
          visitObjectLiteralMembers(init, nextOwnerPath, parentId);
          continue;
        }

        const isFnInit =
          ts.isArrowFunction(init) || ts.isFunctionExpression(init);
        if (!isFnInit) {continue;}

        const hasBody = ts.isArrowFunction(init)
          ? !!init.body
          : ts.isFunctionExpression(init)
            ? !!init.body
            : false;
        if (!hasBody) {continue;}

        const methodId = pushNode(
          init as unknown as ts.Declaration,
          "method",
          nextOwnerPath,
          {
            ...(parentId ? { parentId } : {}),
          },
        );

        if (ts.isBlock(init.body)) {
          ts.forEachChild(init.body, (child) => visitDecls(child, methodId));
        }
      }
    }
  };

  const visitDecls = (node: ts.Node, parentId?: string) => {
    if (parentId && ts.isCallExpression(node) && visitHookCallback(node, parentId)) {
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const fnId = pushNode(node, "function", node.name.text, {
        ...(parentId ? { parentId } : {}),
      });
      ts.forEachChild(node.body, (child) => visitDecls(child, fnId));
      return;
    }

    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (!d.initializer) {continue;}

        const init = d.initializer;
        if (ts.isCallExpression(init)) {
          registerStateHookSource(d, init, parentId ?? fileNodeId);
        }

        if (!ts.isIdentifier(d.name)) {
          visitDecls(init, parentId);
          continue;
        }

        const varName = d.name.text;
        if (ts.isObjectLiteralExpression(init)) {
          visitObjectLiteralMembers(init, varName, parentId);
          continue;
        }

        const isFnInit =
          ts.isArrowFunction(init) || ts.isFunctionExpression(init);
        if (isFnInit) {
          // Only include implementations (body)
          const hasBody = ts.isArrowFunction(init)
            ? !!init.body
            : ts.isFunctionExpression(init)
              ? !!init.body
              : false;
          if (hasBody) {
            // NOTE: Use initializer node for stable body-owner switching during walk()
            const fnId = pushNode(
              init as unknown as ts.Declaration,
              "function",
              varName,
              {
                ...(parentId ? { parentId } : {}),
              },
            );

            if (ts.isBlock(init.body)) {
              ts.forEachChild(init.body, (child) => visitDecls(child, fnId));
            }
          }
          continue;
        }

        visitDecls(init, parentId);
      }
      return;
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const classId = pushNode(node, "class", className, {
        ...(parentId ? { parentId } : {}),
      });

      for (const m of node.members) {
        if (
          ts.isMethodDeclaration(m) &&
          m.name &&
          ts.isIdentifier(m.name) &&
          m.body
        ) {
          const methodId = pushNode(m, "method", `${className}.${m.name.text}`, {
            parentId: classId,
          });
          if (m.body) {
            ts.forEachChild(m.body, (child) => visitDecls(child, methodId));
          }
          continue;
        }

        if (ts.isPropertyDeclaration(m) && m.initializer && m.name) {
          const init = m.initializer;
          const memberName = ts.isIdentifier(m.name)
            ? m.name.text
            : ts.isStringLiteral(m.name)
              ? m.name.text
              : null;
          if (!memberName) {continue;}

          if (ts.isObjectLiteralExpression(init)) {
            visitObjectLiteralMembers(init, `${className}.${memberName}`, classId);
            continue;
          }

          const isFnInit =
            ts.isArrowFunction(init) || ts.isFunctionExpression(init);
          if (!isFnInit) {continue;}

          const hasBody = ts.isArrowFunction(init)
            ? !!init.body
            : ts.isFunctionExpression(init)
              ? !!init.body
              : false;
          if (!hasBody) {continue;}

          const methodId = pushNode(
            init as unknown as ts.Declaration,
            "method",
            `${className}.${memberName}`,
            {
              parentId: classId,
            },
          );
          if (ts.isBlock(init.body)) {
            ts.forEachChild(init.body, (child) => visitDecls(child, methodId));
          }
        }
      }
      return;
    }

    if (ts.isInterfaceDeclaration(node) && node.name) {
      pushNode(node, "interface" as GraphNodeKind, node.name.text, {
        ...(parentId ? { parentId } : {}),
        subkind: "interface",
        signature: `interface ${node.name.text}`,
      });
      return;
    }

    if (ts.isTypeAliasDeclaration(node) && node.name) {
      const name = node.name.text;
      let rhs = "";
      try {
        rhs = node.type.getText(sf);
      } catch {
        rhs = "";
      }
      const short = rhs && rhs.length > 120 ? rhs.slice(0, 117) + "..." : rhs;
      pushNode(node, "interface" as GraphNodeKind, name, {
        ...(parentId ? { parentId } : {}),
        subkind: "type",
        signature: short ? `type ${name} = ${short}` : `type ${name}`,
      });
      return;
    }

    if (ts.isEnumDeclaration(node) && node.name) {
      const name = node.name.text;
      pushNode(node, "interface" as GraphNodeKind, name, {
        ...(parentId ? { parentId } : {}),
        subkind: "enum",
        signature: `enum ${name}`,
      });
      return;
    }

    ts.forEachChild(node, (child) => visitDecls(child, parentId));
  };
  visitDecls(sf);

  // external node cache (by decl file+pos)
  const externalIdByDecl = new Map<string, string>();
  const externalModuleIdByFile = new Map<string, string>();

  const ensureExternalNode = (
    name: string,
    loc: ReturnType<typeof declLocation>,
    signature?: string,
  ) => {
    const key = `${loc.fileName}:${loc.pos}`;
    const existing = externalIdByDecl.get(key);
    if (existing) {return existing;}

    const base = path.basename(loc.fileName);
    const tag = isExternalFile(loc.fileName) ? " [lib]" : "";
    const displayName = `${name} (${base})${tag}`;

    // Stable ID: do not include displayName.
    const id = mkId("external", loc.fileName, loc.pos);
    externalIdByDecl.set(key, id);
    nodes.push({
      id,
      kind: "external",
      name: displayName,
      file: loc.fileName,
      range: loc.range,
      signature,
    });
    trace.push({
      type: "node",
      node: {
        id,
        kind: "external",
        name: displayName,
        file: loc.fileName,
        range: loc.range,
        signature,
      },
    });
    return id;
  };

  const ensureExternalModuleNode = (
    moduleText: string,
    loc: FileTargetLocation,
  ) => {
    const existing = externalModuleIdByFile.get(loc.fileName);
    if (existing) {return existing;}

    const base = path.basename(loc.fileName);
    const displayName = `import("${moduleText}") (${base})`;
    const id = mkId("external", loc.fileName, -1);
    externalModuleIdByFile.set(loc.fileName, id);
    nodes.push({
      id,
      kind: "external",
      name: displayName,
      file: loc.fileName,
      range: loc.range,
      signature: "module",
    });
    trace.push({
      type: "node",
      node: {
        id,
        kind: "external",
        name: displayName,
        file: loc.fileName,
        range: loc.range,
        signature: "module",
      },
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
    if (edgeKey.has(key)) {return;}
    edgeKey.add(key);
    edges.push({
      id: key,
      kind: edgeKind,
      source: srcId,
      target: tgtId,
      label,
    });
    trace.push({
      type: "edge",
      edge: {
        id: key,
        kind: edgeKind,
        source: srcId,
        target: tgtId,
        label,
      },
    });
  };

  const isDeclarationName = (n: ts.Identifier): boolean => {
    const p = n.parent;
    if (!p) {return false;}
    if (
      (ts.isFunctionDeclaration(p) ||
        ts.isClassDeclaration(p) ||
        ts.isInterfaceDeclaration(p) ||
        ts.isTypeAliasDeclaration(p) ||
        ts.isEnumDeclaration(p) ||
        ts.isMethodDeclaration(p) ||
        ts.isPropertyDeclaration(p) ||
        ts.isParameter(p) ||
        ts.isVariableDeclaration(p)) &&
      p.name === n
    ) {
      return true;
    }
    if (
      (ts.isImportSpecifier(p) ||
        ts.isImportClause(p) ||
        ts.isNamespaceImport(p) ||
        ts.isBindingElement(p)) &&
      p.name === n
    ) {
      return true;
    }
    return false;
  };

  const isNodeBoundaryForOwner = (node: ts.Node, ownerRoot: ts.Node): boolean =>
    node !== ownerRoot &&
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node));

  const resolveLocalNodeIdForDeclaration = (decl: ts.Declaration | undefined) => {
    if (!decl) {return null;}

    const directId = idByDeclPos.get(declLocation(decl).pos);
    if (directId) {return directId;}

    if (ts.isBindingElement(decl)) {
      return hookSourceIdByBindingDeclPos.get(declLocation(decl).pos) ?? null;
    }

    if (
      (ts.isVariableDeclaration(decl) ||
        ts.isPropertyDeclaration(decl) ||
        ts.isPropertyAssignment(decl)) &&
      decl.initializer &&
      (ts.isArrowFunction(decl.initializer) ||
        ts.isFunctionExpression(decl.initializer))
    ) {
      return idByDeclPos.get(declLocation(decl.initializer).pos) ?? null;
    }

    return null;
  };

  const expressionReferenceName = (expr: ts.Expression) =>
    expr.getText(sf).replace(/\s+/g, " ").trim();

  const resolveExpressionSymbol = (expr: ts.Expression) =>
    checker.getSymbolAtLocation(expr) ??
    (ts.isPropertyAccessExpression(expr)
      ? checker.getSymbolAtLocation(expr.name)
      : undefined);

  const addHookReferenceEdge = (
    hookId: string,
    parentId: string,
    expr: ts.Expression,
    label: string,
  ) => {
    try {
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        const hookName = nodeNameById.get(hookId) ?? "hook";
        const targetId = pushNode(
          expr as unknown as ts.Declaration,
          "function",
          `${hookName}.${label}`,
          { parentId },
        );
        if (targetId !== hookId) {
          addEdge("references", hookId, targetId, label);
        }
        return;
      }

      const sym = resolveExpressionSymbol(expr);
      const decl = sym ? pickBestDeclaration(sym, checker) : undefined;
      if (!decl) {
        return;
      }

      const localId = resolveLocalNodeIdForDeclaration(decl);
      if (localId) {
        if (localId !== hookId) {
          addEdge("references", hookId, localId, label);
        }
        return;
      }

      const loc = declLocation(decl);
      if (isTypeScriptLibFile(loc.fileName)) {
        return;
      }

      if (loc.fileName === sf.fileName) {
        const targetId = idByDeclPos.get(loc.pos);
        if (targetId && targetId !== hookId) {
          addEdge("references", hookId, targetId, label);
        }
        return;
      }

      let signature: string | undefined;
      try {
        if (ts.isFunctionLike(decl as ts.Node)) {
          const sig = checker.getSignatureFromDeclaration(
            decl as ts.SignatureDeclaration,
          );
          signature = sig ? checker.signatureToString(sig) : undefined;
        }
      } catch {
        signature = undefined;
      }

      const targetId = ensureExternalNode(
        expressionReferenceName(expr),
        loc,
        signature,
      );
      if (targetId !== hookId) {
        addEdge("references", hookId, targetId, label);
      }
    } catch {
      // ignore reducer/init lookup failures
    }
  };

  const resolveJsxTarget = (
    node: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
  ) => {
    try {
      const resolved = resolveJsxTagToDeclaration(node.tagName, sf, checker);
      if (!resolved?.declFile) {
        return null;
      }

      if (resolved.declFile === sf.fileName) {
        const sym = checker.getSymbolAtLocation(node.tagName);
        const decl = sym ? pickBestDeclaration(sym, checker) : undefined;
        const tgtId = resolveLocalNodeIdForDeclaration(decl);
        return tgtId ? { tgtId } : null;
      }

      if (!resolved.declRange || resolved.declPos === null) {
        return null;
      }

      const extId = ensureExternalNode(
        resolved.calleeName,
        {
          fileName: resolved.declFile,
          pos: resolved.declPos,
          range: resolved.declRange,
        },
      );
      return { tgtId: extId };
    } catch {
      return null;
    }
  };

  const addReferenceEdgesForOwner = (ownerId: string) => {
    const ownerRoot = ownerDeclById.get(ownerId);
    if (!ownerRoot) {return;}

    const visit = (node: ts.Node) => {
      if (isNodeBoundaryForOwner(node, ownerRoot)) {return;}

      if (ts.isIdentifier(node)) {
        if (isDeclarationName(node)) {
          ts.forEachChild(node, visit);
          return;
        }

        // property access right side (obj.foo) tends to be noisy for "reference" edges
        if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
          const maybeCallParent = node.parent.parent;
          const isInvokedMember =
            (ts.isCallExpression(maybeCallParent) ||
              ts.isNewExpression(maybeCallParent)) &&
            maybeCallParent.expression === node.parent;
          if (isInvokedMember) {
            ts.forEachChild(node, visit);
            return;
          }
        }
        if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
          ts.forEachChild(node, visit);
          return;
        }
        if (ts.isNewExpression(node.parent) && node.parent.expression === node) {
          ts.forEachChild(node, visit);
          return;
        }

        try {
          const sym = checker.getSymbolAtLocation(node);
          const decl = sym ? pickBestDeclaration(sym, checker) : undefined;
          if (!decl) {
            ts.forEachChild(node, visit);
            return;
          }

          const loc = declLocation(decl);
          if (loc.fileName !== sf.fileName || isTypeScriptLibFile(loc.fileName)) {
            ts.forEachChild(node, visit);
            return;
          }

          const targetId = resolveLocalNodeIdForDeclaration(decl);
          if (!targetId || targetId === ownerId) {
            ts.forEachChild(node, visit);
            return;
          }

          addEdge("references", ownerId, targetId);
        } catch {
          // ignore lookup failures
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(ownerRoot);
  };

  const clampText = (s: string, max = 80) =>
    s.length <= max ? s : `${s.slice(0, max - 1)}…`;

  const buildDataflowLabel = (
    p: ts.ParameterDeclaration,
    arg: ts.Expression,
  ) => {
    const clampText = (s: string, max = 80) =>
      s.length <= max ? s : `${s.slice(0, max - 1)}…`;

    const rawName = p.name.getText(sf).replace(/\s+/g, " ").trim();
    const paramName = clampText(
      p.dotDotDotToken ? `...${rawName}` : rawName,
      60,
    );

    const argText = clampText(arg.getText(sf).replace(/\s+/g, " ").trim(), 80);

    return `${paramName} ← ${argText}`;
  };

  const addDataflowEdgesFromSignature = (
    ownerId: string,
    targetId: string,
    sigDecl: ts.SignatureDeclaration | undefined,
    callArgs: readonly ts.Expression[] | undefined,
  ) => {
    if (!sigDecl) {return;}
    const params = sigDecl.parameters ?? ts.factory.createNodeArray();
    const args = callArgs ?? [];

    const n = Math.min(params.length, args.length);
    for (let i = 0; i < n; i++) {
      const p = params[i];
      const a = args[i];
      if (!p || !a) {continue;}

      const label = buildDataflowLabel(p, a);
      addEdge("dataflow", ownerId, targetId, label, `arg#${i}`);
    }
  };

  const resolveCallTarget = (node: ts.CallExpression) => {
    try {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const firstArg = node.arguments[0];
        if (!firstArg || !ts.isStringLiteralLike(firstArg) || !resolveModuleLocation) {
          return null;
        }

        const loc = resolveModuleLocation(firstArg.text, sf.fileName);
        if (!loc || isTypeScriptLibFile(loc.fileName)) {return null;}

        return {
          tgtId: ensureExternalModuleNode(firstArg.text, loc),
          sigDecl: undefined,
        };
      }

      const calleeName = normalizeCalleeName(node.expression, sf, checker);
      const sig = checker.getResolvedSignature(node);
      const declFromSig = sig?.getDeclaration();

      const sym = checker.getSymbolAtLocation(node.expression);
      const declFromSym = sym ? pickBestDeclaration(sym, checker) : undefined;

      const decl = (declFromSig ?? declFromSym) as ts.Declaration | undefined;
      if (!decl) {return null;}

      if (ts.isBindingElement(decl)) {
        const hookSourceId = hookSourceIdByBindingDeclPos.get(declLocation(decl).pos);
        if (hookSourceId) {
          return {
            tgtId: hookSourceId,
            sigDecl: undefined,
            edgeKind: "updates" as GraphEdgeKind,
            label: calleeName,
          };
        }
      }

      const loc = declLocation(decl);
      if (isTypeScriptLibFile(loc.fileName)) {return null;}

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
      if (!decl) {return null;}

      const loc = declLocation(decl);
      if (isTypeScriptLibFile(loc.fileName)) {return null;}

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

  // same-file declaration references: class<->class, class->interface, function->function, etc.
  for (const relation of pendingHookReferences) {
    addHookReferenceEdge(
      relation.hookId,
      relation.parentId,
      relation.expr,
      relation.label,
    );
  }

  for (const ownerId of ownerDeclById.keys()) {
    addReferenceEdgesForOwner(ownerId);
  }

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

    // owner switches for const foo = () => {} / function() {} and class field initializers
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      node.body
    ) {
      const pos = node.getStart(sf, false);
      const id = idByDeclPos.get(pos);
      const nextOwner = id ?? ownerId;

      // ArrowFunction body can be an expression or a block
      if (ts.isBlock(node.body)) {
        walk(node.body, nextOwner);
      } else {
        walk(node.body, nextOwner);
      }
      return;
    }

    // edges
    if (ts.isCallExpression(node)) {
      const r = resolveCallTarget(node);
      if (r) {
        addEdge(r.edgeKind ?? "calls", ownerId, r.tgtId, r.label);
        if ((r.edgeKind ?? "calls") === "calls") {
          addDataflowEdgesFromSignature(
            ownerId,
            r.tgtId,
            r.sigDecl,
            node.arguments,
          );
        }
      }
    }

    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const r = resolveJsxTarget(node);
      if (r) {
        addEdge("calls", ownerId, r.tgtId, "jsx");
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

  return { graph: { nodes, edges }, trace };
}

/** calls: normalize + resolve declaration location (cross-file enabled by Program) */
function extractCallsResolved(
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
  resolveModuleLocation?: (moduleText: string, containingFile: string) => FileTargetLocation | null,
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
      const resolved = resolveCallToDeclaration(
        node,
        sf,
        checker,
        resolveModuleLocation,
      );
      if (resolved) {bump(resolved);}
    } else if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const resolved = resolveJsxTagToDeclaration(node.tagName, sf, checker);
      if (resolved) {bump(resolved);}
    } else if (ts.isNewExpression(node)) {
      const resolved = resolveNewToDeclaration(node, sf, checker);
      if (resolved) {bump(resolved);}
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
  resolveModuleLocation?: (moduleText: string, containingFile: string) => FileTargetLocation | null,
): (AnalysisCallV2 & { declPos: number | null }) | null {
  if (call.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const firstArg = call.arguments[0];
    const moduleText =
      firstArg && ts.isStringLiteralLike(firstArg) ? firstArg.text : null;
    const moduleLocation =
      moduleText && resolveModuleLocation
        ? resolveModuleLocation(moduleText, sf.fileName)
        : null;

    return {
      calleeName: moduleText ? `import("${moduleText}")` : "import",
      count: 1,
      declFile: moduleLocation?.fileName ?? null,
      declRange: moduleLocation?.range ?? null,
      isExternal: moduleLocation ? isExternalFile(moduleLocation.fileName) : false,
      declPos: moduleLocation?.pos ?? null,
    };
  }

  const calleeName = normalizeCalleeName(call.expression, sf, checker);

  const sig = checker.getResolvedSignature(call);
  const declFromSig = sig?.getDeclaration();

  const sym = checker.getSymbolAtLocation(call.expression);
  const declFromSym = sym ? pickBestDeclaration(sym, checker) : undefined;

  const decl = declFromSig ?? declFromSym ?? null;
  const loc = decl ? declLocation(decl) : null;
  if (loc && isTypeScriptLibFile(loc.fileName)) {return null;}

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
): (AnalysisCallV2 & { declPos: number | null }) | null {
  const ctorExpr = node.expression;
  const calleeName = `new ${normalizeCtorName(ctorExpr, sf, checker)}`;

  const t = checker.getTypeAtLocation(ctorExpr);
  const constructSigs = t.getConstructSignatures();
  const declFromSig = constructSigs[0]?.getDeclaration();

  const sym = checker.getSymbolAtLocation(ctorExpr);
  const declFromSym = sym ? pickBestDeclaration(sym, checker) : undefined;

  const decl = declFromSig ?? declFromSym ?? null;
  const loc = decl ? declLocation(decl) : null;
  if (loc && isTypeScriptLibFile(loc.fileName)) {return null;}

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

function isIntrinsicJsxTagName(tagName: ts.JsxTagNameExpression): boolean {
  return ts.isIdentifier(tagName) && /^[a-z]/.test(tagName.text);
}

function normalizeJsxTagName(
  tagName: ts.JsxTagNameExpression,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): string {
  if (ts.isIdentifier(tagName)) {
    return tagName.text;
  }
  if (ts.isPropertyAccessExpression(tagName)) {
    return normalizeCalleeName(tagName, sf, checker);
  }
  return tagName.getText(sf);
}

function resolveJsxTagToDeclaration(
  tagName: ts.JsxTagNameExpression,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): (AnalysisCallV2 & { declPos: number | null }) | null {
  if (isIntrinsicJsxTagName(tagName)) {
    return null;
  }

  const calleeName = normalizeJsxTagName(tagName, sf, checker);
  const sym = checker.getSymbolAtLocation(tagName);
  const decl = sym ? pickBestDeclaration(sym, checker) : undefined;
  if (!decl) {
    return null;
  }

  const loc = declLocation(decl);
  if (isTypeScriptLibFile(loc.fileName)) {
    return null;
  }

  return {
    calleeName,
    count: 1,
    declFile: loc.fileName,
    declRange: loc.range,
    isExternal: isExternalFile(loc.fileName),
    declPos: loc.pos,
  };
}

function normalizeCalleeName(
  expr: ts.Expression,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): string {
  if (ts.isIdentifier(expr)) {return expr.text;}

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
  if (ts.isIdentifier(expr)) {return expr.text;}
  if (ts.isPropertyAccessExpression(expr)) {
    const t = checker.getTypeAtLocation(expr);
    const name = friendlyTypeName(t, checker);
    return name || expr.getText(sf);
  }
  return expr.getText(sf);
}

function friendlyTypeName(type: ts.Type, checker: ts.TypeChecker): string {
  const normalizeModuleName = (raw: string) => {
    const importTypeMatch = raw.match(/^typeof import\("(.+)"\)$/);
    if (importTypeMatch?.[1]) {
      return path.basename(importTypeMatch[1]).replace(/\.[^.]+$/, "");
    }
    const quotedPathMatch = raw.match(/^"(.+)"$/);
    if (quotedPathMatch?.[1]) {
      return path.basename(quotedPathMatch[1]).replace(/\.[^.]+$/, "");
    }
    return raw;
  };

  const sym = type.getSymbol();
  if (sym) {
    const aliased =
      sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const name = aliased.getName();
    if (name && name !== "__type") {return normalizeModuleName(name);}
  }
  return normalizeModuleName(checker.typeToString(type));
}

function pickBestDeclaration(
  sym: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Declaration | undefined {
  const s =
    sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  const decls = s.getDeclarations();
  if (!decls || decls.length === 0) {return undefined;}

  // implementation preferred
  const impl = decls.find(
    (d) =>
      ts.isMethodDeclaration(d) ||
      ts.isFunctionDeclaration(d) ||
      ts.isFunctionExpression(d) ||
      ts.isArrowFunction(d) ||
      ts.isClassDeclaration(d) ||
      (ts.isVariableDeclaration(d) &&
        Boolean(
          d.initializer &&
            (ts.isArrowFunction(d.initializer) ||
              ts.isFunctionExpression(d.initializer)),
        )) ||
      (ts.isPropertyDeclaration(d) &&
        Boolean(
          d.initializer &&
            (ts.isArrowFunction(d.initializer) ||
              ts.isFunctionExpression(d.initializer)),
        )) ||
      (ts.isPropertyAssignment(d) &&
        (ts.isArrowFunction(d.initializer) ||
          ts.isFunctionExpression(d.initializer))) ||
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

function isTypeScriptLibFile(fileName: string): boolean {
  const norm = fileName.replace(/\\/g, "/");
  return norm.includes("/typescript/lib/");
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
