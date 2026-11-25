# E5C: expanded graph virtualization

## Result and scope

The unchanged E5B multifile fixture generates **188 logical nodes and 360 logical edges**, normalized SHA-256 `09b3c6b2d578b41353645055476c967e4868c8354b7495708ea6ae7b998b33bc`. The original E5B fixture, reference hash, raw logs and clean OFF source remain intact. No Vite test or product code change was performed. These tests use isolated builds with the **same test-only bridge** exposing the exact `nodes` and `edges` supplied to React Flow plus its instance for bounds; the [ON/OFF source comparison](e5c-on-off-source.diff) contains one virtualization expression change. Both test extensions use the same analyzer and manifest probe. The bridge and DOM mutation observer add unmeasured overhead.

**The required expanded-state performance comparison is incomplete.** At the tested 581 ? 494 CSS-pixel canvas size, Fit Graph cannot contain the expanded graph at the product's 0.1 minimum zoom. Expanded attempts fail the requested fit-bound gate and are excluded from valid A/B statistics. The requested five independent valid samples per expanded condition were therefore not achieved; changing the product zoom limit or pretending a failed fit is valid would change the requested experiment. Root cause is supported for this particular fixture/viewport; no general claim is made about other graphs.

## State and density: observed diagnostic snapshots

| State / virtualization | Logical nodes / edges | React Flow nodes / edges | Mounted DOM nodes / SVG edge groups | Viewport CSS px; zoom | Result |
| --- | --- | --- | --- | --- | --- |
| Collapsed ON | 188 / 360 | 5 / 4 | 5 / 4 | 581 ? 494; 0.340387 | five valid runs |
| Collapsed OFF | 188 / 360 | 5 / 4 | 5 / 4 | 581 ? 494; 0.340387 | five valid runs |
| Single, `src/alpha/a.ts`, ON | 188 / 360 | 67 / 122 | 21 / 38 | 581 ? 494; 0.1 | invalid: fit and file re-expansion checks |
| Single, `src/alpha/a.ts`, OFF | 188 / 360 | 67 / 122 | 67 / 122 | 581 ? 494; 0.1 | invalid: fit and file re-expansion checks |
| Multiple, `src/alpha/a.ts` and `src/beta/b.ts`, ON | 188 / 360 | 130 / 242 | 41 / 76 | 581 ? 494; 0.1 | invalid: fit before and after |
| Multiple OFF | ? | ? | ? | ? | not run: preflight 2105 MiB < 2200 MiB |

Single-group setup asserted that exactly 60 `alpha` function IDs were present in the React Flow input; multiple setup asserted 60 `alpha` and 60 `beta` IDs. File-group metadata may include another graph node, so 60 functions is not the same as a DOM or file-group count. Full group IDs, collapsed flags and node IDs, React Flow edge IDs, viewport, and measured instance nodes are preserved in each `e5c-before.json` and `interaction.json`.

Single ON/OFF were at the **same** starting viewport `x=-739.1, y=161, zoom=0.1`. The measured node extent was x=0..20592 graph units. Projected after Fit it occupied x=?739.1..1320.1 CSS px while the pane is x=0..581; both sides are clipped. Multiple ON used the same x and zoom and similarly clipped. The test checks all measured React Flow instance node rectangles, including groups, with a 2 px tolerance and marks missing measurements invalid; `fitView` uses padding and the component specifies `minZoom=0.1`. This is an actual measured bounds failure, not a paint inference. The earlier single ON pilot did not yet contain the automatic fit gate; it was already invalid due to a failed file expansion, and its bounds are computed retrospectively from the saved instance snapshot. Single OFF also failed file re-expansion and final topology restoration; whether that failure is a product bug or an offscreen interaction issue is unresolved. Multiple ON restored flow topology but failed initial and final fit bounds. Multiple OFF never launched because the unchanged preflight rejected the available memory.

## Collapsed-state repeated measurements

Five fresh independent runs per arm were crossed (initial ON/OFF then OFF/ON or ON/OFF by run parity). Every accepted run matched the logical graph hash, selected manifest fields, exact initial viewport, React Flow node/edge IDs and group states. Each checked same-group file and folder collapse/expand, selection/Inspector match, unchanged flow topology after pan and final group state, and Fit containment before and after. Group layout stability is four identical sampled position/dimension snapshots 250 ms apart; this does not prove physical paint. No memory guard fired. The 250 ms free-memory minima across runs were **1236?1441 MiB**; per-process working-set samples are retained, with process roles inferred and not guaranteed to isolate Webview RSS.

