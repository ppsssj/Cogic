// P1-K3: shared helpers for the blinded Corpus B ground-truth review.
// - blind inventories (syntax and import resolution only; never GT relations, never Cogic output)
// - GT item export for the reconciliation stage
// - endpoint notation shared by reviewer forms and reconciliation
// TypeScript compiler API only (repository typescript 5.9.3). Read-only on the corpus.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../../..");
export const ts = createRequire(path.join(repoRoot, "package.json"))("typescript");
export const corpusDir = path.join(repoRoot, "docs/thesis-experiments/corpus-b/fixtures");
export const REVIEW_TOOL_VERSION = "corpus-b-review/1";

export function listCases(root = corpusDir) {
  const out = [];
  for (const fw of fs.readdirSync(root).sort()) {
    const d = path.join(root, fw);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const c of fs.readdirSync(d).sort()) {
      if (fs.existsSync(path.join(d, c, "case.json"))) out.push({ framework: fw, caseId: c, caseDir: path.join(d, c) });
    }
  }
  return out;
}

export const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

// ---------------------------------------------------------------------------
// CSV

export function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows, cols) => `${[cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n")}\n`;
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

// ---------------------------------------------------------------------------
// Endpoint notation (reviewer-instructions.md §4)
//   file                      the active file node (module top level)
//   <path>:<line>             a declaration (§2 node) by file and start line (guide §2 line rule)
//   lib:<Interface.member>    a TypeScript lib declaration (ANNOTATION_ADDENDUM A3 naming)
//   fw:<line>                 a framework synthetic node of the active file anchored on <line>
//   module:<path>             a module node (dynamic import)

export function endpointOfNode(n) {
  if (!n) return "";
  switch (n.type) {
    case "file":
      return "file";
    case "lib":
      return `lib:${n.symbol}`;
    case "synthetic":
      return `fw:${n.line}`;
    case "module":
      return `module:${n.file}`;
    default:
      return `${n.file}:${n.line}`;
  }
}

