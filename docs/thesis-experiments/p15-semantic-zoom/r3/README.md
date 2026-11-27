# P15-R3: safe dataflow motion

Branch `perf/safe-focused-dataflow-motion`, on PR #55 (`eb4231f`), which is on PR #54 (`73bc065`).
Merge order: #54, then #55, then this one.

## What changed in the product

`src/shared/dataflowMotion.ts`: the hidden setting `cogic.experimental.dataflowMotion` takes two
more opt-in values. `legacy` and `focused` keep their meaning, and anything else is still legacy.

| Policy | Dash motion | Extra |
|---|---|---|
| `legacy` | as shipped | - |
| `focused` | only the highlighted relation (P15-R1) | - |
| `safe` | none | the highlighted relation keeps its color, width, dashes, arrow and label |
| `safe-marker` (experiment) | none | as safe, plus one small dot moving along the highlighted relation |

**Rules:**
- `shouldAnimateDataflow` is false for both safe values.
- `shouldShowFlowMarker` is true only under safe-marker, and only where focused would have animated:
  a normal (not muted, not a bridge, not Focus context) dataflow edge holding the highlighted
  relation. There is one highlighted relation, so there is at most one marker.
- No threshold on path or screen length was added.

**The marker** (`FlowMarker` in `CanvasPane.tsx`) is an HTML element in React Flow's edge-label
layer:
- When the path changes, the path is sampled once with `getPointAtLength` into a list of
  `transform` keyframes, and the element runs them with the Web Animations API.
- The animation is transform-only (compositor), and there is no React state per frame.
- The edge's ID, path, direction, layout and style stay as they are.
- Export leaves the marker out (`exportNodeFilter`).

**Alternatives not built:**
- An SVG `<animateMotion>` or CSS `offset-distance` animation runs on the main thread and repaints
  inside the edges' shared SVG.
- The marker was the cheaper candidate, so it is the one prototype.

`protocol.ts` now types the message with `DataflowMotionPolicy`. The settings UI and the default are
unchanged.

## Measurement

**Setup:**
- Harness: `e2e/dataflow-motion/release.mjs`, phase `safe`.
- Fixture: the P15-R1/R2 fixture, 650 nodes and 1266 relations at depth 3, every group expanded.
- Edges: the same four picks as P15-R2 (checked by length), each centered at zoom 0.6.

**Conditions:** the highlighted relation stays highlighted while the policy changes live.

| Condition | Policy | Highlight |
|---|---|---|
| A | focused | that relation |
| B | safe | that relation |
| C | safe-marker | that relation |
| D (control) | safe | nothing highlighted, static graph, same view |

5 repetitions in rotated order. Each run is 2 s idle plus a 5 s pan.

**What each run records:**
- rAF gaps (not display FPS);
- frames over 50 and over 100 ms;
- running CSS/Web animations;
- markers;
- React commits;
- DOM count;
- renderer working set;
- distinct viewport transforms (to prove the view moved).

**React commits:** React assigns the root's `current` fiber once per commit, and the harness wraps
that field. The `probe` phase shows that it sees commits: about 320 per 5 s pan.

### The pan in P15-R1 and P15-R2 did not move the view

- **The cause:** the earlier pan pressed the mouse at `0.55 × width + 240`. In this layout the
  canvas pane is 515 px wide, so the press landed outside it, on the Inspector, and the view never
  moved: 1 distinct transform and 2 commits in 5 s.
- **What R2 measured:** its "pan" numbers are idle with mouse moves. They are kept as recorded
  (P15-R2, and `safe-run1-no-pan-result.json` here), but they are not pans.
- **R1:** `run.mjs` (P15-R1) uses the same start point. That its pan did not move either is
  inferred, not re-measured.
- **The fix:** the pan now starts on empty pane and fits the ellipse to the pane (128 × 140 px).
  Every pan run must show more than 100 distinct transforms. All 80 here show 313.

### Results (`safe-result.json`, median of 5 per cell; ms)

