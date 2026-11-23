# Draft stabilization: partial verification

## Selection ordering

The previous code assigned an active-analysis sequence after asynchronous document open/show. `SelectionOrder` now reserves a revision on receiving the selection and serializes editor activation. A newer explicit analysis invalidates pending selections. When a file selection arrives, it also advances the active sequence and generation immediately, so older in-flight analysis is stale before the new document has opened. Unit tests deterministically cover an older open completing after a newer selection and a newer selection arriving during an older show. The tests do not execute VS Code's actual editor APIs or assert Graph Root and rendered graph together, so that end-to-end case remains **UNVERIFIED**.

## Loading and late activation

The Webview now ignores stale active/expansion results before clearing its loading state, and failures in `selectWorkspaceFile` are delivered as canvas analysis errors. This is only a partial correction: the Webview still tracks the latest *applied* host sequence, not the latest user request ID. A prior result arriving before a later request has been applied can therefore still clear the newer loading indicator. Cancellation without a successor, Runtime Debug starting during loading, a newer request failing after cancellation, rapid Depth/Generate changes, and late same-file editor activation have not been reproduced or proven safe end-to-end. These are **UNVERIFIED** and PR #33 remains Draft. Request-scoped lifecycle messages and loading ownership need further design and tests before claiming completion. Late same-file activation after explicit completion may still trigger a cache-hit reanalysis; edits/saves must remain functional.

## Small real-VS-Code smoke

On Windows 8 GB, VS Code 1.147.0 and the P14 cross-file fixture, the isolated monitored Generate/Inspector/Dataflow smoke passed. Available memory was 2,410 MiB before launch and the one-second post-launch sampler saw a minimum of 946 MiB. The manual request reached Host post, Webview receipt, Canvas commit and two animation frame callbacks with the same request ID. The Inspector showed `Example.request -> Example.fetch value <- value`. Two frame callbacks are not evidence of physical paint or interaction readiness. The result was a warm cache hit after preparation.

The [raw event log](stabilization-ui.jsonl) has three `request.begin`, one `request.cancelled`, zero `request.suppressed`, zero `request.dropped`, one `depth.end`, and two `postMessage.call` events. Absence of suppressed/dropped events is not verification of those paths. The [harness output](stabilization-ui.txt) records the UI observation. This smoke does not test rapid selection, repeated Depth changes, failures, Trace Mode or Runtime Debug, nor compare a complete VS Code graph with the policy disabled. Vite Depth 2 was not run.

Reproduce using `run-local.ps1` in this directory, an isolated copy of the current built extension, the P14 fixture and a fresh output directory. The harness monitors free memory after VS Code launches and closes its own isolated app below 400 MiB; it does not monitor the launch interval. No unrelated user processes are terminated.
