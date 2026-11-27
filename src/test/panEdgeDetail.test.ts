import * as assert from "assert";
import {
  PAN_SOLID_RESTORE_DELAY_MS,
  createPanSolidController,
  isDragMoveSource,
  parsePanEdgeDetailPolicy,
  type PanEdgeDetailPolicy,
} from "../shared/panEdgeDetail";

/** A controller with a manual clock: returns the controller, the applied states and a tick. */
function harness(policy: PanEdgeDetailPolicy) {
  const applied: boolean[] = [];
  let timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let now = 0;
  let nextId = 1;
  const controller = createPanSolidController({
    policy,
    apply: (solid) => applied.push(solid),
    schedule: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    cancelSchedule: (handle) => {
      timers = timers.filter((t) => t.id !== handle);
    },
  });
  const tick = (ms: number) => {
    now += ms;
    const due = timers.filter((t) => t.at <= now);
    timers = timers.filter((t) => t.at > now);
    due.forEach((t) => t.fn());
  };
  return { controller, applied, tick, pending: () => timers.length };
}

const move = { type: "mousemove" };

suite("Pan edge detail", () => {
  test("the setting: only the policy names; anything else is off", () => {
    for (const v of ["off", "immediate", "delayed"]) {
      assert.strictEqual(parsePanEdgeDetailPolicy(v), v);
    }
    for (const v of [undefined, null, "", "on", true, 1, "Immediate", "entering"]) {
      assert.strictEqual(parsePanEdgeDetailPolicy(v), "off", String(v));
    }
  });

  test("only a pointer drag counts: not wheel zoom, not a programmatic move", () => {
    for (const type of ["mousemove", "pointermove", "touchmove"]) {
      assert.strictEqual(isDragMoveSource({ type }), true, type);
    }
    for (const source of [null, undefined, {}, { type: "wheel" }, { type: "mousedown" }, { type: "dblclick" }]) {
      assert.strictEqual(isDragMoveSource(source as { type?: string } | null), false, JSON.stringify(source));
    }
  });

  test("off never switches", () => {
    const h = harness("off");
    h.controller.move(move);
    h.controller.end();
    assert.deepStrictEqual(h.applied, []);
  });

  test("immediate: solid once on the first drag move, dashes back on end", () => {
    const h = harness("immediate");
    h.controller.move(move);
    h.controller.move(move);
    h.controller.move(move);
    assert.deepStrictEqual(h.applied, [true], "one switch per drag, not per frame");
    h.controller.end();
    assert.deepStrictEqual(h.applied, [true, false]);
    assert.strictEqual(h.pending(), 0);
  });

  test("a click without movement, a wheel zoom or a fit never switches", () => {
    const h = harness("immediate");
    h.controller.end();
    h.controller.move({ type: "wheel" });
    h.controller.move(null);
    h.controller.end();
    assert.deepStrictEqual(h.applied, []);
  });

  test("delayed: dashes back after the delay; a new drag before it keeps the edges solid", () => {
    const h = harness("delayed");
    h.controller.move(move);
    h.controller.end();
    assert.deepStrictEqual(h.applied, [true]);
    h.tick(PAN_SOLID_RESTORE_DELAY_MS - 1);
    h.controller.move(move);
    assert.deepStrictEqual(h.applied, [true], "no flip between two quick drags");
    assert.strictEqual(h.pending(), 0);
    h.controller.end();
    h.tick(PAN_SOLID_RESTORE_DELAY_MS);
    assert.deepStrictEqual(h.applied, [true, false]);
  });

  test("cancel (blur, pointer cancel, export, unmount) puts the dashes back at once", () => {
    for (const policy of ["immediate", "delayed"] as const) {
      const h = harness(policy);
      h.controller.move(move);
      h.controller.cancel();
      assert.deepStrictEqual(h.applied, [true, false], policy);
      const d = harness(policy);
      d.controller.move(move);
      d.controller.end();
      d.controller.cancel();
      assert.deepStrictEqual(d.applied, [true, false], `${policy} after end`);
      assert.strictEqual(d.pending(), 0);
    }
  });
});