| Edge | Condition | Idle p50 / p95 | Idle frames > 50 | Pan p50 / p95 | Pan p95 range | Pan max | Pan frames > 50 / > 100 (sum of 5) | Running animations | React commits idle / pan |
|---|---|---|---|---|---|---|---|---|---|
| short 778 | A focused | **55.1 / 57.1** | 177 | **57.9 / 83.7** | 75-85 | 472 | 1582 / 59 | 1 | 0 / 322 |
| short | B safe | 9.6 / 10.4 | 0 | 9.7 / 39.0 | 29-46 | 449 | 102 / 28 | 0 | 0 / 322 |
| short | C safe-marker | 9.4 / 10.2 | 0 | 9.5 / 37.7 | 37-48 | 421 | 105 / 26 | 1 | 0 / 322 |
| short | D control | 9.7 / 10.4 | 0 | 9.3 / 19.4 | 19-20 | 453 | 72 / 36 | 0 | 0 / 322 |
| medium 4054 | A focused | **147.6 / 157.2** | 65 | **166.1 / 212.2** | 204-215 | 492 | 1575 / 1575 | 1 | 0 / 323 |
| medium | B safe | 9.6 / 10.4 | 0 | 10.0 / 38.0 | 38-48 | 471 | 78 / 36 | 0 | 0 / 323 |
| medium | C safe-marker | 9.4 / 10.2 | 0 | 10.1 / 38.5 | 38-47 | 451 | 85 / 30 | 1 | 0 / 323 |
| medium | D control | 9.6 / 10.4 | 0 | 9.6 / 28.5 | 28-37 | 442 | 81 / 55 | 0 | 0 / 323 |
| long 8994 | A focused | **101.0 / 110.5** | 101 | **121.2 / 176.2** | 147-179 | 354 | 1575 / 1562 | 1 | 0 / 321 |
| long | B safe | 9.6 / 10.4 | 0 | 9.5 / 19.3 | 19-39 | 369 | 68 / 45 | 0 | 0 / 321 |
| long | C safe-marker | 9.4 / 10.2 | 0 | 9.3 / 19.6 | 19-27 | 320 | 62 / 40 | 1 | 0 / 321 |
| long | D control | 9.7 / 10.4 | 0 | 9.4 / 37.6 | 37-38 | 290 | 81 / 55 | 0 | 0 / 321 |
| crossing 8994 | A focused | **128.6 / 136.9** | 79 | **147.9 / 205.6** | 183-211 | 456 | 1574 / 1574 | 1 | 0 / 323 |
| crossing | B safe | 9.6 / 10.4 | 0 | 9.4 / 38.1 | 30-57 | 454 | 96 / 46 | 0 | 0 / 323 |
| crossing | C safe-marker | 9.4 / 10.2 | 0 | 9.3 / 38.2 | 28-46 | 412 | 89 / 40 | 1 | 0 / 323 |
| crossing | D control | 9.6 / 10.4 | 0 | 9.5 / 55.9 | 49-56 | 407 | 124 / 49 | 0 | 0 / 323 |

- **Long tasks:** none.
- **DOM:** C draws one element more than B (the marker).
- **Renderer working set:** 615-644 MB in every condition.
- **Minimum free memory:** 1940 MiB (guard 800).

**Findings:**
- **Idle:**
  - Safe and safe-marker remove focused's sustained cost on all four edges: p50 9.4-9.6 ms, p95
    10.2-10.4 ms, no frame over 50 ms, no React commit.
  - They equal the static control D.
- **Pan:**
  - Focused gets worse with a real pan: p95 84-212 ms, with almost every frame over 50 ms.
  - Safe and safe-marker are at p50 9.3-10.1 ms.
  - Their p95 (19-39 ms) and long frames (max 320-471 ms; 26-46 frames over 100 ms per 5 pans) fall
    inside the range of control D (p95 19-56 ms; 36-55 over 100 ms). With nothing highlighted and
    no motion at all, D shows that this is the cost of panning the expanded graph itself. A likely
    reason is that virtualization mounts and unmounts nodes, with about 320 React commits per pan,
    but that was not measured here.
  - Per edge, B and C are sometimes above D (short, medium) and sometimes below (long, crossing).
    The p95 values come in steps of one frame (about 9.5 ms), so a step of one or two frames is
    within run-to-run variation. No cost of the policy itself is visible.
