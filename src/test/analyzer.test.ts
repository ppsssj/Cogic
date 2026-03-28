import * as assert from "assert";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  analyzeTypeScriptWithTypes,
  analyzeWithWorkspace,
} from "../analyzer/analyze";

function normalizeComparablePath(filePath: string | null | undefined) {
  return (filePath ?? "").replace(/\\/g, "/").toLowerCase();
}

suite("Analyzer Test Suite", function () {
  this.timeout(10_000);

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
});
