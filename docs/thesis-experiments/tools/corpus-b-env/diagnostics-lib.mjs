// P1-K2: TypeScript diagnostic collection and root-cause classification for Corpus B.
// Uses only the TypeScript compiler API (the repository's typescript 5.9.3). Never imports or runs
// the Cogic analyzer. The program is built exactly as tools/exp01/validate-gt.mjs builds it
// (parseJsonConfigFileContent + createProgram + getPreEmitDiagnostics), so counts are comparable.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../../..");
export const ts = createRequire(path.join(repoRoot, "package.json"))("typescript");
export const CLASSIFIER_VERSION = "corpus-b-env-diagnostics/1";

export const CAUSES = [
  "UNRESOLVED_MODULE",
  "MISSING_EXPORT",
  "UNTYPED_EXTERNAL_DEPENDENCY",
  "TYPE_ASSIGNMENT_ERROR",
  "INVALID_CALL_SIGNATURE",
  "MISSING_GLOBAL_TYPE",
  "TSCONFIG_MISMATCH",
  "PATH_ALIAS_RESOLUTION",
  "DECORATOR_CONFIGURATION",
  "OTHER",
  "UNKNOWN",
];

// Criteria (environment-audit/README.md §3 repeats them in prose).
export const CAUSE_CRITERIA = {
  UNRESOLVED_MODULE: "A module specifier (relative, bare or implied such as react/jsx-runtime) resolves to no file and no ambient declaration (TS2307, TS2792, TS2875) and is not a path-alias specifier.",
  MISSING_EXPORT: "A name is imported from or qualified through a corpus-local module that does not export it (TS2305, TS2614, TS2724, or TS2694 on a local module).",
  UNTYPED_EXTERNAL_DEPENDENCY: "The diagnostic exists because a third-party module is a shorthand ambient module (`declare module \"x\";`): a namespace/type taken from it (TS2709, TS2694), type arguments or signatures on its `any` values (TS2347, TS2635), an implicit-any parameter whose contextual type is lost because the enclosing call, JSX tag or annotation comes from it (TS7006, TS7031, TS7019), or a type error whose operand is traced to it.",
  TYPE_ASSIGNMENT_ERROR: "An assignability error (TS2322, TS2345 ...) whose operands are not traced to the environment: a candidate genuine type error of the vendored code.",
  INVALID_CALL_SIGNATURE: "A call does not match any signature of a corpus-declared callee (TS2554, TS2555, TS2556, TS2769) and is not traced to the environment.",
  MISSING_GLOBAL_TYPE: "A global name, namespace or interface member that upstream gets from a declaration package (@types/node, @types/react JSX namespace, @types/express global Express, vite/client ImportMeta.env) is absent because Corpus B installs no packages (types: []).",
  TSCONFIG_MISMATCH: "The name would resolve from TypeScript's own lib files if the derived tsconfig used the upstream compiler options (here: the DOM-less `lib` override for Express/NestJS); verified by the lib-override variant run.",
  PATH_ALIAS_RESOLUTION: "A specifier that matches a `paths` alias of the case tsconfig does not resolve.",
  DECORATOR_CONFIGURATION: "Decorator syntax/semantics errors caused by decorator compiler options (TS1206, TS1219, TS1238-1241, TS1270, TS1271).",
  OTHER: "Cause identified but outside the categories above.",
  UNKNOWN: "Cause not established by the rules or the manual adjudication table.",
};

// Effect of the diagnostic on the static semantics the GT relies on (resolution of §2 nodes).
export const IMPACTS = {
  NONE: "No effect on symbol resolution: the construct is still parsed and its tag/callee identifiers resolve as before (JSX runtime module, intrinsic JSX element types).",
  EXTERNAL_OR_GLOBAL_TYPE_ONLY: "Only the type of a third-party or global entity is missing (it is `any` or unresolved). Such entities have no §2 node in Corpus B (ANNOTATION_ADDENDUM A2); corpus-local declarations resolve as before.",
  LOCAL_VALUE_TYPE_DEGRADED: "A corpus-local value or parameter gets type `any`/`unknown`. Member accesses on it cannot resolve; if its upstream type is a corpus-local type, a relation could be hidden. Checked empirically by the resolution comparison (gt-impact-report.md).",
  DEPENDENCY_FILE_ONLY: "Located in a vendored dependency file. The GT covers only the active file, so the diagnostic can matter only through the types the active file imports (covered by the resolution comparison).",
};

