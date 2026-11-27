import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  DATAFLOW_MOTION_SETTING,
  DEFAULT_DATAFLOW_MOTION_POLICY,
  parseDataflowMotionPolicy,
  shouldAnimateDataflow,
  shouldShowFlowMarker,
} from "../shared/dataflowMotion";

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

  test("the setting: the four policies by name; nothing set or anything else is safe (P15-RC)", () => {
    assert.strictEqual(DEFAULT_DATAFLOW_MOTION_POLICY, "safe");
    for (const v of ["legacy", "focused", "safe", "safe-marker"]) {
      assert.strictEqual(parseDataflowMotionPolicy(v), v);
    }
    for (const v of [undefined, null, "", "LEGACY", "Legacy", "FOCUSED", "Safe", "on", 1, true, {}]) {
      assert.strictEqual(parseDataflowMotionPolicy(v), "safe", String(v));
    }
  });

  test("the default moves no dash and shows no marker, for every input", () => {
    const policy = parseDataflowMotionPolicy(undefined);
    for (const c of combinations) {
      assert.strictEqual(shouldAnimateDataflow({ policy, ...c }), false, JSON.stringify(c));
      assert.strictEqual(shouldShowFlowMarker({ policy, ...c }), false, JSON.stringify(c));
    }
  });

  test("legacy chosen by name still animates as before", () => {
    const free = { isDataflow: true, muted: false, collapsedBridge: false, focusContext: false, explicitlyHighlighted: false };
    assert.strictEqual(shouldAnimateDataflow({ policy: parseDataflowMotionPolicy("legacy"), ...free }), true);
  });

  test("the setting stays undeclared in package.json, so no declared default can disagree with the parser", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8"));
    const configs = [manifest.contributes?.configuration ?? []].flat();
    const declared = configs.some((c: { properties?: Record<string, unknown> }) => Object.keys(c.properties ?? {}).includes(`cogic.${DATAFLOW_MOTION_SETTING}`));
    assert.strictEqual(declared, false);
  });
});