export function normalizeEndpoint(s) {
  const t = String(s ?? "").trim();
  if (t === "" || t === "file") return t;
  if (/^(lib|fw|module):/.test(t)) return t.replace(/^(\w+):\s*/, "$1:");
  const m = /^(.+?):(\d+)$/.exec(t.replace(/\\/g, "/").replace(/^\.\//, ""));
  return m ? `${m[1]}:${Number(m[2])}` : t;
}

// ---------------------------------------------------------------------------
// GT export (reconciliation side only; never written into the blind packet)

export const GT_ITEM_COLUMNS = ["gtItemId", "caseId", "framework", "itemType", "id", "kind", "source", "sourceName", "target", "targetName", "argIndex", "candidates", "pattern", "support", "evidenceLines", "note"];

export function gtItems(c, catalog) {
  const gt = readJson(path.join(c.caseDir, "expected.json"));
  const nodes = new Map(gt.nodes.map((n) => [n.id, n]));
  const nameOf = (id) => {
    const n = nodes.get(id);
    return n ? (n.name ?? n.symbol ?? n.anchor ?? n.type) : "";
  };
  const lines = (ev) => (ev ?? []).map((e) => Number(String(e).split(":").pop())).join(" ");
  const support = (p) => catalog.get(p) ?? "";
  const rows = [];
  for (const r of gt.relations) {
    rows.push({
      caseId: gt.caseId,
      framework: c.framework,
      itemType: r.gtStatus === "indeterminate" ? "INDETERMINATE" : "DETERMINATE",
      id: r.id,
      kind: r.kind,
      source: endpointOfNode(nodes.get(r.source)),
      sourceName: nameOf(r.source),
      target: r.target ? endpointOfNode(nodes.get(r.target)) : "",
      targetName: r.target ? nameOf(r.target) : "",
      argIndex: r.argIndex ?? "",
      candidates: r.candidates === "unbounded" ? "unbounded" : Array.isArray(r.candidates) ? r.candidates.map((x) => `${endpointOfNode(nodes.get(x.target))}${x.argIndex !== undefined ? `#${x.argIndex}` : ""}`).join(" ; ") : "",
      pattern: r.pattern,
      support: support(r.pattern),
      evidenceLines: lines(r.evidence),
      note: r.note ?? r.reason ?? "",
    });
  }
  for (const n of gt.negatives) {
    rows.push({ caseId: gt.caseId, framework: c.framework, itemType: "NEGATIVE", id: n.id, kind: n.kind, source: endpointOfNode(nodes.get(n.source)), sourceName: nameOf(n.source), target: n.target ? endpointOfNode(nodes.get(n.target)) : "", targetName: n.target ? nameOf(n.target) : "", argIndex: n.argIndex ?? "", candidates: "", pattern: n.pattern, support: support(n.pattern), evidenceLines: lines(n.evidence), note: n.rationale ?? "" });
  }
  gt.excludedSites.forEach((s, i) => {
    rows.push({ caseId: gt.caseId, framework: c.framework, itemType: "EXCLUDED_SITE", id: `X${String(i + 1).padStart(2, "0")}`, kind: "", source: "", sourceName: "", target: "", targetName: "", argIndex: "", candidates: "", pattern: "", support: "", evidenceLines: String(Number(s.site.split(":").pop())), note: s.reason });
  });
  return rows.map((r) => ({ gtItemId: `${r.caseId}/${r.id}`, ...r }));
}

export function loadCatalogSupport() {
  const text = fs.readFileSync(path.join(corpusDir, "catalog.csv"), "utf8");
  return new Map(parseCsv(text).map((r) => [r.patternId, r.support]));
}

// ---------------------------------------------------------------------------
// Blind inventory: syntax of the active file and resolution of its imports to files.
// It lists declarations and call-like sites; it does not say which are §2 nodes or what any site calls.

export function programFor(caseDir) {
  const raw = ts.readConfigFile(path.join(caseDir, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, caseDir);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

const declKind = (n) => {
  if (ts.isFunctionDeclaration(n)) return "function";
  if (ts.isMethodDeclaration(n)) return "method";
  if (ts.isConstructorDeclaration(n)) return "constructor";
  if (ts.isGetAccessor(n) || ts.isSetAccessor(n)) return "accessor";
  if (ts.isClassDeclaration(n)) return "class";
  if (ts.isInterfaceDeclaration(n)) return "interface";
  if (ts.isTypeAliasDeclaration(n)) return "type alias";
  if (ts.isEnumDeclaration(n)) return "enum";
  if (ts.isPropertyDeclaration(n)) return "class property";
  if (ts.isPropertyAssignment(n) && ts.isObjectLiteralExpression(n.parent)) return "object property";
  if (ts.isVariableDeclaration(n)) return "variable";
  return null;
};

function initializerShape(n) {
  const init = n.initializer;
  if (!init) return ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n) ? (n.body ? "has body" : "no body") : "";
  if (ts.isArrowFunction(init)) return "initializer: arrow function";
  if (ts.isFunctionExpression(init)) return "initializer: function expression";
  if (ts.isClassExpression(init)) return "initializer: class expression";
  if (ts.isCallExpression(init) || ts.isNewExpression(init)) return "initializer: call/new expression";
  return "initializer: other expression";
}

export function inventory(c) {
  const caseJson = readJson(path.join(c.caseDir, "case.json"));
  const program = programFor(c.caseDir);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(path.join(c.caseDir, caseJson.activeFile));
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const colOf = (pos) => sf.getLineAndCharacterOfPosition(pos).character + 1;
  const text = (n) => n.getText(sf).replace(/\s+/g, " ").slice(0, 70);

  const imports = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const mod = checker.getSymbolAtLocation(st.moduleSpecifier);
    const d = mod?.declarations?.[0];
    let resolvesTo = "unresolved";
    if (d && ts.isSourceFile(d)) resolvesTo = path.relative(c.caseDir, d.fileName).split(path.sep).join("/");
    else if (d && ts.isModuleDeclaration(d)) resolvesTo = d.getSourceFile().fileName.endsWith(".d.ts") && path.relative(c.caseDir, d.getSourceFile().fileName).startsWith("shims") ? "untyped third-party (shims/third-party.d.ts)" : "ambient module declaration";
    const cl = st.importClause;
    const names = [];
    if (cl?.name) names.push(`default as ${cl.name.text}`);
    if (cl?.namedBindings && ts.isNamespaceImport(cl.namedBindings)) names.push(`* as ${cl.namedBindings.name.text}`);
    if (cl?.namedBindings && ts.isNamedImports(cl.namedBindings)) for (const e of cl.namedBindings.elements) names.push(e.propertyName ? `${e.propertyName.text} as ${e.name.text}` : e.name.text);
    imports.push({ line: lineOf(st.getStart(sf)), specifier: st.moduleSpecifier.text, names: names.join(", ") || "(side effect)", typeOnly: Boolean(cl?.isTypeOnly), resolvesTo });
  }

  const declarations = [];
  const sites = [];
  const visit = (n, depth) => {
    const k = declKind(n);
    const fnInit = n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer) || ts.isClassExpression(n.initializer));
    const listed = k && (k !== "object property" || fnInit) && (k !== "class property" || fnInit || depth <= 3);
    if (listed && n.name && (ts.isIdentifier(n.name) || ts.isPrivateIdentifier(n.name) || ts.isStringLiteral(n.name)) && depth <= 3) {
      declarations.push({ line: lineOf(n.getStart(sf)), name: n.name.text, kind: k, shape: initializerShape(n) });
    } else if (ts.isConstructorDeclaration(n)) {
      declarations.push({ line: lineOf(n.getStart(sf)), name: "constructor", kind: "constructor", shape: n.body ? "has body" : "no body" });
    }
    let siteKind = null;
    let callee = null;
    if (ts.isCallExpression(n)) {
      siteKind = n.parent && ts.isDecorator(n.parent) ? "decorator call" : n.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic import" : n.expression.kind === ts.SyntaxKind.SuperKeyword ? "super call" : "call";
      callee = n.expression;
    } else if (ts.isNewExpression(n)) {
      siteKind = "new";
      callee = n.expression;
    } else if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      siteKind = "jsx element";
      callee = n.tagName;
    } else if (ts.isTaggedTemplateExpression(n)) {
      siteKind = "tagged template";
      callee = n.tag;
    } else if (ts.isDecorator(n) && !ts.isCallExpression(n.expression)) {
      siteKind = "decorator";
      callee = n.expression;
    }
    if (siteKind) sites.push({ line: lineOf(n.getStart(sf)), col: colOf(n.getStart(sf)), siteKind, expression: text(callee), args: n.arguments ? n.arguments.length : "" });
    n.forEachChild((ch) => visit(ch, depth + (ts.isBlock(ch) || ts.isClassLike(ch) || ts.isObjectLiteralExpression(ch) ? 1 : 0)));
  };
  sf.forEachChild((ch) => visit(ch, 0));
  sites.sort((a, b) => a.line - b.line || a.col - b.col);
  sites.forEach((s, i) => (s.siteId = `S${String(i + 1).padStart(3, "0")}`));
  declarations.sort((a, b) => a.line - b.line);
  return { caseId: c.caseId, framework: c.framework, activeFile: caseJson.activeFile, text: sf.text, imports, declarations, sites };
}
