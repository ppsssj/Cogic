# P15-R1: focused dataflow animation policy (product, opt-in)

> **Correction (P15-RC, 2026-11-27): the "Pan" columns below are not pans.** This harness pressed
> the mouse at `0.55 × width + 240`, outside the 515 px wide canvas pane, on the Inspector (found in
> P15-R3; see `../r3/README.md`). The view did not move, so "Pan" here is idle with mouse moves. That
> the R1 pan did not move is inferred from the shared start point, not re-measured. The idle columns
> and the running-animation counts stand. Do not cite these pan numbers; real-pan numbers are in
> P15-R3, P15-P0, P15-P1 and P15-RC (`../../p15-rc/README.md`). The raw records are kept unchanged.


Branch `perf/focused-dataflow-animation`, from `main` `ba10e93`. It does not depend on PR #52 or
#53. Only the fixture generator was copied from them.

**Raw records:**
- `bench2-result.json`: 162 runs, with every rAF gap;
- `bench2-summary.txt`: the summary.

How to run it: see `e2e/dataflow-motion/README.md`.

An earlier full run (`bench1`) was stopped after 3 of 54 conditions, because the harness positioned
the view too slowly. It is not kept and contains no other data.

## What changed

- **`src/shared/dataflowMotion.ts`**:
  - `shouldAnimateDataflow` (pure). `legacy` is exactly the expression it replaces; a unit test
    checks all 32 input combinations.
  - `focused` animates only an eligible dataflow edge that holds the explicitly highlighted
    relation (`highlightedEdgeId`):
    - a Param Flow chosen in the Inspector;
    - an aggregate member opened;
    - the trace's current flow.

    A node selection alone animates nothing.
  - Muted edges, collapsed bridges and Focus + Context context edges never animate.
- **Opt-in:** the hidden setting `cogic.experimental.dataflowMotion` (`"focused"`, otherwise
  legacy).
  - It is not declared in `package.json`, so it is absent from the Settings UI.
  - The extension forwards it to the webview (`dataflowMotion` message) at start and on change.
  - The policy enters the existing `toReactFlowEdges` memo. It changes only React Flow's
    `animated` flag, no edge ID or layout, and switching needs no new analysis.

## Correctness (real VS Code, 14/14)

- Nothing set means legacy.
- Switching the policy needs no new analysis and leaves nodes, positions and edge IDs unchanged.
- Focused:
  - with nothing highlighted, or a node selected only: 0 running edge animations (computed
    `animation-name`);
  - dashes and arrows stay on every dataflow edge;
  - one Param Flow highlighted: exactly that dataflow edge runs; cleared: 0 again;
  - Focus + Context: no dimmed edge runs.
- Legacy: a selected node's flows run, and a highlighted flow alone runs, as before.
- The highlighted relation is the same edge under both policies.
- An SVG export under focused with a highlight keeps dashed strokes (128) and arrow markers.

## Benchmark

**Fixture:** 650 nodes and 1266 relations at depth 3, every group expanded.

**Views:**
- the fitted centre at zoom 0.6 (5 repetitions) and 0.15 (3 repetitions);
- zoom 0.6 around `main()`, where the highlighted flow is on screen (3 repetitions).

rAF gaps are not display FPS; the floor was about 9.2 ms. Values are medians, with the p95 range
across repetitions.

