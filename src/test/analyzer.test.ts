import * as assert from "assert";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  analyzeTypeScriptWithTypes,
  analyzeWithWorkspace,
  clearAnalyzerCaches,
} from "../analyzer/analyze";

function normalizeComparablePath(filePath: string | null | undefined) {
  return (filePath ?? "").replace(/\\/g, "/").toLowerCase();
}

suite("Analyzer Test Suite", function () {
  this.timeout(10_000);

  test("caches disk SourceFiles without mixing active unsaved text", () => {
    clearAnalyzerCaches();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-cache-"));

    try {
      const activeFile = path.join(root, "main.ts");
      const helperFile = path.join(root, "helper.ts");
      fs.writeFileSync(
        activeFile,
        `import { helper } from "./helper";\nexport function onDisk() { return helper(); }\n`,
      );
      fs.writeFileSync(helperFile, `export function helper() { return 1; }\n`);

      const debugEvents: Array<{
        event: string;
        detail?: Record<string, unknown>;
      }> = [];
      const debug = (event: string, detail?: Record<string, unknown>) => {
        debugEvents.push({ event, detail });
      };

      const first = analyzeWithWorkspace({
        active: {
          code: `import { helper } from "./helper";\nexport function unsavedA() { return helper(); }\n`,
          fileName: activeFile,
          languageId: "typescript",
        },
        workspaceRoot: root,
        filePaths: [activeFile, helperFile],
        debug,
      });
      const second = analyzeWithWorkspace({
        active: {
          code: `import { helper } from "./helper";\nexport function unsavedB() { return helper(); }\n`,
          fileName: activeFile,
          languageId: "typescript",
        },
        workspaceRoot: root,
        filePaths: [activeFile, helperFile],
        debug,
      });

      assert.ok(
        first.exports.some((item) => item.name === "unsavedA"),
        "first analysis should use active in-memory text",
      );
      assert.ok(
        second.exports.some((item) => item.name === "unsavedB"),
        "second analysis should use latest active in-memory text",
      );
      assert.ok(
        debugEvents.some(
          (item) =>
            item.event === "analyzer.sourceFileCache.hit" &&
            normalizeComparablePath(String(item.detail?.filePath)) ===
              normalizeComparablePath(helperFile),
        ),
        "unchanged helper.ts should be served from the disk SourceFile cache",
      );
      assert.ok(
        !debugEvents.some(
          (item) =>
            item.event === "analyzer.sourceFileCache.hit" &&
            normalizeComparablePath(String(item.detail?.filePath)) ===
              normalizeComparablePath(activeFile),
        ),
        "active file should not be served from the disk SourceFile cache",
      );
    } finally {
      clearAnalyzerCaches();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("captures default export declarations as default", () => {
    const functionResult = analyzeTypeScriptWithTypes({
      fileName: "default-export.ts",
      languageId: "typescript",
      code: `
        export default function buildUser() {
          return { ok: true };
        }
      `,
    });

    const classResult = analyzeTypeScriptWithTypes({
      fileName: "default-export-class.ts",
      languageId: "typescript",
      code: `
        export default class UserService {}
      `,
    });

    assert.deepStrictEqual(functionResult.exports, [
      { name: "default", kind: "function" },
    ]);
    assert.deepStrictEqual(classResult.exports, [{ name: "default", kind: "class" }]);
  });

  test("tracks mixed imports and re-exports from a barrel-style file", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "barrel.ts",
      languageId: "typescript",
      code: `
        import React, { useMemo as memoized, type ReactNode } from "react";
        import * as helpers from "./helpers";
        import "./polyfill";

        export { helper as renamedHelper } from "./helpers";
        export * from "./types";

        export const ready = true;
        export default function Screen(): ReactNode {
          return memoized(() => null, []);
        }

        helpers.run();
        void React;
      `,
    });

    assert.deepStrictEqual(result.imports, [
      {
        source: "react",
        specifiers: ["React", "useMemo as memoized", "ReactNode"],
        kind: "named",
      },
      {
        source: "./helpers",
        specifiers: ["helpers"],
        kind: "namespace",
      },
      {
        source: "./polyfill",
        specifiers: [],
        kind: "side-effect",
      },
    ]);

    assert.deepStrictEqual(result.exports, [
      { name: "helper as renamedHelper", kind: "unknown" },
      { name: "*", kind: "unknown" },
      { name: "ready", kind: "const" },
      { name: "default", kind: "function" },
    ]);
  });

  test("promotes object literal methods into graph owners", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "object-literal.ts",
      languageId: "typescript",
      code: `
        export const api = {
          run() {
            return helper();
          },
          save: () => helper(),
        };

        function helper() {
          return 1;
        }
      `,
    });

    const runNode = result.graph.nodes.find((node) => node.name === "api.run");
    const saveNode = result.graph.nodes.find((node) => node.name === "api.save");
    const helperNode = result.graph.nodes.find((node) => node.name === "helper");

    assert.ok(runNode, "object literal method should become its own graph node");
    assert.ok(saveNode, "arrow function property should become its own graph node");
    assert.ok(helperNode, "helper function should still be present");

    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === runNode?.id &&
          edge.target === helperNode?.id,
      ),
      "api.run() should own the helper() call edge",
    );

    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === saveNode?.id &&
          edge.target === helperNode?.id,
      ),
      "api.save() should own the helper() call edge",
    );
  });

  test("resolves calls through barrel re-exports", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-analyzer-"));
    const entryFile = path.join(root, "entry.ts");
    const helperFile = path.join(root, "helper.ts");
    const barrelFile = path.join(root, "index.ts");

    fs.writeFileSync(
      helperFile,
      `
        export function helper() {
          return 1;
        }
      `,
      "utf8",
    );
    fs.writeFileSync(
      barrelFile,
      `
        export { helper } from "./helper";
      `,
      "utf8",
    );

    const result = analyzeWithWorkspace({
      active: {
        fileName: entryFile,
        languageId: "typescript",
        code: `
          import { helper } from "./index";

          export function run() {
            return helper();
          }
        `,
      },
      workspaceRoot: root,
      filePaths: [entryFile, helperFile, barrelFile],
    });

    assert.ok(
      result.calls.some(
        (call) =>
          call.calleeName === "helper" &&
          normalizeComparablePath(call.declFile) ===
            normalizeComparablePath(helperFile),
      ),
      "barrel re-export should resolve helper() back to its implementation file",
    );
  });

  test("resolves tsconfig path alias imports", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-analyzer-"));
    const entryFile = path.join(root, "src", "entry.ts");
    const helperFile = path.join(root, "src", "utils", "helper.ts");

    fs.mkdirSync(path.dirname(entryFile), { recursive: true });
    fs.mkdirSync(path.dirname(helperFile), { recursive: true });
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "@/*": ["src/*"],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      helperFile,
      `
        export const helper = () => 1;
      `,
      "utf8",
    );

    const result = analyzeWithWorkspace({
      active: {
        fileName: entryFile,
        languageId: "typescript",
        code: `
          import { helper } from "@/utils/helper";

          export function run() {
            return helper();
          }
        `,
      },
      workspaceRoot: root,
      filePaths: [entryFile, helperFile],
    });

    assert.strictEqual(result.meta.usedTsconfig, true);
    assert.ok(
      result.calls.some(
        (call) =>
          call.calleeName === "helper" &&
          normalizeComparablePath(call.declFile) ===
            normalizeComparablePath(helperFile),
      ),
      "path alias import should resolve helper() into the aliased source file",
    );
  });

  test("adds reference edges for local arrow function values", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "reference-arrow.ts",
      languageId: "typescript",
      code: `
        const helper = () => 1;

        export function run() {
          return helper;
        }
      `,
    });

    const helperNode = result.graph.nodes.find((node) => node.name === "helper");
    const runNode = result.graph.nodes.find((node) => node.name === "run");

    assert.ok(helperNode);
    assert.ok(runNode);
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.source === runNode?.id &&
          edge.target === helperNode?.id,
      ),
      "returning a local arrow function value should create a reference edge",
    );
  });

  test("adds reference edges for local member access without invocation", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "reference-member.ts",
      languageId: "typescript",
      code: `
        class Service {
          helper = () => 1;

          run() {
            return this.helper;
          }
        }
      `,
    });

    const helperNode = result.graph.nodes.find(
      (node) => node.name === "Service.helper",
    );
    const runNode = result.graph.nodes.find((node) => node.name === "Service.run");

    assert.ok(helperNode);
    assert.ok(runNode);
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.source === runNode?.id &&
          edge.target === helperNode?.id,
      ),
      "non-invoked this.helper access should create a reference edge",
    );
  });

  test("resolves dynamic import calls into module files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-analyzer-"));
    const entryFile = path.join(root, "entry.ts");
    const helperFile = path.join(root, "helper.ts");

    fs.writeFileSync(
      helperFile,
      `
        export function helper() {
          return 1;
        }
      `,
      "utf8",
    );

    const result = analyzeWithWorkspace({
      active: {
        fileName: entryFile,
        languageId: "typescript",
        code: `
          export async function run() {
            const mod = await import("./helper");
            return mod.helper();
          }
        `,
      },
      workspaceRoot: root,
      filePaths: [entryFile, helperFile],
    });

    assert.ok(
      result.calls.some(
        (call) =>
          call.calleeName === 'import("./helper")' &&
          normalizeComparablePath(call.declFile) ===
            normalizeComparablePath(helperFile),
      ),
      "dynamic import should resolve to the imported module file",
    );

    assert.ok(
      result.graph.nodes.some(
        (node) =>
          node.kind === "external" &&
          node.name.includes('import("./helper")') &&
          normalizeComparablePath(node.file) === normalizeComparablePath(helperFile),
      ),
      "graph should include an external module node for dynamic import",
    );
  });

  test("treats local JSX component usage as a call edge", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "jsx-local.tsx",
      languageId: "typescriptreact",
      code: `
        function Button() {
          return null;
        }

        export function App() {
          return <Button />;
        }
      `,
    });

    const appNode = result.graph.nodes.find((node) => node.name === "App");
    const buttonNode = result.graph.nodes.find((node) => node.name === "Button");

    assert.ok(
      result.calls.some(
        (call) =>
          call.calleeName === "Button" &&
          normalizeComparablePath(call.declFile) === "jsx-local.tsx",
      ),
      "JSX component usage should appear in the call summary",
    );
    assert.ok(appNode);
    assert.ok(buttonNode);
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.label === "jsx" &&
          edge.source === appNode?.id &&
          edge.target === buttonNode?.id,
      ),
      "JSX component usage should create a calls edge between components",
    );
  });

  test("resolves imported JSX components across workspace files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-analyzer-"));
    const entryFile = path.join(root, "App.tsx");
    const buttonFile = path.join(root, "Button.tsx");

    fs.writeFileSync(
      buttonFile,
      `
        export function Button() {
          return null;
        }
      `,
      "utf8",
    );

    const result = analyzeWithWorkspace({
      active: {
        fileName: entryFile,
        languageId: "typescriptreact",
        code: `
          import { Button } from "./Button";

          export function App() {
            return <Button />;
          }
        `,
      },
      workspaceRoot: root,
      filePaths: [entryFile, buttonFile],
    });

    assert.ok(
      result.calls.some(
        (call) =>
          call.calleeName === "Button" &&
          normalizeComparablePath(call.declFile) ===
            normalizeComparablePath(buttonFile),
      ),
      "imported JSX component usage should resolve to the source file",
    );
    assert.ok(
      result.graph.nodes.some(
        (node) =>
          node.kind === "external" &&
          node.name.includes("Button") &&
          normalizeComparablePath(node.file) === normalizeComparablePath(buttonFile),
      ),
      "workspace JSX usage should create an external node for the imported component",
    );
  });

  test("promotes React hook callbacks into separate graph owners", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "react-hooks.tsx",
      languageId: "typescriptreact",
      code: `
        import { useEffect, useMemo, useCallback } from "react";

        function helper(v: number) {
          return v + 1;
        }

        export function App({ value }: { value: number }) {
          useEffect(() => {
            helper(value);
          }, [value]);

          const computed = useMemo(() => helper(value), [value]);
          const onClick = useCallback(() => helper(computed), [computed]);

          return <button onClick={onClick}>{computed}</button>;
        }
      `,
    });

    const effectNode = result.graph.nodes.find(
      (node) => node.name === "App.useEffect#1",
    );
    const memoNode = result.graph.nodes.find(
      (node) => node.name === "App.useMemo#1",
    );
    const callbackNode = result.graph.nodes.find(
      (node) => node.name === "App.useCallback#1",
    );
    const helperNode = result.graph.nodes.find((node) => node.name === "helper");

    assert.ok(effectNode, "useEffect callback should become a graph node");
    assert.ok(memoNode, "useMemo callback should become a graph node");
    assert.ok(callbackNode, "useCallback callback should become a graph node");
    assert.ok(helperNode);

    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === effectNode?.id &&
          edge.target === helperNode?.id,
      ),
      "useEffect callback should own helper() call edges",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === memoNode?.id &&
          edge.target === helperNode?.id,
      ),
      "useMemo callback should own helper() call edges",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === callbackNode?.id &&
          edge.target === helperNode?.id,
      ),
      "useCallback callback should own helper() call edges",
    );
  });

  test("connects useState and useReducer updates back to hook sources", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "react-state-hooks.tsx",
      languageId: "typescriptreact",
      code: `
        import { useEffect, useReducer, useState } from "react";

        function helper(value: number) {
          return value + 1;
        }

        function reducer(state: number, action: { type: "inc" }) {
          if (action.type === "inc") {
            return state + 1;
          }
          return state;
        }

        function init(seed: number) {
          return seed + 10;
        }

        export function App() {
          const [count, setCount] = useState(0);
          const [value, dispatch] = useReducer(reducer, 0, init);

          useEffect(() => {
            helper(count);
            helper(value);
            setCount((current) => current + 1);
            dispatch({ type: "inc" });
          }, [count, value]);

          return <button>{count + value}</button>;
        }
      `,
    });

    const effectNode = result.graph.nodes.find(
      (node) => node.name === "App.useEffect#1",
    );
    const appNode = result.graph.nodes.find((node) => node.name === "App");
    const stateHookNode = result.graph.nodes.find(
      (node) => node.name === "App.useState#1",
    );
    const reducerHookNode = result.graph.nodes.find(
      (node) => node.name === "App.useReducer#1",
    );
    const reducerNode = result.graph.nodes.find((node) => node.name === "reducer");
    const initNode = result.graph.nodes.find((node) => node.name === "init");

    assert.ok(effectNode, "useEffect callback should still become a graph node");
    assert.ok(appNode, "component should still be present as a graph owner");
    assert.ok(stateHookNode, "useState should create a hook source node");
    assert.ok(reducerHookNode, "useReducer should create a hook source node");
    assert.ok(reducerNode, "reducer function should still be present in the graph");
    assert.ok(initNode, "initializer function should still be present in the graph");

    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "updates" &&
          edge.label === "setCount" &&
          edge.source === effectNode?.id &&
          edge.target === stateHookNode?.id,
      ),
      "setCount() should create an updates edge to the originating useState hook",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "updates" &&
          edge.label === "dispatch" &&
          edge.source === effectNode?.id &&
          edge.target === reducerHookNode?.id,
      ),
      "dispatch() should create an updates edge to the originating useReducer hook",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.label === "reducer" &&
          edge.source === reducerHookNode?.id &&
          edge.target === reducerNode?.id,
      ),
      "useReducer hook source should reference its reducer function",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.label === "initializer" &&
          edge.source === reducerHookNode?.id &&
          edge.target === initNode?.id,
      ),
      "useReducer hook source should reference its initializer function",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.source === effectNode?.id &&
          edge.target === stateHookNode?.id,
      ),
      "hook callbacks should reference the originating useState source when reading state",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.source === effectNode?.id &&
          edge.target === reducerHookNode?.id,
      ),
      "hook callbacks should reference the originating useReducer source when reading reducer state",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.source === appNode?.id &&
          edge.target === stateHookNode?.id,
      ),
      "component body should reference the originating useState source when rendering state",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.source === appNode?.id &&
          edge.target === reducerHookNode?.id,
      ),
      "component body should reference the originating useReducer source when rendering state",
    );
  });

  test("recognizes aliased React hooks via symbol resolution", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "react-hook-aliases.tsx",
      languageId: "typescriptreact",
      code: `
        import React, {
          useCallback as callbackHook,
          useEffect as effect,
          useMemo as memoized,
          useReducer as reduceHook,
          useState as stateHook,
        } from "react";

        function helper(value: number) {
          return value + 1;
        }

        function reducer(state: number, action: { type: "inc" }) {
          if (action.type === "inc") {
            return state + 1;
          }
          return state;
        }

        function init(seed: number) {
          return seed + 10;
        }

        export function App() {
          const [count, setCount] = stateHook(0);
          const [value, dispatch] = reduceHook(reducer, 0, init);

          effect(() => {
            setCount((current) => current + 1);
            dispatch({ type: "inc" });
          }, []);

          const computed = memoized(() => helper(count), [count]);
          const onClick = callbackHook(() => helper(value), [value]);

          React.useLayoutEffect(() => {
            helper(computed);
          }, [computed]);

          return <button onClick={onClick}>{computed + value}</button>;
        }
      `,
    });

    const effectNode = result.graph.nodes.find(
      (node) => node.name === "App.useEffect#1",
    );
    const memoNode = result.graph.nodes.find(
      (node) => node.name === "App.useMemo#1",
    );
    const callbackNode = result.graph.nodes.find(
      (node) => node.name === "App.useCallback#1",
    );
    const layoutNode = result.graph.nodes.find(
      (node) => node.name === "App.useLayoutEffect#1",
    );
    const stateHookNode = result.graph.nodes.find(
      (node) => node.name === "App.useState#1",
    );
    const reducerHookNode = result.graph.nodes.find(
      (node) => node.name === "App.useReducer#1",
    );
    const reducerNode = result.graph.nodes.find((node) => node.name === "reducer");
    const initNode = result.graph.nodes.find((node) => node.name === "init");
    const helperNode = result.graph.nodes.find((node) => node.name === "helper");

    assert.ok(effectNode, "aliased useEffect should still create a callback node");
    assert.ok(memoNode, "aliased useMemo should still create a callback node");
    assert.ok(callbackNode, "aliased useCallback should still create a callback node");
    assert.ok(
      layoutNode,
      "React.useLayoutEffect should still create a callback node",
    );
    assert.ok(stateHookNode, "aliased useState should still create a hook source");
    assert.ok(
      reducerHookNode,
      "aliased useReducer should still create a hook source",
    );
    assert.ok(reducerNode, "reducer should still be present in the graph");
    assert.ok(initNode, "initializer should still be present in the graph");
    assert.ok(helperNode, "helper() should still be present in the graph");

    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "updates" &&
          edge.label === "setCount" &&
          edge.source === effectNode?.id &&
          edge.target === stateHookNode?.id,
      ),
      "setCount() should still update the aliased useState source",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "updates" &&
          edge.label === "dispatch" &&
          edge.source === effectNode?.id &&
          edge.target === reducerHookNode?.id,
      ),
      "dispatch() should still update the aliased useReducer source",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === memoNode?.id &&
          edge.target === helperNode?.id,
      ),
      "aliased useMemo callback should still own helper() call edges",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === callbackNode?.id &&
          edge.target === helperNode?.id,
      ),
      "aliased useCallback callback should still own helper() call edges",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === layoutNode?.id &&
          edge.target === helperNode?.id,
      ),
      "React.useLayoutEffect callback should still own helper() call edges",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.label === "reducer" &&
          edge.source === reducerHookNode?.id &&
          edge.target === reducerNode?.id,
      ),
      "aliased useReducer hook source should still reference its reducer function",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.label === "initializer" &&
          edge.source === reducerHookNode?.id &&
          edge.target === initNode?.id,
      ),
      "aliased useReducer hook source should still reference its initializer function",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.source === memoNode?.id &&
          edge.target === stateHookNode?.id,
      ),
      "aliased useMemo callback should still reference the originating useState source",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.source === callbackNode?.id &&
          edge.target === reducerHookNode?.id,
      ),
      "aliased useCallback callback should still reference the originating useReducer source",
    );
  });

  test("promotes Vue composition callbacks into separate graph owners", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "vue-hooks.ts",
      languageId: "typescript",
      code: `
        import { computed, watchEffect } from "vue";

        function helper(value: number) {
          return value + 1;
        }

        export function useCounter(seed: number) {
          const total = computed(() => helper(seed));

          watchEffect(() => {
            helper(total.value);
          });

          return { total };
        }
      `,
    });

    const computedNode = result.graph.nodes.find(
      (node) => node.name === "useCounter.computed#1",
    );
    const watchEffectNode = result.graph.nodes.find(
      (node) => node.name === "useCounter.watchEffect#1",
    );
    const helperNode = result.graph.nodes.find((node) => node.name === "helper");

    assert.ok(computedNode, "computed() callback should become a graph node");
    assert.ok(
      watchEffectNode,
      "watchEffect() callback should become a graph node",
    );
    assert.ok(helperNode, "helper() should still be present in the graph");

    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === computedNode?.id &&
          edge.target === helperNode?.id,
      ),
      "computed() callback should own helper() call edges",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === watchEffectNode?.id &&
          edge.target === helperNode?.id,
      ),
      "watchEffect() callback should own helper() call edges",
    );
  });

  test("recognizes aliased and namespace Vue composition callbacks", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "vue-hook-aliases.ts",
      languageId: "typescript",
      code: `
        import { computed as makeComputed, watchEffect as effect } from "vue";
        import * as Vue from "vue";

        function helper(value: number) {
          return value + 1;
        }

        export function useCounter(seed: number) {
          const total = makeComputed(() => helper(seed));

          effect(() => {
            helper(total.value);
          });

          Vue.watchPostEffect(() => {
            helper(seed);
          });

          return { total };
        }
      `,
    });

    const computedNode = result.graph.nodes.find(
      (node) => node.name === "useCounter.computed#1",
    );
    const watchEffectNode = result.graph.nodes.find(
      (node) => node.name === "useCounter.watchEffect#1",
    );
    const postEffectNode = result.graph.nodes.find(
      (node) => node.name === "useCounter.watchPostEffect#1",
    );
    const helperNode = result.graph.nodes.find((node) => node.name === "helper");

    assert.ok(computedNode, "aliased computed() should still create a callback node");
    assert.ok(
      watchEffectNode,
      "aliased watchEffect() should still create a callback node",
    );
    assert.ok(
      postEffectNode,
      "Vue.watchPostEffect() should still create a callback node",
    );
    assert.ok(helperNode, "helper() should still be present in the graph");

    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === computedNode?.id &&
          edge.target === helperNode?.id,
      ),
      "aliased computed() callback should still own helper() call edges",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === watchEffectNode?.id &&
          edge.target === helperNode?.id,
      ),
      "aliased watchEffect() callback should still own helper() call edges",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === postEffectNode?.id &&
          edge.target === helperNode?.id,
      ),
      "Vue.watchPostEffect() callback should still own helper() call edges",
    );
  });

  test("creates Vue state source nodes and tracks watch callbacks", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "vue-state-hooks.ts",
      languageId: "typescript",
      code: `
        import { computed, reactive, ref, watch } from "vue";

        function helper(value: number) {
          return value + 1;
        }

        export function useCounter(seed: number) {
          const count = ref(seed);
          const state = reactive({ step: 1 });

          const total = computed(() => helper(count.value + state.step));

          watch(count, () => {
            helper(state.step);
            count.value = helper(state.step);
            state.step += 1;
          });

          return { count, state, total };
        }
      `,
    });

    const ownerNode = result.graph.nodes.find(
      (node) => node.name === "useCounter",
    );
    const computedNode = result.graph.nodes.find(
      (node) => node.name === "useCounter.computed#1",
    );
    const watchNode = result.graph.nodes.find(
      (node) => node.name === "useCounter.watch#1",
    );
    const refNode = result.graph.nodes.find(
      (node) => node.name === "useCounter.ref#1",
    );
    const reactiveNode = result.graph.nodes.find(
      (node) => node.name === "useCounter.reactive#1",
    );
    const helperNode = result.graph.nodes.find((node) => node.name === "helper");

    assert.ok(refNode, "ref() should create a state source node");
    assert.ok(reactiveNode, "reactive() should create a state source node");
    assert.ok(computedNode, "computed() callback should still become a graph node");
    assert.ok(watchNode, "watch() callback should become a graph node");
    assert.ok(helperNode, "helper() should still be present in the graph");
    assert.ok(ownerNode, "composable owner should still be present");

    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.source === computedNode?.id &&
          edge.target === refNode?.id,
      ),
      "computed() callback should reference the originating ref() source",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.source === computedNode?.id &&
          edge.target === reactiveNode?.id,
      ),
      "computed() callback should reference the originating reactive() source",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.source === watchNode?.id &&
          edge.target === reactiveNode?.id,
      ),
      "watch() callback should reference the originating reactive() source",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "references" &&
          edge.source === ownerNode?.id &&
          edge.target === refNode?.id,
      ),
      "composable body should reference the originating ref() source when returning it",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "updates" &&
          edge.source === watchNode?.id &&
          edge.target === refNode?.id,
      ),
      "watch() callback should update the originating ref() source",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "updates" &&
          edge.source === watchNode?.id &&
          edge.target === reactiveNode?.id,
      ),
      "watch() callback should update the originating reactive() source",
    );
  });

  test("promotes Express route callbacks into separate graph owners", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "express-routes.ts",
      languageId: "typescript",
      code: `
        import express, { Router } from "express";

        function loadUsers() {
          return ["alice", "bob"];
        }

        export function registerRoutes() {
          const app = express();
          const router = Router();

          app.get("/users", (_req, _res) => {
            return loadUsers();
          });

          router.post("/users", (_req, _res) => {
            return loadUsers();
          });

          return { app, router };
        }
      `,
    });

    const getRouteNode = result.graph.nodes.find(
      (node) => node.name === "registerRoutes.route.get:/users#1",
    );
    const postRouteNode = result.graph.nodes.find(
      (node) => node.name === "registerRoutes.route.post:/users#1",
    );
    const helperNode = result.graph.nodes.find((node) => node.name === "loadUsers");

    assert.ok(getRouteNode, "app.get() callback should become a graph node");
    assert.ok(postRouteNode, "router.post() callback should become a graph node");
    assert.ok(helperNode, "loadUsers() should still be present in the graph");

    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === getRouteNode?.id &&
          edge.target === helperNode?.id,
      ),
      "app.get() callback should own loadUsers() call edges",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === postRouteNode?.id &&
          edge.target === helperNode?.id,
      ),
      "router.post() callback should own loadUsers() call edges",
    );
  });

  test("connects Express named handlers and middleware to route owners", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "express-named-handlers.ts",
      languageId: "typescript",
      code: `
        import express from "express";

        function requireAuth() {
          return "auth";
        }

        function listUsers() {
          return ["alice", "bob"];
        }

        export function registerRoutes() {
          const app = express();

          app.use("/api", requireAuth);
          app.get("/users", listUsers);

          return app;
        }
      `,
    });

    const middlewareNode = result.graph.nodes.find(
      (node) => node.name === "registerRoutes.route.use:/api#1",
    );
    const routeNode = result.graph.nodes.find(
      (node) => node.name === "registerRoutes.route.get:/users#1",
    );
    const authNode = result.graph.nodes.find(
      (node) => node.name === "requireAuth",
    );
    const listUsersNode = result.graph.nodes.find(
      (node) => node.name === "listUsers",
    );

    assert.ok(middlewareNode, "app.use() should create a route owner node");
    assert.ok(routeNode, "named route handler should still create a route owner node");
    assert.ok(authNode, "requireAuth() should still be present in the graph");
    assert.ok(listUsersNode, "listUsers() should still be present in the graph");

    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === middlewareNode?.id &&
          edge.target === authNode?.id,
      ),
      "app.use() route owner should call the named middleware handler",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === routeNode?.id &&
          edge.target === listUsersNode?.id,
      ),
      "app.get() route owner should call the named route handler",
    );
  });

  test("promotes Nest controller methods into route owners", () => {
    const result = analyzeTypeScriptWithTypes({
      fileName: "nest-controller.ts",
      languageId: "typescript",
      code: `
        import { Controller, Get, Post } from "@nestjs/common";

        export class UsersService {
          findAll() {
            return ["alice", "bob"];
          }

          create() {
            return { ok: true };
          }
        }

        @Controller("users")
        export class UsersController {
          constructor(private readonly usersService: UsersService) {}

          @Get()
          listUsers() {
            return this.usersService.findAll();
          }

          @Post("invite")
          inviteUser() {
            return this.usersService.create();
          }
        }
      `,
    });

    const getRouteNode = result.graph.nodes.find(
      (node) => node.name === "UsersController.route.get:/users#1",
    );
    const postRouteNode = result.graph.nodes.find(
      (node) => node.name === "UsersController.route.post:/users/invite#1",
    );
    const listUsersNode = result.graph.nodes.find(
      (node) => node.name === "UsersController.listUsers",
    );
    const inviteUserNode = result.graph.nodes.find(
      (node) => node.name === "UsersController.inviteUser",
    );

    assert.ok(getRouteNode, "@Get() should create a route owner node");
    assert.ok(postRouteNode, "@Post() should create a route owner node");
    assert.ok(listUsersNode, "controller method should still be present");
    assert.ok(inviteUserNode, "controller method should still be present");

    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === getRouteNode?.id &&
          edge.target === listUsersNode?.id,
      ),
      "@Get() route owner should call the controller method",
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.source === postRouteNode?.id &&
          edge.target === inviteUserNode?.id,
      ),
      "@Post() route owner should call the controller method",
    );
  });

  test("resolves workspace calls across sibling files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-analyzer-"));
    const entryFile = path.join(root, "entry.ts");
    const helperFile = path.join(root, "helper.ts");

    fs.writeFileSync(
      helperFile,
      `
        export function helper(value: string) {
          return value.toUpperCase();
        }
      `,
      "utf8",
    );

    const result = analyzeWithWorkspace({
      active: {
        fileName: entryFile,
        languageId: "typescript",
        code: `
          import { helper } from "./helper";

          export function run() {
            return helper("ok");
          }
        `,
      },
      workspaceRoot: root,
      filePaths: [entryFile, helperFile],
    });

    assert.ok(
      result.calls.some(
        (call) =>
          call.calleeName === "helper" &&
          normalizeComparablePath(call.declFile) ===
            normalizeComparablePath(helperFile),
      ),
      "workspace analysis should resolve helper() into the sibling file declaration",
    );

    assert.ok(
      result.graph.nodes.some(
        (node) =>
          node.kind === "external" &&
          normalizeComparablePath(node.file) === normalizeComparablePath(helperFile),
      ),
      "workspace graph should include an external node for the resolved sibling declaration",
    );
  });
  // --- typed React setters and dispatch (EXP-01 finding, P1-J1) -------------
  // With a typed `react`, the resolved signature of `setX(...)` points at the function type in the
  // declaration file. A setter or dispatch bound by a registered state hook must still be `updates`.
  const REACT_SHIMS: Record<string, string> = {
    // EXP-01 fixture style: setter/dispatch function types inside the return tuple, one line each
    "tuple-one-line": [
      "export declare function useState<S>(initial: S): [S, (next: S | ((prev: S) => S)) => void];",
      "export declare function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, (action: A) => void];",
      "",
    ].join("\n"),
    // @types/react style: aliases on their own lines
    "alias-split": [
      "export type SetStateAction<S> = S | ((prev: S) => S);",
      "export type Dispatch<A> = (value: A) => void;",
      "export declare function useState<S>(initial: S): [S, Dispatch<SetStateAction<S>>];",
      "export declare function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, Dispatch<A>];",
      "",
    ].join("\n"),
  };

  function analyzeTypedReact(shim: string | null, code: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-typed-react-"));
    const mainFile = path.join(root, "main.ts");
    const shimFile = path.join(root, "shims", "react.d.ts");
    fs.mkdirSync(path.dirname(shimFile), { recursive: true });
    fs.writeFileSync(shimFile, shim ?? 'declare module "react";\n', "utf8");
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noEmit: true,
          types: [],
          paths: shim ? { react: ["./shims/react.d.ts"] } : {},
        },
        include: ["**/*.ts"],
      }),
      "utf8",
    );
    fs.writeFileSync(mainFile, code, "utf8");
    try {
      clearAnalyzerCaches();
      const result = analyzeWithWorkspace({
        active: { fileName: mainFile, languageId: "typescript", code },
        workspaceRoot: root,
        filePaths: [mainFile, shimFile],
        cacheEnabled: false,
      });
      const byId = new Map(result.graph.nodes.map((n) => [n.id, n]));
      // external names carry the declaration file, e.g. "useState (react.d.ts)"
      const nameOf = (id: string) => (byId.get(id)?.name ?? id).replace(/ \(.*$/, "");
      const edges = result.graph.edges.map(
        (e) => `${e.kind} ${nameOf(e.source)} -> ${nameOf(e.target)}`,
      );
      const externals = result.graph.nodes
        .filter((n) => n.kind === "external")
        .map((n) => n.name.replace(/ \(.*$/, ""));
      return { result, edges, externals };
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  const COUNTER = `import { useReducer, useState } from "react";

function reducer(state: number, action: { type: "inc" }): number {
  return action.type === "inc" ? state + 1 : state;
}

function helper(value: number): number {
  return value + 1;
}

export function Counter() {
  const [count, setCount] = useState(0);
  const [value, dispatch] = useReducer(reducer, 0);
  const [, setLabel] = useState("idle");

  function increment() {
    setCount(helper(count));
    setLabel("busy");
  }

  function step() {
    dispatch({ type: "inc" });
  }

  return { value, increment, step };
}
`;

  for (const [variant, shim] of [["untyped", null], ...Object.entries(REACT_SHIMS)] as Array<[string, string | null]>) {
    test(`typed React (${variant}): setter and dispatch calls are updates to their hook sources`, () => {
      const { edges, externals } = analyzeTypedReact(shim, COUNTER);

      assert.ok(edges.includes("updates increment -> Counter.useState#1"), `${variant}: setCount -> useState#1\n${edges.join("\n")}`);
      assert.ok(edges.includes("updates increment -> Counter.useState#2"), `${variant}: setLabel (omitted state) -> useState#2`);
      assert.ok(edges.includes("updates step -> Counter.useReducer#1"), `${variant}: dispatch -> useReducer#1`);

      // no setter/dispatch call is emitted as an ordinary call, and no external node for their function types
      for (const name of ["setCount", "setLabel", "dispatch"]) {
        assert.ok(!externals.includes(name), `${variant}: no external node named ${name}`);
      }
      assert.ok(!edges.some((e) => /^(calls|dataflow) (increment|step) -> (setCount|setLabel|dispatch)/.test(e)), `${variant}: no calls/dataflow to setter types`);

      // ordinary calls and dataflow are unchanged
      assert.ok(edges.includes("calls increment -> helper"), `${variant}: helper call kept`);
      assert.ok(edges.includes("dataflow increment -> helper"), `${variant}: helper dataflow kept`);
      assert.ok(edges.includes("calls Counter -> reducer") === false, `${variant}: reducer is passed, not called`);
      if (shim) {
        assert.ok(edges.includes("calls Counter -> useState"), `${variant}: useState call kept`);
        assert.ok(edges.includes("dataflow Counter -> useState"), `${variant}: useState dataflow kept`);
        assert.ok(edges.includes("calls Counter -> useReducer"), `${variant}: useReducer call kept`);
        assert.deepStrictEqual([...new Set(externals)].sort(), ["useReducer", "useState"], `${variant}: only hook declarations are external`);
      }
    });
  }

  test("typed React: functions that only look like setters stay ordinary calls", () => {
    const { edges } = analyzeTypedReact(
      REACT_SHIMS["alias-split"],
      `import { useState } from "react";

function setCount(n: number): number {
  return n;
}

export function Panel() {
  const [count, setTotal] = useState(0);
  function apply() {
    setCount(count);
    setTotal(1);
  }
  return apply;
}

export function Other() {
  const setTotal = (n: number) => n * 2;
  function apply() {
    setTotal(3);
  }
  return apply;
}
`,
    );
    assert.ok(edges.includes("calls apply -> setCount"), `module function named setCount is a call\n${edges.join("\n")}`);
    assert.ok(edges.includes("dataflow apply -> setCount"), "and keeps its dataflow");
    assert.ok(!edges.some((e) => e.startsWith("updates") && e.endsWith("-> setCount")), "setCount is not an update");
    assert.strictEqual(edges.filter((e) => e === "updates apply -> Panel.useState#1").length, 1, "Panel's setter is an update");
    assert.ok(edges.includes("calls apply -> setTotal"), "Other's local setTotal (same name, different scope) is a call");
    assert.ok(!edges.includes("updates apply -> Other.useState#1"), "no hook source for Other");
  });

  test("typed React: calling the state value is not turned into an update", () => {
    const { edges } = analyzeTypedReact(
      REACT_SHIMS["tuple-one-line"],
      `import { useState } from "react";

function make(): () => number {
  return () => 1;
}

export function Lazy() {
  const [getValue, setGetValue] = useState(make());
  function read() {
    return getValue();
  }
  function reset() {
    setGetValue(make());
  }
  return { read, reset };
}
`,
    );
    assert.ok(!edges.some((e) => e.startsWith("updates read")), `state value call is not an update\n${edges.join("\n")}`);
    assert.ok(edges.includes("updates reset -> Lazy.useState#1"), "the setter still is");
    assert.ok(edges.includes("calls reset -> make"), "setter argument calls are kept");
  });

  // --- shorthand property references (EXP-01 REF-SHORTHAND-PROPERTY, P1-J2) ---
  // In `{ count }` the identifier resolves to the property symbol, whose only declaration is the
  // shorthand itself. The reference must follow the shorthand value symbol to an existing graph node
  // (function, hook state source), and must not be guessed when there is none.
  const VUE_SHIM = [
    "export declare function ref<T>(value: T): { value: T };",
    "export declare function reactive<T extends object>(value: T): T;",
    "",
  ].join("\n");

  function analyzeWithModules(modules: Record<string, string>, code: string, extraFiles: Record<string, string> = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-shorthand-"));
    const mainFile = path.join(root, "main.ts");
    const filePaths = [mainFile];
    const paths: Record<string, string[]> = {};
    for (const [mod, content] of Object.entries(modules)) {
      const shim = path.join(root, "shims", `${mod}.d.ts`);
      fs.mkdirSync(path.dirname(shim), { recursive: true });
      fs.writeFileSync(shim, content, "utf8");
      filePaths.push(shim);
      paths[mod] = [`./shims/${mod}.d.ts`];
    }
    for (const [rel, content] of Object.entries(extraFiles)) {
      const file = path.join(root, rel);
      fs.writeFileSync(file, content, "utf8");
      filePaths.push(file);
    }
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, types: [], paths },
        include: ["**/*.ts"],
      }),
      "utf8",
    );
    fs.writeFileSync(mainFile, code, "utf8");
    try {
      clearAnalyzerCaches();
      const result = analyzeWithWorkspace({
        active: { fileName: mainFile, languageId: "typescript", code },
        workspaceRoot: root,
        filePaths,
        cacheEnabled: false,
      });
      const byId = new Map(result.graph.nodes.map((n) => [n.id, n]));
      const nameOf = (id: string) => (byId.get(id)?.name ?? id).replace(/ \(.*$/, "");
      const edges = result.graph.edges.map((e) => `${e.kind} ${nameOf(e.source)} -> ${nameOf(e.target)}`);
      return { result, edges, refs: edges.filter((e) => e.startsWith("references ")) };
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  test("shorthand: plain functions and arrow-function values are referenced; plain locals and self are not", () => {
    const { refs, edges } = analyzeWithModules(
      {},
      `function validate(): boolean {
  return true;
}

export function App() {
  function increment(): void {}
  const helper = (): number => 1;
  const plain = 1;
  return { validate, increment, helper, plain };
}

export function self() {
  return { self };
}
`,
    );
    for (const target of ["validate", "increment", "helper"]) {
      assert.ok(refs.includes(`references App -> ${target}`), `App -> ${target}\n${refs.join("\n")}`);
    }
    assert.ok(!refs.some((e) => e.endsWith("-> plain")), "no node, no reference");
    assert.ok(!refs.includes("references self -> self"), "no self reference");
    assert.ok(!edges.some((e) => e.startsWith("calls App")), "shorthand is not a call");
  });

  for (const [variant, shim] of Object.entries(REACT_SHIMS)) {
    test(`shorthand (${variant}): React useState / useReducer values reference their state sources`, () => {
      const { refs, edges } = analyzeWithModules(
        { react: shim },
        `import { useReducer, useState } from "react";

function reducer(state: number, action: { type: "inc" }): number {
  return action.type === "inc" ? state + 1 : state;
}

export function Counter() {
  const [count, setCount] = useState(0);
  const [total, dispatch] = useReducer(reducer, 0);

  function increment() {
    setCount(count + 1);
    dispatch({ type: "inc" });
  }

  return { count, total, increment, again: count, nested: { count } };
}
`,
      );
      assert.ok(refs.includes("references Counter -> Counter.useState#1"), `${variant}: count -> useState#1\n${refs.join("\n")}`);
      assert.ok(refs.includes("references Counter -> Counter.useReducer#1"), `${variant}: total -> useReducer#1`);
      assert.ok(refs.includes("references Counter -> increment"), `${variant}: increment`);
      assert.strictEqual(refs.filter((e) => e === "references Counter -> Counter.useState#1").length, 1, `${variant}: shorthand, key: value and nested uses give one relation`);
      // setter / dispatch stay updates (P1-J1)
      assert.ok(edges.includes("updates increment -> Counter.useState#1"), `${variant}: setCount update kept`);
      assert.ok(edges.includes("updates increment -> Counter.useReducer#1"), `${variant}: dispatch update kept`);
      assert.ok(edges.includes("references increment -> Counter.useState#1"), `${variant}: count read in increment kept`);
      assert.ok(edges.includes("calls Counter -> useState") && edges.includes("dataflow Counter -> useState"), `${variant}: hook call and dataflow kept`);
    });
  }

  test("shorthand: Vue ref and reactive values reference their state sources, mixed with functions", () => {
    const { refs, edges } = analyzeWithModules(
      { vue: VUE_SHIM },
      `import { reactive, ref } from "vue";

export function useCart() {
  const items = ref(0);
  const state = reactive({ open: false });

  function add() {
    items.value++;
  }

  return { items, state, add };
}
`,
    );
    assert.ok(refs.includes("references useCart -> useCart.ref#1"), `items -> ref#1\n${refs.join("\n")}`);
    assert.ok(refs.includes("references useCart -> useCart.reactive#1"), "state -> reactive#1");
    assert.ok(refs.includes("references useCart -> add"), "add");
    assert.ok(edges.includes("updates add -> useCart.ref#1"), "items.value++ update kept");
  });

  test("shorthand: same names in other scopes, key: value, destructuring and imports are not misattributed", () => {
    const { refs } = analyzeWithModules(
      { react: REACT_SHIMS["alias-split"] },
      `import { useState } from "react";
import { shared } from "./other";

function validate(): boolean {
  return true;
}

export function Outer() {
  const [count, setCount] = useState(0);
  return { count, setCount };
}

export function Inner() {
  const count = 5;
  return { count };
}

export function Flags() {
  return { validate: true };
}

export function Picks(input: { validate: number }) {
  const { validate } = input;
  return { validate };
}

export function Imports() {
  return { shared, alias: shared };
}
`,
      { "other.ts": "export function shared(): number {\n  return 1;\n}\n" },
    );
    assert.ok(refs.includes("references Outer -> Outer.useState#1"), `Outer count\n${refs.join("\n")}`);
    assert.ok(!refs.some((e) => e.startsWith("references Inner ")), "Inner's own count is a plain local, not Outer's state");
    assert.ok(!refs.some((e) => e.startsWith("references Flags ")), "a property key named like a function is not a reference");
    assert.ok(!refs.some((e) => e.startsWith("references Picks ")), "destructured local shadows the module function");
    // imported values: shorthand behaves exactly like `alias: shared` (cross-file references are not emitted)
    const importRefs = refs.filter((e) => e.startsWith("references Imports "));
    assert.deepStrictEqual(importRefs, [], "no reference to the imported declaration");
  });

});
