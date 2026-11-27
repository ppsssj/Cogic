# P15-P1: solid edges while dragging the canvas

Branch `perf/pan-solid-edges`, from `main` at `ba10e93`. It does not depend on PRs #54-#57; it builds
on the cause found in P15-P0 (#57): the long frames of a real pan are GPU-process raster of edges
entering the view, and dashed strokes cost about twice as much as solid ones.

## Implementation

**Opt-in.** The hidden setting `cogic.experimental.panSolidEdges` has three values. It is not
declared in `package.json`; the default does not change here.

| Value | Behavior |
|---|---|
| `off` (default) | as today |
| `immediate` | solid while dragging; dashes back at the mouse up |
| `delayed` | solid while dragging; dashes back 150 ms after the mouse up, and a new drag within that time keeps the edges solid |

**Files:**
- `src/shared/panEdgeDetail.ts`: the policy, `isDragMoveSource`, and `createPanSolidController`. The
  controller is DOM-free and unit-tested.
- `CanvasPane.tsx`, component `PanSolidEdges`, mounted next to `LowDetailEdges`:
  - It listens to React Flow's own d3-zoom under its own namespace (`zoom.cogicPanSolid`,
    `end.cogicPanSolid`). React Flow's handlers are untouched.
  - **When it switches:** on the first `zoom` event whose source is a pointer move (`mousemove`,
    `pointermove` or `touchmove`). A click without movement, wheel zoom, the zoom and fit buttons, and
    programmatic moves (focus, trace, runtime) do not switch.
  - **What it changes:** one class, `canvasFlow--panningSolidEdges`, on the canvas container. It does
    not set React state, change edges, nodes, IDs or layout, or remount React Flow.
  - **When the dashes come back:** at the mouse up (or after the delay), and at once on window
    `blur`, `pointercancel`, export (`suspended`, like `LowDetailEdges`) and unmount.
- `CanvasPane.css`: the same `stroke-dasharray: none !important` override as the low-detail mode. The
  two classes are independent, and `LowDetailEdges` and its hysteresis are unchanged.
- **Setting → webview:** a `panEdgeDetail` message (`protocol.ts`, the webview message whitelist,
  `App.tsx`), sent at panel start, on request, and live when the setting changes.

## Measurement

**Harness:** `e2e/pan-solid/run.mjs`, built on the P15-P0 harness.
- **Fixture:** the expanded 650-node fixture, zoom 0.6, view V0.
- **The pan:** a 5 s ellipse, with every run gated: press on the pane, more than 100 viewport
  transforms, excursion and return, and the store transform equal to the DOM's.
- **Animation:** dash animation is stopped by a harness style in every condition.
- **Conditions:** the policy changes live through the setting. 3 rotated repetitions per condition.
- **Recorded per run:** each frame's gap, and whether the solid class was on; the mouse up; and the
  500 ms after it.
- **Traces:** one Electron trace per condition, split at the mouse up.

**Environment:** Windows 11, i5-9400F, GeForce GT 710; one machine.

### Results (`run2`, medians of 3; ms)

| Condition | Drag p50 | Drag p95 | Drag max | Drag > 50 | Drag > 100 | Stall in the drag (sum of gaps > 50) | 500 ms after: max | after: > 100 |
|---|---|---|---|---|---|---|---|---|
| D0 dashed (`off`) | 8.3 | 16.7 | 242 | 15 | 7 | 1742 | 8.5 | 0 |
| S1 `immediate` | 8.3 | 25.1 | 125 | 10 | **1** | **742** | **100** | 0 |
| S2 `delayed` (150 ms) | 8.3 | 25.0 | 125 | 12 | 1 | 809 | **125** | 1 |
| S3 only entering edges solid (rejected) | 8.3 | 16.8 | 233 | 15 | 7 | 1708 | 8.5 | 0 |

**The same in every condition:**
- React commits: 321 per pan;
- node and edge mounts and unmounts: 292;
- frames in the drag: 519-535;
- renderer memory: about 705 MB.

GPU memory is about 255 MB (D0) and about 316 MB (S1, S2).

**Traces** (busy time, ms; drag / the 500 ms after the mouse up):

| | GPU raster, drag | GPU raster, after | GPU main, after | GPU `Present`, total |
|---|---|---|---|---|
| D0 | 2010 | 0 | 2 | 606 |
| S1 | **1014** | 164 | 168 | 1113 |
| S2 | 979 | 176 | 180 | 1289 |

### What this shows

- **During the drag:**
  - Solid strokes cut the long frames: over 100 ms from 7 to 1 (all 3 repetitions), total stall time
    by 57%, GPU raster by 50%.
  - The p95 is one frame interval worse (16.7 → 25 ms). The cost is spread over more medium frames
    instead of a few 150-240 ms stalls.