- **The criterion "pan p95 ≤ 20 ms" is not met** by safe, safe-marker or the control on most edges.
  That is the graph's own pan cost, which no motion policy can remove. Measured against the control,
  the policies add none.
- **The marker:**
  - It costs nothing measurable on the main thread: idle and pan are equal to safe, with no
    commits.
  - It is a compositor animation, and rAF gaps do not show compositor or GPU time, which was not
    measured.

**Semantics** (checked at every condition):
- The highlighted relation keeps its color (`#38bdf8`), width 2.8, dashes `8 6` and arrow under
  safe and safe-marker, as under focused.
- At most one marker, and only under safe-marker.
- Switching the policy does not re-analyze the graph or remount React Flow (a DOM tag on
  `.react-flow` survives), and labels stay.

**The path across a switch** (`geometry-result.json`):
- Read right before and right after each policy switch, with no pan in between, the path is
  identical in all 12 switches that keep the highlight (one repetition, 4 edges). All 16 states,
  including D, drift 0 px from the first state.
- In the full run, the paths read across the pans and re-highlights between conditions did differ.
  The cause is that virtualization remounts nodes and re-measures their handles. It is not the
  policy switch.

## Trace, runtime, export (real VS Code)

**Trace** (`trace-result.json`, 55/55): the 16-step trace of `e2e/aggregate-inspector`, run once per
policy. At every step, safe and safe-marker show exactly what focused shows: the same edges,
colors, widths, opacities, dashes, arrows and labels. In addition:
- no dash moves at any step;
- under safe-marker, there is one marker exactly at the dataflow steps (12, 13, 14, 16) where focused
  moved one edge, and none at the others;
- the previous relation's highlight ends with the step;
- after the exit the graph is back (12 nodes, 18 edges), with nothing moving and no marker.

**Runtime Debug** (`runtime-result.json`, 6/6): a Node session paused in `compute`.
- Under safe and safe-marker the same node is marked as under focused, and the selection stays
  empty.
- Nothing moves and there is no marker, before, during or after the session.
- Legacy is unchanged.

**Export** (`export-result.json`, 4/4): a normal (not bridge) relation highlighted from the
Inspector.
- SVG and JPG under safe and safe-marker: the SVG keeps dashed strokes, arrows and the highlight
  color, and does not contain the marker; the JPG is a valid image.

## Decision

- **Safe (static highlight):**
  - It meets the goal: the sustained cost of a highlighted long relation is gone, and the highlight
    keeps its meaning.
  - It is the candidate for the default. It is still opt-in here; the default is unchanged.
- **The marker:**
  - It meets the same criteria as safe: no main-thread cost, at most one, it does not change the
    edge, export and trace are correct.
  - It is a candidate on top of safe, but its compositor or GPU cost is not measured.
  - It stays an opt-in experiment (`safe-marker`), so that it can be removed without touching safe.
- **Before a default switch:**
  - the absolute pan target needs the graph's own pan cost addressed, which is separate from motion;
  - the setting should be declared in `package.json`, so that `legacy` can be chosen.
- **Not mixed in:** the collapsed-bridge classification (120 of 140 dataflow edges in the expanded
  fixture are drawn as bridges, P15-R2) is only recorded here.

## Verified, inferred, unverified

- **Verified:**
  - the table above;
  - the idle result;
  - the policies' cost in a real pan compared with the control;
  - commits;
  - the semantics, geometry, trace, runtime and export checks;
  - that the P15-R2 harness pan did not move the view.

  All on this machine and fixture, at a rAF floor of about 9.5 ms, sometimes 8.3 ms.
- **Inferred:**
  - that the graph's pan cost comes from virtualization mounting and unmounting;
  - that the P15-R1 pan did not move either.
- **Unverified:**
  - compositor and GPU time of the marker;
  - other GPUs and refresh rates;
  - Vite.