// Diagnostics the structural rules cannot attribute; each entry was read in the source.
// key: `<upstreamFile>:<line>:<code>`
export const MANUAL = {
  "apps/react-vite/src/components/ui/notifications/notifications.tsx:14:2322": {
    cause: "MISSING_GLOBAL_TYPE",
    impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY",
    rationale: "`key` is accepted on components through JSX.IntrinsicAttributes, which @types/react declares; without it `key` is checked against NotificationProps.",
  },
  "apps/react-vite/src/config/env.ts:20:2322": {
    cause: "MISSING_GLOBAL_TYPE",
    impact: "LOCAL_VALUE_TYPE_DEGRADED",
    rationale: "Cascade of TS2339 on line 15: `import.meta.env` (vite/client ImportMeta.env) is missing, so `Object.entries(import.meta.env)` yields `unknown` values.",
  },
  "apps/react-vite/src/testing/mocks/db.ts:93:18046": {
    cause: "UNTYPED_EXTERNAL_DEPENDENCY",
    impact: "LOCAL_VALUE_TYPE_DEGRADED",
    rationale: "`db` is the value of `factory(...)` from @mswjs/data (untyped); `Object.entries(db)` gives `unknown` entries.",
  },
};

const DOM_LIB_NAMES = new Set(["console", "URL", "URLSearchParams", "fetch", "AbortSignal", "AbortController", "setTimeout", "clearTimeout", "TextEncoder", "TextDecoder", "Headers", "Request", "Response", "FormData", "Blob"]);
const NODE_GLOBALS = new Set(["process", "Buffer", "__dirname", "__filename", "require", "module", "global"]);

export function listCases(corpusDir) {
  const out = [];
  for (const fw of fs.readdirSync(corpusDir).sort()) {
    const d = path.join(corpusDir, fw);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const c of fs.readdirSync(d).sort()) {
      const caseDir = path.join(d, c);
      if (fs.existsSync(path.join(caseDir, "case.json"))) out.push({ framework: fw, caseId: c, caseDir });
    }
  }
  return out;
}

export function programFor(caseDir, optionOverrides = {}) {
  const raw = ts.readConfigFile(path.join(caseDir, "tsconfig.json"), ts.sys.readFile);
  const config = { ...raw.config, compilerOptions: { ...raw.config.compilerOptions, ...optionOverrides } };
  for (const [k, v] of Object.entries(optionOverrides)) if (v === undefined) delete config.compilerOptions[k];
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, caseDir);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

export function nodeAt(sf, pos) {
  let best = sf;
  const visit = (n) => {
    if (pos >= n.getStart(sf) && pos < n.getEnd()) {
      best = n;
      n.forEachChild(visit);
    }
  };
  sf.forEachChild(visit);
  return best;
}

const isBare = (spec) => !spec.startsWith(".") && !spec.startsWith("/");

// The import declaration that binds `id`, if any. getSymbolAtLocation can return nothing for an
// identifier in a type position whose target is an untyped module, so fall back to the file's imports.
function importOf(checker, id) {
  const sym = checker.getSymbolAtLocation(id);
  let n = sym?.declarations?.[0];
  while (n && !ts.isImportDeclaration(n)) n = n.parent;
  if (n) return { decl: n, sym };
  const sf = id.getSourceFile();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const c = st.importClause;
    const names = [c.name?.text, c.namedBindings && ts.isNamespaceImport(c.namedBindings) ? c.namedBindings.name.text : null, ...(c.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements.map((e) => e.name.text) : [])];
    if (names.includes(id.text)) return { decl: st, sym };
  }
  return null;
}

// Returns { spec, untyped }: untyped = the specifier resolves to a shorthand ambient module declared in
// the case shims (not to a corpus source file). Decided by the checker, not by the specifier's shape,
// because path aliases such as "@/x" are local.
function importSpecifierOf(checker, id) {
  const r = importOf(checker, id);
  if (!r || !ts.isStringLiteral(r.decl.moduleSpecifier)) return null;
  const mod = checker.getSymbolAtLocation(r.decl.moduleSpecifier);
  const d = mod?.declarations?.[0];
  return { spec: r.decl.moduleSpecifier.text, untyped: Boolean(d && ts.isModuleDeclaration(d)), resolved: Boolean(d) };
}