- **After the mouse up:** putting the dashes back re-rasters every visible edge once. That is one
  100-125 ms frame (164-176 ms of GPU raster) about 100-250 ms after the mouse up, in every pan. D0
  has none.
  - Net, a pan goes from 1742 ms of stall to about 850 ms, but part of the cost now comes after the
    drag.
- **The delay (B) does not lower the restoration cost.** It moves it 150 ms later. Its only gain is
  that drags less than 150 ms apart do not flip between solid and dashed (verified).
- **S3, solid only for the edges that enter during the drag** (rejected, removed from the product):
  - The marks were set, but the long frames stayed as in D0.
  - A raster tile that an entering edge invalidates also holds long dashed edges already on screen,
    so the tile costs about the same (INFERRED).

## Correctness (real input)

Checked in `run2`. All checks passed again in `checks-large` (13/13, expanded fixture) and
`checks-small` (14/14, small fixture in its default collapsed state, with export).
- **No switch on:** wheel zoom; the zoom and fit buttons (programmatic); a click on the pane without
  movement.
- **`immediate`:** the computed stroke is `none` during the drag and dashed 30 ms after the mouse up.
- **Cancel:** window `blur` and `pointercancel` put the dashes back at once.
- **`delayed`:**
  - still solid 40 ms after the mouse up, dashed by 440 ms;
  - two drags 60 ms apart switch once each way.
- **Low detail and hysteresis:**
  - at zoom 0.15 a pan leaves the low-detail mode on;
  - at zoom 0.22 a pan leaves it as it was, both when reached from above (off) and from below (on).
- **Export right after a pan**, with the restore still pending, keeps the dashed strokes. This ran on
  the small fixture in its default collapsed state: exporting a fully expanded graph exceeds the
  memory guard on its own (P15-S1). It did so in `run1` (17 MiB free) and in a first expanded
  small-fixture try (725 MiB).
- **Unchanged after all of it:** graph, node positions, edge IDs and the React Flow mount.
- **Relation kinds while solid:** they stay apart by color and width. Dataflow is
  `rgb(96,165,250)` at 1.8 px; calls are gray at 2.2 px; bridges are light gray at 1.7 px. The dashes
  are the only thing lost while dragging.

**Regressions** (default `off`): unit tests, build, lint, `git diff --check`, and the focus-context,
aggregate-inspector, export-viewport, trace-steps and trace-exit E2E (see the PR).

**Not run with the policy on:**
- **Runtime Debug and trace.** They move the view programmatically, and programmatic moves were
  verified not to switch, so they are INFERRED unaffected.

## Decision: CONDITIONAL

| Criterion | Result |
|---|---|
| 1. Fewer frames over 100 ms in a real pan | met: 7 → 1 |
| 2. Pan p95 not meaningfully worse | borderline: one frame interval worse; frames over 50 ms 15 → 10-12 |
| 3. No new long frame from the restoration | **not met**: one 100-125 ms frame after every pan, with either restore timing |
| 4. No conflict with LowDetailEdges | met |
| 5. Graph and features kept | met |

**Recommendations:**
- Keep it opt-in. If it is used, use `immediate`: the delay does not make the restoration cheaper.
- Do not make it the default as it is. The restoration frame is the same kind of cost it removes,
  now at the end of every pan.

**Options to measure next** (not implemented):
1. **Solid strokes always while zoomed below some level, or always.** The `Gdash` condition of
   P15-P0 had no frame over 100 ms and no restoration at all. That is a visual decision (dashes mark
   dataflow), not a performance one.
2. **Restore only after the view is idle for longer.** This hides the frame from the drag but still
   pays it. Spec P15-P1 does not count this as success.

## Verified, inferred, unverified

- **Verified:**
  - the tables;
  - the traces;
  - the correctness checks.

  All on one machine, GPU and fixture.
- **Inferred:**
  - why S3 does not help (tiles, not edges);
  - Runtime Debug and trace under the policy.
- **Unverified:**
  - other GPUs and refresh rates;
  - GPU hardware time;
  - Vite.

## Records

- `run2/result.json`: 12 runs with per-frame logs, plus the checks and traces summary.
- `trace-analysis.jsonl`: the trace totals. The raw traces stay local.
- `run1-aborted-result.json`: the first full run. It has 9 valid runs (D0, S1, S2). It was stopped
  by the memory guard (17 MiB free) when its export check exported the fully expanded graph; the
  export check now runs on the small fixture only.
- `checks-large/`, `checks-small/`: the check-only sessions. The low-detail checks in `run2` read
  the wrong view (a translation used at another zoom) and are superseded by `checks-large`.
