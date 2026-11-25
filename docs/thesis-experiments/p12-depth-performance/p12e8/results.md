# P12-E8 Vite pan: edge animation

**Result: the premise did not hold. No edge animation runs during this pan, so animation cannot be the cause here.**

Same build as E7 (PR #40 CSS), same Vite graph (`1cf5220c…`, 1072/3739), zoom 0.1, 40 inputs at 125 ms, one fresh session each. A = normal; B = `animation:none` on `.react-flow__edges` and descendants. Order A, B.

| | A | B |
|---|---|---|
| Running edge animations before / end / after restore (`document.getAnimations`) | 0 / 0 / 0 | 0 / 0 / 0 |
| Edge elements with computed `animation-name` ≠ none | 0 | 0 |
| Pan ms (5000 planned) | 16620 | 16640 |
| rAF gaps >50 ms n (total ms) | 25 (15640) | 27 (15715) |
| Inputs >50 ms late, of 40 | 37 | 37 |
| GPUTask ms | 15920 | 15937 |
| `DoRasterCHROMIUM` n, ms | 320, 8499 | 325, 8497 |
| Raster Flush ms | 7390 | 7410 |
| Edge SVG Paint n, ms | 64, 43 | 64, 41 |
| DOM attach/detach nodes; edges | 36/36; 868/868 | 36/36; 868/868 |
| Present ms | 8.6 | 8.9 |

Graph hash, start viewport, node/edge IDs and input path match across A, B and E7; 40/40 inputs delivered; viewport and topology restored; minimum free memory 1492 MiB, guard never fired. Edge path data and style hashes match across A and B at each checkpoint (the hash changes between before and end identically in both arms; reason not investigated).

Both sessions exit 1 because the harness requires A to have a running edge animation. That precondition failed, so A/B is not a valid test of turning animation off: **B had nothing to turn off.** It does serve as two repeats of the normal condition. No reversed pair was run.

**Correction to E7:** E7 listed "12 `dashdraw` animated paths" as an open factor. They exist in the initial viewport (zoom 1.02) only, recorded before the viewport is pinned, not in the measured pan view. E8 finds none there.

## Conclusions

* **VERIFIED:** no edge animation runs at the three sampled points (before, end, after restore), in either arm; the trace has no edge animation evidence in the pan window (the 12 Animation events are toolbar-type transform/color transitions, same in both). The stall is unchanged at 16.6 s.
* **VERIFIED:** 839 of the 861 visible edge paths have a static `stroke-dasharray` (8 6 or 6 6 in `CanvasPane.tsx`), and some paths are in layers 60–87k px tall. The ten edge-path layers have compositing reason `Overlap`, not animation.
* **INFERRED:** static dashing of very long paths may be the raster cost. Not tested.
* **UNVERIFIED:** animation cost in views that do animate (zoom 1.02 or a selected flow); dash versus edge attach/detach versus path count.

**Next:** animation optimization is shelved for this case. Planned follow-up is edge DOM virtualization versus raster invalidation; testing static `stroke-dasharray` off first is recommended because it is a one-line diagnostic.

Raw data: `C:/dev/p13/p12e8-data` (not committed).
