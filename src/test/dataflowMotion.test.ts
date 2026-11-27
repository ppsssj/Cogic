import * as assert from "assert";
import { parseDataflowMotionPolicy, shouldAnimateDataflow, shouldShowFlowMarker } from "../shared/dataflowMotion";

const flags = ["isDataflow", "muted", "collapsedBridge", "focusContext", "explicitlyHighlighted"] as const;
/** Every combination of the five inputs. */
const combinations = Array.from({ length: 1 << flags.length }, (_, mask) =>
  Object.fromEntries(flags.map((flag, i) => [flag, Boolean(mask & (1 << i))])) as Record<(typeof flags)[number], boolean>,
);

suite("Dataflow motion policy", () => {
  test("legacy is exactly the expression it replaces, for all 32 input combinations", () => {
    for (const c of combinations) {
      const before = c.isDataflow && !c.muted && !c.collapsedBridge && !c.focusContext;
      assert.strictEqual(shouldAnimateDataflow({ policy: "legacy", ...c }), before, JSON.stringify(c));
    }
  });

  test("focused animates only an eligible edge that holds the highlighted relation", () => {
    for (const c of combinations) {
      const expected = c.isDataflow && !c.muted && !c.collapsedBridge && !c.focusContext && c.explicitlyHighlighted;
      assert.strictEqual(shouldAnimateDataflow({ policy: "focused", ...c }), expected, JSON.stringify(c));
    }
  });

  test("focused with nothing highlighted: no dataflow edge moves", () => {
    const free = { isDataflow: true, muted: false, collapsedBridge: false, focusContext: false, explicitlyHighlighted: false };
    assert.strictEqual(shouldAnimateDataflow({ policy: "legacy", ...free }), true);
    assert.strictEqual(shouldAnimateDataflow({ policy: "focused", ...free }), false);
  });

  test("never: calls, collapsed bridges, or edges dimmed by Focus + Context, in either policy", () => {
    for (const policy of ["legacy", "focused"] as const) {
      const base = { policy, isDataflow: true, muted: false, collapsedBridge: false, focusContext: false, explicitlyHighlighted: true };
      assert.strictEqual(shouldAnimateDataflow({ ...base, isDataflow: false }), false);
      assert.strictEqual(shouldAnimateDataflow({ ...base, collapsedBridge: true }), false);
      assert.strictEqual(shouldAnimateDataflow({ ...base, focusContext: true }), false);
      assert.strictEqual(shouldAnimateDataflow({ ...base, muted: true }), false);
    }
  });

  test("safe and safe-marker: no dash moves, for all 32 input combinations", () => {
    for (const policy of ["safe", "safe-marker"] as const) {
      for (const c of combinations) {
        assert.strictEqual(shouldAnimateDataflow({ policy, ...c }), false, `${policy} ${JSON.stringify(c)}`);
      }
    }
  });

  test("the marker: only safe-marker, only where focused would animate", () => {
    for (const c of combinations) {
      const focused = shouldAnimateDataflow({ policy: "focused", ...c });
      assert.strictEqual(shouldShowFlowMarker({ policy: "safe-marker", ...c }), focused, JSON.stringify(c));
      for (const policy of ["legacy", "focused", "safe"] as const) {
        assert.strictEqual(shouldShowFlowMarker({ policy, ...c }), false, `${policy} ${JSON.stringify(c)}`);
      }
    }
  });

  test("the setting: the four policies opt in by name; anything else is legacy", () => {
    for (const v of ["focused", "safe", "safe-marker"]) {
      assert.strictEqual(parseDataflowMotionPolicy(v), v);
    }
    for (const v of ["legacy", undefined, null, "", "FOCUSED", "Safe", 1, true]) {
      assert.strictEqual(parseDataflowMotionPolicy(v), "legacy", String(v));
    }
  });
});
