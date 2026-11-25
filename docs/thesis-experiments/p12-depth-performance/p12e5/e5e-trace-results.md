# E5E: Chromium trace of the Multiple 125 ms pan

Diagnostic pair only (one ON, one OFF run, Multiple expanded, 125 ms steps). It locates where time is spent; it is not a repeated benchmark. Product code, GraphPayload and virtualization defaults are unchanged.

## Conclusion

**VERIFIED (this pair):** during ON's long rAF gaps the GPU process main thread (`CrGpuMain`) is blocked inside `DXGISwapChainImageBacking::Present`. 28 gaps total 7132 ms; Present covers 6544 ms (**92%**), with 153 ms CPU time inside it, so the thread is waiting, not computing. The renderer main thread covers 312 ms (4%).

**INFERRED:** the wait is for GPU work queued by the extra rasterization that ON produces when edges and nodes enter/leave. **UNVERIFIED:** what Present waits on (GPU hardware queue, driver, texture memory, DWM or remote display capture). Chromium tracing cannot see the hardware queue.

## Method

- [p13-p12e5e-trace.spec.ts](p13-p12e5e-trace.spec.ts) is the E5D spec plus, after the unchanged E5D pan, two more identical-path pans in the same session: untraced, then traced. The node loop in those two only sends input; it reads no style. The rest of the E5D phases still run. Runner: [run-e5e-trace.ps1](run-e5e-trace.ps1), analysis: [analyze-e5e-trace.cjs](analyze-e5e-trace.cjs).
- Capture: Electron main-process `contentTracing` (Chromium 'record-until-full', 300 MiB buffer, 4%/7% used), **not** a Playwright trace. Processes captured: Browser, GPU, both renderers, network and other utility processes. The graph is in its own renderer process (its marks are on that `CrRendererMain`); the workbench is another. Threads captured: graph `CrRendererMain`, `Compositor`, raster workers; GPU `CrGpuMain`, `VizCompositorThread`, `GpuVSyncThread`. Rasterization is GPU raster, so most of its cost is on the GPU thread and on the GPU itself. No V8 CPU profile, ETW or hardware GPU timing was collected.
- Clocks: webview `performance.now` to trace time by 30 `performance.mark` events per run (spread <= 0.2 ms). Node to webview by minimum-RTT round trips before and after (uncertainty <= 0.9 ms, drift <= 0.1 ms). Cross-process values are only meaningful above about 1 ms.
- Gates: manifests match; same graph sha, node/edge IDs, layout and start viewport; both runs functionally valid with restoration. The state gate fails only on pan speed (`pan speed differs at 20`, duration > 20%), the known E5D outcome; it was not relaxed. Free memory minima 1958/1902 MiB, guard not fired.
- Environment: GT 710, GPU compositing and GPU raster enabled; 1920x1080 at 120 Hz plus a 60 Hz display; Chrome Remote Desktop host running.

### Instrumentation overhead

| | ON untraced | ON traced | OFF untraced | OFF traced |
| --- | --- | --- | --- | --- |
| input loop ms | 8803 | 7921 | 5005 | 5012 |
| gaps > 50 ms / total ms | 28 / 7826 | 28 / 6926 | 0 / 0 | 0 / 0 |
| rAF P99 / max ms | 667 / 775 | 567 / 625 | 8.5 / 16.7 | 8.5 / 16.7 |
| system CPU busy % | 12.7 | 13.5 | 19.5 | 20.5 |

Tracing did not create or hide the effect. Traced is always second, so overhead and order are confounded; ON being faster when traced is not a speed-up. Do not compare these absolute times with the E5D numbers. The E5D style-reading loop in the same sessions took 8470 (ON) / 4897 ms (OFF).

## Input chain (traced, delivered steps, n = 34 each, ms, median / p95 / max)

| | ON | OFF |
| --- | --- | --- |
| scheduled -> `mouse.move` start (accumulated lateness) | 746 / 2887 / 2969 | 3.0 / 6.6 / 9.5 |
| `mouse.move` start -> event timestamp | 2.6 / 4.4 / 13.8 | 3.4 / 9.8 / 27.2 |
| event timestamp -> webview handler | **79.8 / 546 / 622** | 5.4 / 9.4 / 10.1 |
| handler -> viewport style | 3.3 / 13.2 / 163 | 2.1 / 7.0 / 135 |
| handler -> next rAF | 5.2 / 9.7 / 19.9 | 3.3 / 7.2 / 11.3 |
| handler -> `mouse.move` return | 12.9 / 22.5 / 32.9 | 9.0 / 19.7 / 25.7 |

Sending is prompt and, once the handler runs, style and rAF follow quickly. The wait is inside Chromium between event creation and delivery. INFERRED: pointer moves are frame-aligned, so they wait for the stalled frame pipeline; Playwright then waits for the acknowledgement (call in flight during 6493 of 7132 ms), which delays the next step. Playwright is a **victim and amplifier of lateness**, not the origin: Present blocks in the GPU process regardless. The style maxima come from samples whose style does not change (the latency then runs to a later change).

