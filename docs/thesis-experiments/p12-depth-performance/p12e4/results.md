# Results

## Complete graph difference

[graph-diff.json](graph-diff.json) contains every added/removed node and edge with full IDs and properties including node kind and file, plus records for common IDs with changed properties. The exact input graphs are [P12-C2 baseline](../p12c2/vite-graph.normalized.json), also byte-identical to P12-E2 baseline 1, and [P12-E3 control](../p12e3/vite-control-no-ts-1/preparation-graph.normalized.json). Script compares IDs, all fields via JSON serialization, and file bytes by SHA-256. It does not infer node identity by name.

| | Original | E3 no-TS control | Removed | Added | Same ID, changed properties |
| --- | ---: | ---: | ---: | ---: | ---: |
| Nodes | 1,078 | 1,072 | 114 | 108 | 0 |
| Edges | 3,755 | 3,739 | 535 | 519 | 0 |

All changed nodes are `external`. Removed nodes refer to 23 Node declaration files under `C:/dev/Cogic-P4-restored/node_modules/@types/node`; added nodes refer to 22 under `<fixture>/node_modules/.pnpm/@types+node@26.6.6/node_modules/@types/node`. All 535 removed and 519 added edges touch one of these changed node IDs. Removed edge kinds: 226 calls, 2 constructs, 307 dataflow. Added: 218 calls, 2 constructs, 299 dataflow. Thus declaration path/contents affect the observed graph: this is more than a hash change or node count discrepancy. The old graph records declaration paths, but not the old file hashes or their historical package version; the current Cogic installation is 22.19.8 and must not be assumed identical to the historical installation without evidence.

## Environment and actual resolution

| Condition | Original P12-E2 | E3 control / E4 repeat |
| --- | --- | --- |
| Vite commit / root / depth | `3567471998e3da315675086f44368e266c9c0e33`, `packages/vite/src/node/server/index.ts`, 2 | same |
| VS Code | 1.147.0, Windows 11 8 GB | same |
| Cogic source | P12-C2 `d3845a6`, E2 product sources unchanged | compiled analyzer binary matches baseline extension (`F169001657FC741E1BB47D805F53E49789F3C440FFE294060939742F593AE668` SHA-256); E4 diagnostic copy adds a read-only event |
| TypeScript language features | enabled; harness waited for TS readiness and idle | disabled explicitly with `--disable-extension=vscode.typescript-language-features` |
| Cogic / TypeScript | isolated Cogic extension; historical bundled TS expected 5.9.3, original run did not log its version | Cogic isolated extension; instrumented actual `ts.version` 5.9.3; Vite installed TypeScript is 7.0.2 and is not the measured analyzer version |
| Node declarations | graph points to Cogic node_modules; historical host cwd and complete SourceFile list were not logged | Vite `.pnpm/@types+node@26.6.6` declarations observed in first Program; 83 files logged |
| Extension Host cwd | not captured | `C:\Users\SCH\AppData\Local\Programs\Microsoft VS Code`, also `ts.sys` and compiler host current directory |
| cache / session | cache ON, lookup MISS, Program session true, first Program 2296 SourceFiles | same cache/session conditions; first Program 2316 SourceFiles |

The actual new Program used the listed declaration files. The test-only probe recorded `ts.resolveModuleName('node:fs', activeFile, ...)` as null; this does **not** mean the graph had no `node:fs` declarations. Node built-ins may be represented as ambient modules from loaded type declarations. Its automatic `node` type-directive probe produced no resolved result in that host context, and it does not establish the route by which the declarations entered the Program. The declaration-file list and compiler options are in [raw pipeline](vite-no-ts-repeat-2/pipeline.jsonl). The dependency inventory includes current package versions, lock hashes and complete `.pnpm` directory names in [inventory.json](inventory.json); it is not a cryptographic inventory of every installed file and does not describe the old installation.

The precise reason the original run selected Cogic declarations while the new run selected Vite declarations remains **UNVERIFIED**. TS language-feature activation, VS Code launch context, dependency installation and compiler resolution inputs were not isolated independently in the historical run. The changed declarations explain which graph objects changed; they do not prove which environmental change caused their selection. Do not claim that disabling the language server caused the difference.

## Reproduction attempts

* Original-style TS-enabled run: fresh profile, same root and Depth 2, analysis cache ON. Available RAM 2548 MiB at preflight; test stopped at **799 MiB** before Depth completed. It produced 2316 SourceFiles in its first Program but no graph; the first probe event was accidentally excluded by the old event filter. This is not a graph or timing result. [Raw run](vite-ts-enabled-1/).
* No-TS E4 repeat: fresh profile, same input as E3 control, diagnostic extension. It completed with **1072 nodes, 3739 edges and SHA-256 `1cf5220cac8c97eb7c3d2379889fc45c01b8bb9c4a7d2b03d908b4dd62a2ab74`**, matching E3 byte for byte, with zero changed node or edge records ([repeat-diff.json](repeat-diff.json)). Request `web-38bbf964-fd75-4d17-ac75-b2777614d846`, cache MISS, session active. Free RAM minimum was **818 MiB** at 250 ms sampling; no guard fired. Two executions provide reproducibility evidence for this specific configuration, not general determinism. [Raw run](vite-no-ts-repeat-2/).
* The first no-TS probe attempt and a small-fixture attempt failed before opening the Webview because a temporary PowerShell edit corrupted the disposable compiled file's Unicode. Product sources were unaffected. Restoring the original bytes and reapplying the Node-based patch fixed this; [fixture probe 2](fixture-probe-2/) passed its known 10/11 hash. Preserve the failed harness logs as harness failures, not graph failures.

## Decision and next work

The controlled new graph is reproducible within the two observations above, but is **not equivalent** to the original graph. Its 818 MiB minimum is too close to the unchanged 800 MiB guard for a credible series of large interaction/profiler arms here. No virtualization, animation or edge-count performance A/B is valid yet; candidate and control have not both demonstrated identical graphs in the same locked environment. No P12-E2 performance comparison or improvement is asserted. No optimization is adopted.

Next, use a machine with substantially more available RAM and capture the extension host cwd, complete CompilerOptions, resolved declaration files and checksums, lockfile and actual installed package content for both old and new setups. Reconstruct the original dependency-resolution environment without modifying the original workspace. Independently vary TS language-feature activation and launch/environment conditions, comparing the exact graph first. Once two candidate/control runs share the same graph and inputs, use one-variable selection conversion instrumentation, virtualization ON/OFF, and separately edge-count/animation comparisons with repeat measurements, collapse/expand and memory. Until then, selection-derived edge reconstruction and visible edge rendering remain hypotheses, not ranked bottlenecks.

Validation: `npm run build:all` passed; `npm test` passed 90 tests (including lint); `git diff --check` passed.
