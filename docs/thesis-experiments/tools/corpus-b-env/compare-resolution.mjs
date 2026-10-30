#!/usr/bin/env node
// P1-K2 EXPLORATORY (not part of the frozen Corpus B environment): compare TypeScript symbol
// resolution in each case's active file between
//   A = the frozen Corpus B workspace (untyped shims, derived tsconfig), and
//   C = the upstream project at the pinned commit with its pinned dependencies installed
//       (lockfile, --ignore-scripts) and its own tsconfig.
// Same TypeScript 5.9.3, same active-file bytes. TypeScript API only; never runs Cogic.
// Also checks, for every GT relation whose target is a declaration, that the C environment resolves
// the evidence site to the same declaration.
// Usage: node compare-resolution.mjs --upstream <dir with react/ vue/ express/ nest/> --out <file>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { listCases, repoRoot, ts } from "./diagnostics-lib.mjs";

export const COMPARE_VERSION = "corpus-b-env-resolution/1";
const corpus = path.join(repoRoot, "docs/thesis-experiments/corpus-b/fixtures");
// project root of each upstream (directory of the tsconfig the case was derived from)
const PROJECT = { react: "apps/react-vite", vue: "", express: "", nest: "" };
const LOCKFILE = { react: "apps/react-vite/yarn.lock", vue: "pnpm-lock.yaml", express: "pnpm-lock.yaml", nest: "package-lock.json" };

function makeProgram(configPath) {
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath));
  return ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
}

// §2 node kinds (ANNOTATION_GUIDE §2): declarations that can be a relation target.
export function isSection2Node(d) {
  if (!d) return false;
  if (ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d)) return Boolean(d.body);
  if (ts.isClassDeclaration(d) || ts.isClassExpression(d) || ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isEnumDeclaration(d)) return true;
  if ((ts.isVariableDeclaration(d) || ts.isPropertyDeclaration(d) || ts.isPropertyAssignment(d)) && d.initializer) return ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer) || ts.isClassExpression(d.initializer);
  return false;
}

const libName = (d) => {
  const own = d.name && ts.isIdentifier(d.name) ? d.name.text : "?";
  const p = d.parent;
  if (p && (ts.isInterfaceDeclaration(p) || ts.isClassDeclaration(p) || ts.isModuleBlock(p)) && !ts.isSourceFile(p)) {
    const pn = ts.isModuleBlock(p) ? p.parent.name.text : p.name?.text;
    return `${(pn ?? "?").replace(/Constructor$/, "")}.${own}`;
  }
  return own;
};

// Describe the declaration a symbol resolves to, relative to the project root.
function describe(sym, checker, root, toUpstream) {
  if (!sym) return { where: "none" };
  if (sym.flags & ts.SymbolFlags.Alias) {
    try {
      sym = checker.getAliasedSymbol(sym);
    } catch {
      return { where: "none" };
    }
  }
  const d = sym.valueDeclaration ?? sym.declarations?.[0];
  if (!d) return { where: "none", name: sym.name };
  const sf = d.getSourceFile();
  const file = path.relative(root, sf.fileName).split(path.sep).join("/");
  const line = sf.getLineAndCharacterOfPosition(d.getStart(sf)).line + 1;
  if (/[\\/]typescript[\\/]lib[\\/]lib\..*\.d\.ts$/.test(sf.fileName)) return { where: "lib", name: libName(d) };
  const nm = sf.fileName.split(/[\\/]/).lastIndexOf("node_modules");
  if (nm >= 0) {
    const parts = sf.fileName.split(/[\\/]/).slice(nm + 1);
    const pkg = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
    return { where: "package", pkg: pkg === ".pnpm" ? parts.slice(1).join("/").replace(/\/node_modules\/.*$/, "") : pkg, name: sym.name };
  }
  if (file.startsWith("shims/")) return { where: "shim", name: sym.name };
  if (file.startsWith("..")) return { where: "outside", name: sym.name };
  const up = toUpstream ? (toUpstream.get(file) ?? file) : file;
  return { where: sf.isDeclarationFile ? "local-dts" : "local", file: up, line, node: isSection2Node(d), declKind: ts.SyntaxKind[d.kind], name: sym.name };
}

