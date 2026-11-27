# P15-RC: static dashes (`safe`) by default — the decision and its evidence

Branch `perf/safe-dataflow-default`, on PR #56 (`5f059b0`, P15-R3). Stack: #54 → #55 → #56 → this.
The `safe` policy itself was built in P15-R3; this step only makes it the default.

## The change

| Policy (`cogic.experimental.dataflowMotion`) | Before | Now |
|---|---|---|
| nothing set, or any value that is not one of the four names | `legacy` | **`safe`** |
| `legacy` | every unmuted dataflow dash moves | the same, chosen by name |
| `focused` | only the highlighted relation moves | the same, not the default |
| `safe` | no dash moves; the highlight stays (color, width, dashes, arrow, label) | the default |
| `safe-marker` | as safe, plus one small moving marker on the highlighted relation | unchanged; experimental |

**Code:**
- `src/shared/dataflowMotion.ts`: `DEFAULT_DATAFLOW_MOTION_POLICY = "safe"`; the parser falls back
  to it.
- The webview uses the same constant in three places, so nothing animates before the extension
  posts the setting:
  - `App.tsx`: the initial state;
  - `CanvasPane.tsx`: the prop default and the `toReactFlowEdges` default.
- `CodeGraphPanel.ts` and `protocol.ts`: comments only. The panel already sends the policy at
  panel start, on the webview's request after a reload, and live when the setting changes.
- **The setting stays undeclared** in `package.json`. Its key is experimental, and `safe-marker` is
  not a user option. A unit test checks that it stays undeclared, so no declared default can
  disagree with the parser. The user guide (`README.md`, "How relations are drawn") documents the
  new default and how to get `legacy` back.
- **Not changed:**
  - `LowDetailEdges` and its 0.20/0.25 hysteresis;
  - edge IDs, `GraphPayload`, the analysis and the layout;
  - PRs #57 and #58, kept as evidence. Solid strokes, permanent or while panning, are not adopted.

## Verification (this step)

**Unit:** `npm test`, 183 passing. New tests:
- the default constant; invalid values (`"Safe"`, `"LEGACY"`, `1`, `true`, `{}`, …) → `safe`;
- the default animates nothing and shows no marker for all 32 input combinations;
- `legacy` by name still animates;
- the setting is undeclared in `package.json`.

**Real VS Code (Extension Development Host), nothing in `settings.json`.** Harness:
`e2e/dataflow-motion/release.mjs`, phases `default*`. Each phase is a fresh extension start on its
own workspace (first open, extension restart, another project).

| Phase | Checks | What it covers |
|---|---|---|
| `default` (`default-result.json`) | 49/49 | first open; idle; real pan; wheel zoom; `legacy` by name and back; key removed; invalid values; `Developer: Reload Webviews` under legacy and unset; a highlighted Param Flow; SVG/JPG export; trace (16 steps) against focused |
| `default-runtime` (`runtime-result.json`) | 4/4 | F5 paused frame: unset, then legacy, then unset |
| `default-large` (`large-result.json`) | 4/4 | expanded 650-node graph: unset vs legacy, idle and real pan × 3; zoom; low detail at 0.15; band 0.22 from below and above |

`default-run1-harness-fail-result.json` is the first `default` run, kept as recorded. It had three
harness faults, all fixed before `default-result.json`; no product fault:
- light "bridge" call edges were counted as calls;
- a node's one-shot focus pulse in the SVG's inlined styles was counted as a dash animation;
- the trace helpers kept the webview frame from before the reload.

**What the checks show:**
- **Nothing set:**
  - no dash animation runs, by the `animated` class, the computed `animation-name` and the Web
    Animations list;
  - dataflow edges are blue (`rgb(96,165,250)`, 1.8 px) and dashed, with arrows;
  - calls are solid gray (2.2 px);
  - edges into collapsed groups keep their own light dashed style, as before.
- **`legacy` against the default:** every drawn edge has the same stroke, width, dashes, opacity and
  arrow. Only the motion differs.
- **Highlighted relation (nothing set):** `#38bdf8`, wider, dashed, with arrow and the
  argument → parameter label; the Inspector row active; nothing moves.
- **Export:**
  - the SVG has static dashes, arrows and the highlight color, and no `dashdraw` animation;
  - the JPG is valid;
  - viewport, selection and highlight are unchanged afterwards.
- **Trace:** each of the 16 steps shows the same edge styles and labels as under `focused`, with no
  dash motion. After the trace ends, the graph is back.
- **Runtime Debug:** the paused frame marks the same node under the default and under legacy. Under
  the default nothing moves while idle, paused or after Shift+F5.
- **Low detail:** on at 0.15; at 0.22 it keeps the state it was entered with (on from below, off
  from above).

**Regression E2E** (nothing set, so under the new default):

| Suite | Result |
|---|---|
| focus-context | 56/56 |
| aggregate-inspector | 47/47 |
| export-viewport | 52/52 |
| trace-exit | 21/21 |
| trace-steps | 18/20 in the first run, then 20/20 and 20/20 |

**The trace-steps failure:**
- At cursor 5, going back with Prev drew 5 nodes in the DOM, where going forward had drawn 7. The
  edge IDs were the same.
