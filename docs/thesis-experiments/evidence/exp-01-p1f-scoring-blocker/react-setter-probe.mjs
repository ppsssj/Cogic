#!/usr/bin/env node
// P1-F independent diagnostic (no source change). Not an EXP-01 measurement.
//
// Runs the compiled Cogic analyzer (out/analyzer, same call shape as exp01-run.mjs) on small synthetic
// workspaces written to a temporary directory, to see how a React setter call is emitted depending on
// how `react` is typed. Nothing is written inside the repository.
//
// Variants (same main.ts, different shims/react.d.ts):
//   untyped        : `declare module` without useState -> useState is not typed
//   tuple-one-line : EXP-01 shim style, setter function type inside the useState return tuple, one line
//   alias-split    : @types/react style, Dispatch/SetStateAction aliases on their own lines
//
// Usage: node react-setter-probe.mjs [--json <out>]   (run `npm run compile` first)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const require = createRequire(import.meta.url);
const analyzer = require(path.join(repoRoot, "out", "analyzer"));
const lib = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/exp01/lib.mjs")).href);

const MAIN = [
  'import { useState } from "react";',
  "",
  "export function Counter() {",
  "  const [count, setCount] = useState(0);",
  "  function increment() {",
  "    setCount(count + 1);",
  "  }",
  "  return increment;",
  "}",
  "",
].join("\n");

const SHIMS = {
  untyped: 'declare module "react";\n',
  "tuple-one-line": "export declare function useState<S>(initial: S): [S, (next: S | ((prev: S) => S)) => void];\n",
  "alias-split": [
    "export type SetStateAction<S> = S | ((prev: S) => S);",
    "export type Dispatch<A> = (value: A) => void;",
    "export declare function useState<S>(initial: S): [S, Dispatch<SetStateAction<S>>];",
    "",
  ].join("\n"),
};

const TSCONFIG = {
  compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, types: [], paths: { react: ["./shims/react.d.ts"] } },
  include: ["**/*.ts"],
};

const result = { analyzer: "out/analyzer (analyzeWorkspaceActive, cacheEnabled: false)", variants: [] };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p1f-react-probe-"));
try {
  for (const [name, shim] of Object.entries(SHIMS)) {
    const dir = path.join(tmpRoot, name);
    fs.mkdirSync(path.join(dir, "shims"), { recursive: true });
    fs.writeFileSync(path.join(dir, "main.ts"), MAIN);
    fs.writeFileSync(path.join(dir, "shims", "react.d.ts"), name === "untyped" ? "" : shim);
    if (name === "untyped") {
      fs.writeFileSync(path.join(dir, "shims", "react-module.d.ts"), shim);
    }
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(name === "untyped" ? { ...TSCONFIG, compilerOptions: { ...TSCONFIG.compilerOptions, paths: {} } } : TSCONFIG));
    const filePaths = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".ts")).map((f) => path.join(dir, f));
    const activeAbs = path.join(dir, "main.ts");
    const out = analyzer.analyzeWorkspaceActive({
      active: { code: MAIN, fileName: activeAbs, languageId: "typescript" },
      workspaceRoot: dir,
      filePaths,
      cacheEnabled: false,
    });
    const g = out.graph;
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const label = (id) => {
      const n = byId.get(id);
      return n ? `${n.kind}:${n.name}@L${(n.range?.start?.line ?? -1) + 1}c${n.range?.start?.character ?? -1}` : id;
    };
    const setterEdges = g.edges
      .filter((e) => /setCount/.test(label(e.target)) || e.label === "setCount" || (byId.get(e.source)?.name === "increment" && e.kind !== "references"))
      .map((e) => `${e.kind} ${label(e.source)} -> ${label(e.target)}${e.label ? ` [${e.label}]` : ""}`);
    const norm = lib.normalizeCogicGraph(g, { fixtureRoot: dir, caseId: name });
    result.variants.push({
      variant: name,
      updatesEdges: g.edges.filter((e) => e.kind === "updates").length,
      edgesFromIncrement: setterEdges,
      externalNodes: g.nodes.filter((n) => n.kind === "external").map((n) => label(n.id)),
      scorerCollisions: norm.collisions.map((c) => c.key),
    });
  }
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

const text = `${JSON.stringify(result, null, 2)}\n`;
const i = process.argv.indexOf("--json");
if (i >= 0) {
  fs.writeFileSync(path.resolve(process.argv[i + 1]), text);
}
console.log(text);
