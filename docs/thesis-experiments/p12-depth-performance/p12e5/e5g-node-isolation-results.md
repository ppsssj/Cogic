# E5G: node paint isolation and layer mapping (Multiple 125 ms pan)

Diagnostic only. Condition B hides nodes on purpose; it is not a functional equivalent or a product performance result. Product code, GraphPayload and defaults are unchanged; no optimization is implemented.

## Conclusion

1. **VERIFIED: layer 15 is `.react-flow__nodes`** (CDP `LayerTree` backend node, 20694 x 2690 CSS px, reasons `Trivial3DTransform, WillChangeTransform`). IDs are not stable: after one hide/restore the same element is layer 451 (session 1) or 312 (session 2).
2. **VERIFIED: hiding nodes removes the stalls** (Present wait 34-42 ms, no gaps, in 4 of 4 B pans). But the pre-registered reading "node paint is the contributor" does **not** follow, because
3. **VERIFIED: normal pans that come after a B pan are also smooth** (3 of 3: Present 41-74 ms, no gaps), with node paint (256-276) and attach/detach (128/128) fully back. The only A pan not preceded by B in an ON session stalled (Present 11015 ms). The effect of B persists, so A and B in this series must not be pooled.
4. **INFERRED:** the contributor is the *state of the nodes layer*, not paint as such. Hide/restore recreates that layer with a small tile set. The stall needs a **large tile set and re-raster during the pan together**.

Classification: outcome **A in the raw B condition, but confounded by carry-over**; handled as C (no causal claim for node paint). It is not outcome B, so the output environment is no longer the first suspect: on the same GPU, displays and remote desktop the same pan runs without Present waits.

## Method

- [p13-p12e5g-nodes.spec.ts](p13-p12e5g-nodes.spec.ts), [run-e5g-nodes.ps1](run-e5g-nodes.ps1), [analyze-e5g-pan.cjs](analyze-e5g-pan.cjs), [aggregate-e5g.cjs](aggregate-e5g.cjs) -> [e5g-aggregate.json](e5g-aggregate.json); [analyze-gpu-tiles.cjs](analyze-gpu-tiles.cjs) -> [e5g-gpu-tiles.json](e5g-gpu-tiles.json). Earlier logs and scripts are unchanged.
- **A** normal; **B** `visibility: hidden !important` on `.react-flow__nodes` and descendants, inserted 2.5 s before the pan and removed after. Sessions: ON `ABBA`, ON `BAAB`, OFF `ABBA` control; E5F path and 40/40 delivery. Pans in a session are not independent (and here demonstrably carry over).
- Layers are mapped by DOM node, class and compositing reason before and after every pan with CDP on the OOPIF that owns the webview. LayerTree is enabled only outside traced intervals. Raster tasks are attributed by those maps; layers created during a pan are "unmapped".
- Verified per pan: graph and group state equal session start, viewport restored, DOM node set unchanged, all nodes hidden in B and none in A, 152 edge paths visible in both, identical attach/detach and viewport sequences in all 8 ON pans, 40/40 moves, nodes restored. Sessions are functionally valid; manifests and graph sha match; ON/ON state gate passes, OFF fails only on the known legacy pan speed. Memory minima 2003-2078 MiB, guard not fired.

### Confounders recorded

- **Carry-over** (above).
- B removes the nodes layer and the folder-header layer (21 -> 19 layers). `visibility:hidden` nodes are not hit-testable; pointer targets were the same classes in A and B, and the press point is the pane.
- `LayerTree` probing is a new perturbation. The first OFF pan (A) in this series stalled (Present 5645 ms, nodes layer 418 raster tasks), and ON p1A was slower than any E5F pan (11.0 s vs 7.1-8.5 s). E5F, without probing, had neither. Probing may re-raster tiles; UNVERIFIED. The first pan of session 1 is therefore not a clean baseline either; the E5F A pans (4/4 stalled, 7.4-8.5 s, no probing) are the better one.

## Results