function roleOf(id) {
  const p = id.parent;
  let n = id;
  if (p && ts.isPropertyAccessExpression(p) && p.name === id) n = p;
  const q = n.parent;
  if (q && ts.isCallExpression(q) && q.expression === n) return q.parent && ts.isDecorator(q.parent) ? "decorator-callee" : "call-callee";
  if (q && ts.isNewExpression(q) && q.expression === n) return "new-callee";
  if (q && (ts.isJsxOpeningElement(q) || ts.isJsxSelfClosingElement(q) || ts.isJsxClosingElement(q)) && q.tagName === n) return ts.isJsxClosingElement(q) ? "jsx-closing" : "jsx-tag";
  for (let a = id.parent; a; a = a.parent) {
    if (ts.isTypeNode(a)) return "type";
    if (ts.isExpression(a) || ts.isStatement(a)) break;
  }
  if (p && ts.isPropertyAccessExpression(p) && p.name === id) return "member";
  return "value";
}

function isDeclarationName(id) {
  const p = id.parent;
  return p && "name" in p && p.name === id && (ts.isDeclarationStatement?.(p) || ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertyAssignment(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isEnumMember(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isTypeParameterDeclaration(p) || ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p));
}

function sites(program, activeAbs, root, toUpstream) {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(activeAbs);
  if (!sf) throw new Error(`active file not in program: ${activeAbs}`);
  const activeDiagnostics = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)].map((d) => `TS${d.code}`);
  const out = new Map();
  const visit = (n) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isIdentifier(n) && !isDeclarationName(n)) {
      const lc = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      const key = `${lc.line + 1}:${lc.character + 1}`;
      const role = roleOf(n);
      // `{ run }`: the shorthand name refers to the value in scope, not to the new property
      const sym = n.parent && ts.isShorthandPropertyAssignment(n.parent) && n.parent.name === n ? checker.getShorthandAssignmentValueSymbol(n.parent) : checker.getSymbolAtLocation(n);
      const rec = { key, line: lc.line + 1, text: n.text, role: n.parent && ts.isShorthandPropertyAssignment(n.parent) ? "shorthand-value" : role, target: describe(sym, checker, root, toUpstream) };
      const call = n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.name === n ? n.parent.parent : n.parent;
      if ((role === "call-callee" || role === "new-callee" || role === "decorator-callee") && call) {
        const sig = checker.getResolvedSignature(call);
        const sd = sig?.declaration;
        if (sd && !ts.isJSDocSignature(sd)) {
          const s2 = sd.getSourceFile();
          rec.signature = { file: path.relative(root, s2.fileName).split(path.sep).join("/"), line: s2.getLineAndCharacterOfPosition(sd.getStart(s2)).line + 1, params: sd.parameters?.length ?? null };
          if (toUpstream) rec.signature.file = toUpstream.get(rec.signature.file) ?? rec.signature.file;
        }
        rec.args = call.arguments?.length ?? 0;
      }
      out.set(key, rec);
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return { text: sf.text, sites: out, activeDiagnostics };
}

