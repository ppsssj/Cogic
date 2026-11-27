# P15-R2: release validation of the focused dataflow motion policy

> **Correction (P15-RC, 2026-11-27): the "Pan" columns below are not pans.** P15-R3 found that this
> harness pressed the mouse outside the 515 px wide canvas pane, on the Inspector: 1 distinct
> viewport transform and 2 React commits in 5 s (see `../r3/README.md`). The "Pan" numbers are idle
> with mouse moves. The idle numbers, the running/paused comparison and the trace and runtime
> checks stand. Do not cite these pan numbers; real-pan numbers are in P15-R3, P15-P0, P15-P1 and
> P15-RC (`../../p15-rc/README.md`). The raw records are kept unchanged.


Branch `test/focused-animation-release-validation`, on PR #54 (`73bc065`). It adds no product
code: only the harness `e2e/dataflow-motion/release.mjs` and these records. How to run it: see
`e2e/dataflow-motion/README.md` (Release checks).

**Raw records:**

| File | Content |
|---|---|
| `long-result.json` | 120 runs, with every rAF gap, the candidate lengths and the picked edges |
| `trace-result.json` | every trace step |
| `runtime-result.json` | the paused frame and running counts |

**Discarded runs:**
- `long1`: every pick was a collapsed bridge (see below), so nothing was measured.
- Two target-search probes: diagnostic only.
None of them is kept.

## 1. One highlighted edge, short to screen-crossing (focused policy)

**Fixture:** P15-R1, 650 nodes and 1266 relations at depth 3, every group header expanded.

**Edge choice:** dataflow paths were measured with `getTotalLength()`. Of 140 found, 120 are drawn
as collapsed bridges (inline opacity 0.26), which never animate under either policy, so the picks
come from the 20 animatable ones:

| Pick | Path | On screen at zoom 0.6 |
|---|---|---|
| short | 778 px | 467 px |
| medium | 4054 px | 2432 px |
| long | 8994 px | 5396 px |
| crossing | 8994 px | 5396 px |

"long" and "crossing" are two different edges of the longest length available. The fixture has
no dataflow edge shorter than 778 px that can animate.

**Conditions:** measured at zoom 0.6, centred on the edge's midpoint, with the same node, edge and
DOM set in every condition. 5 repetitions in a rotated order.
- A: nothing highlighted.
- B: that relation highlighted from the Inspector, so exactly it runs.
- C: the same highlight, with its animation paused by a style the harness adds to the page.

rAF gaps are not display FPS; the floor was about 9.2 ms.

| Edge | Condition | Idle p50 / p95 (ms) | Idle max | Pan p50 / p95 | Pan max | Pan frames > 50 / > 100 ms (sum of 5) |
|---|---|---|---|---|---|---|
| short | A | 9.2 / 10.1 | 10.8 | 9.3 / 10.2 | 11.5 | 0 / 0 |
| short | B | **56.3 / 66.4** | 69.6 | **56.5 / 60.0** | 69.6 | 1557 / 0 |
| short | C | 9.2 / 10.1 | 10.6 | 9.3 / 10.2 | 11.0 | 0 / 0 |
| medium | A | 9.2 / 10.1 | 10.5 | 9.3 / 10.2 | 11.0 | 0 / 0 |
| medium | B | **152.0 / 159.9** | 164.1 | **151.6 / 161.3** | 179.3 | 1570 / 1570 |
| medium | C | 9.2 / 10.1 | 11.1 | 9.3 / 10.2 | 12.3 | 0 / 0 |
| long | A | 9.2 / 10.1 | 10.5 | 9.3 / 10.1 | 10.7 | 0 / 0 |
| long | B | **103.5 / 111.7** | 114.1 | **103.6 / 112.6** | 123.6 | 1570 / 1537 |
| long | C | 9.2 / 10.1 | 10.6 | 9.3 / 10.2 | 11.2 | 0 / 0 |
| crossing | A | 9.2 / 10.1 | 10.9 | 9.3 / 10.2 | 20.1 | 0 / 0 |
| crossing | B | **131.5 / 134.9** | 140.9 | **131.7 / 140.1** | 151.0 | 1570 / 1570 |
| crossing | C | 9.3 / 10.1 | 10.8 | 9.3 / 10.2 | 93.8 | 1 / 0 |

