#!/usr/bin/env node
// P14-D: how decorator relations look to the TypeScript compiler (emit), the TypeScript Language
// Service (call hierarchy, the API behind VS Code's Call Hierarchy) and Cogic, on the same fixtures.
//
//   node docs/thesis-experiments/p14d-semantic-contract/decorator-probe/probe.cjs [--out result.json]
//
// Uses the repository's TypeScript (5.9.3) and compiled analyzer (out/analyzer; run `npm run compile`
// first). Writes nothing but the optional result file; paths in the result are fixture-relative.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const HERE = __dirname;
const REPO = path.resolve(HERE, "../../../..");
const DECORATORS = ["ClassDeco", "PlainClass", "Method", "PlainMethod", "Prop", "Param", "Field", "helper"];
const rel = (f) => path.relative(HERE, f).split(path.sep).join("/");

function loadProject(dir) {
  const cfgPath = path.join(dir, "tsconfig.json");
  const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, dir);
  return cfg;
}

// 1. Compiler emit: where each decorator function is evaluated in the emitted JavaScript.
function emitEvidence(dir, cfg) {
  const program = ts.createProgram(cfg.fileNames, { ...cfg.options, noEmit: false, outDir: undefined });
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  let js = "";
  program.emit(program.getSourceFile(path.join(dir, "main.ts")), (name, text) => {
    if (name.endsWith(".js")) js = text;
  });
  const sf = ts.createSourceFile("main.js", js, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const sites = [];
  const scopeOf = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) || ts.isConstructorDeclaration(p)) {
        const name = p.name && ts.isIdentifier(p.name) ? p.name.text : ts.isArrowFunction(p) || ts.isFunctionExpression(p) ? "<anonymous function>" : "<constructor>";
        return { kind: ts.SyntaxKind[p.kind], name };
      }
      if (ts.isClassStaticBlockDeclaration(p)) return { kind: "ClassStaticBlock", name: "static {}" };
      if (ts.isPropertyDeclaration(p) && p.initializer) {
        const isStatic = (p.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
        if (isStatic) return { kind: "StaticFieldInitializer", name: p.name.getText(sf) };
      }
    }
    return { kind: "SourceFile", name: "<module top level>" };
  };
  const visit = (node) => {
    if (ts.isIdentifier(node) && DECORATORS.includes(node.text) && !(ts.isFunctionDeclaration(node.parent) && node.parent.name === node)) {
      const call = ts.isCallExpression(node.parent) && node.parent.expression === node;
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      sites.push({ name: node.text, emittedLine: line, form: call ? "called" : "referenced", scope: scopeOf(node), text: sf.text.split("\n")[line - 1].trim().slice(0, 100) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { diagnostics, sites, js };
}

// 2. Language Service call hierarchy (what VS Code's "Show Incoming/Outgoing Calls" asks tsserver).
function languageServiceEvidence(dir, cfg) {
  const files = new Map(cfg.fileNames.map((f) => [f, fs.readFileSync(f, "utf8")]));
  const host = {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => (files.has(f) ? ts.ScriptSnapshot.fromString(files.get(f)) : fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8")) : undefined),
    getCurrentDirectory: () => dir,
    getCompilationSettings: () => cfg.options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
  };
  const ls = ts.createLanguageService(host);
  // the config's file names use "/" separators; use the same string as the key
  const main = cfg.fileNames.find((f) => path.resolve(f) === path.resolve(dir, "main.ts"));
  const text = files.get(main);
  const sf = ls.getProgram().getSourceFile(main);
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const item = (it) => ({ name: it.name, kind: it.kind, containerName: it.containerName ?? null, line: lineOf(it.selectionSpan.start) });
  const declPos = (name) => {
    const m = new RegExp(`(function|class)\\s+${name}\\b`).exec(text);
    return m ? m.index + m[0].length - name.length : null;
  };
  const memberPos = (name) => {
    const m = new RegExp(`\\n\\s+${name}\\(`).exec(text);
    return m ? m.index + m[0].indexOf(name) : null;
  };
  const out = { incoming: {}, outgoing: {} };
  for (const name of DECORATORS) {
    const pos = declPos(name);
    if (pos == null) continue;
    const prepared = [ls.prepareCallHierarchy(main, pos)].flat().filter(Boolean);
    out.incoming[name] = prepared.flatMap((p) => ls.provideCallHierarchyIncomingCalls(main, p.selectionSpan.start).map((c) => ({ from: item(c.from), fromSpans: c.fromSpans.map((s) => ({ line: lineOf(s.start), text: text.slice(s.start, s.start + s.length) })) })));
  }
  const targets = [["class Sample", declPos("Sample")], ["Sample.method", memberPos("method")], ["Sample.constructor", memberPos("constructor")], ["file", 0]];
  for (const [label, pos] of targets) {
    if (pos == null) continue;
    if (label === "file") {
      const prepared = [ls.prepareCallHierarchy(main, declPos("ClassDeco"))].flat().filter(Boolean);
      // outgoing calls of the module itself: ask from the first incoming item whose kind is "script"/"module"
      const fileItem = prepared.length ? ls.provideCallHierarchyIncomingCalls(main, prepared[0].selectionSpan.start).map((c) => c.from).find((f) => f.kind === "module" || f.kind === "script") : null;
      if (fileItem) out.outgoing.file = ls.provideCallHierarchyOutgoingCalls(main, fileItem.selectionSpan.start).map((c) => ({ to: item(c.to), fromSpans: c.fromSpans.map((s) => lineOf(s.start)) }));
      continue;
    }
    const prepared = [ls.prepareCallHierarchy(main, pos)].flat().filter(Boolean);
    out.outgoing[label] = prepared.flatMap((p) => ls.provideCallHierarchyOutgoingCalls(main, p.selectionSpan.start).map((c) => ({ to: item(c.to), fromSpans: c.fromSpans.map((s) => lineOf(s.start)) })));
  }
  // references (Find All References) of each decorator: the decorator sites themselves
  out.references = {};
  for (const name of DECORATORS) {
    const pos = declPos(name);
    if (pos == null) continue;
    out.references[name] = (ls.getReferencesAtPosition(main, pos) ?? []).filter((r) => !r.isDefinition).map((r) => lineOf(r.textSpan.start));
  }
  return out;
}

// 3. Cogic: the compiled analyzer, as the EXP-01 runner calls it.
function cogicEvidence(dir) {
  const analyzer = require(path.join(REPO, "out", "analyzer"));
  const main = path.join(dir, "main.ts");
  const output = analyzer.analyzeWorkspaceActive({
    active: { code: fs.readFileSync(main, "utf8"), fileName: main, languageId: "typescript" },
    workspaceRoot: dir,
    filePaths: [main],
    cacheEnabled: false,
    debug: () => {},
  });
  const g = output.graph ?? output;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const label = (id) => {
    const n = byId.get(id);
    return n ? `${n.kind}:${n.name}@${n.range ? n.range.start.line + 1 : ""}` : id;
  };
  return {
    nodes: g.nodes.map((n) => `${n.kind}:${n.name}@${n.range ? n.range.start.line + 1 : ""}`),
    edges: g.edges.map((e) => ({ kind: e.kind, source: label(e.source), target: label(e.target), label: e.label ?? null })).filter((e) => DECORATORS.some((d) => e.target.includes(`:${d}@`) || e.source.includes(`:${d}@`))),
  };
}

const result = { tool: "p14d-decorator-probe/1", typescript: ts.version, fixtures: {} };
for (const name of ["legacy", "standard"]) {
  const dir = path.join(HERE, "fixtures", name);
  const cfg = loadProject(dir);
  const emit = emitEvidence(dir, cfg);
  result.fixtures[name] = {
    fixture: rel(path.join(dir, "main.ts")),
    compilerOptions: { experimentalDecorators: Boolean(cfg.options.experimentalDecorators), target: ts.ScriptTarget[cfg.options.target] },
    diagnostics: emit.diagnostics,
    emit: emit.sites,
    languageService: languageServiceEvidence(dir, cfg),
    cogic: cogicEvidence(dir),
  };
}
const outIdx = process.argv.indexOf("--out");
if (outIdx > 0) fs.writeFileSync(process.argv[outIdx + 1], `${JSON.stringify(result, null, 1)}\n`);
for (const [name, f] of Object.entries(result.fixtures)) {
  console.log(`== ${name} (experimentalDecorators ${f.compilerOptions.experimentalDecorators}); diagnostics ${f.diagnostics.length}`);
  for (const s of f.emit) console.log(`emit  ${s.name.padEnd(11)} ${s.form.padEnd(10)} in ${s.scope.kind}:${s.scope.name}  | ${s.text}`);
  for (const [d, calls] of Object.entries(f.languageService.incoming)) console.log(`LS in ${d.padEnd(11)} <- ${calls.map((c) => `${c.from.kind}:${c.from.name}${c.from.containerName ? `(${c.from.containerName})` : ""}@${c.from.line} [${c.fromSpans.map((s) => s.line).join(",")}]`).join("; ") || "-"}`);
  for (const [t, calls] of Object.entries(f.languageService.outgoing)) console.log(`LS out ${t.padEnd(18)} -> ${calls.map((c) => `${c.to.name}@${c.to.line}[${c.fromSpans.join(",")}]`).join("; ") || "-"}`);
  for (const e of f.cogic.edges) console.log(`cogic ${e.kind} ${e.source} -> ${e.target}${e.label ? ` (${e.label})` : ""}`);
}