| Run | Arm | Pan rAF P50/P95/P99 ms | Zoom rAF P50/P95/P99 ms | Click ? Inspector DOM ms | Min free MiB |
| --- | --- | --- | --- | ---: | ---: |
| e5c-collapsed-on-1 | virtual-on | 8.3/8.5/8.5 | 8.3/8.5/8.5 | 8.1 | 1441 |
| e5c-collapsed-on-r2 | virtual-on | 8.3/8.5/8.6 | 8.3/8.5/8.6 | 10.9 | 1262 |
| e5c-collapsed-on-r3 | virtual-on | 8.3/8.5/8.6 | 8.3/8.5/8.5 | 8.2 | 1236 |
| e5c-collapsed-on-r4 | virtual-on | 8.3/8.5/8.6 | 8.3/8.5/8.6 | 11.1 | 1250 |
| e5c-collapsed-on-r5 | virtual-on | 8.3/8.5/8.5 | 8.3/8.5/8.6 | 8.2 | 1239 |
| e5c-collapsed-off-1 | virtual-off | 8.3/8.5/8.6 | 8.3/8.4/8.5 | 11.7 | 1236 |
| e5c-collapsed-off-r2 | virtual-off | 8.3/8.5/8.6 | 8.3/8.5/8.5 | 10.6 | 1329 |
| e5c-collapsed-off-r3 | virtual-off | 8.3/8.5/8.5 | 8.3/8.5/8.5 | 12.4 | 1243 |
| e5c-collapsed-off-r4 | virtual-off | 8.3/8.5/8.5 | 8.3/8.5/8.6 | 12.7 | 1250 |
| e5c-collapsed-off-r5 | virtual-off | 8.3/8.5/8.5 | 8.3/8.4/8.5 | 8.0 | 1255 |

Every pan had a verified viewport displacement of +80,+55 CSS px at an intermediate point, zero observed DOM-node mount/unmount mutation counts, and zero observed Long Tasks across the measured phases. A DOM MutationObserver counts attach/detach events including possible reparenting, not React component lifecycle calls. The pan returned toward its starting point. The frame-interval distributions for **each phase and run**, memory, IDs and raw arrays are in [e5c-collapsed-summary.json](e5c-collapsed-summary.json) and each referenced run directory. These numbers describe only the small collapsed rendered state. The zoom button was checked for a viewport change, but click-to-zoom response latency was **not separately timestamped**; the zoom phase includes a deliberate 350 ms wait. Fit boundaries were checked; actual screen paint, FPS and INP were not measured. There is no statistically supported virtualization advantage from this data.

## Safety, reproducibility and remaining work

The existing 2200 MiB preflight and 800 MiB stop threshold sampled every 250 ms were preserved. The multi-OFF diagnostic stopped before launching VS Code at 2105 MiB; do not count it as a graph, timing or memory-protection success. The first multiple ON attempt used a previous harness revision without later position-stability and topology-restoration checks; it already failed both Fit gates. The single ON/OFF and multiple ON invalid runs are retained for diagnosis and must not be pooled with valid samples.

For reconstruction, use E5B's generated fixture and pinned SHA, clean isolated ON/OFF sources, apply [prepare-e5c-probe.cjs](prepare-e5c-probe.cjs) identically to each detached copy, build, copy into isolated extensions and apply the existing analyzer manifest probe. [run-e5c.ps1](run-e5c.ps1) runs [p13-p12e5c.spec.ts](p13-p12e5c.spec.ts); set `P12E5C_STATE` to `collapsed`, `single` or `multiple`, `P12E5_EXPECT_SHA256` to the hash above, `P12E2_NO_TS=1` only with the harness which actually disables TS language features, and use a new output path. [run-e5c-pair.ps1](run-e5c-pair.ps1) runs collapsed crossed arms and compares the manifest and [compare-e5c.cjs](compare-e5c.cjs) state against `e5c-collapsed-on-1`. The state comparator has four checks ([test-e5c.cjs](test-e5c.cjs)). As in E5, selected manifest fields and graph equality do not prove all dependency bytes, active extensions or profiling overhead are identical.

Next, investigate full-fit behavior and reliable re-expansion separately without changing the graph payload, then rerun matched expanded arms in an environment where the requested fit bounds can actually pass. Do not infer Vite behavior or recommend a virtualization change from invalid expanded samples. Product optimization, SVG edge/animation isolation, zoom input latency and physical presentation remain unverified.

Validation: `npm run build:all` passed; `npm test` passed 90 tests including lint; `git diff --check` and the four E5C state-gate tests passed.
