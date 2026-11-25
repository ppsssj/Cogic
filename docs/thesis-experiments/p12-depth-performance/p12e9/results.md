# P12-E9 Vite pan: static edge dashes

Question: do static `stroke-dasharray` dashes contribute to the Vite pan GPU raster cost? Diagnostic only; no product, analyzer, GraphPayload or layout change.

Same setup as E7/E8: PR #40 CSS build, virtualization ON, Vite `35674719` Depth 2 (`1cf5220c…`, 1072/3739), TS language features disabled, zoom 0.1, 40 inputs at 125 ms, fresh VS Code 1.147.0 session each. **A** = normal. **B** = `.react-flow__edges .react-flow__edge-path { stroke-dasharray: none !important }`, injected before tracing (2.5 s settle) and removed after. Order A, B, B, A.

## Comparison

| | A (s1 / s2) | B (s1 / s2) |
|---|---|---|
| Pan ms (5000 planned) | 16632 / 16409 | 5005 / 5001 |
| rAF gaps >50 ms, n (total ms) | 25 (15648) / 25 (15390) | 9 (558) / 8 (500) |
| Inputs >50 ms late, of 40 | 37 / 37 | 0 / 0 |
| GPUTask ms | 15959 / 15704 | 1340 / 1345 |
| `DoRasterCHROMIUM` n, ms | 322, 8509 / 325, 8362 | 361, 371 / 361, 374 |
| `DoEndRasterCHROMIUM::Flush` ms | 7419 / 7313 | 939 / 942 |
| Edge SVG Paint n | 64 / 64 | 64 / 64 |
| Node Paint n | 36 / 36 | 36 / 36 |
| DOM attach/detach, nodes; edges | 36/36; 868/868 (both) | 36/36; 868/868 (both) |

GPU events nest: GPUTask contains DoRaster and Flush; do not add them. rAF gaps are not display FPS. E7's edge-hidden condition: pan 5.0 s, GPUTask 268–279 ms, no gaps. So B still costs about 1.06–1.08 s more GPUTask time than hidden edges and leaves 8–9 gaps.

## Was the dash removal applied, and is the rest the same?

| | A | B |
|---|---|---|
| Dashed edge paths before CSS | 839 of 861 (645 × `8px 6px`, 194 × `6px 6px`) | same |
| Dashed during the pan (before and end) | 839 | 0 |
| Visible edge paths | 861 of 861 | 861 of 861 |
| Dashed after removal | 839 | 839 |
| Running edge animations | 0 | 0 |

* Within each B session, injecting the CSS changed neither the path `d` hash, nor the hash of stroke, width, opacity, linecap, filter and markers, nor edge IDs, nor the element count (2593). Edge IDs, those style hashes and the element count also match across all four sessions.
* Graph hash, start viewport, node/edge IDs, start point and input path match across all four; 40/40 inputs delivered; viewport and topology restored; minimum free memory 1219 MiB, guard never fired; trace buffer ≤6%.
* **Path geometry is not byte-identical across arms.** The `d` hash already differed between A and B before injection (A = A, B = B). In s2, 17 of 861 paths differ, by at most 0.003 px, with the same command structure; s1 paths were not saved, but their hashes equal s2's for the same arm. All 288 node positions and sizes were identical in s1. B's initial Fit also settled slower (964–983 vs 471–489 ms). Both precede the injection; the cause is not established. A 0.003 px difference is too small to plausibly explain a 12x GPU difference, but strict cross-session path identity is not met.

## Conclusions

* **VERIFIED:** removing static dashes alone cuts the Vite pan from 16.4–16.6 s to 5.0 s in 2/2 pairs, GPUTask time by ~91%, and `DoRaster` by ~96%, while Paint counts and DOM attach/detach are unchanged. Edge DOM attach/detach continues in B without the stall.
* **INFERRED:** dash generation along very long paths is the main raster cost on this graph. The remaining ~1.3 s of GPU time in B is solid-stroke edge raster plus the rest.
* **UNVERIFIED:** other zooms, graphs, GPUs; whether selection highlighting or muted edges behave the same; visual equivalence of any replacement style; whether dash period, path length or tile size dominates; the cause of the 0.003 px differences.

**Next single target:** avoid static dashes on long edges at low zoom (or while panning), keeping relation types distinguishable by other styling. Not implemented here. E10 on edge attach/detach is lower priority because attach/detach was unchanged while the stall disappeared.

## Files and checks

Added: `p13-p12e9.spec.ts`, `run.ps1`, `analyze.cjs`, `summary.json`, this file. The spec gained a `geometry.json` dump after the first pair; it is written outside the traced window. Harness 4/4 pass; `git diff --check` clean; product tests not rerun (product code unchanged). Raw traces and screenshots: `C:/dev/p13/p12e9-data` (not committed).
