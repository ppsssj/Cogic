# P12-E6 Compositor layer CSS: result and regression check

**Change:** delete `will-change: transform` from the `.react-flow__renderer/viewport/edges/nodes` rule in `webview-ui/src/components/CanvasPane.css`. `translateZ(0)`, `backface-visibility: hidden` and the rest of the 84558b8 blank-canvas fix are kept. No analyzer, GraphPayload or layout change.

A = existing build, K = this change. Fixture graph `09b3c6b2…` (188 nodes / 360 edges), TS language features disabled, one fresh VS Code 1.147.0 session per run, one machine and one GPU. rAF intervals are not display FPS.

## Minimal-condition search (Multiple, virtualization ON, n=3 each; `screen.json`)

| Condition (`will-change:auto` on) | Result |
|---|---|
| A (none) | stalls 3/3 |
| V (viewport + nodes + edges), R (renderer + nodes + edges) | stalls 3/3 |
| W (viewport only), X (renderer + viewport) | stalls 3/3 |
| **D (all four)** | smooth 3/3 |

Renderer + viewport + nodes with edges kept was not tested. Some V and X runs had later-phase harness failures (zoom/selection/expand target); their pan data is retained. Because only D worked, the simplest change is deleting the declaration (K).

## Performance (min–max across sessions; `main.json`, `main4.json`)

| State / virt / build | n | pan P95 / P99 ms | pan >50 ms gaps (total ms) | pan Present wait ms | pan loop ms (5000 planned) | tiles | wheel-out gap ms | button-zoom gap ms | animated-fit gap ms / max | selection gap ms | file-expand gap ms | folder-expand gap ms | sharpness zoom 2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| multiple ON A | 3 | 408–417 / 542–658 | 30 (7617–7709) | 7126–7377 | 8338–8441 | 650–749 | 3992–4017 | 985–1200 | 375–1225 / 217–925 | 192–241 | 250–342 | 7875–9083 | 295 |
| multiple ON K | 4 | 8.6–8.7 / 17–25 | 0 | 49–92 | 5001–5012 | 27–29 | 0 | 225–350 | 484–550 / 75–92 | 208–300 | 292–400 | 933–1076 | 1621 |
| single ON A | 3 | 17–25 / 75–92 | 10–13 (793–1208) | 1379–1639 | 5002–5008 | 551 | 1525–1808 | 50–117 | 767–1033 / 375–533 | 183–217 | 533–650 | 867–917 | 295 |
| single ON K | 3 | 8.5–8.6 / 17 | 0 | 51–97 | 5003 | 20 | 0 | 117–125 | 458–533 / 75–76 | 100–108 | 425–525 | 475–575 | 1621 |
| multiple OFF A | 3 | 8.5 / 17 | 0 | 40–52 | 5004–5006 | 758–783 | 1675–1901 | 0 | 575–1492 / 283–992 | 408–483 | 292–367 | 6692–7350 | 213–272 |
| multiple OFF K | 3 | 8.5 / 17–25 | 0 | 48–55 | 5000–5010 | 42–43 | 59–192 | 142–192 | 609–617 / 92–100 | 325–408 | 258–409 | 817–1309 | 1620 |
| single OFF A | 3 | 8.5 / 9–17 | 0 | 49–52 | 5012–5014 | 554–568 | 984–1075 | 0 | 467–642 / 233–392 | 200–475 | 708–725 | 767–834 | 210–294 |
| single OFF K | 3 | 8.5 / 9–17 | 0 | 50–60 | 5002–5007 | 29 | 0 | 117–125 | 550–592 / 100–133 | 108–167 | 417–467 | 492–550 | 1621 |

Sharpness is Laplacian variance of one node crop; it is not a visual rating. In every valid run the graph hash, start viewport, DOM counts, node/edge IDs and expand state matched across A and K. `main-b3-multiple-on-A` is invalid (preparation could not reach the file button); `main-b4` replaced it and the failed attempt is kept.

