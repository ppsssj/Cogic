# P12-C run and verification

## VERIFIED

- `npm run build:all` and `npm test` passed. Test preflight runs compile and `lint:all`; 80 tests passed, including four P12-C tests. The full UI features were not exercised by those tests.
- One isolated VS Code 1.147.0 Vite V1 Depth 2 attempt was started on Windows with 8 GB RAM, the P13 pinned Vite commit, cache enabled and a fresh profile. Available physical memory was approximately 2.30 GiB before launch. The run was manually interrupted after an observed 401,232 KiB available (approximately 392 MiB). This is a sampled value, not a continuous minimum. The partial [raw JSONL](vite-v1-aborted.jsonl) contains 190 records and no completed graph result. Source files were not changed.
- The manual `select-file` request logged a cache miss and started Depth. An automatic active-file request began approximately 31.2 seconds later, before the first request finished; both reached Depth. This is evidence of overlap in this run, not proof that it caused P13's timing. Neither request reached a recorded Depth end before interruption. File-list duration on the first request was 0.022 ms using the panel's already-prepared file-list cache, and cache-key construction/lookup was 4.72 ms. These are individual in-run observations, not representative estimates.
- A host logger microbenchmark ([raw results](logger-overhead.json)) issued 1,000 calls per condition. Disabled runs took 0.72 and 0.53 ms; enabled synchronous JSONL runs took 277.76 and 264.78 ms. This isolates logger calls and filesystem writes; it is not whole-pipeline overhead.

## INFERRED

- The overlap can increase memory pressure because two analyses are active together. The experiment did not isolate its causal effect.

## UNVERIFIED and next steps

- End-to-end time, one-way transport, Webview conversion, layout and rendered graph counts, peak memory, UI interactions, Inspector, Dataflow and Runtime Debug remain unverified in this attempt. No bottleneck is established. The experiment was interrupted, so missing events are not zero-duration stages.
- Repeat on a machine with sufficient free memory, monitor continuously, and retain request IDs for overlapping auto/manual requests. Compare complete profiling-on/off runs with the same profile, cache state, pinned project and viewport before ranking optimizations. Verify actual graph and interaction behavior separately. Review repeated Canvas commit events and background/visibility state before interpreting frame observations.
- The P13 Generate step includes its own graph stability wait and used a previous extension build; this interrupted run is not directly comparable. No Program long-term cache, payload change or render optimization is proposed from this partial evidence.
