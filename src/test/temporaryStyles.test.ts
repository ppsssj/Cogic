import * as assert from "assert";
import { withTemporaryStyles, type InlineStyle } from "../shared/temporaryStyles";

/** A Map-backed stand-in for CSSStyleDeclaration. */
function fakeElement(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const priorities = new Map<string, string>();
  const style: InlineStyle = {
    getPropertyValue: (p) => values.get(p) ?? "",
    getPropertyPriority: (p) => priorities.get(p) ?? "",
    setProperty: (p, v, priority = "") => {
      values.set(p, v);
      priorities.set(p, priority);
    },
    removeProperty: (p) => {
      const old = values.get(p) ?? "";
      values.delete(p);
      priorities.delete(p);
      return old;
    },
  };
  return { style, values };
}

const PROPS = ["width", "height", "overflow", "background", "transform"];
const VIEWPORT = "translate(27.5893px,354.872px) scale(0.30172)";

function exportLike(viewport: ReturnType<typeof fakeElement>, root: ReturnType<typeof fakeElement>) {
  root.style.setProperty("width", "2000px");
  root.style.setProperty("overflow", "hidden");
  root.style.setProperty("background", "#081226");
  viewport.style.setProperty("transform", "translate(96px, 96px) scale(1)");
}

suite("Export restores temporary styles", () => {
  test("a normal export restores the viewport transform and removes added properties", async () => {
    const viewport = fakeElement({ transform: VIEWPORT });
    const root = fakeElement({ height: "100%" });
    const out = await withTemporaryStyles([root, viewport], PROPS, async () => {
      exportLike(viewport, root);
      return "data:image/svg+xml,...";
    });
    assert.strictEqual(out, "data:image/svg+xml,...");
    assert.deepStrictEqual([...viewport.values], [["transform", VIEWPORT]]);
    assert.deepStrictEqual([...root.values], [["height", "100%"]]);
  });

  test("a conversion failure after the changes still restores everything", async () => {
    const viewport = fakeElement({ transform: VIEWPORT });
    const root = fakeElement();
    await assert.rejects(
      withTemporaryStyles([root, viewport], PROPS, async () => {
        exportLike(viewport, root);
        await Promise.resolve();
        throw new Error("toJpeg failed");
      }),
      /toJpeg failed/,
    );
    assert.strictEqual(viewport.style.getPropertyValue("transform"), VIEWPORT);
    assert.strictEqual(root.values.size, 0);
  });

  test("a failure halfway through the changes still restores everything", async () => {
    const viewport = fakeElement({ transform: VIEWPORT });
    const root = fakeElement({ width: "10px" });
    await assert.rejects(
      withTemporaryStyles([root, viewport], PROPS, async () => {
        root.style.setProperty("width", "2000px");
        throw new Error("node went away");
      }),
      /node went away/,
    );
    assert.strictEqual(root.style.getPropertyValue("width"), "10px");
    assert.strictEqual(viewport.style.getPropertyValue("transform"), VIEWPORT);
  });

  test("the priority of an inline value is kept", async () => {
    const el = fakeElement();
    el.style.setProperty("overflow", "visible", "important");
    await withTemporaryStyles([el], PROPS, async () => el.style.setProperty("overflow", "hidden"));
    assert.strictEqual(el.style.getPropertyValue("overflow"), "visible");
    assert.strictEqual(el.style.getPropertyPriority("overflow"), "important");
  });

  test("consecutive exports each return to the same state", async () => {
    const viewport = fakeElement({ transform: VIEWPORT });
    const root = fakeElement();
    for (const fail of [false, true, false]) {
      await withTemporaryStyles([root, viewport], PROPS, async () => {
        exportLike(viewport, root);
        if (fail) {
          throw new Error("x");
        }
      }).catch(() => undefined);
      assert.deepStrictEqual([...viewport.values], [["transform", VIEWPORT]]);
      assert.strictEqual(root.values.size, 0);
    }
  });
});
