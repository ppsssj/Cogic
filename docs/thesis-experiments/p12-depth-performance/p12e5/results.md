# Results

## Evidence and graph baselines

The two historical Vite graphs remain distinct. The original P12-C2/E2 graph is 1078/3755 with SHA-256 `baf0b1c591a5ad4af4f0fb5c1a947b3124d220acd1fded6e50d00e6ee9117049`; the separately reproduced E3/E4 no-TS graph is 1072/3739 with `1cf5220cac8c97eb7c3d2379889fc45c01b8bb9c4a7d2b03d908b4dd62a2ab74`. E4 found all changed graph nodes in external Node declarations and all changed edges touching them; it did not prove what changed their resolution. The [retrospective Vite manifest](vite-historical-manifest.json) separates historical observations from later inventory and marks unavailable cwd, exact rootNames, file bytes and extension activation evidence as null. A later package hash is not proof of the bytes used in an earlier run. The exact reason the earlier graph referenced Cogic's Node declarations remains unknown. No Vite A/B was run in E5: E4's successful repeat reached 818 MiB available, and there is no larger-memory machine available.

## New manifest and gates

A diagnostic extension copy emits the first Program's actual rootNames, compiler options, host cwd, TypeScript version, and all loaded Node declaration paths and SHA-256 values. Manifest generation includes those values, workspace commit and lock hash where available, root file content hashes, Cogic analyzer and instrumented analyzer binary hashes, Webview asset hashes, graph hash/count, cache/session, declared extension configuration, OS and memory. Root hashes are collected after the run, not atomically when TypeScript reads them; source/config/dependency immutability must be enforced externally. The user-provided VS Code version and declared extension activation are not independently checked. Only Node declarations, not all dependency files, are hashed. A matching manifest is necessary evidence, not proof that every input or machine state matches.

`compare-manifests.cjs` refuses missing required fields, differing graphs or input evidence, and `--require-vite` also requires Vite Git/lock and package metadata. It reports asset differences but cannot prove the intended single-variable code change. Before performing interactions the harness requires an expected graph SHA; graph-only discovery is explicitly separate. `test-manifest.cjs` checks matching, mismatched hash, missing roots and missing Vite fields (4 checks passed). The user must compare manifests after collection and exclude unequal or incomplete arms. [ON manifest](medium-on-1/manifest.json), [OFF manifest](medium-off-1/manifest.json), [comparison](medium-manifest-comparison.json).

## Actual VS Code: medium synthetic graph

A deterministic single-file synthetic fixture, not Vite, generated 200 functions; graph-only discovery and both test arms produced **201 nodes / 398 edges** and `e603354e5e571db31ad8d1bbb42079d8293fccd148bc21178cedd683bf22d434`. Each arm used the same fixture, no TypeScript language service, cache MISS and session ON, single test VS Code, a read-only first-Program manifest probe, same analyzer, and only the isolated Webview virtualization property changed. The observed manifests match on recorded inputs; there is one run per arm, in ON then OFF order, with no randomization or profiler-overhead control. These observations are not Vite results or proof of a product performance effect.

| Observed | Virtualization ON | Virtualization OFF |
| --- | ---: | ---: |
| Pan rAF callback intervals P50 / P95 / P99 | 8.3 / 8.5 / 16.6 ms | 8.4 / 16.7 / 25.0 ms |
| Pan rAF callback rate | 117.14/s | 102.19/s |
| Pan Long Tasks observed | 0 | 0 |
| Pan DOM node / SVG edge-group counts | 20 / 38 | 202 / 398 |
| File collapse rAF interval P95 | 8.5 ms | 16.7 ms |
| Minimum system available RAM, 250 ms sample | 1247 MiB | 1037 MiB |
| Largest sampled individual process labeled renderer (3 s sample) | 540.4 MiB | 541.8 MiB |

A renderer is not reliably identified as the Webview process; working sets are per-process snapshots, not total GPU memory or causal cost. The file-collapse window includes waits/animations, not input-to-settled duration. Folder collapse was unavailable in both arms; OFF file expansion timed out because the button was outside the viewport, so expansion correctness and its performance are **UNVERIFIED** despite the overall Playwright test returning success. Node selection targets were not found in these two ON/OFF arms, so their selection-to-Inspector, conversions and React Commit comparison is **UNVERIFIED**. After improving the locator, a separate React profiling arm on the same graph observed one selection: click-to-Inspector DOM mutation 75.2 ms, node conversion 2.8 ms, edge conversion 6.1 ms, and first ReactFlow / Inspector commit actualDuration 3.4 / 18.6 ms. Additional commits occurred; the nested ReactFlow and Canvas scopes overlap, so durations must not be added. This one instrumented observation includes profiling overhead, excludes pre-click input delay and physical paint, and is not a Vite measurement. [React raw](medium-react-1/interaction.json) and [manifest](medium-react-1/manifest.json). There was no edge animation/count arm and no SVG paint attribution. rAF callbacks are not physical FPS, and zero observed long tasks is not proof of zero browser or GPU work. [ON raw](medium-on-1/interaction.json), [OFF raw](medium-off-1/interaction.json), pipeline and process-memory JSONL remain beside them.

## Recommendation

Do not adopt an optimization based on these single synthetic samples. On a larger-memory machine, first capture a complete Vite manifest at analysis time, lock actual installed dependency bytes and extension state, and assert the same graph and manifests for each paired arm. Then measure selection derivation with a profiling build and separately vary virtualization, edge count, and animation, adding reachable selection and expand/collapse assertions, repeated randomized order and memory monitoring. Other extensions, all dependency bytes, process noise, React Profiler overhead and Vite graph interaction remain unverified. No 800 MiB guard was lowered.

Validation: `npm run build:all`, `npm test` (90 passing including lint), `git diff --check`, and four manifest gate checks passed.
