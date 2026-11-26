import * as assert from "assert";
import {
  createLowDetailMode,
  LOW_DETAIL_ENTER_ZOOM,
  LOW_DETAIL_EXIT_ZOOM,
  nextLowDetailEdges,
} from "../shared/edgeDetail";

/**
 * The canvas side (LowDetailEdges): while running, the class follows the mode; a pause (export)
 * removes the class; resuming puts back the mode and goes on from the current zoom.
 */
function canvas(mode = createLowDetailMode()) {
  let cls = false;
  let paused = false;
  const apply = (zoom: number) => {
    const next = mode.update(zoom);
    if (next !== null) {
      cls = next;
    }
  };
  return {
    zoom(z: number) {
      if (!paused) {
        apply(z);
      }
    },
    pause() {
      paused = true;
      cls = false;
    },
    resume(z: number) {
      paused = false;
      cls = mode.low;
      apply(z);
    },
    get low() {
      return cls;
    },
  };
}

suite("Low-detail edges hysteresis", () => {
  test("enters at 0.20 and below, leaves at 0.25 and above", () => {
    assert.strictEqual(LOW_DETAIL_ENTER_ZOOM, 0.2);
    assert.strictEqual(LOW_DETAIL_EXIT_ZOOM, 0.25);
    assert.strictEqual(nextLowDetailEdges(false, 0.2), true);
    assert.strictEqual(nextLowDetailEdges(false, 0.2001), false);
    assert.strictEqual(nextLowDetailEdges(true, 0.2499), true);
    assert.strictEqual(nextLowDetailEdges(true, 0.25), false);
  });

  test("the band keeps whichever mode the view came with", () => {
    const m = createLowDetailMode();
    assert.strictEqual(m.update(0.22), null, "normal stays normal in the band");
    assert.strictEqual(m.update(0.19), true);
    assert.strictEqual(m.update(0.22), null, "low stays low in the band");
    assert.strictEqual(m.low, true);
    assert.strictEqual(m.update(0.26), false);
    assert.strictEqual(m.update(0.22), null);
    assert.strictEqual(m.low, false);
  });

  test("a pause for export keeps the mode: the table of P15-S4", () => {
    const c = canvas();
    const seen: Array<[string, boolean]> = [];
    c.zoom(0.19);
    seen.push(["0.19", c.low]);
    c.zoom(0.22);
    seen.push(["0.19 -> 0.22", c.low]);
    c.pause();
    seen.push(["during export", c.low]);
    c.resume(0.22);
    seen.push(["after export at 0.22", c.low]);
    c.zoom(0.26);
    seen.push(["0.22 -> 0.26", c.low]);
    c.zoom(0.22);
    seen.push(["0.26 -> 0.22", c.low]);
    c.pause();
    c.resume(0.22);
    seen.push(["after export at 0.22 again", c.low]);
    c.zoom(0.19);
    seen.push(["0.22 -> 0.19", c.low]);
    for (let i = 0; i < 3; i++) {
      c.pause();
      c.resume(0.19);
    }
    seen.push(["after SVG -> JPG -> SVG", c.low]);
    assert.deepStrictEqual(seen, [
      ["0.19", true],
      ["0.19 -> 0.22", true],
      ["during export", false],
      ["after export at 0.22", true],
      ["0.22 -> 0.26", false],
      ["0.26 -> 0.22", false],
      ["after export at 0.22 again", false],
      ["0.22 -> 0.19", true],
      ["after SVG -> JPG -> SVG", true],
    ]);
  });

  test("a zoom change during the pause follows the normal rules on resume", () => {
    const c = canvas();
    c.zoom(0.19);
    c.pause();
    c.resume(0.3);
    assert.strictEqual(c.low, false);
    const d = canvas();
    d.zoom(0.3);
    d.pause();
    d.resume(0.1);
    assert.strictEqual(d.low, true);
  });

  test("the old behaviour, for comparison: a fresh mode on resume loses low detail in the band", () => {
    const before = createLowDetailMode();
    before.update(0.19);
    before.update(0.22);
    assert.strictEqual(before.low, true);
    const restarted = canvas(createLowDetailMode());
    restarted.resume(0.22);
    assert.strictEqual(restarted.low, false);
  });

  test("a new canvas mount starts from the initial policy (normal detail)", () => {
    assert.strictEqual(createLowDetailMode().low, false);
    const c = canvas();
    c.resume(0.22);
    assert.strictEqual(c.low, false);
    c.resume(0.2);
    assert.strictEqual(c.low, true);
  });
});