// Does the value/type of `expr` originate from a third-party (shorthand ambient) module?
// Follows property-access/call/element-access bases and const initializers (bounded depth).
export function untypedOrigin(checker, expr, depth = 0) {
  if (!expr || depth > 24) return null;
  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) return untypedTypeOrigin(checker, expr.type, depth + 1) ?? untypedOrigin(checker, expr.expression, depth + 1);
  if (ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr) || ts.isAwaitExpression(expr)) return untypedOrigin(checker, expr.expression, depth + 1);
  if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(expr.operatorToken.kind)) return untypedOrigin(checker, expr.left, depth + 1);
  if (ts.isPropertyAccessExpression(expr)) {
    // a member with its own annotation (e.g. a constructor parameter property `private m: Model<X>`)
    const m = checker.getSymbolAtLocation(expr.name);
    const md = m?.valueDeclaration ?? m?.declarations?.[0];
    if (md && (ts.isParameter(md) || ts.isPropertyDeclaration(md) || ts.isPropertySignature(md)) && md.type) {
      const o = untypedTypeOrigin(checker, md.type, depth + 1);
      if (o) return o;
    }
    return untypedOrigin(checker, expr.expression, depth + 1);
  }
  if (ts.isElementAccessExpression(expr) || ts.isCallExpression(expr) || ts.isNewExpression(expr) || ts.isTaggedTemplateExpression(expr)) return untypedOrigin(checker, expr.expression ?? expr.tag, depth + 1);
  if (ts.isQualifiedName(expr)) return untypedOrigin(checker, expr.left, depth + 1);
  if (ts.isJsxOpeningElement(expr) || ts.isJsxSelfClosingElement(expr)) return untypedOrigin(checker, expr.tagName, depth + 1);
  if (ts.isIdentifier(expr) || expr.kind === ts.SyntaxKind.ThisKeyword) {
    let sym = checker.getSymbolAtLocation(expr);
    if (ts.isIdentifier(expr)) {
      const imp = importSpecifierOf(checker, expr);
      if (imp?.untyped) return imp.spec;
      // a corpus-local import: follow it to the exported declaration
      if (imp && sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    }
    if (!sym && ts.isIdentifier(expr) && NODE_GLOBALS.has(expr.text)) return `global ${expr.text}`;
    const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
    if (decl && (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl)) && decl.type) return untypedTypeOrigin(checker, decl.type, depth + 1);
    // a local function without a return annotation: the value comes from what it returns
    const fnOf = (d) => (ts.isFunctionDeclaration(d) ? d : d && ts.isVariableDeclaration(d) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) ? d.initializer : null);
    const fn = fnOf(decl);
    if (fn && !fn.type && ts.isCallExpression(expr.parent) && expr.parent.expression === expr) {
      if (fn.body && !ts.isBlock(fn.body)) return untypedOrigin(checker, fn.body, depth + 1);
      let ret = null;
      const find = (n) => {
        if (ret || (n !== fn.body && ts.isFunctionLike(n))) return;
        if (ts.isReturnStatement(n) && n.expression) ret = n.expression;
        else n.forEachChild(find);
      };
      if (fn.body) find(fn.body);
      if (ret) return untypedOrigin(checker, ret, depth + 1);
    }
    // an unannotated callback parameter: typed by whatever calls the callback
    if (decl && ts.isParameter(decl) && !decl.type) {
      const r = implicitAnyOrigin(checker, decl);
      if (r?.origin) return r.origin;
    }
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer) return untypedOrigin(checker, decl.initializer, depth + 1);
    if (decl && ts.isBindingElement(decl)) {
      let v = decl.parent;
      while (v && !ts.isVariableDeclaration(v)) v = v.parent;
      if (v?.initializer) return untypedOrigin(checker, v.initializer, depth + 1);
    }
    if (decl && (ts.isParameter(decl) || ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)) && decl.type) return untypedTypeOrigin(checker, decl.type, depth + 1);
    return null;
  }
  return null;
}