- The next "Next again" check failed on the same cursor.
- The check compares drawn DOM node IDs, which virtualization and the viewport animation affect.
  The policy changes only the edges' `animated` flag. So the failure is attributed to timing, not
  to this change (INFERRED; the base branch was not run three times to compare).

## Performance after the switch (`large-result.json`)

Expanded 650-node fixture, zoom 0.6, view centered; 3 rotated repetitions; real pans (313 distinct
viewport transforms each). rAF gaps (ms), not display FPS; floor 8.3 ms.

| Policy | Running dash animations | Idle p50 / p95 | Idle frames > 50 | Pan p50 / p95 | Pan max | Pan frames > 50 / > 100 (per pan) | Frames in a 5 s pan | Renderer MB |
|---|---|---|---|---|---|---|---|---|
| default (`safe`) | 0 | **8.3 / 8.5** | 0 | **8.3 / 16.5** | 333 | 11-16 / **7-10** | 550-609 | 641-708 |
| `legacy` | 10 | 166.7 / 175 | 12 of 12 | 141.6 / 166.7 | 333 | 299-301 / 256-257 | 314-315 | 630-678 |

- No long tasks in any run; minimum free memory 1827 MiB (guard 800).
- **Memory:** no growth from the switch; renderer working set in the same range under both
  policies.
- **Pan under the default:** the 7-10 frames over 100 ms are the cost P15-P0 attributed to GPU
  raster of dashed edges entering the view (P15-P0's dashed condition: 7). The default does not
  change that cost, and does not claim to.

## For the paper: what the P15 series supports

**1. The cost of moving dashes (verified, idle, this machine).**
- **Z0A** (P15-Z0 fixture, zoom 0.6, nothing selected):
  - idle p50 37.2 ms with the dash animation;
  - 8.3 ms (the floor) with only the animation stopped;
  - same graph, dashes and DOM.
- **R1:** legacy idles at about 161 ms per frame on the expanded 650-node graph; focused at the
  floor.
- **R2:** even one highlighted moving relation costs 56-152 ms frames for as long as it stays
  highlighted, and pausing that animation returns to the floor.
- **This step:** the default idles at 8.3 ms, against legacy's 166.7 ms.

The cost is continuous: it stays while the user does nothing.

**2. Why static dashes, not motion for the highlight.**
- `focused` keeps one moving relation, and R2/R3 show that this one can cost as much as all of them.
- `safe` keeps every visual distinction the motion did not carry alone:
  - dashes and color separate dataflow from calls;
  - arrows give the direction;
  - the highlight and the label mark the chosen relation.
- R3 measured `safe` at the static control on idle and on real pans.

**3. Why not permanent solid strokes.**
- Solid strokes would remove the pan raster cost too. In P15-P0's `Gdash` condition, no frame was
  over 100 ms.
- But dashes are what tells dataflow from calls at a glance, together with color. That is a
  visual-encoding decision, not a performance one, and it is not taken here.
- **Solid only while dragging** (P15-P1, #58) cut in-drag frames over 100 ms from 7 to 1. But
  restoring the dashes cost one 100-125 ms frame after every pan. It is not adopted.

**4. The real-pan bottleneck (P15-P0, verified on one GPU).**
- The long frames of a real pan come 2-4 frames after virtualization mounts edges.
- They are GPU-process raster; dashed strokes cost about 2× solid ones.
- React commits (about 315 per pan) cost nothing measurable over empty views.

**5. Limits.**
- One machine: Windows 11, i5-9400F, GeForce GT 710, a 120 Hz rAF floor of 8.3 ms. Other GPUs and
  displays will differ; nothing here generalizes the GT 710 numbers.
- Synthetic fixtures (the 650-node P15-Z0/R1 generator, the small aggregate-inspector fixture).
- GPU hardware time was not measured; rAF gaps are not display FPS.
- Extension Development Host builds only.

**6. Not verified from the user's side.**
- Whether users miss the motion: does it help to see direction or to find dataflow?
- Whether static dashes plus highlight are as readable.
- Perceived smoothness or power use.

These need the usability study; this record makes no claim about them.

**7. Citable and excluded measurements.**

| Record | Use |
|---|---|
| P15-Z0A idle and animation-isolation numbers | citable |
| P15-R1 idle numbers and running counts | citable |
| P15-R2 idle numbers, running/paused comparison, trace and runtime checks | citable |
| P15-R3 `safe` idle and real-pan numbers (gated pans) | citable |
| P15-P0 real-pan attribution and traces | citable |
| P15-P1 real-pan and restore-cost numbers | citable |
| P15-RC (this record) | citable |
| **P15-R1 "Pan" columns** | **excluded:** the press landed on the Inspector; the view did not move (inferred from the shared start point) |
| **P15-R2 "Pan" columns** | **excluded:** verified not to move the view (1 transform, 2 commits in 5 s) |
| **Early P15-Z0A pan numbers** | **excluded** as evidence of a pan improvement: they predate the gated pan |

Correction notes were added to the P15-R1 and P15-R2 records; their raw data is unchanged. The
P15-Z0A record lives on PR #53 and is not edited here. This table is the correction for it.

**How to describe it:** a design and performance decision that makes the tool usable on large
graphs. It removes a continuous repaint of a decorative animation while keeping the relation
encoding. It is not an algorithmic contribution of Cogic.
