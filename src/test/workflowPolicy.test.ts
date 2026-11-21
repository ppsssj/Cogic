import * as assert from "assert";
import { shouldAutoAnalyzeEditorChange } from "../panel/workflowPolicy";

suite("Exploration workflow policy", () => {
  test("keeps the graph when a debug session opens a file", () => {
    assert.strictEqual(shouldAutoAnalyzeEditorChange(true, true), false);
  });

  test("keeps normal editor navigation automatic when root allows it", () => {
    assert.strictEqual(shouldAutoAnalyzeEditorChange(false, true), true);
    assert.strictEqual(shouldAutoAnalyzeEditorChange(false, false), false);
  });
});
