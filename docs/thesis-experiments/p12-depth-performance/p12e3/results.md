# Results and limitations

## Prior work and measured Vite baseline

P9/P10 used a different synthetic graph, product revision and viewport. In P9 the 1k expanded synthetic graph's rAF callback rate improved from 55.5/s to 101.4/s without virtualization. In P10's 2k expanded-to-collapsed case, input-to-rAF P95 rose from 15.5 ms to 518 ms (586 ms with stable handlers/reuse). P10 describes widespread position changes and the cost of rendering the full graph; that evidence suggests a tradeoff, not a controlled attribution of the regression to a single cause. The interactive toggle experiment also incurred mount/unmount costs. These numbers are not directly comparable to Vite. See [P8?P10 interaction study](../../p4-p10/06-graph-interaction.md) and [rejected candidates](../../p4-p10/07-rejected-optimizations.md).

The existing P12-E2 Vite baseline, independently recorded before this work, had pan callback rates 39.10 and 38.78/s, P95 callback interval 33.4 ms, and six click-handler-to-Inspector DOM mutations of 92.1?117.1 ms. rAF callback rate is not measured display FPS; a mutation is not presentation. Selection windows contained long tasks, and latest reported edge conversions were 21.7?29.1 ms. These measurements do not isolate SVG, React reconciliation or virtualization. Full source and caveats: [P12-E2 results](../p12e2/results.md).

## New selection instrumentation: P14 fixture only

Three real VS Code selection observations on the 10-node/11-edge fixture matched SHA-256 `56f6e1fea2c0579ace421c4c358e3fd3b2ae491ce37fad5a13918ec1b38b6af2`. Each selection ran both conversion functions. Results in milliseconds:

| Click to Inspector DOM mutation | Node conversion | Edge conversion | ReactFlow first commit actualDuration | Inspector first commit actualDuration |
| ---: | ---: | ---: | ---: | ---: |
| 11.2 | 0.1 | 0.3 | 2.0 | 2.2 |
| 6.7 | 0.3 | 0.4 | 0.7 | 1.0 |
| 23.2 | 0.9 | 0.6 | 3.3 | 3.0 |

The selected-ID useEffect is observed **after** commit, not the exact state update. Commit actualDuration is React render work, not a measured browser paint or full reconciliation wall time. Profiler intervals overlap (ReactFlow is nested in CanvasPane), so do not sum them. Mutation timing excludes earlier input delay and physical presentation. Multiple commits can occur per selection. The React profiling build changes runtime cost, and its overhead on Vite is unknown. [Raw fixture events](fixture-profile-1/interaction.json).

## Virtualization: diagnostic small-fixture comparison

One run per variant, same fixture and hash, isolated production-mode Webview, same single variable onlyRenderVisibleElements. No GraphPayload change. Both executed pan, zoom, selection, file/folder collapse and expand, and Fit. These tests establish harness operation, not exhaustive Inspector, Trace, Dataflow or visual correctness. No repeat/statistical claim is supported.

| Observation | ON | OFF |
| --- | ---: | ---: |
| Pan callback rate (not display FPS) | 119.6/s | 118.7/s |
| Pan callback interval P95 | 8.5 ms | 8.5 ms |
| Click-to-Inspector DOM, four observations | 7.9?13.2 ms | 5.7?9.8 ms |
| File collapse callback interval P95 | 33.1 ms | 25.0 ms |
| Folder collapse callback interval P95 | 16.7 ms | 16.6 ms |
| Minimum available RAM, sampled at 250 ms | 1208 MiB | 1343 MiB |

Collapse windows include waits and animations, so they are not click-to-settled durations. Memory includes the entire system, not attributable Webview peak. The values cannot establish Vite benefit, regression, or memory overhead. [ON](fixture-control-1/interaction.json), [OFF](fixture-virtual-off-1/interaction.json), and per-run process memory JSONL are retained.

## Vite attempts and graph mismatch

Both used Vite commit `3567471998e3da315675086f44368e266c9c0e33`, the same requested root and depth, and an isolated harness with the TypeScript language-features extension disabled. This differs from the original E2 baseline.

* [React-profile attempt](vite-profile-1/): began with 2522 MiB available; guard closed the test at 787 MiB during preparation. The obtained graph snapshot cannot be accepted as a valid sample. There are no Vite selection/Profiler measurements.
* [Non-profile control](vite-control-no-ts-1/): began at 2553 MiB and reached 900 MiB minimum; the guard did not fire. Depth produced 1072 nodes / 3739 edges, SHA-256 `1cf5220cac8c97eb7c3d2379889fc45c01b8bb9c4a7d2b03d908b4dd62a2ab74`, failing the required 1078 / 3755 / `baf0b1c591a5ad4af4f0fb5c1a947b3124d220acd1fded6e50d00e6ee9117049` assertion before interactions. The untracked dependency trees are not fixed by the Vite Git commit: the old normalized graph contains external Node declarations under the Cogic `node_modules`, while this run contains Vite `.pnpm/@types+node@26.6.6` declarations. This is an observed input difference, not proof of why resolution changed. TypeScript extension state, process working directory and installed dependencies must be controlled before a valid comparison. Do not replace the original reference or count the failed graph as equivalent.

There was no available larger-memory machine. No Vite virtualization OFF or edge-label/animation/count comparison was attempted after the control failed; without a matching control, such results would not answer the question, and virtualization OFF may raise memory. The existing 800 MiB protection was not lowered. Notion, remote access, system/security processes and Codex were left running; no user process was forcibly terminated. The Vite workspace was not modified.

## Decision

**VERIFIED:** selection recomputes both derived node and edge arrays in the fixture; P12-E2 demonstrated the Vite symptoms above. **INFERRED:** edge conversion and selection-driven whole-graph reconstruction are worthwhile hypotheses, as are virtualization and SVG/rendering costs; none is ranked causally. **UNVERIFIED:** Vite React Profiler durations, virtualization/edge A/B, SVG paint attribution, profiling overhead, and graph/Inspector/Dataflow/Trace equivalence across alternatives. The best next experiments are (1) lock all resolved dependencies and repeat the matching Vite control, followed by one-variable virtualization/visible-edge tests with collapse and memory measurements, and (2) capture a Vite selection React/browser trace on a machine with enough RAM. No optimization is adopted.

Final verification: `npm run build:all` passed; `npm test` passed 90 tests including host and Webview lint. `git diff --check` was run before commit. No product code changed.
