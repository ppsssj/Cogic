// Post-hoc H2 diagnostic, not a GT case. Usage: node .../hono-h2-diagnostic.cjs <hono-worktree>
"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const repo = path.resolve(__dirname, "../../../.."), root = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw Error("Specify the pinned Hono worktree");
const ts = require(path.join(repo, "node_modules/typescript"));
const analyzer = require(path.join(repo, "out/analyzer/index.js"));
const active = path.join(root, "src/hono-base.ts");
const files = cp.execFileSync("git", ["-C", root, "ls-files", "src"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(x => /\.(ts|tsx|js|jsx)$/.test(x)).map(x => path.join(root, x));
const rel = f => { const r = path.relative(root, f).replace(/\\/g, "/"); return r.startsWith("../") || path.isAbsolute(r) ? "<external>" : r; };
const cfg = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
if (cfg.error) throw Error(ts.flattenDiagnosticMessageText(cfg.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
const roots = parsed.fileNames.length ? parsed.fileNames : files;
const program = ts.createProgram(roots, parsed.options), checker = program.getTypeChecker();
const source = program.getSourceFile(active); if (!source) throw Error("Hono source missing from TypeScript program");
const lines = new Set([469, 503, 525, 528]), calls = [];
function declaration(d) { const sf = d.getSourceFile(); return { file: rel(sf.fileName), line: sf.getLineAndCharacterOfPosition(d.getStart(sf)).line + 1, kind: ts.SyntaxKind[d.kind], text: d.name?.getText(sf) ?? "" }; }
function visit(n) {
  if (ts.isCallExpression(n)) {
    const line = source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
    if (lines.has(line)) {
      const sig = checker.getResolvedSignature(n), sym = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression);
      calls.push({ line, expression: n.expression.getText(source), arguments: n.arguments.map(a => a.getText(source)), signature: sig?.declaration ? declaration(sig.declaration) : null, symbols: (sym?.declarations ?? []).map(declaration) });
    }
  }
  ts.forEachChild(n, visit);
}
visit(source);
const result = analyzer.analyzeWorkspaceActive({ active: { code: fs.readFileSync(active, "utf8"), fileName: active, languageId: "typescript" }, workspaceRoot: root, filePaths: files, cacheEnabled: false });
const nodes = result.graph.nodes, byId = new Map(nodes.map(n => [n.id, n]));
const interesting = n => /(?:^|\.)(request|fetch|#dispatch|dispatch|compose)(?:$| \()/.test(n.name ?? "") || n.name === "Hono";
const selected = nodes.filter(interesting);
const formatNode = n => n ? { name: n.name, kind: n.kind, file: n.file ? rel(n.file) : null, range: n.range } : null;
const edges = result.graph.edges.filter(e => interesting(byId.get(e.source) ?? {}) || interesting(byId.get(e.target) ?? {})).map(e => ({ kind: e.kind, source: formatNode(byId.get(e.source)), target: formatNode(byId.get(e.target)), label: e.label ?? null }));
const revision = cp.execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
console.log(JSON.stringify({ revision, active: rel(active), typescript: ts.version, inputFileCount: files.length, meta: { mode: result.meta?.mode, usedTsconfig: result.meta?.usedTsconfig }, calls, nodes: selected.map(formatNode), edges }, null, 2));
