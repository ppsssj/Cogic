#!/usr/bin/env node
// Corpus B (P1-K1) GT authoring aid. NOT Ground Truth by itself and NOT Cogic.
//
// Uses only the TypeScript checker on one case workspace and applies the EXP-01 ANNOTATION_GUIDE
// rules (§2 nodes, §3 owners, §4 relations, §5 framework semantics) to propose a *draft*
// expected.json plus a per-site listing. Every draft is reviewed by hand against the source before it
// is saved as expected.json; corrections are recorded in the case notes. The Cogic analyzer is never
// imported or executed.
//
// Usage: node annotate-assist.mjs --case <case dir> [--draft <out.json>] [--listing <out.txt>]

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const REACT_STATE = new Set(["useState", "useReducer"]);
const REACT_CALLBACK = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect", "useMemo", "useCallback"]);
const VUE_STATE = new Set(["ref", "shallowRef", "customRef", "reactive", "shallowReactive"]);
const VUE_STATE_SUPPORTED = new Set(["ref", "reactive"]);
const VUE_LIFECYCLE = /^on(BeforeMount|Mounted|BeforeUpdate|Updated|BeforeUnmount|Unmounted|Activated|Deactivated|ErrorCaptured|RenderTracked|RenderTriggered|ServerPrefetch)$/;
const EXPRESS_ROUTE = new Set(["use", "get", "post", "put", "patch", "delete", "options", "head", "all"]);
const NEST_ROUTE = new Set(["Get", "Post", "Put", "Patch", "Delete", "Options", "Head", "All"]);