export function untypedTypeOrigin(checker, typeNode, depth = 0) {
  if (!typeNode || depth > 24) return null;
  let found = null;
  const visit = (n) => {
    if (found) return;
    if (ts.isTypeReferenceNode(n)) {
      let left = n.typeName;
      while (ts.isQualifiedName(left)) left = left.left;
      const imp = importSpecifierOf(checker, left);
      if (imp?.untyped) found = imp.spec;
      else if (depth < 24) {
        // a corpus-local type alias / interface: look inside its declaration
        let sym = checker.getSymbolAtLocation(left === n.typeName ? n.typeName : left);
        if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
        for (const d of sym?.declarations ?? []) {
          if (found) break;
          if (ts.isTypeAliasDeclaration(d)) found = untypedTypeOrigin(checker, d.type, depth + 1);
          else if (ts.isInterfaceDeclaration(d)) for (const m of d.members) if (!found && m.type) found = untypedTypeOrigin(checker, m.type, depth + 1);
        }
      }
    } else if (ts.isTypeQueryNode(n)) {
      let left = n.exprName;
      while (ts.isQualifiedName(left)) left = left.left;
      found = untypedOrigin(checker, left, depth + 1);
    }
    if (!found) n.forEachChild(visit);
  };
  visit(typeNode);
  return found;
}

// A corpus-local function component whose props annotation draws on an untyped module.
function componentPropsOrigin(checker, tag) {
  if (!ts.isIdentifier(tag)) return null;
  let sym = checker.getSymbolAtLocation(tag);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  const d = sym?.valueDeclaration;
  const fn = d && ts.isFunctionDeclaration(d) ? d : d && ts.isVariableDeclaration(d) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) ? d.initializer : null;
  return fn?.parameters[0]?.type ? untypedTypeOrigin(checker, fn.parameters[0].type) : null;
}

// Why does this parameter have no contextual type? Climbs through the expressions that pass a
// contextual type down (object/array literals, parentheses, returned expressions of an enclosing
// function expression) to the call, JSX tag, assignment target or annotation that supplies it.
function implicitAnyOrigin(checker, node) {
  let fn = node;
  while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
  if (!fn) return null;
  const contextual = ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || (ts.isMethodDeclaration(fn) && ts.isObjectLiteralExpression(fn.parent));
  if (!contextual) return { origin: null, why: "declaration without annotation" };
  let holder = fn;
  let ctx = fn.parent;
  for (let guard = 0; ctx && guard < 30; guard++) {
    if (ts.isParenthesizedExpression(ctx) || ts.isAsExpression(ctx) || ts.isSatisfiesExpression(ctx) || ts.isPropertyAssignment(ctx) || ts.isObjectLiteralExpression(ctx) || ts.isArrayLiteralExpression(ctx) || ts.isShorthandPropertyAssignment(ctx) || ts.isSpreadElement(ctx)) {
      holder = ctx;
      ctx = ctx.parent;
      continue;
    }
    // returned from an enclosing function expression: its own contextual type decides
    if ((ts.isArrowFunction(ctx) && ctx.body === holder) || ts.isReturnStatement(ctx)) {
      let outer = ctx;
      while (outer && !(ts.isArrowFunction(outer) || ts.isFunctionExpression(outer) || ts.isMethodDeclaration(outer) || ts.isFunctionDeclaration(outer))) outer = outer.parent;
      if (!outer) break;
      if (outer.type) return { origin: untypedTypeOrigin(checker, outer.type), why: "returned from annotated function" };
      if (ts.isFunctionDeclaration(outer) || (ts.isMethodDeclaration(outer) && !ts.isObjectLiteralExpression(outer.parent))) return { origin: null, why: "returned from declaration" };
      holder = outer;
      ctx = outer.parent;
      continue;
    }
    break;
  }
  if (ctx && (ts.isCallExpression(ctx) || ts.isNewExpression(ctx)) && ctx.arguments?.includes(holder)) return { origin: untypedOrigin(checker, ctx.expression), why: "argument of call" };
  if (ctx && ts.isJsxExpression(ctx)) {
    const el = ctx.parent?.parent?.parent; // JsxAttribute -> JsxAttributes -> element
    if (el && (ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el))) return { origin: untypedOrigin(checker, el.tagName) ?? componentPropsOrigin(checker, el.tagName) ?? (ts.isIdentifier(el.tagName) && /^[a-z]/.test(el.tagName.text) ? "JSX intrinsic (no @types/react)" : null), why: "JSX attribute" };
  }
  if (ctx && ts.isBinaryExpression(ctx) && ctx.operatorToken.kind === ts.SyntaxKind.EqualsToken && ctx.right === holder) return { origin: untypedOrigin(checker, ctx.left), why: "assigned to a property" };
  if (ctx && ts.isVariableDeclaration(ctx) && ctx.type) return { origin: untypedTypeOrigin(checker, ctx.type), why: "annotated variable" };
  if (ctx && (ts.isPropertyDeclaration(ctx) || ts.isParameter(ctx)) && ctx.type) return { origin: untypedTypeOrigin(checker, ctx.type), why: "annotated property/parameter" };
  return { origin: null, why: `context ${ctx ? ts.SyntaxKind[ctx.kind] : "none"}` };
}

