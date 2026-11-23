# P12-D: request lifecycle and cooperative cancellation

## Alternatives and scope

| Candidate | Benefit | Risks and MVP decision |
| --- | --- | --- |
| A. Coalesce identical requests | Avoids duplicate work | Inputs include unsaved buffers, workspace invalidation, trace settings and generation. Sharing promises also complicates cancellation and UI metadata. Deferred. |
| B. Suppress automatic analysis during Generate | Avoids self-induced activation | Suppressing edits, saves or a different file could hide newer content. MVP suppresses only an activation timer for the same file while the latest manual/select-file request is active. The `request.suppressed` diagnostic references the explicit request ID. |
| C. Latest request supersedes older work | Avoids obsolete results and work | Active sequence remains the existing authority; an edit/save or different-file activation may supersede explicit work. It is deliberately not a blanket manual-over-auto rule. File opening is asynchronous and sequence is assigned only when analysis begins, not at the initial click. |
| D. Cooperative cancellation | Stops remaining expansion work and disposes the session | JavaScript cannot interrupt synchronous TypeScript `createProgram` or analysis. MVP checks after file-list preparation, before cache result use, before/after base analysis, before and after each asynchronous read and after each synchronous target analysis, and before cache store. Cancellation throws a distinct error, is not swallowed as an unreadable file, and `finally` disposes the session. |

## Lifecycle and semantics

Generate and depth changes call active analysis, often via asynchronous `selectWorkspaceFile`; an editor activation schedules auto analysis, while edits and saves invalidate caches and schedule analysis separately. Trace mode uses the existing trace scope and reason. Debug start clears the timer; the existing debug epoch invalidates requests whose reason is `auto`. Expansion requests retain their existing generation policy and now check it after their file read and during preparation. This change does not introduce parallel TypeScript execution, change GraphPayload, join requests, or promise instantaneous cancellation. While synchronous work blocks the extension event loop, a later request cannot be observed until control yields. A cancelled result is neither posted nor inserted into the analysis-result cache; existing SourceFile cache and session invalidation mechanisms remain unchanged. Trace auto requests use reason `trace`, so the existing auto-only debug-epoch condition does not cover them; no new Runtime Debug policy is asserted.

An activation timer cannot replace a pending edit/save timer; a newer edit/save can replace an activation timer. For active requests, `request.begin` is followed by `request.cancelled` if superseded or invalidated by the existing debug rule; `depth.end` is absent when Depth throws. Suppressed activations are `request.suppressed`. A completed request can still be discarded by the existing stale check. Events are opt-in P12-C JSONL diagnostics. No cancellation is attempted within `createProgram`.

## Controlled comparison

Run `npm run compile`, then `node docs/thesis-experiments/p12-depth-performance/p12d/compare.cjs baseline` and the same command with `cancel`. Each condition is a fresh Node process with two small files. The first request is held at its expansion read, marked obsolete, then released; the second request starts after the first settles. Baseline allows the first to finish; cancel uses the new callback. Both issue two requests and there is no claim of real parallel execution. The file is a simulation, not the VS Code scheduler. Both use the same current build, with cancellation disabled/enabled by callback rather than separate historical builds.

| Condition | Requests | Programs | Cancelled | Elapsed | Process max RSS | Final graph |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline | 2 | 4 | 0 | 1,072.79 ms | 286,844 KiB | 5 nodes, 2 edges |
| Cancel | 2 | 3 | 1 | 1,165.23 ms | 288,988 KiB | same normalized SHA-256 |

Raw results: [baseline.json](baseline.json), [cancel.json](cancel.json). One run per condition, Node 24.12.0 on Windows, same machine. `maxRSS` is the OS process high-water mark, not a per-request or system peak. The small sample demonstrates one fewer Program in this controlled scenario; it establishes neither a speedup nor a memory reduction. Both hashes cover GraphPayload only, normalized for fixture location.

## Verification and limitations

`npm test` passed 83 tests, including a held-read cancellation and subsequent full-result equality, priority policy, pre-cancelled trace, and existing SourceFile, P12-B session, P14 and workflow tests. These are unit/integration tests; they do not simulate all VS Code event ordering. Cache-hit/miss behavior, rapid file/depth changes, unsaved edits, Trace and Runtime Debug need full VS Code end-to-end regression. In particular, an activation event arriving after explicit completion can still schedule a cache-hit analysis, and async file selection may reorder analysis start. Expansion cancellation and session invalidation due to concurrent filesystem events are not independently stress tested. No full Vite run was attempted on this 8 GB machine; no causal conclusion about its memory pressure is claimed.