**Harness finding (applies to E5D too):** only 34 of 40 moves reach the webview. In steps 14-16 and 34-36 the pointer is left of the iframe, so the graph does not move. Both arms are affected identically and the path gate passed, but the effective left extent is about -227 px rather than -280 px. Earlier results are not invalidated for ON/OFF comparison; the path description is corrected here.

## Where the gap time goes (ON, 28 gaps, 7132 ms)

| Hypothesis | Overlap with gaps | Verdict |
| --- | --- | --- |
| JavaScript accumulation | script 166 ms; all main-thread tasks 312 ms, longest task 30.7 ms | excluded as the main cause |
| Style + layout | 54 ms | excluded |
| Paint / commit on main | 28 ms | excluded |
| GC | 16 ms | excluded |
| Renderer compositor thread / raster workers | 52 / 56 ms | excluded as CPU cost |
| GPU raster commands on `CrGpuMain` | gpu tasks 7075 ms, of which Present 6544; raster 298 + flush 425 ms over the whole pan | CPU part small; GPU-side cost UNVERIFIED |
| **GPU / presentation wait** | **Present 6544 ms, CPU 153 ms** | **confirmed location** |
| Viz compositor thread | 56 ms | excluded |
| Playwright send/ack wait | in flight 6493 ms, but overlaps Present | consequence (see above) |
| Process scheduling | system 13.5% busy; main-thread wall 570 vs CPU 531 ms | no sign of CPU contention; not traced with ETW |

Rows overlap and must not be summed. Per-gap rows are in [ON analysis](e5e-trace-on-1/trace-analysis.json).

## ON against OFF (traced pan)

| | ON | OFF |
| --- | --- | --- |
| Present calls / wall / CPU ms | 42 / 6596 / 155 | 241 / 28 / 28 |
| `CrGpuMain` task wall / CPU ms | 7459 / 996 | 228 / 217 |
| Renderer main wall / CPU ms | 570 / 531 | 776 / 737 |
| GPU raster commands (all renderers) | 701 | 128 |
| Raster + end-raster GPU-thread ms | 723 | 31 |
| Graph renderer raster tasks | 720 over 59 layers | 64 in one layer |
| of which layer 15 / 139 / 12 / other | 496 / 72 / 64 / 88 | 0 / 0 / 64 / 0 |
| Paint of `.react-flow__edges` SVG | 56 | 0 |
| Paint of nodes (`react-flow__node` / `cgNode`) | 120 / 112 | 0 / 0 |
| Paint of background SVG | 32 | 32 |
| DOM node attach/detach; edge group attach/detach | 120/120; 240/240 in 28 batches | 0 |

**Only in ON:** node and edge-SVG repaint, raster of layers other than 12, and the 496-tile layer. Layer 12 (both arms) is probably the background; layer 15 is probably the edges SVG, since edges repaint only in ON. The trace's paint events carry no usable layer ID, so both mappings are **INFERRED**. OFF does *more* main-thread and frame work than ON and is still smooth.

**Correlation only, and limits of the raster explanation:** raster volume, attach/detach and blocked Presents occur together, but per Present the rank correlation with raster commands since the previous Present is -0.09 and with attach/detach -0.48. Some of the longest Presents (565, 609, 619 ms) follow few rasters and no attach, including windows where the pointer was outside the iframe and the dirty rectangle was the editor group. A backlog of earlier GPU work would produce this; so would texture-memory pressure or a presentation/DWM effect. Attach/detach is therefore *not established* as a direct cause, only as the ON-specific trigger.

**500 ms pace (INFERRED, not traced):** the same 120/120 churn has about 4x the idle time between steps, enough for a per-step backlog to drain before the next step (E5D: ON smooth, 5/5). At 125 ms the queue would never drain. This fits a backlog but does not prove it.

## Best single target

If optimization is pursued later, the **re-raster of the edges SVG layer on each visible-set change** is the best candidate: the inferred layer is 496 of 720 raster tasks (69%). No optimization is proposed or implemented here.

## Still unverified

- What Present waits on; needs ETW/GPUView (hardware queue, paging) on the same machine.
- Whether edge re-raster causes the wait. Next single test: an isolated, non-product build that virtualizes nodes but keeps all edges mounted, on the same path. If the blocked Present time vanishes, the edges layer is causal.
- Influence of Chrome Remote Desktop, the mixed 120/60 Hz displays, GT 710 driver; other hardware; Vite graph; n = 1 per arm.

## Data

`e5e-trace-{on,off}-1/`: all E5D-style outputs, `trace-analysis.json`, `chromium-trace.json.gz`. The committed trace omits only the top-level `metadata` block (hardware/network identifiers, command line); the unmodified originals stay on the test machine under `C:\dev\p13\e5e-trace-*-1.original.json`. Analysis from the committed files reproduces the same output. Re-run: `node --max-old-space-size=3000 analyze-e5e-trace.cjs e5e-trace-on-1 --write`.
