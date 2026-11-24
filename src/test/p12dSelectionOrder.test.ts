import * as assert from "assert";
import { SelectionOrder } from "../panel/selectionOrder";

suite("P12-D selection ordering", () => {
  test("older slow document open cannot activate after newer selection", async () => {
    const order = new SelectionOrder();
    const a = order.next();
    const b = order.next();
    const shown: string[] = [];
    assert.strictEqual(await order.activate(b, async () => { shown.push("B"); return "B"; }), "B");
    assert.strictEqual(await order.activate(a, async () => { shown.push("A"); return "A"; }), undefined);
    assert.deepStrictEqual(shown, ["B"]);
  });
  test("newer selection activates after an in-flight older show", async () => {
    const order = new SelectionOrder();
    const a = order.next();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const shown: string[] = [];
    const old = order.activate(a, async () => { await gate; shown.push("A"); return "A"; });
    await Promise.resolve();
    const b = order.next();
    const next = order.activate(b, async () => { shown.push("B"); return "B"; });
    release();
    assert.strictEqual(await old, undefined);
    assert.strictEqual(await next, "B");
    assert.deepStrictEqual(shown, ["A", "B"]);
  });
});