export function classify(d, ctx) {
  const { checker, framework, isLibOverridden, upstreamKey, paths } = ctx;
  const manual = MANUAL[upstreamKey];
  if (manual) return { cause: manual.cause, impact: manual.impact, basis: `manual: ${manual.rationale}` };
  const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
  const node = d.file ? nodeAt(d.file, d.start) : null;
  const quoted = (msg.match(/'([^']*)'/) ?? [])[1];
  switch (d.code) {
    case 2875:
      return { cause: "UNRESOLVED_MODULE", impact: "NONE", basis: `implied JSX runtime module ${quoted} is not declared by the shim (only "react" is)` };
    case 2307:
    case 2792: {
      const alias = Object.keys(paths ?? {}).some((p) => quoted?.startsWith(p.replace(/\*$/, "")));
      return { cause: alias ? "PATH_ALIAS_RESOLUTION" : "UNRESOLVED_MODULE", impact: "LOCAL_VALUE_TYPE_DEGRADED", basis: `module ${quoted} not found` };
    }
    case 1206:
    case 1219:
    case 1238:
    case 1239:
    case 1240:
    case 1241:
    case 1270:
    case 1271:
      return { cause: "DECORATOR_CONFIGURATION", impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY", basis: "decorator diagnostic" };
    case 7026:
      return { cause: "MISSING_GLOBAL_TYPE", impact: "NONE", basis: "JSX.IntrinsicElements comes from @types/react" };
    case 2591:
    case 2580:
      return { cause: "MISSING_GLOBAL_TYPE", impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY", basis: `Node global ${quoted} (@types/node)` };
    case 2304:
    case 2584:
      if (NODE_GLOBALS.has(quoted)) return { cause: "MISSING_GLOBAL_TYPE", impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY", basis: `Node global ${quoted} (@types/node)` };
      if (DOM_LIB_NAMES.has(quoted) && isLibOverridden) return { cause: "TSCONFIG_MISMATCH", impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY", basis: `${quoted} is declared by lib.dom, which the upstream default lib includes and the derived ${framework} lib override removes` };
      return { cause: "UNKNOWN", impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY", basis: `name ${quoted}` };
    case 2503:
      if (["Express", "React", "JSX", "NodeJS"].includes(quoted)) return { cause: "MISSING_GLOBAL_TYPE", impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY", basis: `global namespace ${quoted} is declared by a @types package` };
      return { cause: "UNKNOWN", impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY", basis: `namespace ${quoted}` };
    case 2339:
      if (quoted === "env" && /ImportMeta/.test(msg)) return { cause: "MISSING_GLOBAL_TYPE", impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY", basis: "ImportMeta.env comes from vite/client" };
      break;
    case 2305:
    case 2614:
    case 2724:
      return { cause: "MISSING_EXPORT", impact: "LOCAL_VALUE_TYPE_DEGRADED", basis: msg };
    case 2694: {
      const mod = (msg.match(/Namespace '"([^"]+)"'/) ?? [])[1];
      if (mod && isBare(mod)) return { cause: "UNTYPED_EXTERNAL_DEPENDENCY", impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY", basis: `qualified type from untyped module "${mod}"` };
      return { cause: "MISSING_EXPORT", impact: "LOCAL_VALUE_TYPE_DEGRADED", basis: msg };
    }
    case 2709: {
      let id = node;
      while (id && !ts.isIdentifier(id)) id = id.parent;
      const imp = id ? importSpecifierOf(checker, id) : null;
      if (imp?.untyped) return { cause: "UNTYPED_EXTERNAL_DEPENDENCY", impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY", basis: `type ${quoted} imported from untyped module "${imp.spec}"` };
      break;
    }
    case 2347:
    case 2635: {
      let e = node;
      while (e && !(ts.isCallExpression(e) || ts.isNewExpression(e) || ts.isExpressionWithTypeArguments(e))) e = e.parent;
      const origin = e ? untypedOrigin(checker, e.expression) : null;
      if (origin) return { cause: "UNTYPED_EXTERNAL_DEPENDENCY", impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY", basis: `type arguments on an any value from "${origin}"` };
      break;
    }
    case 1064: {
      let fn = node;
      while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
      const origin = fn?.type ? untypedTypeOrigin(checker, fn.type) : null;
      if (origin) return { cause: "UNTYPED_EXTERNAL_DEPENDENCY", impact: "LOCAL_VALUE_TYPE_DEGRADED", basis: `return type annotation evaluates to any through "${origin}"` };
      break;
    }
    case 7006:
    case 7031:
    case 7019: {
      const r = implicitAnyOrigin(checker, node);
      if (r?.origin?.startsWith("global ")) return { cause: "MISSING_GLOBAL_TYPE", impact: "LOCAL_VALUE_TYPE_DEGRADED", basis: `${r.why}: contextual type lost through the missing Node ${r.origin}` };
      if (r?.origin) return { cause: "UNTYPED_EXTERNAL_DEPENDENCY", impact: "LOCAL_VALUE_TYPE_DEGRADED", basis: `${r.why}: contextual type lost through "${r.origin}"` };
      return { cause: "UNKNOWN", impact: "LOCAL_VALUE_TYPE_DEGRADED", basis: `implicit any (${r?.why ?? "no function"})` };
    }
    case 2322:
    case 2345:
      return { cause: "TYPE_ASSIGNMENT_ERROR", impact: "LOCAL_VALUE_TYPE_DEGRADED", basis: msg };
    case 2554:
    case 2555:
    case 2556:
    case 2769:
      return { cause: "INVALID_CALL_SIGNATURE", impact: "LOCAL_VALUE_TYPE_DEGRADED", basis: msg };
    default:
      break;
  }
  return { cause: "UNKNOWN", impact: "EXTERNAL_OR_GLOBAL_TYPE_ONLY", basis: msg };
}

const CATEGORY = ["Warning", "Error", "Suggestion", "Message"];

export function collectCase({ framework, caseId, caseDir }, { optionOverrides } = {}) {
  const caseJson = JSON.parse(fs.readFileSync(path.join(caseDir, "case.json"), "utf8"));
  const upstream = JSON.parse(fs.readFileSync(path.join(caseDir, "upstream.json"), "utf8"));
  const toUpstream = new Map(upstream.files.map((f) => [f.path, f.upstreamPath]));
  const program = programFor(caseDir, optionOverrides);
  const checker = program.getTypeChecker();
  const options = program.getCompilerOptions();
  // the derived tsconfig sets `lib` although upstream leaves it to the target default (build-cases LIB_OVERRIDE)
  const isLibOverridden = upstream.tsconfig.upstreamOptions.lib === undefined && upstream.tsconfig.derivedOptions.lib !== undefined;
  const rows = [];
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const rel = d.file ? path.relative(caseDir, d.file.fileName).split(path.sep).join("/") : null;
    const lc = d.file ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    const upstreamFile = rel ? (toUpstream.get(rel) ?? (rel.startsWith("shims/") ? `(generated) ${rel}` : `(not vendored) ${rel}`)) : null;
    const upstreamKey = `${upstreamFile}:${lc ? lc.line + 1 : 0}:${d.code}`;
    const cls = classify(d, { checker, framework, isLibOverridden, upstreamKey, paths: options.paths });
    const isActive = rel === caseJson.activeFile;
    rows.push({
      caseId,
      framework,
      code: d.code,
      category: CATEGORY[d.category],
      file: rel,
      upstreamFile,
      line: lc ? lc.line + 1 : null,
      character: lc ? lc.character + 1 : null,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
      location: isActive ? "ACTIVE_FILE" : "DEPENDENCY_FILE",
      cause: cls.cause,
      impact: isActive ? cls.impact : cls.impact === "NONE" ? "NONE" : "DEPENDENCY_FILE_ONLY",
      impactAtSite: cls.impact,
      basis: cls.basis,
      uniqueKey: `${upstreamFile}:${lc ? `${lc.line + 1}:${lc.character + 1}` : "-"}:TS${d.code}:${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
    });
  }
  return rows;
}