export function assist(caseDir) {
  const caseJson = JSON.parse(fs.readFileSync(path.join(caseDir, "case.json"), "utf8"));
  const raw = ts.readConfigFile(path.join(caseDir, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, caseDir);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const activeAbs = path.resolve(caseDir, caseJson.activeFile);
  const sf = program.getSourceFiles().find((s) => path.resolve(s.fileName) === activeAbs);
  if (!sf) throw new Error(`active file not in program: ${caseJson.activeFile}`);
  const rel = (f) => path.relative(caseDir, f).split(path.sep).join("/");
  const lineOf = (node, file = node.getSourceFile()) => file.getLineAndCharacterOfPosition(node.getStart(file, false)).line + 1;
  const isLibFile = (f) => program.isSourceFileDefaultLibrary(program.getSourceFile(f)) || /node_modules[\\/]typescript[\\/]lib/.test(f);
  const isFnInit = (n) => n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));

  // ---------------------------------------------------------------- nodes
  const nodes = new Map(); // id -> node
  const nodeIdByDecl = new Map(); // ts.Node (declaration) -> id
  const used = new Set();
  const addNode = (n) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
    return n.id;
  };
  addNode({ id: "file", type: "file", file: caseJson.activeFile });
  let counter = 0;
  const safe = (s) => String(s).replace(/[^A-Za-z0-9_$]/g, "_");

  // §2 classification of a declaration (any file). Returns {type, name, anchorNode} or null.
  const classifyDecl = (d) => {
    if (!d) return null;
    if (ts.isFunctionDeclaration(d) && d.name) return d.body || d.getSourceFile().isDeclarationFile || ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Ambient ? { type: "callable", name: d.name.text, at: d } : null;
    if (ts.isMethodDeclaration(d) && (ts.isIdentifier(d.name) || ts.isStringLiteral(d.name) || ts.isPrivateIdentifier(d.name))) return { type: "callable", name: d.name.text, at: d, bodyless: !d.body };
    if (ts.isMethodSignature(d) && ts.isIdentifier(d.name)) return { type: "callable", name: d.name.text, at: d, signature: true };
    if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && isFnInit(d.initializer)) return { type: "callable", name: d.name.text, at: d.initializer };
    if ((ts.isPropertyAssignment(d) || ts.isPropertyDeclaration(d)) && isFnInit(d.initializer) && d.name && (ts.isIdentifier(d.name) || ts.isStringLiteral(d.name))) return { type: "callable", name: d.name.text, at: d.initializer };
    if (ts.isClassDeclaration(d) && d.name) return { type: "class", name: d.name.text, at: d };
    if ((ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isEnumDeclaration(d)) && d.name) return { type: "typeLike", name: d.name.text, at: d };
    return null;
  };

  // Node id for a declaration, creating local / external / lib nodes. null = not a §2 node.
  const nodeForDecl = (d) => {
    const c = classifyDecl(d);
    if (!c) return null;
    if (c.signature && d.getSourceFile() === sf) return null; // interface method signatures in the active file are not nodes
    const f = d.getSourceFile().fileName;
    if (nodeIdByDecl.has(c.at)) return nodeIdByDecl.get(c.at);
    let n;
    if (isLibFile(f)) {
      const parent = d.parent && (ts.isInterfaceDeclaration(d.parent) || ts.isClassDeclaration(d.parent)) && d.parent.name ? `${d.parent.name.text.replace(/Constructor$/, "")}.` : "";
      n = { id: `lib_${safe(parent + c.name)}`, type: "lib", symbol: `${parent}${c.name}` };
    } else if (path.resolve(f) === activeAbs) {
      n = { id: `${c.type === "class" ? "C" : c.type === "typeLike" ? "T" : "F"}_${safe(c.name)}_${lineOf(c.at)}`, type: c.type, file: caseJson.activeFile, line: lineOf(c.at), name: c.name };
    } else {
      n = { id: `X_${safe(c.name)}_${safe(path.basename(f))}_${lineOf(c.at)}`, type: "external", file: rel(f), line: lineOf(c.at), name: c.name };
    }
    nodeIdByDecl.set(c.at, addNode(n));
    return n.id;
  };

  const aliasTarget = (sym) => (sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym);
  const declsOf = (sym) => aliasTarget(sym)?.declarations ?? [];
  const isUnknown = (sym) => !sym || aliasTarget(sym) === checker.getUnknownSymbol?.() || declsOf(sym).length === 0;

  // module a local identifier was imported from (or null)
  const importModuleOf = (id) => {
    const sym = checker.getSymbolAtLocation(id);
    const d = sym?.declarations?.[0];
    let n = d;
    while (n && !ts.isImportDeclaration(n)) n = n.parent;
    return n && ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier.text : null;
  };
  // framework API name of a callee expression: { module, name } (supports alias and namespace import)
  const frameworkApi = (expr) => {
    if (ts.isIdentifier(expr)) {
      const sym = checker.getSymbolAtLocation(expr);
      const d = sym?.declarations?.[0];
      const mod = importModuleOf(expr);
      if (!mod) return null;
      const name = d && ts.isImportSpecifier(d) ? (d.propertyName ?? d.name).text : expr.text;
      return { module: mod, name, viaAlias: d && ts.isImportSpecifier(d) && !!d.propertyName };
    }
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
      const mod = importModuleOf(expr.expression);
      return mod ? { module: mod, name: expr.name.text, viaNamespace: true } : null;
    }
    return null;
  };

  // ---------------------------------------------------------------- framework synthetic nodes
  const synthetic = new Map(); // ts.Node -> id
  const addSynthetic = (anchorNode, framework, role, anchor, note) => {
    if (synthetic.has(anchorNode)) return synthetic.get(anchorNode);
    const line = lineOf(anchorNode);
    const id = addNode({ id: `S_${framework}_${role.replace(/-/g, "_")}_${line}_${++counter}`, type: "synthetic", file: caseJson.activeFile, line, framework, role, anchor, note });
    synthetic.set(anchorNode, id);
    return id;
  };
  const callbackOwnerFor = new Map(); // function node -> synthetic id (inline framework callbacks)
  const stateSourceByBinding = new Map(); // declaration node of state/setter binding -> {id, setter, kind}
  const relations = [];
  const negatives = [];
  const excludedSites = [];
  const listing = [];
  const fwEvidence = [];

  const expressValues = new Set(); // declarations of express app/router values
  const isExpressFactory = (call) => {
    if (!ts.isCallExpression(call)) return false;
    const api = frameworkApi(call.expression);
    if (api?.module === "express") return api.viaNamespace ? api.name === "Router" : true; // express() or Router()
    // default import `express` called directly
    if (ts.isIdentifier(call.expression) && importModuleOf(call.expression) === "express") return true;
    if (ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression) && importModuleOf(call.expression.expression) === "express" && call.expression.name.text === "Router") return true;
    return false;
  };
  const isExpressValue = (expr) => {
    if (ts.isCallExpression(expr) && isExpressFactory(expr)) return true;
    if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === "route") return isExpressValue(expr.expression.expression);
    if (ts.isIdentifier(expr)) {
      for (const d of declsOf(checker.getSymbolAtLocation(expr))) {
        if (ts.isVariableDeclaration(d) && d.initializer && isExpressValue(d.initializer)) return true;
      }
    }
    return false;
  };

  const visitFw = (node) => {
    if (ts.isCallExpression(node)) {
      const api = frameworkApi(node.expression);
      if (api?.module === "react" && REACT_STATE.has(api.name)) {
        const vd = node.parent;
        const id = addSynthetic(node, "react", "state-source", api.viaNamespace ? `.${api.name}` : ts.isIdentifier(node.expression) ? node.expression.text : api.name);
        fwEvidence.push({ id, pattern: api.viaAlias ? "FW-REACT-ALIAS-IMPORT" : api.viaNamespace ? "FW-REACT-NAMESPACE-IMPORT" : "FW-REACT-STATE-SOURCE", line: lineOf(node) });
        if (ts.isVariableDeclaration(vd) && ts.isArrayBindingPattern(vd.name)) {
          const [st, setter] = vd.name.elements;
          if (st && ts.isBindingElement(st)) stateSourceByBinding.set(st, { id, setter: false, hook: api.name });
          if (setter && ts.isBindingElement(setter)) stateSourceByBinding.set(setter, { id, setter: true, hook: api.name });
        }
        if (api.name === "useReducer" && node.arguments[0]) fwEvidence.push({ id, reducerArg: node.arguments[0], line: lineOf(node) });
      } else if (api?.module === "react" && REACT_CALLBACK.has(api.name) && node.arguments[0]) {
        const a = node.arguments[0];
        if (isFnInit(a)) {
          const id = addSynthetic(a, "react", "callback-owner", firstToken(a), `${api.name} callback`);
          callbackOwnerFor.set(a, id);
          fwEvidence.push({ id, pattern: api.viaAlias ? "FW-REACT-ALIAS-IMPORT" : api.viaNamespace ? "FW-REACT-NAMESPACE-IMPORT" : "FW-REACT-CALLBACK-INLINE", line: lineOf(a) });
        } else {
          const id = addSynthetic(node, "react", "callback-owner", api.name, `${api.name} named callback`);
          fwEvidence.push({ id, pattern: "FW-REACT-CALLBACK-NAMED", namedArg: a, line: lineOf(node) });
        }
      } else if (api?.module === "vue" && VUE_STATE.has(api.name)) {
        const vd = node.parent;
        const id = addSynthetic(node, "vue", "state-source", api.viaNamespace ? `.${api.name}` : ts.isIdentifier(node.expression) ? node.expression.text : api.name);
        fwEvidence.push({ id, pattern: VUE_STATE_SUPPORTED.has(api.name) ? (api.viaNamespace ? "FW-VUE-NAMESPACE-IMPORT" : "FW-VUE-STATE-SOURCE") : "FW-VUE-STATE-UNSUPPORTED", line: lineOf(node), unsupported: !VUE_STATE_SUPPORTED.has(api.name) });
        if (ts.isVariableDeclaration(vd)) stateSourceByBinding.set(vd, { id, vue: true, hook: api.name, unsupported: !VUE_STATE_SUPPORTED.has(api.name) });
      } else if (api?.module === "vue" && (api.name === "computed" || api.name === "watchEffect" || api.name === "watchPostEffect" || api.name === "watchSyncEffect" || api.name === "watch" || VUE_LIFECYCLE.test(api.name))) {
        const a = api.name === "watch" ? node.arguments[1] : node.arguments[0];
        if (a && isFnInit(a)) {
          const lifecycle = VUE_LIFECYCLE.test(api.name);
          const id = addSynthetic(a, "vue", "callback-owner", firstToken(a), `${api.name} callback`);
          callbackOwnerFor.set(a, id);
          fwEvidence.push({ id, pattern: lifecycle ? "FW-VUE-LIFECYCLE" : api.viaNamespace ? "FW-VUE-NAMESPACE-IMPORT" : "FW-VUE-CALLBACK", line: lineOf(a), unsupported: lifecycle });
        }
      } else if (ts.isPropertyAccessExpression(node.expression) && EXPRESS_ROUTE.has(node.expression.name.text) && isExpressValue(node.expression.expression)) {
        const args = node.arguments;
        const fnArgs = args.filter((a) => isFnInit(a) || ts.isIdentifier(a) || ts.isPropertyAccessExpression(a) || ts.isCallExpression(a));
        const isRoute = node.expression.name.text === "use" ? args.length >= 1 : args.length >= 2;
        if (isRoute) {
          const inline = args.filter(isFnInit);
          const anchorNode = inline.length === 1 && args.filter((a) => !ts.isStringLiteralLike(a)).length === 1 ? inline[0] : node;
          const id = addSynthetic(anchorNode, "express", "route-owner", anchorNode === node ? `.${node.expression.name.text}` : firstToken(anchorNode), `${node.expression.getText(sf)} route`);
          if (anchorNode !== node) callbackOwnerFor.set(anchorNode, id);
          fwEvidence.push({ id, pattern: "FW-EXPRESS-ROUTER", line: lineOf(node), handlers: fnArgs, registration: node });
        }
      }
    }
    if (ts.isClassDeclaration(node) && node.name) {
      const isController = (ts.getDecorators(node) ?? []).some((dec) => {
        const e = ts.isCallExpression(dec.expression) ? dec.expression.expression : dec.expression;
        const api = frameworkApi(e);
        return api?.module === "@nestjs/common" && api.name === "Controller";
      });
      if (isController) {
        for (const m of node.members) {
          if (!ts.isMethodDeclaration(m) || !m.body) continue;
          const route = (ts.getDecorators(m) ?? []).find((dec) => {
            const e = ts.isCallExpression(dec.expression) ? dec.expression.expression : dec.expression;
            const api = frameworkApi(e);
            return api?.module === "@nestjs/common" && NEST_ROUTE.has(api.name);
          });
          if (route) {
            const id = addSynthetic(m, "nest", "route-owner", `@${(ts.isCallExpression(route.expression) ? route.expression.expression : route.expression).getText(sf)}`, `${node.name.text}.${m.name.getText(sf)} route`);
            fwEvidence.push({ id, pattern: "FW-NEST-ROUTE", line: lineOf(m), method: m });
          }
        }
      }
    }
    ts.forEachChild(node, visitFw);
  };
  function firstToken(fn) {
    return fn.getText(sf).split("\n")[0].slice(0, 12).trim();
  }
  visitFw(sf);

  // ---------------------------------------------------------------- owners (§3)
  const ownerOf = (node) => {
    const r = ownerOfInner(node);
    // crossed an anonymous (transparent) function expression before reaching the owner? (§3.3)
    let anon = false;
    for (let n = node.parent; n; n = n.parent) {
      if (callbackOwnerFor.has(n)) break;
      if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && !classifyDecl(n.parent)) {
        anon = true;
        break;
      }
      if (ts.isFunctionLike(n) || ts.isClassLike(n) || ts.isSourceFile(n)) break;
    }
    return { ...r, anon };
  };
  const ownerOfInner = (node) => {
    let n = node;
    let prev = null;
    while (n) {
      if (callbackOwnerFor.has(n)) return { id: callbackOwnerFor.get(n), via: "framework" };
      if (ts.isDecorator(n)) {
        // §3.4: decorators run outside the decorated declaration; continue from the enclosing class's parent
        let c = n.parent;
        while (c && !ts.isClassLike(c)) c = c.parent;
        n = c ? c.parent : n.parent;
        prev = null;
        continue;
      }
      if (n !== node || !ts.isFunctionLike(n)) {
        const c = classifyDecl(n) ?? (ts.isArrowFunction(n) || ts.isFunctionExpression(n) ? classifyDecl(n.parent) : null);
        if (c && (c.at === n) && c.type !== "typeLike" && !(ts.isMethodDeclaration(n) && !n.body)) {
          const id = nodeForDecl(ts.isArrowFunction(n) || ts.isFunctionExpression(n) ? n.parent : n);
          if (id) return { id, via: c.type };
        }
        if ((ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n)) && n.name) return { id: nodeForDecl(n), via: "typeLike" };
      }
      if (ts.isPropertyDeclaration(n) && prev === n.initializer && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) {
        // static field initializer: evaluated at class definition, like a decorator (judged per case)
        let c = n.parent;
        n = c.parent;
        prev = c;
        continue;
      }
      if (ts.isSourceFile(n)) return { id: "file", via: "file" };
      prev = n;
      n = n.parent;
    }
    return { id: "file", via: "file" };
  };

  // ---------------------------------------------------------------- relations (§4)
  let rid = 0;
  let iid = 0;
  const addRel = (r) => {
    used.add(r.source);
    if (r.target) used.add(r.target);
    const key = r.gtStatus === "indeterminate" ? `I|${r.kind}|${r.source}|${r.evidence[0]}` : `${r.kind}|${r.source}|${r.target ?? ""}|${r.argIndex ?? ""}`;
    const existing = relations.find((x) => x.key === key);
    if (existing) {
      for (const e of r.evidence) if (!existing.evidence.includes(e)) existing.evidence.push(e);
      return existing;
    }
    const out = { key, id: r.gtStatus === "indeterminate" ? `I${String(++iid).padStart(2, "0")}` : `R${String(++rid).padStart(2, "0")}`, ...r };
    relations.push(out);
    return out;
  };
  const ev = (node) => `${caseJson.activeFile}:${lineOf(node, sf)}`;
  const cited = new Set();

  const declForCall = (call) => {
    const sig = checker.getResolvedSignature(call);
    const sd = sig?.getDeclaration();
    const sym = checker.getSymbolAtLocation(ts.isCallExpression(call) || ts.isNewExpression(call) ? call.expression : call);
    return { sig, sd, sym };
  };

  const targetForCallee = (call) => {
    const expr = call.expression;
    const { sd, sym } = declForCall(call);
    // explicit `fn.call/apply/bind` handled as lib target plus note (ambiguous) by the reviewer
    const decls = declsOf(sym);
    if (decls.length > 0 && decls.every((x) => ts.isParameter(x) || (ts.isBindingElement(x) && ts.isParameter(x.parent?.parent)))) {
      return { id: null, indeterminate: "CALL-PARAM-CALLBACK", reason: "callee is a parameter: any caller-supplied function (unbounded)" };
    }
    if (decls.length > 0 && decls.every((x) => (ts.isMethodSignature(x) || ts.isPropertySignature(x)) && !isLibFile(x.getSourceFile().fileName))) {
      return { id: null, indeterminate: "CALL-INTERFACE-DISPATCH", reason: "callee is an interface/type member signature: implementation chosen at run time (structural typing, unbounded)" };
    }
    // prefer the implementation / declaration of the callee symbol (overloads -> implementation)
    let d = decls.find((x) => (ts.isFunctionDeclaration(x) || ts.isMethodDeclaration(x)) && x.body) ?? decls.find((x) => classifyDecl(x)) ?? (sd && classifyDecl(sd) ? sd : null);
    if (!d && sd && (ts.isFunctionExpression(sd) || ts.isArrowFunction(sd))) d = sd.parent;
    if (!d) return { id: null, reason: isUnknown(sym) ? "callee has no declaration in the corpus (third-party untyped or any)" : `callee declaration is not a §2 node (${decls.map((x) => ts.SyntaxKind[x.kind]).join(",") || "none"})`, sd };
    const id = nodeForDecl(d);
    return { id, decl: d, sd, reason: id ? null : `callee declaration is not a §2 node (${ts.SyntaxKind[d.kind]})` };
  };

  const paramsOf = (sd) => (sd && "parameters" in sd ? sd.parameters : null);
  const addDataflow = (owner, target, call, sd, pattern, siteNode) => {
    const params = paramsOf(sd);
    if (!params) return;
    const args = call.arguments ?? [];
    const seen = new Set();
    args.forEach((a, i) => {
      if (ts.isSpreadElement(a)) {
        listing.push(`  ! spread argument at ${ev(a)}: decide DF-SPREAD-* by hand`);
        return;
      }
      const restIdx = params.findIndex((p) => p.dotDotDotToken);
      const pi = restIdx >= 0 && i >= restIdx ? restIdx : i;
      if (pi >= params.length) return;
      if (seen.has(pi)) return;
      seen.add(pi);
      addRel({ kind: "dataflow", source: owner, target, argIndex: pi, pattern: restIdx >= 0 && i >= restIdx ? "DF-REST-PARAM" : pattern, gtStatus: "determinate", evidence: [ev(siteNode)] });
    });
  };

  const patternForCall = (owner, ownerVia, targetNode, call, anon = false) => {
    const t = nodes.get(targetNode);
    if (t.type === "lib") return "CALL-LIB";
    if (ownerVia === "class") return "CALL-CTOR-BODY";
    if (anon) return "CALL-IN-ANON-CALLBACK";
    // owner position before target form (ANNOTATION_ADDENDUM A4; EXP-01 e03/h03: imported callee at top level)
    if (owner === "file") return "CALL-TOPLEVEL";
    if (t.type === "external") {
      if (ts.isPropertyAccessExpression(call.expression)) return "CALL-METHOD-EXTERNAL";
      const imp = ts.isIdentifier(call.expression) ? checker.getSymbolAtLocation(call.expression)?.declarations?.[0] : null;
      if (imp && ts.isImportClause(imp)) return "CALL-IMPORT-DEFAULT";
      return "CALL-IMPORT-NAMED";
    }
    if (ts.isPropertyAccessExpression(call.expression)) {
      if (call.expression.expression.kind === ts.SyntaxKind.ThisKeyword) return "CALL-METHOD-THIS";
      return "CALL-METHOD-INSTANCE";
    }
    if (owner === "file") return "CALL-TOPLEVEL";
    return "CALL-LOCAL-FN";
  };

  const visitRel = (node) => {
    // calls / dataflow
    if (ts.isCallExpression(node) && node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
      const owner = ownerOf(node);
      const isSuperCall = node.expression.kind === ts.SyntaxKind.SuperKeyword;
      const setter = setterBindingOf(node.expression);
      if (setter) {
        addRel({ kind: "updates", source: owner.id, target: setter.id, pattern: setter.hook === "useReducer" ? "UPD-REACT-DISPATCH" : node.arguments[0] && isFnInit(node.arguments[0]) ? "UPD-REACT-SETTER-FN" : "UPD-REACT-SETTER", gtStatus: "determinate", evidence: [ev(node)] });
        cited.add(lineOf(node));
        listing.push(`${ev(node)} updates ${owner.id} -> ${setter.id} (${node.getText(sf).split("\n")[0].slice(0, 60)})`);
      } else if (!isSuperCall) {
        const t = targetForCallee(node);
        if (t.id) {
          const pattern = patternForCall(owner.id, owner.via, t.id, node, owner.anon);
          addRel({ kind: "calls", source: owner.id, target: t.id, pattern, gtStatus: "determinate", evidence: [ev(node)] });
          const dfPattern = nodes.get(t.id).type === "lib" ? "DF-LIB" : owner.via === "class" ? "DF-CTOR-BODY" : nodes.get(t.id).type === "external" ? "DF-EXTERNAL" : "DF-POSITIONAL";
          addDataflow(owner.id, t.id, node, t.sd ?? t.decl, dfPattern, node);
          cited.add(lineOf(node));
          listing.push(`${ev(node)} calls ${owner.id} -> ${t.id} [${pattern}] (${node.getText(sf).split("\n")[0].slice(0, 60)})`);
        } else if (t.indeterminate) {
          addRel({ kind: "calls", source: owner.id, candidates: "unbounded", pattern: t.indeterminate, gtStatus: "indeterminate", evidence: [ev(node)], reason: t.reason });
          if (node.arguments.length > 0) {
            addRel({ kind: "dataflow", source: owner.id, candidates: "unbounded", pattern: "DF-INDIRECT", gtStatus: "indeterminate", evidence: [ev(node)], reason: "call target is indeterminate, so is the receiving parameter (guide §4.5)" });
          }
          cited.add(lineOf(node));
          listing.push(`${ev(node)} INDETERMINATE ${t.indeterminate} ${owner.id} (${node.getText(sf).split("\n")[0].slice(0, 60)})`);
        } else {
          excludedSites.push({ site: ev(node), reason: `NO_NODE_TARGET: ${t.reason}`, text: node.getText(sf).split("\n")[0].slice(0, 80) });
          listing.push(`${ev(node)} (no target) ${node.getText(sf).split("\n")[0].slice(0, 60)} -- ${t.reason}`);
        }
      } else {
        listing.push(`${ev(node)} super(...) call: decide by hand`);
      }
    }
    if (ts.isNewExpression(node)) {
      const owner = ownerOf(node);
      const sym = aliasTarget(checker.getSymbolAtLocation(node.expression));
      const cls = sym?.declarations?.find(ts.isClassDeclaration);
      if (cls) {
        const id = nodeForDecl(cls);
        const sd = checker.getResolvedSignature(node)?.getDeclaration();
        const t = nodes.get(id);
        void t;
        const explicit = !!(sd && ts.isConstructorDeclaration(sd));
        const inherited = explicit && sd.parent !== cls;
        const pattern = t.type === "lib" ? "CONS-LIB" : owner.via === "class" ? "CONS-CTOR-BODY" : owner.anon ? "CONS-IN-ANON-CALLBACK" : owner.id === "file" ? "CONS-TOPLEVEL" : inherited ? "CONS-INHERITED-CTOR" : t.type === "external" ? (explicit ? "CONS-IMPORTED-EXPLICIT-CTOR" : "CONS-IMPORTED-IMPLICIT-CTOR") : explicit ? "CONS-LOCAL-EXPLICIT-CTOR" : "CONS-LOCAL-IMPLICIT-CTOR";
        addRel({ kind: "constructs", source: owner.id, target: id, pattern, gtStatus: "determinate", evidence: [ev(node)] });
        if (sd && (ts.isConstructorDeclaration(sd) || ts.isConstructSignatureDeclaration(sd))) addDataflow(owner.id, id, node, sd, t.type === "lib" ? "DF-LIB" : "DF-CONSTRUCTOR", node);
        cited.add(lineOf(node));
        listing.push(`${ev(node)} constructs ${owner.id} -> ${id} [${pattern}] (check implicit/explicit ctor)`);
      } else {
        const libDecl = sym?.declarations?.find((d) => isLibFile(d.getSourceFile().fileName));
        if (libDecl) {
          const lid = addNode({ id: `lib_${safe(sym.name)}`, type: "lib", symbol: sym.name });
          addRel({ kind: "constructs", source: owner.id, target: lid, pattern: "CONS-LIB", gtStatus: "determinate", evidence: [ev(node)] });
          addDataflow(owner.id, lid, node, checker.getResolvedSignature(node)?.getDeclaration(), "DF-LIB", node);
          cited.add(lineOf(node));
          listing.push(`${ev(node)} constructs ${owner.id} -> ${lid} [CONS-LIB]`);
        } else {
          excludedSites.push({ site: ev(node), reason: "NO_NODE_TARGET: constructed class has no declaration in the corpus", text: node.getText(sf).split("\n")[0].slice(0, 80) });
          listing.push(`${ev(node)} (no target) new ${node.expression.getText(sf)}`);
        }
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const owner = ownerOf(node);
      const tag = node.tagName;
      if (ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) {
        excludedSites.push({ site: ev(node), reason: "JSX_INTRINSIC: intrinsic element is not a call (guide §4.1)", text: `<${tag.text}>` });
      } else {
        const sym = aliasTarget(checker.getSymbolAtLocation(tag));
        const d = sym?.declarations?.find((x) => classifyDecl(x));
        const id = d ? nodeForDecl(d) : null;
        if (id) {
          addRel({ kind: "calls", source: owner.id, target: id, pattern: owner.anon ? "CALL-IN-ANON-CALLBACK" : nodes.get(id).type === "external" ? "CALL-JSX-IMPORT" : "CALL-JSX-LOCAL", gtStatus: "determinate", evidence: [ev(node)] });
          cited.add(lineOf(node));
          listing.push(`${ev(node)} calls(jsx) ${owner.id} -> ${id}`);
        } else {
          excludedSites.push({ site: ev(node), reason: "NO_NODE_TARGET: JSX component has no declaration in the corpus (third-party untyped) or is not a §2 node", text: `<${tag.getText(sf)}>` });
          listing.push(`${ev(node)} (no target) <${tag.getText(sf)}>`);
        }
      }
    }
    // references
    if (ts.isIdentifier(node) && !isDeclName(node) && !isCalleeOrTag(node) && !isImportExportSpecifier(node)) {
      const owner = ownerOf(node);
      let sym;
      if (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node) sym = checker.getShorthandAssignmentValueSymbol(node.parent);
      else sym = checker.getSymbolAtLocation(node);
      const decls = declsOf(sym);
      const stateDecl = decls.find((d) => stateSourceByBinding.has(d));
      if (stateDecl) {
        const s = stateSourceByBinding.get(stateDecl);
        const write = s.vue && isVueValueWrite(node);
        const shorthand = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node;
        addRel({ kind: "references", source: owner.id, target: s.id, pattern: s.unsupported ? "REF-UNSUPPORTED-STATE" : owner.anon ? "REF-IN-ANON-CALLBACK" : owner.id === "file" ? "REF-TOPLEVEL" : shorthand ? "REF-SHORTHAND-PROPERTY" : s.setter ? "REF-STATE-SETTER-VALUE" : write ? "REF-STATE-WRITE" : "REF-STATE-READ", gtStatus: "determinate", evidence: [ev(node)] });
        if (write) addRel({ kind: "updates", source: owner.id, target: s.id, pattern: s.unsupported ? "UPD-UNSUPPORTED-STATE" : ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === "value" ? "UPD-VUE-REF" : "UPD-VUE-REACTIVE-PROP", gtStatus: "determinate", evidence: [ev(node)] });
        listing.push(`${ev(node)} references ${owner.id} -> ${s.id} (state ${node.text}${write ? ", write" : ""})`);
      } else {
        const d = decls.find((x) => classifyDecl(x));
        const id = d ? nodeForDecl(d) : null;
        if (id && nodes.get(id).type === "lib" && isReceiver(node)) {
          // EXP-01 precedent (c07 Math.max): a lib global used only as a member-access receiver is not annotated
          listing.push(`${ev(node)} lib receiver ${node.text} (not annotated, EXP-01 c07)`);
        } else if (id && id !== owner.id) {
          const t = nodes.get(id);
          const pattern = t.type === "lib" ? "REF-LIB" : t.type === "external" ? "REF-CROSS-FILE" : owner.anon ? "REF-IN-ANON-CALLBACK" : owner.id === "file" ? "REF-TOPLEVEL" : isTypePosition(node) ? "REF-TYPE-ANNOTATION" : ts.isShorthandPropertyAssignment(node.parent) ? "REF-SHORTHAND-PROPERTY" : isReceiver(node) ? "REF-RECEIVER" : "REF-VALUE-FN";
          addRel({ kind: "references", source: owner.id, target: id, pattern, gtStatus: "determinate", evidence: [ev(node)] });
          listing.push(`${ev(node)} references ${owner.id} -> ${id} [${pattern}] (${node.text})`);
        } else if (id === owner.id) {
          listing.push(`${ev(node)} self reference ${node.text} (excluded)`);
        }
      }
    }
    ts.forEachChild(node, visitRel);
  };

  function setterBindingOf(expr) {
    if (!ts.isIdentifier(expr)) return null;
    for (const d of declsOf(checker.getSymbolAtLocation(expr))) {
      const s = stateSourceByBinding.get(d);
      if (s && s.setter) return s;
    }
    return null;
  }
  function isVueValueWrite(id) {
    let e = id;
    while (ts.isPropertyAccessExpression(e.parent) && e.parent.expression === e) e = e.parent;
    if (e === id) return false;
    const p = e.parent;
    if (ts.isBinaryExpression(p) && p.left === e && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true;
    if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return true;
    return false;
  }
  function isDeclName(id) {
    const p = id.parent;
    if (!p) return false;
    if ((ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isEnumDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isBindingElement(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isPropertyAssignment(p) || ts.isEnumMember(p) || ts.isTypeParameterDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === id) return true;
    if (ts.isBindingElement(p) && p.propertyName === id) return true;
    if (ts.isPropertyAccessExpression(p) && p.name === id) {
      // member name: a reference only if it resolves to a method node and is not invoked (handled below)
      const inv = (ts.isCallExpression(p.parent) || ts.isNewExpression(p.parent)) && p.parent.expression === p;
      return inv;
    }
    if (ts.isQualifiedName(p) && p.right === id) return false;
    if (ts.isJsxAttribute(p) && p.name === id) return true;
    return false;
  }
  function isCalleeOrTag(id) {
    const p = id.parent;
    if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === id) return true;
    if ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) && p.tagName === id) return true;
    if (ts.isDecorator(p)) return true;
    return false;
  }
  function isImportExportSpecifier(id) {
    let p = id.parent;
    return ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isNamespaceExport(p) || ts.isImportEqualsDeclaration(p) || ts.isExternalModuleReference(p);
  }
  function isTypePosition(id) {
    let p = id.parent;
    while (p && (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isExpressionWithTypeArguments(p))) {
      if (ts.isTypeReferenceNode(p)) return true;
      p = p.parent;
    }
    return ts.isTypeNode(id.parent) || ts.isTypeReferenceNode(id.parent);
  }
  function isReceiver(id) {
    return ts.isPropertyAccessExpression(id.parent) && id.parent.expression === id;
  }

  visitRel(sf);

  // framework relations (§4.6, §5)
  for (const f of fwEvidence) {
    if (f.reducerArg) {
      const sym = ts.isIdentifier(f.reducerArg) ? checker.getSymbolAtLocation(f.reducerArg) : null;
      const d = declsOf(sym).find((x) => classifyDecl(x));
      const id = d ? nodeForDecl(d) : null;
      if (id) addRel({ kind: "references", source: f.id, target: id, pattern: "FW-REACT-REDUCER-BINDING", gtStatus: "determinate", evidence: [`${caseJson.activeFile}:${f.line}`] });
      continue;
    }
    addRel({ kind: "owner", source: f.id, pattern: f.pattern, gtStatus: "determinate", evidence: [`${caseJson.activeFile}:${f.line}`] });
    if (f.namedArg) {
      const d = declsOf(checker.getSymbolAtLocation(f.namedArg)).find((x) => classifyDecl(x));
      const id = d ? nodeForDecl(d) : null;
      if (id) addRel({ kind: "calls", source: f.id, target: id, pattern: "FW-REACT-NAMED-CALLBACK-CALL", gtStatus: "determinate", evidence: [`${caseJson.activeFile}:${f.line}`] });
    }
    if (f.handlers) {
      for (const h of f.handlers) {
        if (isFnInit(h)) continue; // inline handler is the owner itself (single) or an anonymous extra handler
        const sym = ts.isPropertyAccessExpression(h) ? checker.getSymbolAtLocation(h.name) : ts.isIdentifier(h) ? checker.getSymbolAtLocation(h) : null;
        const d = declsOf(sym).find((x) => classifyDecl(x));
        const id = d ? nodeForDecl(d) : null;
        if (id) addRel({ kind: "calls", source: f.id, target: id, pattern: "FW-EXPRESS-HANDLER-CALL", gtStatus: "determinate", evidence: [`${caseJson.activeFile}:${f.line}`] });
        else listing.push(`  ! express handler without node at ${caseJson.activeFile}:${f.line}: ${h.getText(sf).slice(0, 60)}`);
      }
    }
    if (f.method) {
      const id = nodeForDecl(f.method);
      addRel({ kind: "calls", source: f.id, target: id, pattern: "FW-NEST-HANDLER-CALL", gtStatus: "determinate", evidence: [`${caseJson.activeFile}:${f.line}`] });
    }
  }

  const gt = {
    schema: "exp01-gt/1",
    caseId: caseJson.caseId,
    gtVersion: 1,
    activeFile: caseJson.activeFile,
    nodes: [...nodes.values()].filter((n) => n.id === "file" || used.has(n.id)).map(({ note, ...n }) => n),
    relations: relations.map(({ key, ...r }) => r),
    negatives,
    excludedSites: dedupeSites(excludedSites, cited),
  };
  return { gt, listing };
}

function dedupeSites(sites, cited) {
  const out = [];
  const seen = new Set();
  for (const s of sites) {
    const line = Number(s.site.split(":").pop());
    if (cited.has(line)) continue;
    if (seen.has(s.site)) continue;
    seen.add(s.site);
    out.push({ site: s.site, reason: s.reason });
  }
  return out;
}

function main() {
  const arg = (n) => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : null;
  };
  const { gt, listing } = assist(path.resolve(arg("--case")));
  if (arg("--draft")) fs.writeFileSync(arg("--draft"), `${JSON.stringify(gt, null, 2)}\n`);
  if (arg("--listing")) fs.writeFileSync(arg("--listing"), `${listing.join("\n")}\n`);
  console.log(`${gt.caseId}: nodes ${gt.nodes.length}, relations ${gt.relations.length}, excludedSites ${gt.excludedSites.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
