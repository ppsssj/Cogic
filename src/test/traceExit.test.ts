import * as assert from "assert";
import { decideTraceExit, type PreTraceTarget, type TraceExitState } from "../shared/traceExit";

const ROOT = { kind: "file" as const, path: "c:/w/src/main.ts" };
const snapshot = (over: Partial<PreTraceTarget> = {}): PreTraceTarget => ({
  hasGraph: true,
  root: null,
  graphDepth: 2,
  workspaceRoot: "c:/w",
  activeFileUri: "file:///c:/w/src/main.ts",
  ...over,
});
// Starting a trace clears the root, so an unchanged session ends with root null.
const now = (over: Partial<TraceExitState> = {}): TraceExitState => ({
  root: null,
  graphDepth: 2,
  workspaceRoot: "c:/w",
  activeFileUri: "file:///c:/w/src/main.ts",
  sourceChanged: false,
  generationKnown: true,
  hasTarget: true,
  ...over,
});

suite("Trace exit", () => {
  test("the graph from before the trace comes back when nothing changed", () => {
    assert.strictEqual(decideTraceExit(snapshot(), now()), "restore");
    assert.strictEqual(decideTraceExit(snapshot({ root: ROOT }), now()), "restore");
    assert.strictEqual(decideTraceExit(snapshot({ root: ROOT }), now({ root: ROOT })), "restore");
  });

  test("no graph before the trace: analyze the target, or show the empty state", () => {
    assert.strictEqual(decideTraceExit(null, now()), "reanalyze");
    assert.strictEqual(decideTraceExit(snapshot({ hasGraph: false }), now()), "reanalyze");
    assert.strictEqual(decideTraceExit(snapshot({ hasGraph: false }), now({ hasTarget: false })), "empty");
  });

  test("a root chosen during the trace is analyzed instead", () => {
    const other = { kind: "file" as const, path: "c:/w/src/app/a.ts" };
    assert.strictEqual(decideTraceExit(snapshot({ root: ROOT }), now({ root: other })), "reanalyze");
    assert.strictEqual(decideTraceExit(snapshot(), now({ root: other })), "reanalyze");
  });

  test("without a root, another active editor is another target", () => {
    const other = "file:///c:/w/src/app/a.ts";
    assert.strictEqual(decideTraceExit(snapshot(), now({ activeFileUri: other })), "reanalyze");
    // with a root the graph does not follow the editor
    assert.strictEqual(decideTraceExit(snapshot({ root: ROOT }), now({ activeFileUri: other })), "restore");
  });

  test("another depth or workspace is analyzed instead", () => {
    assert.strictEqual(decideTraceExit(snapshot(), now({ graphDepth: 1 })), "reanalyze");
    assert.strictEqual(decideTraceExit(snapshot(), now({ workspaceRoot: "c:/other" })), "reanalyze");
  });

  test("an edit during the trace makes the old graph out of date", () => {
    assert.strictEqual(decideTraceExit(snapshot(), now({ sourceChanged: true })), "reanalyze");
  });

  test("without a trace result the extension generation is unknown, so it analyzes again", () => {
    assert.strictEqual(decideTraceExit(snapshot(), now({ generationKnown: false })), "reanalyze");
  });

  test("the snapshot is not changed by the decision", () => {
    const s = snapshot({ root: ROOT });
    const before = JSON.stringify(s);
    decideTraceExit(s, now({ root: ROOT }));
    assert.strictEqual(JSON.stringify(s), before);
  });
});
