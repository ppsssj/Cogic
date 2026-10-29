// Corpus B (P1-K1): local-import closure of each selected file, resolved with the repository's own
// tsconfig (paths/baseUrl). Local = resolves to a git-tracked .ts/.tsx file of the same checkout.
// Everything else is a third-party module. Read-only; never runs Cogic.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const TSCONFIG = {
  react: "apps/react-vite/tsconfig.json",
  vue: "tsconfig.json",
  express: "tsconfig.json",
  nest: "tsconfig.json",
};

export function compilerOptionsFor(checkout, framework) {
  const cfgPath = path.join(checkout, TSCONFIG[framework]);
  const raw = ts.readConfigFile(cfgPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(cfgPath));
  return parsed.options;
}

export function importsOf(text, fileName) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const out = [];
  for (const st of sf.statements) {
    if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      out.push(st.moduleSpecifier.text);
    }
  }
  const visit = (n) => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...new Set(out)];
}

export function closure(checkout, framework, entry, tracked) {
  const options = compilerOptionsFor(checkout, framework);
  const host = ts.createCompilerHost(options);
  const local = new Set([entry]);
  const thirdParty = new Set();
  const queue = [entry];
  const edges = [];
  while (queue.length) {
    const rel = queue.shift();
    const abs = path.join(checkout, rel);
    for (const spec of importsOf(fs.readFileSync(abs, "utf8"), abs)) {
      const r = ts.resolveModuleName(spec, abs, options, host).resolvedModule;
      const resolvedRel = r ? path.relative(checkout, r.resolvedFileName).replace(/\\/g, "/") : null;
      if (resolvedRel && tracked.has(resolvedRel) && /\.tsx?$/.test(resolvedRel) && !resolvedRel.includes("node_modules/")) {
        edges.push([rel, spec, resolvedRel]);
        if (!local.has(resolvedRel)) {
          local.add(resolvedRel);
          queue.push(resolvedRel);
        }
      } else {
        thirdParty.add(spec);
      }
    }
  }
  return { entry, local: [...local].sort(), thirdParty: [...thirdParty].sort(), edges };
}
