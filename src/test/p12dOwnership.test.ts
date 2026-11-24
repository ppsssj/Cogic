import * as assert from "assert";
import { mayApplyActiveResult, ownsLoading } from "../shared/requestOwnership";

suite("P12-D request ownership", () => {
  test("A cannot release B or replace B, including after B fails", () => {
    assert.strictEqual(ownsLoading("web-B", "web-A"), false);
    assert.strictEqual(mayApplyActiveResult("web-A", "web-B", true), false);
    assert.strictEqual(mayApplyActiveResult("web-A", "web-B", false), false);
    assert.strictEqual(ownsLoading("web-B", "web-B"), true);
    assert.strictEqual(mayApplyActiveResult("web-B", "web-B", true), true);
  });
  test("automatic results do not replace pending user work and unrelated terminals do not clear it", () => {
    assert.strictEqual(mayApplyActiveResult("active-3", "web-B", true), false);
    assert.strictEqual(mayApplyActiveResult("active-3", "web-B", false), true);
    assert.strictEqual(mayApplyActiveResult("active-3", "web-B", true, 3, 2), true);
    assert.strictEqual(mayApplyActiveResult("active-1", "web-B", true, 1, 2), false);
    assert.strictEqual(mayApplyActiveResult("active-1", "web-B", false, 1, 2), false);
    assert.strictEqual(ownsLoading("web-B", "web-expand"), false);
    assert.strictEqual(ownsLoading(null, "web-B"), false);
  });

  test("delayed A completion cannot release or apply over B after B fails", async () => {
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    let owner: string | null = "web-A", latest = "web-A", applied = "";
    const a = delayed.then(() => {
      if (mayApplyActiveResult("web-A", latest, false)) {applied = "A";}
      if (ownsLoading(owner, "web-A")) {owner = null;}
    });
    owner = "web-B";
    latest = "web-B";
    if (ownsLoading(owner, "web-B")) {owner = null;} // B fails
    release();
    await a;
    assert.strictEqual(owner, null);
    assert.strictEqual(applied, "");
  });

  test("completion or cancellation only releases its own current request", async () => {
    let owner: string | null = "web-A";
    let finishA!: () => void;
    const delayedA = new Promise<void>((resolve) => { finishA = resolve; });
    const a = delayedA.then(() => { if (ownsLoading(owner, "web-A")) {owner = null;} });
    owner = "web-B";
    finishA();
    await a;
    assert.strictEqual(owner, "web-B");
    if (ownsLoading(owner, "web-B")) {owner = null;}
    assert.strictEqual(owner, null);
    owner = "web-C";
    if (ownsLoading(owner, "web-C")) {owner = null;} // cancellation with no successor
    assert.strictEqual(owner, null);
  });
});
