# TypeScript Program breakdown in real VS Code

## Setup and boundaries

Cogic main `66228e1`, Vite `3567471998e3da315675086f44368e266c9c0e33`, root `packages/vite/src/node/server/index.ts`, Depth 2, Windows 11 / VS Code 1.147.0 / TypeScript 5.9.3, cache ON. The P12-C pipeline logger remained ON throughout. The **additional detailed profiler** was injected only into a disposable copy of compiled `out/analyzer/analyze.js` using [prepare-program-profile.cjs](prepare-program-profile.cjs); no shipped product source or payload was modified. It enables TypeScript's `performance` marks and wraps CompilerHost operations, the existing session reuse check, and the two analyzer `statSync` call sites. It emits one aggregate JSONL record per completed analysis, not one log line per file. Each of three detailed-ON and two detailed-OFF runs used a new extension host; filesystem caches were not flushed. The third ON run added reuse/stat timing; ON1 and ON2 did not have those additional wrappers. Details and UI are real VS Code, not a separate Node benchmark.

Start measurements are nested: TypeScript `Parse` and `ResolveModule` live within `createProgram`, `sourceMs` includes read/parse/stat/reuse, `reuseMs` includes `statMs`, and `fileExistsMs` may be included within module resolution. **Do not add these categories together.** TypeScript measures are cumulative counters differenced around each `createProgram`; read counts/bytes measure calls through the wrapped `defaultHost.readFile`, not every possible OS read. Roots timing includes checking the workspace tsconfig, building options/rootNames and ensuring the active file is present; this Vite root has no `tsconfig.json`, so no tsconfig parse time was observed. `checkerMs` measures `getTypeChecker()` immediately after Program creation; subsequent extraction/diagnostics/graph time includes additional lazy semantic work and is not a pure checker measure. No GC profiler or OS file-cache manipulation was used.

Raw aggregate records: [ON1](profile-vite-1-program.jsonl), [ON2](profile-vite-2-program.jsonl), [ON3 with stat/reuse wrappers](profile-vite-3-program.jsonl), with adjacent pipeline, memory and harness logs. A separate fixture smoke and all Vite runs used the 800 MiB guard. Before these tests Chrome window PID 23376 was normally closed; free memory rose from 2,473,208 to 3,626,768 KiB. No user program was force-terminated and no OS configuration was altered.

## First Program

| Metric | ON1 | ON2 | ON3 (extra stat/reuse wrappers) |
| --- | ---: | ---: | ---: |
| roots/options preparation ms | 18.40 | 6.49 | 9.32 |
| root files / Program SourceFiles | 1,654 / 2,296 | same | same |
| old Program / cache entries before | none / 0 | none / 0 | none / 0 |
| `createProgram` ms | 3,979.94 | 4,916.47 | 4,701.15 |
| TypeScript Parse ms | 1,635.05 | 1,789.18 | 2,144.58 |
| TypeScript ResolveModule ms | 1,325.44 | 1,433.34 | 1,580.30 |
| wrapped SourceFile requests / total ms | 2,296 / 2,430.01 | 2,296 / 3,236.04 | 2,296 / 2,894.00 |
| wrapped read calls / ms / bytes | 2,916 / 794.74 / 19,793,308 | 2,916 / 1,426.11 / 19,793,308 | 2,915 / 737.27 / 19,792,066 |
| disk SourceFile cache misses / hits | 2,295 / 0 | 2,295 / 0 | 2,295 / 0 |
| `getTypeChecker` ms | 1,305.80 | 718.61 | 629.51 |
| after checker through graph extraction ms | 510.05 | 459.30 | 445.07 |

ON3 additionally recorded 2,295 analyzer stat calls / 60.32 ms and 14,321 host `fileExists` calls / 351.71 ms, both nested inside the other work. Its source cache held 2,020 entries after the first analysis. This is evidence that cold SourceFile parsing and module resolution are large observed costs, alongside wrapped file reads; it does not establish the amount uniquely attributable to disk, CPU, resolver substeps or GC. `readCalls` include more than source-file misses and are not asserted to be duplicate reads. The earlier 21.36 s first Program was measured without these detailed counters; its reason remains unknown. System cache state, system activity and memory pressure were not isolated.

## Remaining 34 Programs

In ON3 all 34 used `oldProgram` and session reuse, with 77,996 reused SourceFiles total (2,294 each). `createProgram` totaled 3,269.29 ms, median 91.06 ms. Across these Programs, wrapped `getSourceFile` totaled 1,569.22 ms; 78,030 session reuse checks totaled 1,200.51 ms, including 78,030 analyzer stat calls totaling 977.62 ms. Wrapped reads totaled 718.08 ms, TypeScript module resolution 270.20 ms, and Parse 70.71 ms. These are nested and overlapping, and the extra wrappers have unquantified overhead. They reveal a measurable repeated metadata-validation cost, not proof that removing it is safe or would save the entire measured amount.

