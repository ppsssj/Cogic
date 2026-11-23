import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import { analyzeWorkspaceActive, clearAnalyzerCaches } from "../analyzer";
import { diskScriptKind } from "../analyzer/analyze";

/**
 * Workspace with `resolveJsonModule` whose active file reaches a `.json` module, an ES module `.mjs` file and a
 * CommonJS `.cjs` file. The JSON module drives a key-path type, so parsing it with the wrong ScriptKind turns the
 * parameter type into `any` (the P11 excalidraw `NestedKeyOf` case).
 */
function makeJsonWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cogic-scriptkind-"));
  const src = path.join(root, "src");
  fs.mkdirSync(path.join(src, "locales"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "bundler", resolveJsonModule: true, allowJs: true, strict: true, skipLibCheck: true },
      include: ["src"],
    }),
  );
  fs.writeFileSync(path.join(src, "locales", "en.json"), JSON.stringify({ labels: { save: "Save", open: "Open" }, errors: { missing: "Missing" } }));
  fs.writeFileSync(
    path.join(src, "i18n.ts"),
    [
      'import en from "./locales/en.json";',
      "type NestedKeyOf<T> = { [K in keyof T & string]: T[K] extends object ? `${K}.${NestedKeyOf<T[K]>}` : K }[keyof T & string];",
      "export function t(path: NestedKeyOf<typeof en>): string {",
      "  return path;",
      "}",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(src, "util.mjs"), "export function double(x) {\n  return x * 2;\n}\n");
  fs.writeFileSync(path.join(src, "legacy.cjs"), "function triple(x) {\n  return x * 3;\n}\nmodule.exports = { triple };\n");
  const entry = path.join(src, "main.ts");
  const code = [
    'import { t } from "./i18n";',
    'import { double } from "./util.mjs";',
    'import legacy from "./legacy.cjs";',
    "export function run(): string {",
    '  return t("labels.save") + double(2) + legacy.triple(3);',
    "}",
    "",
  ].join("\n");
  fs.writeFileSync(entry, code);
  const filePaths = ["i18n.ts", "util.mjs", "legacy.cjs", "main.ts", "locales/en.json"].map((f) => path.join(src, f));
  return { root, entry, code, filePaths };
}

function analyze(ws: ReturnType<typeof makeJsonWorkspace>, cacheEnabled: boolean) {
  const events: Record<string, number> = {};
  const result = analyzeWorkspaceActive({
    active: { code: ws.code, fileName: ws.entry, languageId: "typescript" },
    workspaceRoot: ws.root,
    filePaths: ws.filePaths,
    cacheEnabled,
    debug: (event) => { events[event] = (events[event] ?? 0) + 1; },
  });
  return { result, events };
}

/** The result as the webview receives it (JSON semantics), with object keys sorted. */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) {return v.map(sort);}
    if (v && typeof v === "object") {return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));}
    return v;
  };
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
}

function signatureOf(result: ReturnType<typeof analyzeWorkspaceActive>, name: string) {
  // nodes of other files are external stubs named "<name> (<file>)"
  const node = (result.graph?.nodes ?? []).find((n) => n.name === name || n.name.startsWith(`${name} (`)) as { signature?: string } | undefined;
  return node?.signature;
}

suite("Disk SourceFile ScriptKind", () => {
  test("matches the kind TypeScript infers from the file name", () => {
    const names = ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mts", "a.cts", "a.mjs", "a.cjs", "a.json", "a.d.ts", "a.d.mts", "a.d.cts", "A.JSON", "A.MJS", "a.vue", "README"];
    for (const name of names) {
      const text = name.toLowerCase().endsWith(".json") ? "{}" : "export {};";
      // what the default compiler host gets: no explicit kind, TypeScript infers it from the extension.
      // `scriptKind` is set on every SourceFile but is not in the public typings.
      const inferred = (ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true) as unknown as { scriptKind: ts.ScriptKind }).scriptKind;
      assert.strictEqual(ts.ScriptKind[diskScriptKind(name)], ts.ScriptKind[inferred], name);
    }
  });

  test("cache on and off give the same analysis for a JSON module, .mjs and .cjs", () => {
    const ws = makeJsonWorkspace();
    clearAnalyzerCaches();
    const off = analyze(ws, false);
    clearAnalyzerCaches();
    const onFirst = analyze(ws, true);
    const onCached = analyze(ws, true);

    assert.ok((onCached.events["analyzer.sourceFileCache.hit"] ?? 0) > 0, "second pass should reuse cached SourceFiles");
    const tSignature = signatureOf(off.result, "t");
    // the JSON module's shape reaches the key-path type (it is `any` when en.json is parsed as TypeScript)
    assert.ok(tSignature && tSignature.includes("labels: { save: string"), `cache off: JSON-derived type expected, got ${tSignature}`);
    assert.ok(!/path: any/.test(tSignature ?? ""), `cache off: ${tSignature}`);
    // the CommonJS module must be analysed as JavaScript: its member call is a graph node and no false diagnostic appears
    assert.ok(signatureOf(off.result, "legacy.triple"), "cache off: legacy.triple node expected");
    assert.deepStrictEqual(off.result.diagnostics, [], "cache off: no diagnostics expected");
    for (const [label, run] of [["cache on, first pass", onFirst], ["cache on, cached pass", onCached]] as const) {
      assert.strictEqual(signatureOf(run.result, "t"), tSignature, `${label}: signature of t`);
      assert.strictEqual(canonical(run.result.diagnostics), canonical(off.result.diagnostics), `${label}: diagnostics`);
      assert.strictEqual(canonical(run.result.graph), canonical(off.result.graph), `${label}: graph nodes and edges`);
      assert.strictEqual(canonical(run.result), canonical(off.result), `${label}: full result`);
    }
  });
});
