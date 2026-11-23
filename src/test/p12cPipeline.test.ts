import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { analyzeWorkspaceDepth, clearAnalyzerCaches } from "../analyzer";
import { pipelineProfile } from "../panel/pipelineProfile";
import { summarizePipeline, type PipelineRecord } from "../panel/pipelineSummary";

suite("P12-C pipeline diagnostics", () => {
  test("keeps request IDs, clock domains, incomplete, duplicate and dropped requests distinct", () => {
    const row = (requestId: string, event: string, monotonicMs: number, webMs?: number): PipelineRecord => ({
      requestId, event, monotonicMs, webview: webMs === undefined ? undefined : { monotonicMs: webMs },
    });
    const result = summarizePipeline([
      row("one", "pipeline.request.sent", 900, 10), row("one", "request.begin", 1000),
      row("two", "request.begin", 1001), row("two", "request.begin", 1002),
      row("one", "postMessage.call", 1100), row("one", "pipeline.result.received", 1120, 120),
      row("two", "request.dropped", 1130), row("one", "pipeline.canvas.commit", 1140, 140),
      row("one", "pipeline.canvas.twoAnimationFrames", 1160, 160), row("missing", "request.begin", 1200),
    ]);
    assert.deepStrictEqual(result[0], { requestId: "one", duplicateBegin: false, status: "frame-observed", hostRequestToPostMs: 100, hostPostToWebviewAckMs: 20, webRequestToReceiveMs: 110, webReceiveToCommitMs: 20, webReceiveToTwoFramesMs: 40 });
    assert.strictEqual(result[1].status, "dropped");
    assert.strictEqual(result[1].duplicateBegin, true);
    assert.strictEqual(result[2].webReceiveToCommitMs, null);
  });

  test("disabled output and diagnostic write failures do not throw", () => {
    const old = process.env.COGIC_PIPELINE_PROFILE;
    try {
      delete process.env.COGIC_PIPELINE_PROFILE;
      assert.doesNotThrow(() => pipelineProfile("test", "id"));
      process.env.COGIC_PIPELINE_PROFILE = path.join(os.tmpdir(), "missing-p12c-directory", "log.jsonl");
      assert.doesNotThrow(() => pipelineProfile("test", "id"));
    } finally {
      if (old === undefined) {delete process.env.COGIC_PIPELINE_PROFILE;} else {process.env.COGIC_PIPELINE_PROFILE = old;}
    }
  });

  test("JSONL events preserve order and request IDs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cogic-p12c-log-"));
    const old = process.env.COGIC_PIPELINE_PROFILE;
    const file = path.join(root, "events.jsonl");
    try {
      process.env.COGIC_PIPELINE_PROFILE = file;
      pipelineProfile("request.begin", "a");
      pipelineProfile("request.begin", "b");
      pipelineProfile("request.dropped", "a", { reason: "stale" });
      const rows = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.deepStrictEqual(rows.map((row) => [row.requestId, row.event]), [["a", "request.begin"], ["b", "request.begin"], ["a", "request.dropped"]]);
      assert.ok(rows[0].monotonicMs <= rows[2].monotonicMs);
    } finally {
      if (old === undefined) {delete process.env.COGIC_PIPELINE_PROFILE;} else {process.env.COGIC_PIPELINE_PROFILE = old;}
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("depth profiling preserves the complete result and records frontier order", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cogic-p12c-"));
    const first = path.join(root, "a.ts"), second = path.join(root, "b.ts");
    fs.writeFileSync(first, 'import { b } from "./b"; export function a(x: number) { return b(x); }');
    fs.writeFileSync(second, "export function b(x: number) { return x + 1; }");
    const args = { code: fs.readFileSync(first, "utf8"), fileName: first, languageId: "typescript", traceMode: false, graphDepth: 2, traceScope: "single-file" as const, workspaceRoot: root, filePaths: [first, second], cacheEnabled: true, readFile: async (file: string) => fs.promises.readFile(file, "utf8") };
    try {
      clearAnalyzerCaches();
      const off = await analyzeWorkspaceDepth(args);
      clearAnalyzerCaches();
      const events: string[] = [];
      const on = await analyzeWorkspaceDepth({ ...args, profile: (event) => events.push(event) });
      assert.deepStrictEqual(on, off);
      assert.strictEqual(events[0], "depth.frontier");
      assert.ok(events.includes("depth.target.end"));
      assert.ok(events.indexOf("depth.merge") < events.indexOf("depth.target.end"));
      assert.strictEqual(events[events.length - 1], "depth.frontier");
    } finally {
      clearAnalyzerCaches();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
