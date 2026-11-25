# P12-E10 Low-detail edge strokes when zoomed out

**Change:** at low zoom, edges are drawn solid instead of dashed. All edges stay visible with the same color, width, opacity and markers. Based on PR #40.

* `webview-ui/src/lib/edgeDetail.ts`: policy. Low detail at zoom <= 0.2, off at >= 0.25 (hysteresis). 0.1 is the measured case (E9); 0.2/0.25 are conservative, not tuned.
* `CanvasPane.tsx`: `LowDetailEdges` inside `<ReactFlow>` subscribes to the React Flow store and toggles `canvasFlow--lowDetailEdges` only when the mode changes. No React state, no node/edge array rebuild; viewport changes from any source reach it through the store.
* `CanvasPane.css`: the class sets `stroke-dasharray: none !important` on `.react-flow__edge-path` (needed over the inline edge style).
* Export: the mode is suspended while `renderAllForExport` is set, because `html-to-image` copies computed styles, then restored.

## Vite pan (Depth 2, zoom 0.1, virtualization ON, 1 session each)

| | A (PR #40) | B (this change) |
|---|---|---|
| Pan ms (5000 planned) | 16654 | 5000 |
| rAF gaps >50 ms n (total ms) | 26 (15748) | 9 (550) |
| Inputs >50 ms late, of 40 | 37 | 0 |
| GPUTask ms | 15973 | 1347 |
| `DoRasterCHROMIUM` ms | 8503 | 372 |
| Raster Flush ms | 7440 | 945 |
| Visible edge paths | 861 of 861 | 861 of 861 |
| Dashed edge paths | 839 | 0 |
| Edge Paint n; node Paint n | 64; 36 | 64; 36 |
| Edge DOM attach/detach | 868/868 | 868/868 |

GPU rows nest; do not add them. rAF gaps are not display FPS. Graph `1cf5220c…`, start viewport, node/edge IDs, path geometry hash, stroke-style hash and input path are equal in A and B; 40/40 inputs delivered; minimum free memory 1195 MiB, guard never fired. The result matches E9, so no repeat was run.

## Functional checks

| Check | Result |
|---|---|
| Zoom walk 1 / 0.3 / 0.22 / 0.2 / 0.22 / 0.249 / 0.25 / 0.22 / 0.201 / 0.1 / 0.24 / 1 / 0.1 | as expected at every step; dashes back at >= 0.25 and on 1 |
| 10 moves between 0.199 and 0.24 | 0 mode changes |
| Wheel to 0.1 and back | 2 mode changes (one each way); B low at 0.1, dashed at 1.6 |
| Button zoom 0.54 / 1.11, Fit at 0.34 | correct (not low) |
| SVG export at zoom 0.1 | dash styles identical to A (2 × `8, 6`, 2 × `6, 6`); low detail restored afterwards |
| Blank-canvas regression (8 rounds, real build) | pass: openLocation, selection and Inspector kept, 5 file switches, no blank, 38 painted screenshots |
| File/folder collapse and expand, selection, Fit, button/wheel zoom, graph and topology (Multiple fixture) | valid, no errors |
| `npm run build:all` / `npm test` / `git diff --check` | exit 0 / 90 passing / clean |

The fixture functional run (`functional-*.json`) used 4 collapsed-group edges, none of them animated. The animation rule is untouched, but animation at low zoom was not exercised. JPG export was not run; it goes through the same suspend step. No sideways canvas shift was seen in the regression run (n=1; it was intermittent before).

## Status

* **VERIFIED:** above, on one machine and GPU.
* **INFERRED:** other large graphs with long dashed edges benefit at zoom <= 0.2.
* **UNVERIFIED:** zoom 0.2–1 on large graphs, where dashes remain and pan may still be slow; other GPUs/OS; JPG export; animated edges at low zoom; whether users miss the dash cue when zoomed out (type is still shown by color and width).

Risk: while zoomed out, dataflow and bridge edges differ only by color, width and opacity. Crossing the threshold repaints all edges once.

Raw data: `C:/dev/p13/p12e10-data` (not committed). `run.ps1` needs the memory monitor from research PR #39.
