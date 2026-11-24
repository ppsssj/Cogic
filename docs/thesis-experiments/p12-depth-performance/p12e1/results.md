# P12-E1 results and decision

## Experiment and candidates

The current session normalizes `requested` in `reuseSourceFile`, checks invalidation, source kind, language version and `statSync` (mtime and size), and on a hit normalizes `requested` again when recording it for the next Program. The experimental candidate returns `[key, entry]` from the session lookup so its already computed key can be used by the caller. It is applied only to a disposable compiled extension using [prepare-candidate.cjs](prepare-candidate.cjs); it allocates a pair per hit and changes that internal method's return shape. Product source and shipped build are unchanged. It does not skip `statSync` or rely on file events as a complete external-change detector.

Other candidates evaluated conceptually: B (reuse metadata across async boundaries) would fail to detect external modifications without a guaranteed invalidation, so it was not prototyped; C/D (simplify lookup/invalidation) need correctness and material performance evidence before implementation. The unchanged system catches same-size edits with changed mtime via stat; same size and restored mtime requires explicit invalidation. Without invalidation, a same-size edit with restored mtime is not guaranteed detectable; no stronger claim is made. The active editor text bypasses cached disk text, `AnalysisSession` is scoped to one Depth run and disposed in `finally`; unknown relevant file/tsconfig invalidations poison reuse.

## Actual VS Code A/B

Vite `3567471998e3da315675086f44368e266c9c0e33`, `packages/vite/src/node/server/index.ts`, Depth 2, cache ON, 1,654 roots, 2,296 SourceFiles, Windows 11, VS Code 1.147.0, TypeScript 5.9.3. Fresh isolated Extension Hosts and identical detailed instrumentation (including path counters) were used for baseline and candidate; order was candidate 1, baseline 1, baseline 2, candidate 2. File-system caches and system load were not randomized or reset. Each record is a completed first Depth-change request through two frame callbacks; it is not a user Generate or proof of physical paint. The later warm Generate and interaction stage were deliberately omitted to reduce memory pressure.

| Run | Depth ms | First Program ms | Other 34 Program ms | normalize calls / ms, other 34 | stat calls / ms, other 34 | Reused SourceFiles | sampled host working-set max MiB | min free MiB |
| --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: |
| baseline 1 | 11,631.7 | 4,693.1 | 3,260.3 | 156,094 / 202.2 | 78,030 / 966.2 | 77,996 | 659.5 | 949 |
| baseline 2 | 11,246.9 | 3,890.6 | 3,218.1 | 156,094 / 199.7 | 78,030 / 952.8 | 77,996 | 668.9 | 1,002 |
| candidate 1 | 11,409.3 | 4,695.9 | 3,122.9 | 78,098 / 100.1 | 78,030 / 968.5 | 77,996 | 672.9 | 1,009 |
| candidate 2 | 12,157.7 | 4,945.1 | 3,353.1 | 78,098 / 97.0 | 78,030 / 1,004.0 | 77,996 | 662.3 | 1,080 |

The two-value baseline midpoint is 11,439.3 ms versus 11,783.5 ms for candidate (candidate 344.2 ms / 3.0% slower); this is not a reliable estimate of a regression or benefit. N=2 per group, instrumentation, sequential machine state and no confidence interval prevent a statistically meaningful improvement claim. `normalizeMs`, `statMs`, reuse and Program durations overlap; instrumentation itself adds overhead. Working-set maxima are 3-second samples for a process inferred as Extension Host, not exact peak RSS, and sample maxima are not simultaneous. The additional pair allocation's memory cost was not isolated.

All four first requests matched 1,078 nodes, 3,755 edges and normalized SHA-256 `baf0b1c591a5ad4af4f0fb5c1a947b3124d220acd1fded6e50d00e6ee9117049`. Full raw pipeline, Program and memory JSONL plus harness logs have corresponding `base-*` and `candidate-*` prefixes. This establishes equality for the tested fixture and settings, not every possible graph.

One earlier candidate run completed graph generation but crossed the 800 MiB guard during its later warm/UI stage (minimum 797 MiB); it is excluded from A/B success and its [partial log](candidate-aborted-harness.txt) and memory records are retained. The shorter harness was used thereafter for both conditions. Before cleanup, free memory was 2,138,040 KiB; Chrome window PID 18664 was sent a normal close, after which 3,566,552 KiB was observed. Other user apps and Codex/system processes were not force-terminated. Guard remained 800 MiB with 250 ms sampling, which is not continuous.

## Correctness and limitations

The baseline and isolated candidate each passed [probe-correctness.cjs](probe-correctness.cjs) for same-size edits with changed mtime; same-size/mtime-restored edits with explicit invalidation; deletion and creation invalidation; tsconfig invalidation; and unsaved active buffers, comparing graphs, calls and diagnostics with uncached analysis. The candidate also passed 28 existing P12-B/P12-D Node tests, including session ON/OFF graph equality, cancellation and subsequent reanalysis, invalidation, source creation, config changes and session disposal. The fixture UI smoke passed with its expected graph hash. A [controlled frontier edit](probe-async.cjs) also passed in baseline and candidate: with and without a session, the same mid-read edit/invalidation sequence produced equal graphs. In that isolated analyzer test (no Host cancellation), the in-flight graph differed from a fresh post-edit graph because the root was analyzed before the edit. This is a mixed-snapshot limitation of that test sequence, not evidence that the UI applies such a stale result. These tests do not prove detection of a same-size and same-mtime edit without invalidation or cover all asynchronous interleavings. Full Trace and Runtime Debug candidate E2E was not run. Since candidate is not adopted, these remain experimental limitations rather than a production code change.

## Next step and reproduction

Do not merge the prototype into product based on these data. If pursuing it further, repeat with more randomized, paired samples on a machine with ample RAM, profiling OFF as well as ON, and validate all invalidation/cancellation/Trace/Runtime Debug paths. Any metadata caching proposal must preserve observation of external edits across asynchronous boundaries. The first Program's parsing and module-resolution costs remain a separate candidate from P12-C2.

Build the baseline commit, make two isolated extension copies, run `node prepare-candidate.cjs <candidate>/out/analyzer/analyze.js` on the candidate only, then `node prepare-measure.cjs <copy>/out/analyzer/analyze.js` once on each. Set `P12C2_PROGRAM_PROFILE` to a unique path and run [run.ps1](run.ps1) with explicit harness, Vite workspace, isolated extension directory, VS Code executable, new output path, root file and cache ON; see [P12-C2 method](../p12c2/measurement-method.md) for arguments. Never patch the installed extension. Run the correctness probe against each copy's `out/analyzer/index.js`.

Final checks: `npm run build:all`, `npm test` (90 passing including compile and lint), and `git diff --check` passed on the unchanged product source.
