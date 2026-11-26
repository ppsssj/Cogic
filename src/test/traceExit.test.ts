import * as assert from "assert";
import {
  decideTraceExit,
  gateActiveResult,
  traceExitAnalysisTarget,
  type ActiveResultVerdict,
  type PreTraceTarget,
  type TraceExitState,
} from "../shared/traceExit";

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

suite("Trace exit: analysis target and root rules", () => {
  const folder = { kind: "folder" as const, path: "c:/w/src/app" };
  test("a file root is analyzed itself, with or without an active file", () => {
    assert.deepStrictEqual(traceExitAnalysisTarget(ROOT, null), { kind: "root-file", path: ROOT.path });
    assert.deepStrictEqual(traceExitAnalysisTarget(ROOT, "c:/w/src/app/a.ts"), { kind: "root-file", path: ROOT.path });
  });
  test("a folder root analyzes an active file directly in it", () => {
    assert.deepStrictEqual(traceExitAnalysisTarget(folder, "c:/w/src/app/a.ts"), { kind: "active-file" });
    assert.deepStrictEqual(traceExitAnalysisTarget(folder, ["C:", "w", "src", "app", "a.ts"].join("\\")), { kind: "active-file" });
  });
  test("a folder root with the active file outside it, or below it, has nothing to analyze", () => {
    assert.strictEqual(traceExitAnalysisTarget(folder, "c:/w/src/main.ts"), null);
    assert.strictEqual(traceExitAnalysisTarget(folder, "c:/w/src/app/deep/x.ts"), null);
  });
  test("a folder root without an active file has nothing to analyze", () => {
    assert.strictEqual(traceExitAnalysisTarget(folder, null), null);
  });
  test("without a root the active file is analyzed, and nothing without one", () => {
    assert.deepStrictEqual(traceExitAnalysisTarget(null, "c:/w/src/main.ts"), { kind: "active-file" });
    assert.strictEqual(traceExitAnalysisTarget(null, null), null);
  });
});

/**
 * Replays the webview's request bookkeeping (App.tsx: postMessage, analysisLifecycle "running",
 * cancelPendingTrace, the active-result apply path) around gateActiveResult, so late responses
 * can be ordered at will.
 */
class Webview {
  latestUserId: string | null = null;
  userPending = false;
  userSequence: number | undefined;
  latestApplied = 0;
  traceMode = false;
  boundary: number | null = null;
  maxStarted = 0;
  shown = "normal graph";
  send(id: string) {
    this.latestUserId = id;
    this.userPending = true;
    this.userSequence = undefined;
  }
  running(id: string, sequence: number) {
    if (this.latestUserId === id) {
      this.userSequence = sequence;
    }
    this.maxStarted = Math.max(this.maxStarted, sequence);
  }
  enterTrace(id: string) {
    this.traceMode = true;
    this.send(id);
  }
  exitTrace() {
    this.traceMode = false;
    this.boundary = this.maxStarted;
    if (this.latestUserId && this.userPending) {
      this.userPending = false;
      this.latestUserId = null;
    }
    this.shown = "restored graph";
  }
  result(id: string, sequence: number, payload: "trace" | "normal" | "empty"): ActiveResultVerdict {
    const verdict = gateActiveResult(
      { requestId: id, sequence, hasTrace: payload === "trace" },
      {
        latestUserId: this.latestUserId,
        userPending: this.userPending,
        userSequence: this.userSequence,
        latestAppliedSequence: this.latestApplied,
        traceModeActive: this.traceMode,
        traceExitBoundary: this.boundary,
      },
    );
    if (verdict === "apply") {
      if (this.latestUserId === id) {
        this.userPending = false;
      }
      this.latestApplied = sequence;
      this.shown = payload === "empty" ? "no graph" : `${payload} from ${id}`;
    }
    return verdict;
  }
}

suite("Trace exit: late responses", () => {
  test("leaving while the trace is analyzed: its result arrives later and is dropped", () => {
    const w = new Webview();
    w.enterTrace("web-1");
    w.running("web-1", 5);
    w.exitTrace();
    assert.strictEqual(w.result("web-1", 5, "trace"), "not-owner");
    assert.strictEqual(w.shown, "restored graph");
  });

  test("a trace result of the ended session from the extension itself is dropped", () => {
    const w = new Webview();
    w.enterTrace("web-1");
    w.running("web-1", 5);
    assert.strictEqual(w.result("web-1", 5, "trace"), "apply");
    w.running("auto-6", 6); // an edit during the trace started an automatic trace analysis
    w.exitTrace();
    assert.strictEqual(w.result("auto-6", 6, "trace"), "from-ended-trace");
    assert.strictEqual(w.shown, "restored graph");
  });

  test("an empty result of the ended session does not clear the graph", () => {
    const w = new Webview();
    w.enterTrace("web-1");
    w.running("web-1", 5);
    w.result("web-1", 5, "trace");
    w.running("auto-6", 6);
    w.exitTrace();
    assert.strictEqual(w.result("auto-6", 6, "empty"), "from-ended-trace");
    assert.strictEqual(w.result("auto-6", 6, "normal"), "from-ended-trace");
    assert.strictEqual(w.shown, "restored graph");
  });

  test("the new normal analysis after the exit applies, and old results stay out", () => {
    const w = new Webview();
    w.enterTrace("web-1");
    w.running("web-1", 5);
    w.exitTrace();
    w.send("web-2"); // reanalysis
    w.running("web-2", 8);
    assert.strictEqual(w.result("web-1", 5, "trace"), "not-owner");
    assert.strictEqual(w.result("web-2", 8, "normal"), "apply");
    assert.strictEqual(w.shown, "normal from web-2");
    // older than the user's request: the existing ownership rule rejects it
    assert.strictEqual(w.result("auto-6", 6, "normal"), "not-owner");
    assert.strictEqual(w.shown, "normal from web-2");
  });

  test("a new trace right after the exit gets only its own results", () => {
    const w = new Webview();
    w.enterTrace("web-1");
    w.running("web-1", 5);
    w.running("auto-6", 6);
    w.exitTrace();
    w.enterTrace("web-3");
    w.running("web-3", 9);
    assert.strictEqual(w.result("web-1", 5, "trace"), "not-owner");
    assert.strictEqual(w.result("auto-6", 6, "trace"), "not-owner");
    assert.strictEqual(w.result("web-3", 9, "trace"), "apply");
    assert.strictEqual(w.shown, "trace from web-3");
  });

  test("a trace payload whose start was reported only after the exit still cannot apply", () => {
    const w = new Webview();
    w.enterTrace("web-1");
    w.running("web-1", 5);
    w.result("web-1", 5, "trace");
    w.exitTrace();
    w.running("auto-7", 7);
    assert.strictEqual(w.result("auto-7", 7, "trace"), "trace-after-exit");
    // an automatic normal analysis after the exit is current, and applies
    w.running("auto-8", 8);
    assert.strictEqual(w.result("auto-8", 8, "normal"), "apply");
  });

  test("before any trace, nothing changes for normal results", () => {
    const w = new Webview();
    w.send("web-1");
    w.running("web-1", 3);
    assert.strictEqual(w.result("web-1", 3, "normal"), "apply");
    assert.strictEqual(w.result("auto-2", 2, "normal"), "not-owner");
  });
});