| View | Condition | Running | Idle p50 / p95 | Pan p50 / p95 | Pan frames > 50 ms (sum) | Wheel zoom p95 |
|---|---|---|---|---|---|---|
| 0.6 centre | A legacy, nothing selected | 10 | **161.1 / 169.2** | **161.8 / 170.1** | 1568 | 169.6 |
| 0.6 centre | B focused, nothing selected | 0 | 9.2 / 10.1 | 9.2 / 10.2 | 0 | 134.3 |
| 0.6 centre | E legacy, `main()` selected | 1 | **161.3 / 171.6** | **164.9 / 171.2** | 1565 | 191.7 |
| 0.6 centre | F focused, `main()` selected | 0 | 9.2 / 10.2 | 9.2 / 10.2 | 0 | 151.2 |
| 0.6 centre | C focused, flow highlighted (off screen) | 0 | 9.2 / 10.1 | 9.3 / 10.2 | 0 | 151.8 |
| 0.6 centre | D legacy, flow highlighted (off screen) | 0 | 9.2 / 10.1 | 9.3 / 10.2 | 0 | 151.1 |
| 0.15 centre | A legacy, nothing selected | 16 | 18.8 / 19.9 | 19.0 / 20.4 | 0 | 130.9 |
| 0.15 centre | B focused, nothing selected | 0 | 9.6 / 10.1 | 9.6 / 10.2 | 0 | 75.2 |
| 0.15 centre | C / D, flow highlighted | 0 | 9.6 / 10.1 | 9.6 / 10.2 | 0 | 77.3 / 67.1 |
| around `main()` | A legacy, nothing selected | 3 | 9.2 / 10.2 | 9.2 / 10.2 | 0 | 18.8 |
| around `main()` | B focused, nothing selected | 0 | 9.2 / 10.0 | 9.2 / 10.2 | 0 | 18.3 |
| around `main()` | C focused, flow highlighted (on screen) | 1 | 9.1 / 10.1 | 9.2 / 10.2 | 0 | 19.2 |
| around `main()` | D legacy, flow highlighted (on screen) | 1 | 9.2 / 10.1 | 9.2 / 10.2 | 0 | 20.2 |

**Drawn objects:** in every view, A and B draw the same edges and DOM structure, for example 240
edges at the 0.6 centre. B's 12 nodes there against 13 come from the view tolerance: B landed at
zoom 0.6021 against 0.6008, and one node at the edge was virtualized out. The correctness phase
checked identical nodes, positions and edges at one view.

**Other measurements:**
- Long tasks: none in any run.
- Renderer working set: 536-631 MB in all conditions.
- Minimum free memory: 1572 MiB (guard 800 MiB).

## Findings

1. **Verified:** focused removes the continuous cost in the default state.
   - At the 0.6 centre, nothing selected: legacy idles and pans at about 161 ms per frame (1568
     frames over 50 ms in 5 pans). Focused idles and pans at the floor.
   - With `main()` selected, legacy keeps that cost (E, about 161 ms) and focused does not (F, the
     floor).
2. **Verified:** a highlight does not bring the animation back to the graph.
   - With one relation highlighted, focused runs exactly one animation.
   - Around `main()`, where that edge is on screen, idle and pan stay at the floor (C), the same as
     legacy with the same highlight (D).
3. **The cost depends on what is animated, not only on how many edges.**
   - One running animation in E costs as much as ten in A.
   - Three running animations around `main()` (A) cost nothing measurable.
   - Inferred: long animated edges crossing the view are what is expensive. They are not measured
     separately here.
4. **Zoom improves but stays costly.** Wheel zoom p95 drops from 130.9 to 75.2 ms at 0.15 and from
   169.6 to 134.3 ms at 0.6, but frames over 50 ms remain under both policies. The rest of the zoom
   cost is not the animation (P15-Z0: virtualization mounts; P15-Z0A: dash rasterization).
5. **Visual meaning kept:** dashes, colours, arrowheads, lanes and the kind distinction are
   unchanged. Only the motion of unhighlighted flows is gone.

## Verified, inferred, unverified

- **Verified:** findings 1, 2, 4 and 5 and the correctness list, on this fixture, this machine and
  a 120 Hz display.
- **Inferred:** finding 3, that long animated edges are the expensive ones.
- **Unverified:**
  - GPU and raster time;
  - other refresh rates or GPUs;
  - Vite;
  - trace and runtime debug highlights under focused in a real VS Code (covered by the unit
    tests, through the same `highlightedEdgeId`);
  - hover (not part of this step).

## Should focused become the default?

The data support it: no measured cost of its own, and a large continuous saving in the default
state.

What a user loses is the motion of unhighlighted flows. A selected node no longer animates its
flows; it still highlights and labels them. Whether that motion matters to users is a product
decision. If it does, a later step could animate a selected node's flows only when they are short,
or on hover, measured the same way.

This PR keeps legacy as the default.