- **Long tasks:** none.
- **Renderer working set:** 549-602 MB.
- **Minimum free memory:** 1476 MiB (guard 800 MiB).

**Findings:**
- **Verified:** one highlighted dataflow edge alone produces frame gaps over 100 ms (medium, long
  and crossing). Even the short one gives about 56 ms.
- **Verified:** the cost is that edge's animation. Paused, on the same graph and view, every edge
  is at the floor.
- **Verified:** idle equals pan, so this is a continuous repaint while the highlight lasts, not
  input handling.
- **Not proportional to path length:** medium (4054 px) costs more than long (8994 px). With four
  edges no general relation is claimed. That the painted screen area matters more than the length
  is inferred, not measured.
- **Not caused by focused:** legacy shows the same cost whenever the same relation is highlighted
  (P15-R1, condition D). Focused does not create this cost, and it removes the larger one of the
  default state.

**Observation:** 120 of 140 dataflow edges are drawn as collapsed bridges (opacity 0.26) although
no drawn group shows as collapsed. The cause was not found. Both policies treat bridges the same
way (never animated), so it does not change P15-R1 or this result, but it is worth a separate look.

## 2. Trace under focused (real VS Code, 21/21)

The trace runs on `e2e/aggregate-inspector/fixture/src/app/a.ts`, 16 steps.

| Steps | Event | What ran |
|---|---|---|
| 1-10 | node | nothing |
| 11 | constructs | nothing |
| 12-14, 16 | dataflow | exactly one dataflow edge, both of whose drawn ends are the nodes highlighted for the flow |

- At step 14 the running edge is the expanded same-label aggregate that holds the traced relation.
- At step 16 both ends are members of one class card.
- When the step changes, the previous relation stops.
- After the trace ends, the graph is back (12 nodes, 18 edges) and nothing runs.

## 3. Runtime Debug (real VS Code, 4/4)

**From the code:** Runtime Debug never sets a relation highlight. A paused frame marks a node
(`runtimeActiveNodeId`, the selected style) and moves the view; `highlightedEdgeId` comes only from
a manual Param Flow or the trace. So no animation was added for runtime.

**The run:** a small JS program with a `debugger` statement, started with F5. It paused in
`compute` (`server.js`), and the node `compute` was marked; the selection stayed empty.
- **Focused:** with 7 dataflow edges drawn, nothing runs while paused, and nothing after Shift+F5.
  The graph is unchanged.
- **Legacy (comparison):** 7 edges run before, during and after the session, as before.

## Decision: CONDITIONAL

- Trace and Runtime Debug show no regression under focused (not BLOCKED).
- Focused removes the large continuous cost of the default state (P15-R1).
- But a single highlighted long relation still produces 100-160 ms frames, and focused animates
  exactly that relation. The same happens under legacy, but switching the default to focused
  should come with a limit on that one animation. Options to measure next, not implemented here:
  - no motion, or a short finite motion, when the highlighted edge's drawn length or area is large;
  - a cheaper moving marker instead of the dash animation;
  - motion only while the view is not moving.

**Going back to legacy:** the hidden setting `cogic.experimental.dataflowMotion` already accepts
`"legacy"`. If focused becomes the default, the setting should be declared in `package.json`
(an enum with a description), so that users can find and choose legacy.

## Verified, inferred, unverified

- **Verified:**
  - section 1's measurements and their first three findings;
  - the trace and runtime behaviour (on these fixtures, this machine and a 120 Hz display).
- **Inferred:**
  - that screen area rather than length decides the cost;
  - that the limits listed above would remove it.
- **Unverified:**
  - GPU and raster time;
  - other refresh rates or GPUs;
  - Vite;
  - runtime on other debuggers than Node;
  - why most dataflow edges in the large fixture are bridges.