The existing session checks invalidation, mtime/size, script kind and language-version, deliberately keeps active editor buffers fresh, and is poisoned by relevant unknown changes. A next optimization PR could first prototype reducing redundant path/metadata-validation overhead **while preserving equivalent freshness checks**, then measure it against the same graph and adversarial edit, same-size/mtime, file creation and cancellation tests. No invalidation or stat check should simply be skipped on the basis of these results. Separately investigate first-Program parsing/resolution and I/O with controlled cache-state measurements before committing to a cache design.

`cacheEnabled=false` in product also disables the session, so a UI result-cache OFF run cannot isolate the Program Session. No new session policy was implemented. The earlier P12-B Node experiment explicitly controlled `programSession` with the same `cache: cold` setting: its on/off results had identical normalized and raw hashes but different timing. This is historical Node evidence, not an ON/OFF UI result-cache comparison for these runs.

## Detailed profiling ON/OFF and UI

| Run | Extra detailed profiling | Depth ms | First Program ms | Graph hash | Minimum free MiB |
| --- | --- | ---: | ---: | --- | ---: |
| ON1 | on | 11,471.50 | 3,979.94 | `baf0b1c5...` | 902 |
| OFF1 | off | 12,289.86 | 5,014.87 | `baf0b1c5...` | 923 |
| ON2 | on | 12,217.20 | 4,916.47 | `baf0b1c5...` | 949 |
| OFF2 | off | 11,989.85 | 4,783.12 | `baf0b1c5...` | 1,058 |
| ON3 | on + stat/reuse wrappers | 11,529.36 | 4,701.15 | `baf0b1c5...` | 949 |

All returned 1,078 nodes, 3,755 edges and full normalized SHA-256 `baf0b1c591a5ad4af4f0fb5c1a947b3124d220acd1fded6e50d00e6ee9117049`, including their subsequent warm Generate graphs. ON1/OFF1 and ON2/OFF2 were sequential, not randomized; two comparisons and shifting cache/load cannot isolate overhead. ON results being faster in one pair is not evidence of negative overhead. Earlier 21.36 s sample did not have detailed profiling.

The [final UI run](profile-ui-final-interactions.json), detailed profiler OFF, passed a single Vite test covering pan (viewport translate changed), Zoom in (scale changed), code node selection and Inspector/Dataflow, and Fit Graph (viewport changed). It did not verify that every intended node was visible after fitting. The test now locates an unobstructed pane point and uses the visible Zoom button rather than fixed window coordinates. Prior failed coordinate attempts remain in the earlier report. This is a functional smoke, not an interaction latency or physical-paint benchmark.

## Memory and conclusions

ON3 free physical memory was 1,867,546,624 bytes immediately before the first Program and 1,586,978,816 after that analysis; host RSS after first graph extraction was 601,931,776 bytes. These are snapshots at different boundaries, not a memory cost or causality measurement. Across the detailed-ON and OFF runs, 250 ms guard minima were 902?1,058 MiB; three-second samples saw an inferred Extension Host working-set maximum of 679.3 MiB and a largest individual renderer of 658.4 MiB. Renderer identity is not isolated to Webview. The 800 MiB guard did not fire. GC pauses, paging, exact OS cache state and correlation between memory pressure and latency were not measured; no causal inference is justified.

**VERIFIED:** first Program has substantial Parse, resolution and read work with an initially empty SourceFile cache; subsequent Programs reuse 2,294 SourceFiles per run but still perform many metadata checks. **INFERRED:** both first-Program parsing/resolution and repeated session metadata checks warrant controlled optimization experiments. **UNVERIFIED:** the cause of the isolated 21 s Program, exact profiler overhead, a statistically defensible latency/memory correlation, and historical P12-B versus UI GraphPayload equality under identical serialization.

## Reproduce

Build and copy the extension to an isolated directory; run `node prepare-program-profile.cjs <isolated>/out/analyzer/analyze.js` exactly once. Set `P12C2_PROGRAM_PROFILE` to a new absolute JSONL path, then use `run.ps1` with the pinned Vite root and `-Cache on` as in [measurement-method.md](measurement-method.md). Run OFF using a separate unpatched extension copy and omit that environment variable. Never patch the installed user extension or repository build; keep the 800 MiB guard and a single VS Code at a time. ON1/ON2 were collected before the optional stat/reuse wrappers, ON3 after them; direct timing comparisons must account for that distinction.

Final local verification: `npm run build:all`, `npm test` (90 passing, including compile and lint), and `git diff --check` passed.
