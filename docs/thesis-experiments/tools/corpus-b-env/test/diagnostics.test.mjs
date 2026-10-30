// P1-K2: synthetic-input tests for the Corpus B diagnostic classifier and the §2 node predicate.
// Each test builds a throw-away case directory (case.json, upstream.json, tsconfig.json, shims) in the
// OS temp directory; nothing in the repository is read or written except the tools under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CAUSES, collectCase, ts } from "../diagnostics-lib.mjs";
import { isSection2Node } from "../compare-resolution.mjs";

function makeCase({ files, active = "src/a.ts", shims = [], compilerOptions = {}, upstreamOptions = {}, framework = "test" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "k2-diag-"));
  const derived = { target: "ES2021", module: "ESNext", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, types: [], ...compilerOptions };
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  fs.mkdirSync(path.join(dir, "shims"), { recursive: true });
  fs.writeFileSync(path.join(dir, "shims", "third-party.d.ts"), shims.map((m) => `declare module "${m}";`).join("\n"));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: derived, include: ["**/*.ts", "**/*.tsx"] }));
  fs.writeFileSync(path.join(dir, "case.json"), JSON.stringify({ caseId: "t01", activeFile: active }));
  fs.writeFileSync(path.join(dir, "upstream.json"), JSON.stringify({ files: Object.keys(files).map((f) => ({ path: f, upstreamPath: `up/${f}` })), tsconfig: { upstreamOptions, derivedOptions: derived } }));
  return { framework, caseId: "t01", caseDir: dir };
}

const run = (spec) => {
  const c = makeCase(spec);
  try {
    return collectCase(c);
  } finally {
    fs.rmSync(c.caseDir, { recursive: true, force: true });
  }
};
const causesOf = (rows) => rows.map((r) => `TS${r.code} ${r.cause}`).sort();

test("untyped shim: namespace-as-type and lost contextual type are UNTYPED_EXTERNAL_DEPENDENCY", () => {
  const rows = run({ shims: ["ext"], files: { "src/a.ts": 'import { Foo, run } from "ext";\nexport let x: Foo;\nrun((p) => p);\n' } });
  assert.deepEqual(causesOf(rows), ["TS2709 UNTYPED_EXTERNAL_DEPENDENCY", "TS7006 UNTYPED_EXTERNAL_DEPENDENCY"]);
  assert.ok(rows.every((r) => r.location === "ACTIVE_FILE" && r.category === "Error"));
  assert.equal(rows.find((r) => r.code === 7006).impact, "LOCAL_VALUE_TYPE_DEGRADED");
  assert.equal(rows.find((r) => r.code === 2709).impact, "EXTERNAL_OR_GLOBAL_TYPE_ONLY");
});

test("contextual type traced through a local re-export and a returned object literal", () => {
  const rows = run({
    shims: ["store"],
    files: {
      "src/s.ts": 'import { create } from "store";\nexport const useS = create((set) => ({ add: (n) => set(n) }));\n',
      "src/a.ts": 'import { useS } from "./s";\nuseS.subscribe((v) => v);\n',
    },
  });
  assert.ok(rows.length >= 3);
  assert.ok(rows.every((r) => r.cause === "UNTYPED_EXTERNAL_DEPENDENCY"), JSON.stringify(rows.map((r) => [r.code, r.basis])));
  assert.deepEqual([...new Set(rows.map((r) => r.location))].sort(), ["ACTIVE_FILE", "DEPENDENCY_FILE"]);
  assert.equal(rows.find((r) => r.file === "src/s.ts").impact, "DEPENDENCY_FILE_ONLY");
});

test("a genuine local type error is TYPE_ASSIGNMENT_ERROR; a wrong arity call is INVALID_CALL_SIGNATURE", () => {
  const rows = run({ files: { "src/a.ts": 'export const n: number = "s";\nfunction f(a: number) { return a; }\nf();\n' } });
  assert.deepEqual(causesOf(rows), ["TS2322 TYPE_ASSIGNMENT_ERROR", "TS2554 INVALID_CALL_SIGNATURE"]);
});

test("missing local export, unresolved relative module and unresolved path alias", () => {
  const rows = run({
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
    files: { "src/b.ts": "export const other = 1;\n", "src/a.ts": 'import { nope } from "./b";\nimport { z } from "./missing";\nimport { y } from "@/gone";\nexport default [nope, z, y];\n' },
  });
  assert.deepEqual(causesOf(rows), ["TS2305 MISSING_EXPORT", "TS2307 PATH_ALIAS_RESOLUTION", "TS2307 UNRESOLVED_MODULE"]);
});

test("Node globals are MISSING_GLOBAL_TYPE; DOM names removed by the lib override are TSCONFIG_MISMATCH", () => {
  const rows = run({ compilerOptions: { lib: ["ES2021"] }, upstreamOptions: {}, files: { "src/a.ts": "export const e = process.env.X;\nconsole.log(e);\n" } });
  assert.deepEqual(causesOf(rows), ["TS2584 TSCONFIG_MISMATCH", "TS2591 MISSING_GLOBAL_TYPE"]);
  // the same code with an explicit upstream lib is not a tsconfig mismatch
  const kept = run({ compilerOptions: { lib: ["ES2021"] }, upstreamOptions: { lib: ["ES2021"] }, files: { "src/a.ts": "console.log(1);\n" } });
  assert.deepEqual(causesOf(kept), ["TS2584 UNKNOWN"]);
});

test("decorators without experimentalDecorators are DECORATOR_CONFIGURATION", () => {
  const rows = run({ files: { "src/a.ts": "declare function D(): any;\nexport class A { m(@D() x: number) { return x; } }\n" } });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.cause === "DECORATOR_CONFIGURATION"), JSON.stringify(rows.map((r) => [r.code, r.message])));
});

test("JSX without @types/react: intrinsic element and missing jsx-runtime have no resolution impact", () => {
  const rows = run({ active: "src/a.tsx", shims: ["react"], compilerOptions: { jsx: "react-jsx" }, files: { "src/a.tsx": "export const A = () => <div />;\n" } });
  assert.deepEqual(causesOf(rows), ["TS2875 UNRESOLVED_MODULE", "TS7026 MISSING_GLOBAL_TYPE"]);
  assert.ok(rows.every((r) => r.impact === "NONE"));
});

test("repeated upstream diagnostics share a uniqueKey; every cause is a declared category", () => {
  const rows = run({ files: { "src/a.ts": 'export const a: number = "x";\n' } });
  assert.equal(rows.length, 1);
  assert.match(rows[0].uniqueKey, /^up\/src\/a\.ts:1:14:TS2322:/);
  assert.ok(CAUSES.includes(rows[0].cause));
});

test("§2 node predicate follows ANNOTATION_GUIDE §2", () => {
  const sf = ts.createSourceFile("x.ts", "function f() {}\ndeclare function g(): void;\nclass C { m() {} abstract n(): void; p = () => 1; q = 1; }\nconst h = () => 1;\nconst k = 1;\ninterface I {}\ntype T = 1;\n", ts.ScriptTarget.Latest, true);
  const got = [];
  const visit = (n) => {
    if (n.name && ts.isIdentifier(n.name)) got.push(`${n.name.text}:${isSection2Node(n)}`);
    n.forEachChild(visit);
  };
  visit(sf);
  assert.deepEqual(got, ["f:true", "g:false", "C:true", "m:true", "n:false", "p:true", "q:false", "h:true", "k:false", "I:true", "T:true"]);
});
