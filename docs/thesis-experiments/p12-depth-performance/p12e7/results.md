# P12-E7 Vite pan: edge SVG raster isolation

Question: is edge SVG rendering the main cause of the GPU raster cost in the Vite pan left over from P12-E6? Diagnostic only; no product, analyzer or GraphPayload change.

Same build (PR #40 CSS), virtualization ON, fresh VS Code 1.147.0 session each, Vite `35674719` Depth 2 (1072 nodes / 3739 edges), TS language features disabled, zoom 0.1, 40 inputs at 125 ms.
**A** = normal. **B** = `visibility:hidden` on `.react-flow__edges` and descendants, set before tracing, removed after the pan. Edge DOM stays. Edge labels live outside that container and stay visible. B is not functionally equivalent to the product. Order A, B, B, A.

| | A (s1 / s2) | B (s1 / s2) |
|---|---|---|
| Pan ms (5000 planned) | 16609 / 16308 | 5012 / 5008 |
| rAF gaps >50 ms, n (total ms) | 25 (15624) / 25 (15440) | 0 / 0 |
| Inputs >50 ms late (max ms) | 37 of 40 (11693) / 37 (11385) | 0 (17) / 0 (19) |
| GPUTask ms | 15898 / 15645 | 279 / 268 |
| `DoRasterCHROMIUM` n, ms | 323, 8472 / 324, 8343 | 198, 97 / 198, 88 |
| `DoEndRasterCHROMIUM::Flush` ms | 7397 / 7272 | 165 / 162 |
| Edge SVG Paint n, ms | 64, 39 / 64, 43 | 0 / 0 |
| Node Paint n | 36 / 36 | 36 / 36 |
| DOM node attach / detach | 36 / 36 (both) | 36 / 36 (both) |
| DOM edge attach / detach | 868 / 868 (both) | 868 / 868 (both) |
| Present ms | 8.9 / 8.5 | 61 / 39 |

Paint counts are Chromium `Paint` events (one per invalidated owner), not per path. rAF is not display FPS. GPU events nest: GPUTask contains the DoRaster and Flush rows.

**Suppression:** visible paths in B were 0 of 1722 before the pan and at its end (861 edge groups stayed in the DOM), 1722 after restore; edge SVG Paint was 0; `during.png` shows nodes but no edges.

**Identical conditions (all four):** graph hash, start viewport, DOM node IDs, flow edge IDs, 16 DOM nodes / 861 DOM edges, pan start point and input path; 40/40 inputs delivered; viewport and topology restored. Trace buffer ≤6%; minimum free memory 1363 MiB; guard never fired. B renders more frames, which is why its Present total is higher.

## Conclusions

* **VERIFIED:** hiding edge paint alone removes the Vite pan stall in 2/2 pairs (16.3–16.6 s → 5.0 s) and ~98% of GPU raster time, with the same React Flow virtualization churn. Main-thread edge Paint is small (~40 ms); the cost is GPU raster. About 82 of ~323 raster calls took ≥20 ms and make up ~90% of `DoRaster` time.
* **INFERRED:** edge raster per pan update is the main bottleneck on this graph. The edge SVG and several edge paths are layers up to ~82–87k px tall, and the edge SVG is repainted during the pan, so re-rasterizing large overlapping path content on each update is the likely mechanism. B also shows virtualization and node churn do not cause the stall by themselves; it does not show their cost with edges visible.
* **UNVERIFIED:** which part dominates (edge attach/detach invalidation, 12 `dashdraw` animated paths splitting layers, stroke style, path length); SVG versus Canvas cost; other graphs, zooms, GPUs; TS features enabled.

**Next single target:** stop the edge SVG from being re-rasterized on every pan update. First step: separate edge attach/detach from dash animation, since they point to different fixes. Candidates after that: avoid unnecessary re-raster of the SVG edge layer, cheaper edges while panning, SVG vs Canvas cost, animation off while panning. None is implemented here.

Excluded: wheel zoom, fit, Single graph, the canvas sideways shift (separate issue). Raw traces stay in `C:/dev/p13/p12e7-data`. `summary.json` is the analysis output. `run.ps1` needs the memory monitor from research PR #39 (`-Research`).
