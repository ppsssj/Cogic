#!/usr/bin/env node
// EXP-01 Ground Truth validator (P1-A).
//
// Checks, per case:
//   1. TypeScript program diagnostics with the case tsconfig (must be 0)
//   2. case.json / expected.json schema and structural integrity (lib.mjs)
//   3. every GT node resolves to a real declaration / anchor in the source text
//   4. every evidence "file:line" exists
//   5. call-site coverage: every call/new/JSX site in the active file is cited by
//      some relation, negative, indeterminate entry or excludedSites entry
//
// It never imports or runs the Cogic analyzer. The TypeScript compiler is used only
// to parse fixtures and report diagnostics.
//
// Usage: node validate-gt.mjs [--corpus <dir>] [--catalog <csv>] [--json <out.json>]

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  CASE_SCHEMA,
  listCaseDirs,
  loadCatalog,
  readJson,
  validateGtStructure,
} from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const require = createRequire(path.join(repoRoot, "package.json"));
const ts = require("typescript");

function parseArgs(argv) {
  const args = {
    corpus: path.join(repoRoot, "docs/thesis-experiments/fixtures/exp-01"),
    catalog: null,
    json: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--corpus") {
      args.corpus = path.resolve(argv[++i]);
    } else if (a === "--catalog") {
      args.catalog = path.resolve(argv[++i]);
    } else if (a === "--json") {
      args.json = path.resolve(argv[++i]);
    } else {
      throw new Error(`unknown argument ${a}`);
    }
  }
  args.catalog ??= path.join(args.corpus, "catalog.csv");
  return args;
}

function lineOf(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function nameText(name) {
  if (!name) {
    return null;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  return null;
}

const isFnInit = (n) => n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));

// Collects declarations by line: { line -> [{ type, name }] }.
// "type" uses GT node classes: callable | class | typeLike | other.
function collectDeclarations(sf) {
  const byLine = new Map();
  const push = (node, type, name) => {
    const line = lineOf(sf, node.getStart(sf, false));
    if (!byLine.has(line)) {
      byLine.set(line, []);
    }
    byLine.get(line).push({ type, name });
  };
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      push(node, node.body ? "callable" : "other", node.name.text);
    } else if (ts.isMethodDeclaration(node)) {
      push(node, node.body ? "callable" : "other", nameText(node.name));
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (isFnInit(node.initializer)) {
        push(node.initializer, "callable", node.name.text);
      }
      push(node, "other", node.name.text);
    } else if (ts.isPropertyAssignment(node) && isFnInit(node.initializer)) {
      push(node.initializer, "callable", nameText(node.name));
    } else if (ts.isPropertyDeclaration(node)) {
      if (isFnInit(node.initializer)) {
        push(node.initializer, "callable", nameText(node.name));
      }
      push(node, "other", nameText(node.name));
    } else if (ts.isClassDeclaration(node) && node.name) {
      push(node, "class", node.name.text);
    } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
      push(node, "typeLike", node.name.text);
    } else if (ts.isMethodSignature(node) || ts.isPropertySignature(node)) {
      push(node, "other", nameText(node.name));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return byLine;
}