**Costs of K:** button zoom with virtualization OFF goes from no >50 ms gaps to two (117–192 ms total, max 133 ms). Animated fit is not better for single/OFF. Multiple/ON file expand is slightly slower (292–400 vs 250–342 ms). Virtualization ON keeps its selection advantage and zero selection Long Tasks (OFF: one, ~64 ms, Multiple only).

## Blank-canvas regression (84558b8 scenario, clean product builds)

Per session: 8 rounds of select, double-click openLocation, editor focus move and return; rapid selection; 5 file switches with the graph visible.

* First series (harness v1, 4 sessions each): A 1/4, K 3/4 passed. A failed three times with `focused node not hittable` after a fixed 1.5 s wait. K failed once in the informational hide/reveal phase (VS Code quick-open closed) after all rounds passed. This difference is not evidence for K.
* Second series (v2: waits up to 8 s for the node, retries quick-open; 3 sessions each): **A 3/3, K 3/3**. A needed ~0.5 s extra in two rounds; K never did.
* All 14 sessions: DOM nodes never 0 in any sample, no canvas anomaly events. Every round that ran opened the right file and kept the selection and the node name in the Inspector; start Inspector text (incl. PARAM FLOW) was equal in the A/K pair compared. Every screenshot was painted (min ink 0.030; `paint.py`); no blank canvas.
* Hiding the Cogic tab destroys the webview; graph nodes did not return within 20 s in A or K. Existing behavior, unchanged.
* **Sideways shift, not new:** in some sessions the canvas contents, including its toolbar, move left (~254 or ~525 px); see `shift.py`. A: b1, b3, b5, b7; K: b4, b5, b7. Mostly from the rapid-selection phase; in `reg-b7-K` from round 0. Hence that session's low ink. The 254 px shift occurs in both A and K, 525 px only in A, so it predates this change (cause unverified, possibly browser focus scroll of an overflow-hidden parent). Earlier onset in K is n=1 and cannot be excluded as an effect. Follow up separately.

## Real Vite graph (`vite.json`)

Vite `35674719`, Depth 2, 1072 nodes / 3739 edges, graph `1cf5220c…`, 861 DOM edges, viewport pinned to zoom 0.1, n=3 each (b5–b7). Memory guard never fired (minimum free 1050 MiB; preflight ≥3001 MiB).

| | A | K |
|---|---|---|
| Pan loop (5000 ms planned) | 16919–17034 | 16271–16514 |
| Pan >50 ms gaps, total ms | 15863–16049 | 15294–15657 |
| Present wait ms | 96–226 | 7–9 |
| Wheel in / out gaps ms | 61978–62515 / 176792–184857 | 45960–47913 / 50029–52583 |
| Button zoom | 30 s click timeout 3/3 | completed 3/3 (~18 s gaps) |
| Animated-fit gaps ms / max | 3096–4051 / 2556–2609 | 440–1063 / 354–618 |
| Sharpness zoom 2 | 340 | 1574 |

**Vite panning is not fixed.** Both builds spend ~0.6–0.9 s of GPU raster per update (GPU main thread `RasterDecoderImpl::DoRasterCHROMIUM` and flush, ~15.5 s of a 16 s pan); Present is not the bottleneck there. Reducing raster cost for 861 edges is separate work. Early attempts b1–b4 are invalid (syntax error, non-comparable expansion, start viewport at zoom 1.02) and kept.

## Conclusions

* **VERIFIED:** on the fixture K removes the pan Present stall in all 13 valid sessions, removes or shrinks wheel-out gaps, and sharpens zoom 2; graph and React Flow state are identical; `npm run build:all` exit 0, `npm test` 90 passing, `git diff --check` clean.
* **INFERRED:** the raster scale no longer being pinned explains both the tile drop and the sharper zoom 2 (E5H).
* **UNVERIFIED:** other GPUs/OS/DPR; Vite selection, collapse/expand and openLocation; why the canvas shifts; Vite raster cause below the trace level; TS language features enabled.

Raw traces and screenshots stay local in `C:/dev/p13/p12e6-data` and are not committed. `run*.ps1` and `series*.ps1` call `../p12c2/memory-monitor.ps1` and `../p12e5/manifest.cjs`, which exist on the research branch (#39).
