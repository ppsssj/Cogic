import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AnalysisCancelledError, analyzeWorkspaceDepth, clearAnalyzerCaches } from "../analyzer";
import { activationFingerprint, shouldRetainPendingChange, shouldSuppressActivationAnalysis, shouldSuppressPendingSelectionActivation, shouldSuppressDeliveredActivation } from "../panel/workflowPolicy";

suite("P12-D cooperative cancellation", () => {
  test("explicit work suppresses only duplicate activation, never edits or a different file", () => {
    const request = { sequence: 5, fileName: "a.ts" };
    assert.strictEqual(shouldSuppressActivationAnalysis("activation", request, 5, "a.ts"), true);
    assert.strictEqual(shouldSuppressActivationAnalysis("change", request, 5, "a.ts"), false);
    assert.strictEqual(shouldSuppressActivationAnalysis("activation", request, 5, "b.ts"), false);
    assert.strictEqual(shouldSuppressActivationAnalysis("activation", request, 6, "a.ts"), false);
    assert.strictEqual(shouldSuppressActivationAnalysis("activation", undefined, 5, "a.ts"), false);
    assert.strictEqual(shouldRetainPendingChange("activation", "change"), true);
    assert.strictEqual(shouldRetainPendingChange("change", "activation"), false);
    assert.strictEqual(shouldSuppressPendingSelectionActivation("activation", "b.ts", "b.ts"), true);
    assert.strictEqual(shouldSuppressPendingSelectionActivation("activation", "b.ts", "a.ts", "a.ts"), true);
    assert.strictEqual(shouldSuppressPendingSelectionActivation("activation", "b.ts", "c.ts", "a.ts"), false);
    assert.strictEqual(shouldSuppressPendingSelectionActivation("change", "b.ts", "b.ts"), false);
    assert.strictEqual(shouldSuppressPendingSelectionActivation("activation", undefined, "a.ts"), false);
    assert.strictEqual(shouldSuppressDeliveredActivation("activation", "same", "same"), true);
    assert.strictEqual(shouldSuppressDeliveredActivation("activation", "changed", "same"), false);
    assert.strictEqual(shouldSuppressDeliveredActivation("change", "same", "same"), false);
    assert.strictEqual(shouldSuppressDeliveredActivation("activation", undefined, undefined), false);
  });

  test("activation identity changes when content, scope, root or invalidation changes", () => {
    const base = { file: "a.ts", languageId: "typescript", codeHash: "one", graphDepth: 2, traceMode: false, traceScope: "single-file", cacheEpoch: 3, graphRootEpoch: 4 };
    const key = activationFingerprint(base);
    assert.strictEqual(activationFingerprint({ ...base }), key);
    for (const changed of [{ codeHash: "two" }, { graphDepth: 1 }, { traceMode: true }, { traceScope: "current-depth" }, { cacheEpoch: 4 }, { graphRootEpoch: 5 }, { file: "b.ts" }]) {
      assert.notStrictEqual(activationFingerprint({ ...base, ...changed }), key);
    }
  });

  test("superseded analysis stops after a pending read and a later analysis remains correct", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p12d-"));
    const a = path.join(root, "a.ts"), b = path.join(root, "b.ts");
    fs.writeFileSync(a, 'import { b } from "./b"; export function a(x: number) { return b(x); }');
    fs.writeFileSync(b, "export function b(x: number) { return x + 1; }");
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const readStarted = new Promise<void>((resolve) => { entered = resolve; });
    let cancelled = false, programs = 0;
    const args = { code: fs.readFileSync(a, "utf8"), fileName: a, languageId: "typescript", traceMode: false, graphDepth: 2, traceScope: "single-file" as const, workspaceRoot: root, filePaths: [a, b], cacheEnabled: true };
    try {
      const pending = analyzeWorkspaceDepth({ ...args, isCancelled: () => cancelled, debug: (event) => { if (event === "analyzer.program.created") {programs++;} }, readFile: async (file) => { entered(); await gate; return fs.promises.readFile(file, "utf8"); } });
      await readStarted;
      cancelled = true;
      release();
      await assert.rejects(pending, AnalysisCancelledError);
      assert.strictEqual(programs, 1, "no expansion Program is built after cancellation");
      const normal = await analyzeWorkspaceDepth({ ...args, readFile: (file) => fs.promises.readFile(file, "utf8") });
      clearAnalyzerCaches();
      const fresh = await analyzeWorkspaceDepth({ ...args, readFile: (file) => fs.promises.readFile(file, "utf8") });
      assert.deepStrictEqual(normal, fresh);
      assert.ok(normal.graph?.nodes.some((node) => node.name === "b"));
    } finally {
      clearAnalyzerCaches();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("pre-cancelled trace and debug requests stop before building a Program", async () => {
    let reads = 0;
    await assert.rejects(analyzeWorkspaceDepth({ code: "export const x = 1", fileName: "x.ts", languageId: "typescript", traceMode: true, graphDepth: 2, traceScope: "current-depth", workspaceRoot: null, filePaths: [], cacheEnabled: true, isCancelled: () => true, readFile: async () => { reads++; return ""; } }), AnalysisCancelledError);
    assert.strictEqual(reads, 0);
  });
});
