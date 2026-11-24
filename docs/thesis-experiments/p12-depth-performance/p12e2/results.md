# Results

## Baseline Vite ? observed Webview behavior

Both baseline test runs completed and matched the pinned graph hash. Each used a 5-second, 80-step synthetic pointer path and eight alternating Zoom button clicks. Percentiles below describe **rAF callback intervals**, not display-frame guarantees.

| Phase | Run | Callback rate | P50 / P95 / P99 interval ms | Long Tasks observed | DOM nodes / SVG edge groups at end |
| --- | --- | ---: | --- | ---: | --- |
| Pan | 1 | 39.10/s | 24.9 / 33.4 / 83.3 | 3 (50?67 ms) | 17 / 838 |
| Pan | 2 | 38.78/s | 24.9 / 33.4 / 116.7 | 2 (55?61 ms) | 17 / 838 |
| Zoom | 1 | 53.78/s | 16.7 / 25.1 / 25.3 | 0 | 17 / 838 |
| Zoom | 2 | 54.91/s | 16.7 / 25.1 / 25.3 | 0 | 17 / 838 |

The received pointer path was 776.7 CSS pixels in each Pan run; the path returned to its initial location, and the viewport before/after transform was the same. Intermediate viewport movement was not recorded, so this is not a measured graph travel distance. The largest callback gaps in Pan were 408.2 and 391.5 ms; these are observed callback gaps, not separately attributed screen freezes. Zoom run 2 reported 17 visible DOM nodes and 838 edge groups at all eight samples, with 12 active edge-path animations. Neither run proves the cost of those edges or animations.

Selection click-handler-to-Inspector DOM mutation delays were **117.1 / 95.7 / 92.6 ms** (run 1) and **97.4 / 94.0 / 92.1 ms** (run 2). Each selection window recorded two Long Tasks; the largest individual tasks were 128 ms and 106 ms respectively. Timing excludes pre-handler input delay and paint. P12-C Canvas commit events appeared in every selection window; their latest node conversion values were 1.9?2.5 ms and edge conversion values 21.7?29.1 ms. The timings are not independent per-commit call counts and cannot be added to Long Task durations. DOM counts after selection were 7 nodes / 629 edge groups.

For file/folder collapse, neither run found an unobstructed header within the viewport; Vite collapse, relayout, reconstruction and visual stability are **N/A**, not pass. Fit Graph in run 1 changed the viewport from scale 1.2 to 0.1; run 2 started and ended at 0.1. The recorded window includes automation waits and experienced callback gaps; no click-to-settled duration or full-graph bounds assertion was collected. Only 17 DOM nodes were present, so full-fit correctness remains unverified.

The baseline source defines stable module-level `nodeTypes` and `edgeTypes`. Selection IDs are dependencies of both the node and edge `useMemo` calculations; `toReactFlowEdges` rebuilds derived edges and `DataflowEdge` computes a smooth-step path and conditional label. A change of those dependencies requires recomputation by React's memo semantics, but the baseline Vite logs alone do not identify individual React commits or paint costs. The source structure and timing observations justify investigating selection-driven derived graph work, not yet a proven single-function bottleneck.

## React and comparison limitations

The profiling build worked on a small fixture: during individual selection phases it observed both node and edge conversion callbacks and CanvasPane/Inspector Profiler commits. This is evidence of the instrumentation and small-fixture behavior only; its values cannot be extrapolated to Vite. The profiler-enabled Vite run stopped at **780 MiB** available. A separate no-TypeScript-language-server full run stopped at **797 MiB**, and a shorter no-server selection attempt also stopped at **794 MiB**. They are incomplete and excluded from performance comparisons. Partial logs remain.

Two CSS animation-OFF Vite attempts failed before the initial Depth request was observed; they are not valid comparison samples. The harness later added an active-file readiness wait, but the comparison was not retried under the memory constraints. Virtualization ON/OFF, labels ON/OFF, SVG edge rendering cost, Vite React Profiler actualDuration, and profiling overhead are **UNVERIFIED**. No claim is made that animated edges caused the observed Pan or selection delays.

## Evidence and next step

1. **VERIFIED symptom:** repeated Pan windows produced about 39 rAF callbacks/s and 2?3 Long Tasks under the measured environment. Their root cause is not attributed.
2. **VERIFIED symptom:** six selection handler-to-Inspector mutation observations were 92?117 ms and each selection window contained Long Tasks. Code and small-fixture profiling show selection can trigger derived node/edge conversion; a Vite React profile is needed to quantify its contribution.
3. **UNVERIFIED:** a third bottleneck, SVG paint cost, or Fit/collapse cost cannot be ranked with current evidence.

The most promising next investigations are a controlled Vite React/renderer trace of selection-driven node/edge reconstruction, and a one-variable visible-edge/animation comparison on a machine with more available memory. Defer a specific optimization until those experiments show a cause and graph/Inspector/Dataflow/Trace equivalence. No frame-rate or UX improvement is claimed.

Raw data: [baseline 1](baseline-1-interaction.json), [baseline 2](baseline-2-interaction.json), their JSONL/memory files and [summaries](baseline-1-summary.json); [fixture React profiling](fixture-react-interaction.json); incomplete [React Vite](react-vite-aborted-harness.txt) and [no-server Vite](react-vite-no-ts-aborted-harness.txt) records.

Final local verification: `npm run build:all`, `npm test` (90 passing including compile and lint), and `git diff --check` passed. Product sources and GraphPayload were not changed.
