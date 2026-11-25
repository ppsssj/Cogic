# E5F: edge paint isolation during the Multiple 125 ms pan

Diagnostic only. Condition B hides edges on purpose, so it is **not** a functional equivalent and says nothing about performance quality of a product. Product code, GraphPayload and defaults are unchanged.

## Conclusion

The hypothesis "re-raster of the edges SVG is an important contributor to the GPU Present wait" is **not supported** (VERIFIED for this machine and fixture). Suppressing edge paint removed all 64 edge paints per pan and about a fifth of raster work, and the Present wait, gaps and input lateness did not change. **Edge layer optimization is not recommended on this evidence**, and "virtualized nodes + always-mounted edges" versus "overscan" is not proposed as the next step. The remaining ON-only raster (layer 15) and the output environment are.

## Correction to E5E

E5E inferred that layer 15 (496 of 720 raster tasks) is the edges SVG and named it the best single target. **That inference is wrong.** With edges hidden, layer 15 still has 504-542 raster tasks. What disappears is one layer with 76-84 tasks and about 65 one- or two-tile layers. Layer 15 is therefore not the edges SVG; it is probably the nodes container (`.react-flow__nodes` is a promoted layer and nodes repaint only in ON), which stays INFERRED. E5E's measurements, including the location of the wait, stand.

> **Follow-up (E5G):** layer 15 is verified as `.react-flow__nodes`. See [E5G](e5g-node-isolation-results.md).

## Method

- [p13-p12e5f-edges.spec.ts](p13-p12e5f-edges.spec.ts), [run-e5f-edges.ps1](run-e5f-edges.ps1), [analyze-e5f-pan.cjs](analyze-e5f-pan.cjs), [aggregate-e5f.cjs](aggregate-e5f.cjs) -> [e5f-aggregate.json](e5f-aggregate.json). E5D/E5E scripts and data are unchanged.
- **A** = build as is. **B** = same build, `visibility: hidden !important` on `.react-flow__edges` and descendants during the pan, removed afterwards. Edges stay mounted: DOM attach/detach and layout still happen, only painting is suppressed.
- Sessions: ON `ABBA`, ON `BAAB`, OFF `ABBA` (control); 4 pans per session, each traced separately with the E5E categories, 2.5 s settle before. n = 4 per condition in ON from 2 sessions; pans within a session are not independent.
- **E5F path**: the same +-280/+-55 px sine, 40 steps at 125 ms, but the press point is the hit-testable pane point nearest the horizontal center for which every move stays inside the iframe (client 312,154 of 621x864). 40/40 moves arrived in every pan. Values here must not be compared with E5D/E5E, which lost 6 moves.
- Verified in every pan: graph node/edge IDs and group states equal the session start, start viewport restored, same DOM node set before/after, nodes visible, all edge paths hidden in B and visible again afterwards. In the 8 ON pans the per-mutation attach/detach sequence and viewport sequence are identical. Graph sha, manifest and functional gates pass for all three sessions; the E5D state gate matches ON/ON, and for OFF fails only on the known pan speed of the legacy pan phase.
- Memory: minima 2011-2039 MiB, guard not fired.

## Results (ON)

| Pan (session order) | Present n / wall / CPU ms | gaps > 50 ms n / ms | GPU raster cmds | graph raster tasks (layer 15) | edge / node Paint | input loop ms |
| --- | --- | --- | --- | --- | --- | --- |
| A abba-1 | 55 / 8538 / 202 | 32 / 8908 | 826 | 917 (613) | 64 / 256 | 9424 |
| B abba-2 | 57 / 7118 / 203 | 30 / 7425 | 600 | 624 (504) | 0 / 256 | 8139 |
| B abba-3 | 52 / 7417 / 190 | 32 / 7834 | 591 | 647 (534) | 0 / 256 | 8371 |
| A abba-4 | 53 / 7633 / 205 | 31 / 8016 | 787 | 845 (540) | 64 / 256 | 8646 |
| B baab-1 | 54 / 7643 / 197 | 31 / 8083 | 614 | 654 (542) | 0 / 256 | 8627 |
| A baab-2 | 56 / 7460 / 200 | 31 / 7850 | 791 | 836 (540) | 64 / 256 | 8531 |
| A baab-3 | 51 / 7417 / 201 | 30 / 7892 | 774 | 817 (525) | 64 / 256 | 8475 |
| B baab-4 | 49 / 7710 / 170 | 33 / 8200 | 594 | 651 (540) | 0 / 256 | 8648 |
| **A median [range]** | **7546 [7417..8538]** wall | 7954 [7850..8908] ms | 789 [774..826] | 841 [817..917] | 64 | 8589 [8475..9424] |
| **B median [range]** | **7530 [7118..7710]** wall | 7958 [7425..8200] ms | 597 [591..614] | 649 [624..654] | 0 | 8499 [8139..8648] |

- Raster clearly falls in B (ranges disjoint: GPU commands -24%, graph raster tasks -23%). Present wall, gap time and input loop ranges overlap; the medians differ by -0.2%, +0.1% and -1%. Planned loop is about 5000 ms in all.
- Of gap time, Present covers 92-94% in both conditions. DOM: 128/128 nodes, 256/256 edge groups attach/detach in 32 batches in every pan.
- Event timestamp -> handler (median per pan): A 131.6-141.2 ms, B 112.6-146.6 ms; OFF 5.3-5.7 ms. Final-step lateness: A 3442-4369 ms, B 3232-3607 ms.
- Order: the first pan of session 1 (A) was slowest, but the first pan of session 2 (B) was not; with the position-balanced orders no systematic benefit remains. Session 1 alone would have suggested a B benefit; the reversed session shows the opposite.
- Free memory before/after each traced pan is within +-115 MiB; no difference by condition.

OFF control (same path, ABBA): Present 35-38 ms in 3 of 4 pans; gaps 0; loop 5004-5007 ms; attach/detach 0; edge paint 0 in both A and B. Pan 3 (B) had 2 gaps (242 ms, Present 284 ms): an isolated event that is not understood. GPU raster commands 348-364.

## What this does and does not show

VERIFIED: less edge paint and raster without less Present wait, so the wait is not proportional to edge raster. Present wall being independent of a 24% drop in raster commands also weakens "more raster commands -> longer wait".

INFERRED: the contributor is another ON-only item: the layer-15 raster / node repaint, layer tree changes and commits on attach/detach, or the presentation path itself. E5E's "GPU backlog of raster" is now a weaker hypothesis, not excluded (layer 15 stays in B).

UNVERIFIED: identity of layer 15; what Present waits on; remote desktop, mixed 120/60 Hz displays, GT 710 driver; Vite graph; whether B's layer still keeps GPU memory (visibility:hidden does not necessarily release it).

## Next

1. **First:** same harness, suppress node paint instead (B' = nodes hidden, and mapping layer IDs to DOM with the CDP `LayerTree` domain). If Present falls, layer 15 / node raster is the contributor.
2. If not, the output environment: ETW/GPUView plus a run without Chrome Remote Desktop and with a single display.

No optimization is implemented or recommended.

## Data

Every `e5f-*/` folder keeps the interaction log and per-pan `analysis-*.json`. To limit repository size only session `e5f-on-abba` commits its traces (`trace-*.json.gz`, without the metadata block); all 12 originals stay on the test machine in `C:\dev\p13\e5f-traces\`, hashes in [e5f-original-trace-sha256.txt](e5f-original-trace-sha256.txt). Re-analysis of a committed trace gives the same output.