const count = (xs, key) => {
  const o = {};
  for (const x of xs) o[key(x)] = (o[key(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
};
const spec = (t) => (t.where === "local" || t.where === "local-dts" ? `${t.where}:${t.file}:${t.line}` : t.where === "lib" ? `lib:${t.name}` : t.where === "package" ? `package:${t.pkg}` : t.where);

export function compareCase(c, upstreamRoot) {
  const caseJson = JSON.parse(fs.readFileSync(path.join(c.caseDir, "case.json"), "utf8"));
  const up = JSON.parse(fs.readFileSync(path.join(c.caseDir, "upstream.json"), "utf8"));
  const gt = JSON.parse(fs.readFileSync(path.join(c.caseDir, "expected.json"), "utf8"));
  const toUpstreamRel = new Map(up.files.map((f) => [f.path, f.path])); // case paths already equal project-relative paths
  const A = sites(makeProgram(path.join(c.caseDir, "tsconfig.json")), path.join(c.caseDir, caseJson.activeFile), c.caseDir, toUpstreamRel);
  const projRoot = path.join(upstreamRoot, c.framework, PROJECT[c.framework]);
  const C = sites(makeProgram(path.join(upstreamRoot, c.framework, up.tsconfig.upstream)), path.join(projRoot, caseJson.activeFile), projRoot, null);
  if (A.text.replace(/\r\n/g, "\n") !== C.text.replace(/\r\n/g, "\n")) throw new Error(`${c.caseId}: active file differs between A and C`);

  const rows = [];
  for (const [key, a] of A.sites) {
    const cc = C.sites.get(key);
    const sa = spec(a.target);
    const sc = cc ? spec(cc.target) : "missing";
    let cls;
    if (sa === sc) cls = a.signature && cc?.signature && JSON.stringify(a.signature) !== JSON.stringify(cc.signature) && a.target.where === "local" ? "SAME_TARGET_DIFFERENT_SIGNATURE" : "SAME";
    else if (a.target.where === "local") cls = "A_LOCAL_C_DIFFERENT";
    else if (cc?.target.where === "local") cls = cc.target.node ? "A_UNRESOLVED_C_LOCAL_NODE" : "A_UNRESOLVED_C_LOCAL_NON_NODE";
    else cls = `A_${a.target.where.toUpperCase().replace("-", "_")}_C_${(cc?.target.where ?? "missing").toUpperCase().replace("-", "_")}`;
    // the executed function (guide §4.1) can be known from the signature even when the callee symbol
    // is a plain variable: flag calls whose corpus-local signature exists only in C (or changes)
    const localSig = (sg) => sg && !sg.file.startsWith("node_modules/") && !sg.file.includes("/node_modules/") && !/typescript\/lib\//.test(sg.file);
    let sigCls = null;
    if (["call-callee", "new-callee", "decorator-callee", "jsx-tag"].includes(a.role)) {
      if (!a.signature && localSig(cc?.signature)) sigCls = "C_ONLY_LOCAL_SIGNATURE";
      else if (localSig(a.signature) && JSON.stringify(a.signature) !== JSON.stringify(cc?.signature)) sigCls = "LOCAL_SIGNATURE_CHANGED";
    }
    rows.push({ key, text: a.text, role: a.role, cls, sigCls, a: a.target, c: cc?.target, aSignature: a.signature, cSignature: cc?.signature });
  }

  // GT targets under C
  const nodes = new Map(gt.nodes.map((n) => [n.id, n]));
  const targetSpec = (n) => (n.type === "lib" ? `lib:${n.symbol}` : ["callable", "class", "typeLike", "external"].includes(n.type) ? `local:${n.file}:${n.line}` : null);
  const gtCheck = [];
  for (const r of gt.relations.filter((x) => x.gtStatus === "determinate" && ["calls", "constructs", "references", "dataflow"].includes(x.kind))) {
    const n = nodes.get(r.target);
    const want = n ? targetSpec(n) : null;
    if (!want) continue;
    const lines = new Set((r.evidence ?? []).map((e) => Number(e.split(":").pop())));
    const hits = rows.filter((x) => lines.has(Number(x.key.split(":")[0])) && spec(x.a) === want);
    const status = hits.length === 0 ? "NOT_LOCATED_IN_A" : hits.every((h) => spec(h.c ?? { where: "missing" }) === want) ? "CONFIRMED_IN_C" : hits.some((h) => spec(h.c ?? { where: "missing" }) === want) ? "PARTLY_CONFIRMED" : "CHANGED_IN_C";
    const sigChanged = r.kind === "dataflow" && hits.some((h) => h.aSignature && h.cSignature && h.aSignature.params !== h.cSignature.params);
    gtCheck.push({ id: r.id, kind: r.kind, pattern: r.pattern, target: r.target, want, status, sites: hits.map((h) => h.key), cTargets: [...new Set(hits.map((h) => spec(h.c ?? { where: "missing" })))], ...(sigChanged ? { signatureParamsChanged: true } : {}) });
  }

  // framework APIs behind synthetic GT nodes: does C resolve the API to the framework package?
  const fwPkg = { react: /^(react|@types\/react)$/, vue: /^(vue|@vue\/)/, express: /^express/, nest: /^@nestjs\// };
  const synth = gt.nodes.filter((n) => n.type === "synthetic").map((n) => {
    const onLine = rows.filter((x) => x.key.startsWith(`${n.line}:`));
    const apiToken = (n.anchor ?? "").replace(/^@/, "").split(/[.(]/)[0];
    const api = onLine.find((x) => x.text === apiToken) ?? onLine.find((x) => x.c?.where === "package");
    return { id: n.id, role: n.role, anchor: n.anchor, apiIdentifier: api?.text ?? null, cResolution: api ? spec(api.c ?? { where: "missing" }) : null, frameworkPackageInC: api ? (api.c?.where === "package" && fwPkg[n.framework]?.test(api.c.pkg)) || (n.framework === "express" && api.c?.where === "local") : null };
  });

  const tally = {};
  for (const r of rows) tally[r.cls] = (tally[r.cls] ?? 0) + 1;
  return {
    caseId: c.caseId,
    framework: c.framework,
    sites: rows.length,
    activeFileDiagnostics: { A: A.activeDiagnostics.length, C: C.activeDiagnostics.length, cCodes: C.activeDiagnostics },
    byClass: tally,
    localCallSites: rows.filter((r) => ["call-callee", "new-callee", "decorator-callee"].includes(r.role) && r.a.where === "local").length,
    localCallSitesSameSignature: rows.filter((r) => ["call-callee", "new-callee", "decorator-callee"].includes(r.role) && r.a.where === "local" && r.cls === "SAME" && JSON.stringify(r.aSignature) === JSON.stringify(r.cSignature)).length,
    sitesOnLines: (lines) => rows.filter((r) => lines.includes(Number(r.key.split(":")[0]))),
    signatureOnlyInC: rows.filter((r) => r.sigCls).map((r) => ({ key: r.key, text: r.text, role: r.role, sigCls: r.sigCls, symbolClass: r.cls, a: spec(r.a), cSignature: r.cSignature })),
    critical: rows.filter((r) => ["A_LOCAL_C_DIFFERENT", "A_UNRESOLVED_C_LOCAL_NODE", "SAME_TARGET_DIFFERENT_SIGNATURE"].includes(r.cls)),
    // sites with no corpus declaration in A that C resolves to a dependency: the scope Corpus B leaves out (A2)
    externalInC: {
      byRole: count(rows.filter((r) => ["A_NONE_C_PACKAGE", "A_SHIM_C_PACKAGE"].includes(r.cls)), (r) => r.role),
      byPackage: count(rows.filter((r) => ["A_NONE_C_PACKAGE", "A_SHIM_C_PACKAGE"].includes(r.cls)), (r) => r.c.pkg),
    },
    otherChanges: rows.filter((r) => !["SAME", "A_NONE_C_PACKAGE", "A_SHIM_C_PACKAGE", "A_UNRESOLVED_C_LOCAL_NON_NODE", "A_LOCAL_C_DIFFERENT", "A_UNRESOLVED_C_LOCAL_NODE", "SAME_TARGET_DIFFERENT_SIGNATURE"].includes(r.cls)).map((r) => ({ key: r.key, text: r.text, role: r.role, cls: r.cls, a: spec(r.a), c: spec(r.c ?? { where: "missing" }) })),
    unresolvedToLocalNonNode: rows.filter((r) => r.cls === "A_UNRESOLVED_C_LOCAL_NON_NODE").map((r) => ({ key: r.key, text: r.text, role: r.role, c: `${r.c.file}:${r.c.line} ${r.c.declKind}` })),
    gtTargets: gtCheck,
    syntheticNodes: synth,
  };
}

function main() {
  const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
  const upstreamRoot = path.resolve(arg("--upstream"));
  const out = path.resolve(arg("--out"));
  if (fs.existsSync(out)) throw new Error(`${out} exists; refusing to overwrite`);
  const lf = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const env = Object.fromEntries(["react", "vue", "express", "nest"].map((fw) => [fw, { lockfile: LOCKFILE[fw], lockfileSha256: lf(path.join(upstreamRoot, fw, LOCKFILE[fw])) }]));
  const cases = listCases(corpus).map((c) => compareCase(c, upstreamRoot));
  const result = { schema: COMPARE_VERSION, exploratory: true, note: "Exploratory, read-only comparison. Not the frozen Corpus B environment; not used for any GT change or accuracy measure.", typescript: ts.version, upstreamEnvironment: env, cases };
  fs.writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
  for (const c of cases) {
    const g = {};
    for (const x of c.gtTargets) g[x.status] = (g[x.status] ?? 0) + 1;
    console.log(`${c.caseId}: sites ${c.sites}, critical ${c.critical.length}, gt ${JSON.stringify(g)}, classes ${JSON.stringify(c.byClass)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
