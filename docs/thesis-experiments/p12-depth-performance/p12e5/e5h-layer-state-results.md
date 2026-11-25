# E5H: layer state and will-change isolation (Multiple 125 ms pan)

Diagnostic styles only, in isolated extension copies. Product code, GraphPayload and defaults are unchanged; nothing is adopted here. One fixture, one machine (GT 710, 120 + 60 Hz displays, Chrome Remote Desktop). Each session is one independent fresh VS Code run with **one** traced pan.

## Conclusion

1. **VERIFIED:** with `will-change: auto` on `.react-flow__renderer`, `.react-flow__viewport`, `.react-flow__edges` and `.react-flow__nodes` (condition **D**; every transform and `translateZ(0)` kept, nodes and edges visible, virtualization ON) the stall is gone in **5/5** sessions, against **10/10** stalled A sessions.
2. **VERIFIED:** `will-change: auto` on nodes and edges only (**B**) changes nothing (5/5 stalled).
3. **VERIFIED:** forcing the nodes layer to be recreated once at zoom 0.1 (**C2**) also removes the stall in every valid session (4/4). In the first C series it worked only when the layer was actually recreated (2/5).
4. **VERIFIED (visual):** at zoom 2, A, B and C show blurred node text, still blurred after 2 s; D is sharp. Recreated layers (C, C2) are as blurred as A at zoom 2.
5. **INFERRED:** an ancestor's `will-change: transform` (the React Flow viewport and/or renderer) pins the raster scale near 1. At zoom 0.1 the nodes layer then holds ~750 tiles that are re-rastered as nodes enter and leave; at zoom 2 it is upscaled.

Recommended next development step: **a CSS adjustment** (see "Recommendation").

## Design

- [p13-p12e5h-layer.spec.ts](p13-p12e5h-layer.spec.ts), [run-e5h-layer.ps1](run-e5h-layer.ps1), [run-e5h-series.ps1](run-e5h-series.ps1), [analyze-e5h-pan.cjs](analyze-e5h-pan.cjs), [analyze-gpu-tiles.cjs](analyze-gpu-tiles.cjs), [aggregate-e5h.cjs](aggregate-e5h.cjs) -> [e5h-aggregate.json](e5h-aggregate.json).
- **A** build as is. **B** A plus one appended bundle rule `.canvasFlow .react-flow__edges,.canvasFlow .react-flow__nodes{will-change:auto}`. **C** A, with nodes hidden and restored once after the initial Fit. **D** (declared supplement) A plus the same rule on renderer, viewport, edges and nodes. **C2** (declared supplement) C with the hide verified: computed hidden state plus 10 rAFs, then 3 s more.
- B/D apply through the isolated bundle CSS, i.e. before React Flow exists: when first sampled no React Flow element was mounted, and computed `will-change` was checked after setup. The extension copies differ from A only in that CSS file.
- Series 1, orders fixed in advance: ABC, CBA, BAC, CAB, BCA (15 sessions). After B failed and C split, one supplement was declared before running: ADC, CDA, DCA, ACD, CAD (15 sessions, with concurrent A). No further series.
- Each session: initial expand/Fit, condition setup, the legacy E5D pan (untraced), then the traced E5F-path pan (40/40 moves arrived everywhere). **No LayerTree query before or during the pan**; screenshots and layer mapping come after it. Deviation from a pure first pan: the legacy pan precedes it in every arm.
- Graph sha, manifest fields, group/edge/node IDs, DOM node set, start viewport and attach/detach sequence are identical in all sessions with a measured pan. Functional gates pass in all of them. The E5D state gate compares the legacy pan: it fails on pan speed between stalled and smooth sessions (the outcome), and on a waypoint between two stalled runs in some; two sessions (`b4-B`, `d-b3-C`) also record a different *legacy* pre-pan viewport snapshot. Gates were not relaxed.
- Invalid: `d-b1-C` (viewport style differed during the condition setup; no pan). It stays invalid and is not replaced, so C2 has 4. `e5h-check-b1-A` is a harness check, excluded. Two things differ from the plan: C's 1 s hide was not verified as rendered, and the C2 check is stricter.
- Memory: lowest free 1984 MiB; guard not fired.

## Results (median [range], per session)

| | A series 1 (n=5) | B (n=5) | C, not recreated (n=3) | C, recreated (n=2) | A series 2 (n=5) | **D (n=5)** | **C2 (n=4)** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Present wall ms | 7871 [6630..7899] | 6719 [6650..7509] | 7010 [6710..7744] | 43 [39..46] | 7399 [7007..7833] | **44 [40..45]** | **77 [40..83]** |
| Present CPU ms | 201 | 187 | 196 | 43 | 190 | 44 | 73 |
| Present calls | 53 | 54 | 56 | 302 | 59 | 294 | 303 |
| rAF gaps > 50 ms: n / ms | 30 / 8168 | 30 / 7150 | 32 / 7526 | 0 / 0 | 31 / 7643 | **0 / 0** | **0 / 0** |
| GPU raster commands | 836 | 762 | 770 | 624 | 818 | 668 | 629 |
| graph raster tasks | 860 | 828 | 838 | 623 | 853 | 667 | 628 |
| tile count | 749 | 749 | 749 | 31 | 748 | **28** | 31 |
| GPU client memory MiB | 196 | 208 | 201 | 15 | 173 | **17** | 15 |
| node paint | 256 | 256 | 256 | 256 | 256 | 128 | 256 |
| event -> handler ms, median | 135 | 125 | 131 | 5.4 | 130 | **5.6** | 5.3 |
| loop ms (plan ~5000) | 8832 | 7957 | 8107 | 5002 | 8375 | **5006** | 5010 |
| lateness of last step ms | 3904 | 2962 | 3059 | 3.7 | 3451 | **3.5** | 3.8 |
| untraced legacy pan ms | 8608 | 8298 | 8891 | 4921 | 8133 | 4911 | 4910 |

