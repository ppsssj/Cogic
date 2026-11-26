import * as assert from "assert";
import { overviewCollapse } from "../shared/semanticOverview";

const sorted = (set: Set<string>) => [...set].sort();

suite("Semantic zoom overview (P15-Z0 experiment)", () => {
  test("collapses leaf folders and every file, keeps folders with subfolders open", () => {
    const folders = ["c:/w/src", "c:/w/src/f0", "c:/w/src/f1", "c:/w/src/f1/deep"];
    const files = ["c:/w/src/main.ts", "c:/w/src/f0/a.ts", "c:/w/src/f1/b.ts", "c:/w/src/f1/deep/c.ts"];
    const o = overviewCollapse(folders, files);
    assert.deepStrictEqual(sorted(o.folders), ["c:/w/src/f0", "c:/w/src/f1/deep"]);
    assert.deepStrictEqual(sorted(o.files), files.slice().sort());
  });

  test("a gap in the visible folders still finds the nearest visible parent", () => {
    // c:/w/src/x is not a visible folder of its own
    const o = overviewCollapse(["c:/w/src", "c:/w/src/x/y"], []);
    assert.deepStrictEqual(sorted(o.folders), ["c:/w/src/x/y"]);
  });

  test("a single folder is a leaf; no folders means none collapsed", () => {
    assert.deepStrictEqual(sorted(overviewCollapse(["c:/w/src"], ["c:/w/src/a.ts"]).folders), ["c:/w/src"]);
    assert.deepStrictEqual(sorted(overviewCollapse([], ["c:/w/a.ts"]).folders), []);
  });

  test("does not change its inputs", () => {
    const folders = ["c:/w/src", "c:/w/src/f0"];
    const files = ["c:/w/src/f0/a.ts"];
    const before = JSON.stringify([folders, files]);
    overviewCollapse(folders, files);
    assert.strictEqual(JSON.stringify([folders, files]), before);
  });
});
