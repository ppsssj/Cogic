# P15-Z0: semantic zoom rendering feasibility

An experiment on branch `experiment/semantic-zoom-feasibility`, based on `main` `ba10e93` (after
PR #50 and #51). Nothing in it is enabled in the product: the experiment switch defaults to the
baseline, and no UI changes it.

How to run it: see `e2e/semantic-zoom/README.md`.

## Files

| File | Content |
|---|---|
| `bench2-result.json`, `bench2-summary.txt` | The valid run: 5 repetitions x 2 zooms x 5 conditions x (idle, pan, wheel zoom) = 150 runs, with every rAF gap. |
| `bench1-result.json` | An earlier run, kept as a raw record. Its "A0 at zoom 0.15" cells in repetitions 1-4 are invalid. The harness looked for the selection in the canvas DOM, so a selected node outside the view (virtualized) went unnoticed, and those runs had a selection. bench2 reads the selection from the Inspector and stops if a run's selection state is wrong. |

The console logs of both runs are not in the repository (`.gitignore` excludes `*.log`). Every
value they print is in the result files.

## Current rendering path (as studied)

**Pipeline:** `GraphPayload` → `filterGraph` (chips) → `toReactFlowNodes`. Collapse state
decides which file and folder groups are drawn and which code nodes are embedded. Then:

- `buildDrawnEdges` maps relations to drawn endpoints and aggregates them (`aggregateEdges`).
- `toReactFlowEdges` adds styles, aggregate data and Focus classes.
- React Flow renders with `onlyRenderVisibleElements` (virtualization: off-view nodes and edges
  are not in the DOM).

**During pan and zoom:** React Flow moves the viewport transform from its store. `LowDetailEdges`
and `AggregateBadgeScale` subscribe to the store directly and only touch a class or a CSS variable,
so no React state changes per frame. Virtualization mounts and unmounts nodes as the visible set
changes.

**Dataflow edges:**
- They are dashed (`8 6`) and **animated** (`animated: isDataflow && !muted && !collapsedBridge`).
- A node selection mutes the unrelated ones, which stops their animation.
- Below zoom 0.2, `LowDetailEdges` makes every stroke solid.

**Collapse already is an overview:** Cogic's default state collapses non-active files and
folders. On this fixture that draws 11 nodes and 128 edges, almost the same as the B projection
(10 nodes, 128 edges).

## Conditions

- **A (baseline):** every group expanded.
- **B (overview):** `overviewCollapse` collapses every leaf folder and every file, through the
  existing collapse code; the GraphPayload is unchanged.
- **C (local detail):** A plus a fixed overlay outside React Flow for the selected function, with
  real source lines from the active file.
- **Selection factor:** `0` = no selection, `1` = `main()` selected.

**Fixture:** generated, 8 folders x (hub + 6 files x 6 functions), at depth 3. 650 graph nodes,
1266 relations.

**Viewport:** fixed `{x: 40, y: 40}` at zoom 0.6 and 0.15. rAF gaps are measured in the webview
and are not display FPS; the floor in this session was about 9.6 ms.

## Results (bench2, medians of 5 repetitions; p95 range across repetitions)

| Zoom | Measure | A0 | B0 | A1 | B1 | C1 |
|---|---|---|---|---|---|---|
| 0.6 | idle p50 / p95 (ms) | **29.7 / 39.2** | 9.6 / 10.1 | 9.7 / 10.2 | 9.6 / 10.1 | 9.7 / 10.2 |
| 0.6 | pan p50 / p95 (ms) | **37.0 / 39.5** (39.2-41.7) | 9.6 / 10.2 | 9.7 / 10.9 (10.2-19.8) | 9.6 / 10.2 | 9.7 / 10.3 (10.2-19.6) |
| 0.6 | wheel zoom p95 (ms) | 38.9 (38.2-41.7) | **18.9** (18.6-24.9) | 38.2 (29.9-41.7) | **19.4** (19.1-25.0) | 29.8 (29.6-41.6) |
| 0.15 | pan p50 / p95 (ms) | 9.6 / 10.2 (10.2-16.6) | 9.6 / 10.2 | 9.6 / 10.1 | 9.6 / 10.2 | 9.6 / 10.2 |
| 0.15 | wheel zoom p95 (ms) | 48.2 (47.8-58.3) | **10.2** | 49.4 (41.7-58.2) | **10.2** | 48.6 (41.7-49.1) |
| 0.15 | wheel zoom frames > 50 ms (median per run) | 6 | **0** | 7 | **0** | 7 |

Drawn objects in view:

| Zoom | | A | B | C |
|---|---|---|---|---|
| 0.6 | React Flow nodes / edges | 10 / 64 | 7 / 116 | 10 / 64 + overlay |
| 0.6 | DOM elements in the canvas | 359-369 | 685-695 (badges) | 375 |
| 0.15 | React Flow nodes / edges | 66 / 244 | 10 / 128 | 66 / 244 + overlay |
| 0.15 | DOM elements in the canvas | 1490-1500 | 778-788 | 1506 |

- **Animated edges (A0 / A1):** 32 / 8 at 0.6, and 122 / 8 at 0.15. B has 0 (all of its edges are
  collapsed bridges).
- **Long tasks during the runs:** none recorded in any run.
- **Render calls during pan:** 0 in every condition.
- **Render calls during the wheel zoom (median per run):** A and C 46 code-node renders at 0.6 and
  15 at 0.15; B 0. Virtualization mounts nodes as the visible set changes.
- **Renderer working set (median, pan runs):**
  - A: 565-697 MB at 0.6, 760-771 MB at 0.15;
  - B: 556-576 MB;
  - C: 608-661 MB.
- **JS heap:** 24-45 MB everywhere.
- **Minimum free memory:** 1485 MiB (guard 800 MiB).

Mode switches:

| Switch | Time | Long tasks | Render calls | Samples |
|---|---|---|---|---|
| A→B | median 35.4 ms (max 81.5 ms) | none | 57 code-node renders (correctness sample) | n = 22 |
| B→A (correctness phase) | 182 ms | 2, 180 ms | 650 code-node renders | n = 1 |
| C, opening the overlay (correctness phase) | 3.7 ms | none | 5 code-node renders (the visible ones) | n = 1 |
| C, in the benchmark | median 2.1 ms at zoom 0.15 | none | | |

In the benchmark, C's switch also measured a median of 91 ms at zoom 0.6. The settle detection
there probably includes unrelated view settling, so that value is **not** taken as the overlay's
cost (unexplained).

## Correctness (bench2, 11/11)

- B collapses exactly the leaf folders and the files outside them.
- Sampled aggregates (every 6th of 112; opening all of them in a row passed the memory guard) open
  all of their original relations, of their own kind.
- Back in A, every node is at the same position.
- C draws one overlay for the selected function, with real source lines from `main.ts`. It moves no
  node and renders at most the visible code nodes once.
- With C off, the overlay is gone and the layout is unchanged.
- With the experiment at its default, the existing end-to-end suites are re-run on this branch
  (see the PR).

## Reading the results

1. **Pan is not where the baseline loses.** With a selection, or at zoom 0.15 (solid strokes), all
   conditions pan at the rAF floor. The one slow case, A0 at 0.6, is just as slow **without any
   input** (idle p50 29.7 ms). Its cost comes from the 32 animated dashed dataflow edges, not from
   panning or from the number of objects. B removes it only because collapsed bridges are not
   animated.
2. **Wheel zoom is where B helps.**
   - The difference is larger than the spread between repetitions: at 0.15, B's p95 is 10.2 ms
     against A's 48.2 ms, with no frames over 50 ms against 6-7 per run.
   - It matches the render counts: in A, virtualization mounts code nodes while the visible set
     changes; in B nothing is mounted.
3. **B costs about 35 ms to enter and about 182 ms to leave** (one sample, with long tasks). The
   way back to the full graph is the expensive transition, and it would happen whenever the detail
   level rises.
4. **C (one overlay) adds no measurable pan or zoom cost.** Its numbers are within A1's spread, and
   opening it touches only the visible nodes once.
5. **On this fixture the existing collapse already produces almost the same picture as B.** The
   saving comes from collapsing, which Cogic already has, not from a new representation.

## Verified, inferred, unverified

- **Verified:** everything in the tables and the correctness list, on this fixture and machine.
- **Inferred:**
  - that animated dataflow dashes cause A0's idle and pan cost (it matches idle = pan and the
    animated-edge counts, but they were not switched off in isolation here; P12-E8 studied edge
    animation on Vite);
  - that the zoom cost in A comes from virtualization mounts (it matches the render counts).
- **Unverified:**
  - GPU time (no API);
  - React commit counts (production React; only Cogic's own render calls were counted);
  - Vite or other large real projects;
  - other display refresh rates;
  - the B→A switch cost beyond one sample;
  - the 91 ms C switch reading at zoom 0.6.

## Recommendation for the next step

- **No semantic zoom with automatic level switching yet.** Pan does not need it here, and leaving
  the overview costs about 182 ms (one sample).
- **If zooming out should get cheaper,** an "overview" can be the existing collapse, applied on an
  explicit user action. That is B, with no new renderer or layout.
- **If idle and pan cost without a selection matters,** look at dataflow edge animation first. It
  is the one cost in this data that is independent of interaction.
- **Local detail as one overlay is cheap** and can be developed without touching layout or React
  Flow nodes.
