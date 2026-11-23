# P12-C pipeline diagnostics

The completed small-fixture smoke and overlap investigation are recorded in [follow-up.md](follow-up.md). The fixture Generate was a cache hit after preparation; it is not a cold Vite measurement.

## Scope and collection

Opt in by setting `COGIC_PIPELINE_PROFILE` to an absolute, writable JSONL path in the VS Code process environment before launching a fresh extension host. The extension appends one JSON object per event; no telemetry is sent externally. The file may contain source paths and should be reviewed before sharing. Unset the variable to disable output. Write errors are ignored and can leave an incomplete log. The same variable injects an opt-in Webview meta tag. GraphPayload is unchanged.

Each line has `source`, `event`, `requestId`, extension-host `monotonicMs` and `wallTime`. Forwarded Webview events additionally carry `webview.monotonicMs`, `webview.timeOrigin`, `webview.wallTime`, and event-specific detail. The user-triggered request ID is created in the Webview and echoed in the host request metadata. Auto and expansion requests receive host IDs. Generation and sequence identify stale requests; `request.dropped` and `pipeline.result.dropped` explicitly identify discarded results. IDs from independent panel instances are not a global ordering mechanism. A missing event is unknown, not zero.

## Boundaries

| Event | Observable boundary |
| --- | --- |
| `pipeline.request.sent` | Immediately before Webview posts a manual request. File selection includes editor opening before host analysis starts. |
| `request.begin` | Host analysis starts, after request dispatch and any selected-file opening. |
| `workspace.ready` | File listing and its existing throttle; duration and count. |
| `cache.lookup` | Cache-key construction and lookup; hit, miss, or disabled. A hit skips Depth and Program events. |
| `depth.begin`, `depth.end` | Full Depth call. `analyzer.program.created` supplies existing `createProgramMs`; `depth.frontier`, `depth.target.end`, `depth.target.failed`, and `depth.merge` report traversal and merge. Target duration includes read, analysis, merge and frontier collection. Durations overlap and must not be summed blindly. |
| `payload.ready` | Payload preparation including trace pruning; graph counts and extension-host `process.memoryUsage()` snapshot, not peak system or renderer memory. |
| `postMessage.call`, `postMessage.resolved` | Invocation and resolution of VS Code's postMessage promise. This is not a separately observed serialization or one-way transfer time. |
| `pipeline.result.received`, `pipeline.result.prepare`, `pipeline.state.queued` | Webview message handler, diagnostic summary preparation, and queued React state update. Queueing is not a React commit. |
| `pipeline.canvas.commit` | React effect after CanvasPane commit, with latest node conversion/layout and edge conversion timings and logical counts. The node conversion contains application layout; React Flow's own internal layout, reconciliation and browser layout are not isolated. Measurements may be repeated and reflect the most recent memo calculation. |
| `pipeline.canvas.twoAnimationFrames` | Two requestAnimationFrame callbacks after that effect and DOM node count. This is a paint opportunity, not proof of physical presentation or interaction readiness. Hidden windows may delay or suppress it. |

Extension and Webview monotonic clocks have unrelated origins; **never subtract across them**. Within each process durations are meaningful. Host `postMessage.call` to host receipt of forwarded `pipeline.result.received` is a round-trip upper bound including Webview scheduling and return forwarding, not one-way transfer. `pipelineSummary` exposes this bound, within-clock differences, null for missing boundaries and dropped/duplicate status. React Flow virtualization means DOM counts are not total graph counts. No event asserts that a user can interact with a particular node.

## Reproduction and limitations

Build with `npm run build:all`. Install a test copy of the resulting extension into an isolated extensions directory; do not overwrite the P13 install. Use the P13 harness and fixed Vite worktree `3567471998e3da315675086f44368e266c9c0e33`. Copy `p13-p12c.spec.ts` into the harness `e2e` directory, select a fresh profile, set `STUDY_WORKSPACE`, `VSCODE_EXE`, `P4_EXTENSIONS_DIR`, `RUN_ID`, and `COGIC_PIPELINE_PROFILE`, then run `npx playwright test -c playwright.p13.config.ts e2e/p13-p12c.spec.ts`. Record available and minimum physical memory separately; stop if the machine becomes unstable. Preserve the raw JSONL and harness log separately from previous runs. `waitGraphStable` adds a 3-second quiet period, so its elapsed time is not first paint. P13 used a previous extension revision and a full task harness; comparisons require matching project, dependencies, viewport, profile, cache state and measurement definition.

`npm test` covers event ordering, ID grouping, missing and duplicate records, dropped requests and exact analysis result equality for a small cross-file fixture with profiling enabled/disabled. This does not establish UI, Inspector, Dataflow or Runtime Debug end-to-end equivalence. The logger performs synchronous file writes when enabled and Webview forwarding itself adds work; the overhead must be measured under the intended workload before treating an instrumented duration as representative. The actual one-way transfer, serialization cost, physical paint, interaction readiness, peak renderer memory and Vite ON/OFF overhead remain unverified until separately measured. Do not infer a bottleneck from P13's 385–391 s automation step or subtract P12-B Node results from it.