| Pan (session order) | Present n / wall / CPU ms | gaps >50 ms n / ms | loop ms | GPU raster | raster: nodes / edges / other | node / edge Paint | tiles median | GPU MiB median |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ON-1 A | 47 / 11015 / 214 | 31 / 11616 | 12268 | 1071 | 821 / 83 / 216 | 256 / 64 | 606 | 179 |
| ON-1 B | 305 / 42 / 41 | 0 | 5015 | 548 | 0 / 84 / 463 | 0 / 64 | 17 | 10 |
| ON-1 B | 304 / 35 / 35 | 0 | 5001 | 549 | 0 / 84 / 464 | 0 / 64 | 17 | 10 |
| ON-1 A (after B) | 305 / 41 / 40 | 0 | 5007 | 637 | 84 / 84 / 467 | 276 / 64 | 31 | 16 |
| ON-2 B | 305 / 34 / 33 | 0 | 5005 | 549 | 0 / 83 / 466 | 0 / 64 | 17 | 10 |
| ON-2 A (after B) | 303 / 74 / 61 | 0 | 4999 | 633 | 84 / 84 / 463 | 276 / 64 | 31 | 16 |
| ON-2 A (after B) | 301 / 71 / 56 | 0 | 5012 | 633 | 84 / 84 / 463 | 256 / 64 | 31 | 14 |
| ON-2 B | 300 / 36 / 36 | 0 | 5000 | 546 | 0 / 84 / 461 | 0 / 64 | 17 | 10 |
| OFF A | 61 / 5645 / 111 | 11 / 5883 | 6969 | 552 | 418 / 5 / 128 | 0 / 0 | 759 | 188 |
| OFF B | 307 / 37 / 35 | 0 | 4999 | 362 | 0 / 2 / 359 | 0 / 0 | 44 | 9 |
| OFF B | 313 / 38 / 38 | 0 | 5001 | 369 | 0 / 2 / 366 | 0 / 0 | 44 | 9 |
| OFF A (after B) | 309 / 56 / 55 | 0 | 5001 | 376 | 8 / 3 / 363 | 0 / 0 | 58 | 16 |

ON DOM attach/detach is 128/128 nodes and 256/256 edge groups per pan; OFF 0. In the stalled pans Present covers 93-94% of gap time. Event timestamp -> handler: 182 ms median (p95 976) in ON-1 A, 4.3-5.3 ms in all other ON pans.

### Tile counts, applied post hoc to the saved E5E/E5F traces

| Traces | tiles median | GPU MiB median | Present wall |
| --- | --- | --- | --- |
| E5E ON; E5F ON (8 pans, with edges hidden or not) | 742-752 | 174-221 | 6596-8538 ms, stalled 9/9 |
| E5E OFF; E5F OFF (4 pans) | 747-771 | 213-220 | 28-288 ms, smooth (one isolated 2-gap pan) |
| E5G after recreation (3 ON A, 4 ON B) | 17-31 | 10-16 | 34-74 ms, smooth 7/7 |

So a large tile set **alone** does not stall (OFF holds ~770 tiles and stays smooth, with no node repaint), and node churn **alone** does not (ON A after recreation). The stalled pans have both. This explains why removing edge paint (E5F) changed nothing. `used_bytes` is GPUTask accounting for the graph renderer, not VRAM residency; the cc budget was 512 MiB, no tile-manager out-of-memory was reported.

## Interpretation

INFERRED: the nodes container is promoted by `CanvasPane.css` (`.react-flow__edges`, `.react-flow__nodes`: `translateZ(0)`, `will-change: transform`). Chromium avoids lowering the raster scale of `will-change: transform` layers, so a layer first rastered around zoom 1 plausibly keeps a high raster scale at zoom 0.1, spanning hundreds of tiles for what is about 2060 x 260 screen px. Hide/restore recreates it at zoom 0.1 with about 30 tiles. Every attach/detach then invalidates far fewer tiles. This fits layer identity, tile counts, GPU memory, persistence and the E5F null result.

UNVERIFIED: the raster scale itself (traces do not record it), that recreation rather than another side effect of hiding is responsible, why Present waits so long per unit of raster, the role of LayerTree probing, and anything on other hardware or the Vite graph. Single fixture; 1 clean stalled ON A in this series.

## Next (one experiment, then stop isolating)

In the same ON build, with **no** LayerTree probing and alternating sessions (one condition per fresh session, since pans carry over): A as is, versus A with a diagnostic stylesheet setting only `will-change: auto` on `.react-flow__nodes` and `.react-flow__edges` before any zoom, plus a recreate-only control (hide/restore once, then normal). If the stall disappears in both, the raster-scale mechanism is supported and a product proposal can be evaluated, including zoom-in sharpness. Overscan/hysteresis is **not** the first candidate: it reduces churn, but churn alone did not stall. ETW/GPUView is now lower priority, useful only to explain the Present cost.

## Data

Per-pan analyses and interaction logs are in `e5g-*/`. Traces of session `e5g-on-abba` are committed (without metadata); all 12 originals are in `C:\dev\p13\e5g-traces\`, hashes in [e5g-original-trace-sha256.txt](e5g-original-trace-sha256.txt).