- The A/D and A/C2 ranges do not overlap on Present, gaps, raster, tiles, GPU memory or input rows. DOM churn (attach/detach 128/128 nodes and 256/256 edge groups) and edge paint (64) are identical in every session; node paint is 256 except in D (128). The untraced legacy pan shows the same split, so the trace does not create it.
- Improvement tracks tile count exactly: 11 smooth sessions have 27-31 tiles, 18 stalled ones (plus the check run) 748-752. Total raster tasks fall only about 25%, so the stall is tied to the large-scale node tiles, not the command count.
- **B:** LayerTree after the run still shows a 20694 x 2690 nodes layer, now without its own compositing reasons, and tile count stays 749. So B removed the direct hint but not the state; viewport and renderer still had `will-change: transform`. This is consistent with scale being pinned by an ancestor. B does not reject the will-change explanation.
- **C vs C2:** in C2 ten rAFs took 5.4-8.5 s while hidden, i.e. the pipeline was still catching up after Fit, so the 1 s hide of C may have been restored before a frame without nodes was produced (INFERRED). C measured an unverified manipulation; only its recreated/not recreated split is informative.
- **Layer reuse:** A/B/C-not-recreated keep the original nodes layer during the pan (dominant layer 15, 510-620 raster tasks); smooth sessions do not. D keeps the layer that was mapped after the run (14, 124-128 tasks) and nodes paint is halved.

## Sharpness

Node `alpha21` at zoom 1 and 2, `setViewport` without animation, screenshots at 100/500/2000 ms after the pan. Laplacian variance of the node crop (same content; higher is sharper):

| | zoom 1 | zoom 2 |
| --- | --- | --- |
| A, B, C, C2 | 4445 in all 24 sessions | 295 in all |
| D | 4445 | **1621** |

A, B, C and C2 screenshots are pixel identical to A at every time. D differs at zoom 1 in 0.04% of pixels, at zoom 2 in 2.7%. Text blur at zoom 2 is visible in A ([A](e5h-b1-A/zoom2-2000ms.png), [D](e5h-d-b1-D/zoom2-2000ms.png)). This is an independent pre-existing symptom that A does not recover from within 2 s. Only zoom 1 and 2 of one node were checked; other zooms, fractional scale factors and animated zoom are not.

## Interpretation

**VERIFIED:** the stall depends on the nodes layer's large tile state (changed by D and by recreation, at the same DOM churn, with the same GPU, displays and remote session). The output environment is not needed to explain it, though it may set its cost.

**INFERRED:** pinned raster scale by ancestor `will-change`. Evidence: tile counts, B vs D, zoom-2 blur and its removal by D. Chromium does not expose raster scale in these traces.

**UNVERIFIED:** which of renderer/viewport in D is sufficient; why ~750 tiles cost so much per Present; wheel/trackpad zoom and zoom animation with D (a layer without `will-change` is re-rastered as scale changes, which can cost frames while zooming); Single state; other hardware, high DPI; Vite graph; long sessions.

## Recommendation

**CSS adjustment** rather than layer lifecycle management or GPU environment analysis. Candidate for a separate product experiment (not implemented):

```css
/* keep translateZ(0) and backface-visibility; drop the permanent hint */
.canvasFlow .react-flow__renderer, .canvasFlow .react-flow__viewport,
.canvasFlow .react-flow__edges, .canvasFlow .react-flow__nodes { will-change: auto; }
```

Before adoption:

1. **Regression risk:** `will-change` and `translateZ(0)` in `CanvasPane.css` were introduced by commit `84558b8` (fix for the graph going blank after canvas click / openLocation). The candidate keeps `translateZ(0)`, but that blank-canvas case must be retested. It was not.
2. Find the smallest rule (viewport only?); measure zoom/wheel animation frames, Single, Vite and a second machine.
3. Compare with and without virtualization on the same build; the E5D ON/OFF result was obtained with the pinned layer and should be re-read after any change.

Forced layer recreation (C2) works but is a hack, needs a timing guarantee and leaves zoom-2 blur. Overscan/hysteresis stays lower priority.

This closes the isolation series E5E-E5H. Earlier results stand; E5D's "virtualization ON stalls" must be read as ON **with the pinned layer state**, not as a property of virtualization itself.

## Data

Every `e5h-*` folder keeps interaction log, analysis and screenshots. Committed traces: `e5h-b1-B` and the supplement block `e5h-d-b2-{C,D,A}` (metadata removed). All 30 originals: `C:\dev\p13\e5h-traces\`, hashes in [e5h-original-trace-sha256.txt](e5h-original-trace-sha256.txt).