function collectCallSites(sf) {
  const lines = new Map();
  const visit = (node) => {
    let kind = null;
    if (ts.isCallExpression(node)) {
      kind = "call";
    } else if (ts.isNewExpression(node)) {
      kind = "new";
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      kind = "jsx";
    }
    if (kind) {
      const line = lineOf(sf, node.getStart(sf, false));
      if (!lines.has(line)) {
        lines.set(line, []);
      }
      lines.get(line).push(`${kind}:${node.getText(sf).split("\n")[0].slice(0, 60)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

function scriptKindFor(file) {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function validateCase(caseDir, catalog) {
  const errors = [];
  const warnings = [];
  const caseJsonPath = path.join(caseDir, "case.json");
  const gtPath = path.join(caseDir, "expected.json");
  const caseJson = readJson(caseJsonPath);
  if (caseJson.schema !== CASE_SCHEMA) {
    errors.push(`case.json schema must be ${CASE_SCHEMA}`);
  }
  if (!fs.existsSync(gtPath)) {
    errors.push("expected.json missing");
    return { caseId: caseJson.caseId, errors, warnings };
  }
  const gt = readJson(gtPath);
  if (gt.caseId !== caseJson.caseId) {
    errors.push(`caseId mismatch: case.json ${caseJson.caseId} vs expected.json ${gt.caseId}`);
  }
  if (path.basename(caseDir) !== gt.caseId) {
    errors.push(`directory name ${path.basename(caseDir)} must equal caseId ${gt.caseId}`);
  }
  if (gt.activeFile !== caseJson.activeFile) {
    errors.push("activeFile mismatch between case.json and expected.json");
  }
  const structural = validateGtStructure(gt, catalog);
  errors.push(...structural.errors);
  warnings.push(...structural.warnings);

  // 1. TypeScript diagnostics
  const cfgPath = path.join(caseDir, "tsconfig.json");
  let diagnostics = [];
  if (!fs.existsSync(cfgPath)) {
    errors.push("tsconfig.json missing");
  } else {
    const raw = ts.readConfigFile(cfgPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, caseDir);
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    diagnostics = [...ts.getPreEmitDiagnostics(program)].map((d) => {
      const where = d.file ? `${path.relative(caseDir, d.file.fileName)}:${lineOf(d.file, d.start ?? 0)}` : "";
      return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
    });
    for (const d of diagnostics) {
      errors.push(`TS diagnostic: ${d}`);
    }
    const active = path.join(caseDir, gt.activeFile ?? "");
    if (!parsed.fileNames.some((f) => path.resolve(f) === path.resolve(active))) {
      errors.push("activeFile is not part of the tsconfig program");
    }
  }

  // 2-4. Source integrity
  const sources = new Map();
  const getSource = (rel) => {
    if (sources.has(rel)) {
      return sources.get(rel);
    }
    const abs = path.join(caseDir, rel);
    if (!fs.existsSync(abs)) {
      sources.set(rel, null);
      return null;
    }
    const text = fs.readFileSync(abs, "utf8");
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.ES2022, true, scriptKindFor(abs));
    const entry = { sf, lines: text.split(/\r?\n/), decls: collectDeclarations(sf) };
    sources.set(rel, entry);
    return entry;
  };

  for (const n of gt.nodes ?? []) {
    if (n.type === "lib") {
      continue;
    }
    const src = getSource(n.file);
    if (!src) {
      errors.push(`node ${n.id}: file ${n.file} does not exist`);
      continue;
    }
    if (n.type === "file" || n.type === "module") {
      continue;
    }
    const text = src.lines[n.line - 1];
    if (text === undefined) {
      errors.push(`node ${n.id}: line ${n.line} out of range in ${n.file}`);
      continue;
    }
    if (n.type === "synthetic") {
      if (!text.includes(n.anchor)) {
        errors.push(`node ${n.id}: anchor "${n.anchor}" not found on ${n.file}:${n.line} (${text.trim()})`);
      }
      continue;
    }
    const decls = src.decls.get(n.line) ?? [];
    const wanted = n.type === "external" ? null : n.type;
    const ok = decls.some((d) => d.name === n.name && (wanted === null || d.type === wanted));
    if (!ok) {
      errors.push(
        `node ${n.id}: no ${wanted ?? "declaration"} named "${n.name}" starts at ${n.file}:${n.line} (found: ${
          decls.map((d) => `${d.type}:${d.name}`).join(", ") || "none"
        })`,
      );
    }
  }

  const nodesById = new Map((gt.nodes ?? []).map((n) => [n.id, n]));
  const cited = new Set();
  const checkEvidence = (item, label) => {
    for (const ev of item.evidence ?? []) {
      const m = ev.match(/^(.+):(\d+)$/);
      if (!m) {
        continue;
      }
      const [, rel, ln] = m;
      const src = getSource(rel);
      if (!src) {
        errors.push(`${label} ${item.id}: evidence file ${rel} missing`);
        continue;
      }
      const text = src.lines[Number(ln) - 1];
      if (text === undefined) {
        errors.push(`${label} ${item.id}: evidence line ${ev} out of range`);
        continue;
      }
      if (rel === gt.activeFile) {
        cited.add(Number(ln));
      }
    }
    // Heuristic: some evidence line should mention the target name.
    const names = [];
    if (item.target && nodesById.get(item.target)?.name) {
      names.push(nodesById.get(item.target).name);
    }
    for (const c of Array.isArray(item.candidates) ? item.candidates : []) {
      if (nodesById.get(c.target)?.name) {
        names.push(nodesById.get(c.target).name);
      }
    }
    if (names.length > 0 && item.kind !== "dataflow") {
      const hit = (item.evidence ?? []).some((ev) => {
        const m = ev.match(/^(.+):(\d+)$/);
        const text = m ? getSource(m[1])?.lines[Number(m[2]) - 1] ?? "" : "";
        return names.some((nm) => text.includes(nm));
      });
      if (!hit) {
        warnings.push(`${label} ${item.id}: no evidence line mentions ${names.join("/")}`);
      }
    }
  };
  for (const r of gt.relations ?? []) {
    checkEvidence(r, "relation");
  }
  for (const r of gt.negatives ?? []) {
    checkEvidence(r, "negative");
  }
  for (const s of gt.excludedSites ?? []) {
    const m = String(s.site ?? "").match(/^(.+):(\d+)$/);
    if (m && m[1] === gt.activeFile) {
      cited.add(Number(m[2]));
    }
  }

  // 5. Call-site coverage
  const active = getSource(gt.activeFile ?? "");
  let callSites = 0;
  if (active) {
    const sites = collectCallSites(active.sf);
    callSites = [...sites.values()].reduce((a, b) => a + b.length, 0);
    for (const [line, labels] of sites.entries()) {
      if (!cited.has(line)) {
        errors.push(`call-site coverage: ${gt.activeFile}:${line} (${labels.join(" | ")}) is not cited by any GT item`);
      }
    }
  }

  // Unused nodes
  const used = new Set();
  for (const r of [...(gt.relations ?? []), ...(gt.negatives ?? [])]) {
    used.add(r.source);
    if (r.target) {
      used.add(r.target);
    }
    for (const t of r.targetAlternatives ?? []) {
      used.add(t);
    }
    for (const c of Array.isArray(r.candidates) ? r.candidates : []) {
      used.add(c.target);
    }
  }
  for (const n of gt.nodes ?? []) {
    if (!used.has(n.id)) {
      warnings.push(`node ${n.id} is not used by any relation or negative`);
    }
  }

  return {
    caseId: gt.caseId,
    category: caseJson.category,
    errors,
    warnings,
    stats: {
      nodes: (gt.nodes ?? []).length,
      relations: (gt.relations ?? []).length,
      negatives: (gt.negatives ?? []).length,
      callSites,
      tsDiagnostics: diagnostics.length,
    },
  };
}

function main() {
  const args = parseArgs(process.argv);
  const catalog = loadCatalog(args.catalog);
  const results = listCaseDirs(args.corpus).map((dir) => validateCase(dir, catalog));
  let errorCount = 0;
  let warningCount = 0;
  for (const r of results) {
    errorCount += r.errors.length;
    warningCount += r.warnings.length;
    const status = r.errors.length === 0 ? "OK  " : "FAIL";
    console.log(
      `${status} ${r.caseId} (nodes ${r.stats?.nodes ?? 0}, relations ${r.stats?.relations ?? 0}, negatives ${
        r.stats?.negatives ?? 0
      }, callSites ${r.stats?.callSites ?? 0}, tsDiagnostics ${r.stats?.tsDiagnostics ?? 0})`,
    );
    for (const e of r.errors) {
      console.log(`     ERROR ${e}`);
    }
    for (const w of r.warnings) {
      console.log(`     warn  ${w}`);
    }
  }
  console.log(`\ncases ${results.length}, errors ${errorCount}, warnings ${warningCount}`);
  if (args.json) {
    fs.writeFileSync(
      args.json,
      `${JSON.stringify({ typescript: ts.version, cases: results.length, errorCount, warningCount, results }, null, 2)}\n`,
    );
  }
  process.exitCode = errorCount === 0 ? 0 : 1;
}

main();
