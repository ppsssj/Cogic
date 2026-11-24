# Measurement method and reproduction

## Environment

Windows 11 Pro 10.0.26100, 8,331,380 KiB visible physical RAM; VS Code archive 1.147.0; Node 24.12.0; npm 11.6.2; Cogic TypeScript 5.9.3. Cogic main `66228e1d9b9c049c37cdc0a64dc767ecdc06cc48`, built with `npm run build:all`. P13 Vite worktree `3567471998e3da315675086f44368e266c9c0e33`, clean tracked files, existing `node_modules`, root `packages/vite/src/node/server/index.ts`, Depth 2. Fresh isolated VS Code profile, cache ON, diagnostic logging ON. A separate user-owned Vite preview server belonged to another project and was not terminated. Only one P12-C2 VS Code test ran at a time.

P13 recorded an automation step that includes harness operations and a prior product revision; it is not a measured user wait or directly comparable to these observations. P12-B Node runs have different execution context and are reference values, not UI timing baselines.

## Event interpretation

Webview `pipeline.request.sent` is immediately before post; host `request.begin`, `workspace.ready`, `cache.lookup`, `depth.begin/end`, `analyzer.program.created`, `depth.frontier`, `depth.merge`, `payload.ready`, `postMessage.call/resolved` and forwarded `pipeline.result.received`, `pipeline.state.queued`, `pipeline.canvas.commit`, `pipeline.canvas.twoAnimationFrames` share request IDs. Use durations inside their own process only. Do not subtract Webview monotonic times from Extension Host monotonic times. Host post-to-forwarded receipt includes the return diagnostic and is an upper bound, not one-way network transfer. `payload.ready` is not a separate serialization measurement.

`CanvasPane` filters with `filterGraph` before the node and edge memo computations. Existing `nodesMs` covers `toReactFlowNodes` including application node/file/folder positioning; `edgesMs` covers `toReactFlowEdges`. Filter time, React Flow reconciliation, browser layout, SVG paint and physical presentation are not separately recorded. Logical graph counts, flow counts and virtualized DOM counts are different. The Canvas effect is an observable React commit boundary; two `requestAnimationFrame` callbacks are opportunities for paint, not proof of visible physical paint or interaction readiness. If a boundary is missing, its value is unknown, not zero. Profiling writes synchronously and adds unknown workload-specific overhead.

The existing UI starts analysis on a Depth change. The harness records that request as **preparation**, waits for a terminal host event and a quiet period, then clicks Generate. A cache-ON Generate may therefore be a warm cache hit; it must not be described as a cold analysis. It records every request so overlaps or cancellation can invalidate interpretation. For cache OFF, preparation still changes OS/TypeScript caches; it is not a fresh-host cold Generate. Truly cold manual Generate requires a separately validated setup or test-only preparation control.

## Memory policy

The fixture smoke used 1,400 MiB preflight and a 1-second 500 MiB guard; the sampled minimum was 584 MiB. Before Vite, raised preflight to 2,200 MiB and changed the guard to 800 MiB with a 250 ms Node timer, including startup. On threshold crossing it closes only the test-owned Electron application. The guard observed 768 MiB; asynchronous termination and sampling are not guaranteed to prevent OOM. The independent three-second WMI samples are not continuous, report working set rather than peak RSS, classify renderers together (workbench and webview cannot be reliably separated), and identify the extension host by its TypeScript-server children only as an inference. Host `payload.ready` exposes a process RSS snapshot, not a peak. The Vite guard stopped VS Code, but the first harness version continued polling the absent event; the test runner was manually interrupted and monitor stopped. Its log is partial; subsequent script adds guard checks during polling, which have not been rerun under guard failure. No user processes were terminated.

## Reproduce

Use a separate machine with at least 16 GB RAM and sufficient available memory; retain a safe guard and monitor system health. Prepare the exact Vite commit and dependencies, build Cogic, and copy the built extension to a new isolated extensions directory (never overwrite a real user installation). The P13 Playwright harness and `e2e/lib` are required; paths must be changed to the local machine. Each output path must be new.

```powershell
./docs/thesis-experiments/p12-depth-performance/p12c2/run.ps1 `
  -Harness C:/path/to/harness -Workspace C:/path/to/vite `
  -Extensions C:/path/to/isolated-extensions -CodeExe C:/path/to/Code.exe `
  -Output C:/path/to/new-run -File packages/vite/src/node/server/index.ts -Cache on
```

Run a small fixture first. Examine `process-memory.jsonl`, `pipeline.jsonl`, `memory-summary.json`, and `harness.log`; an abort is not a successful sample. Then repeat with fresh profiles, cache ON/OFF, and record conditions and repetitions. `graph.normalized.json` replaces the case-insensitive workspace path with `<fixture>`, normalizes backslashes to slashes and preserves object/array order; compare hashes only against an identically normalized result from the same project/dependencies/settings. The script stores fixture paths, request IDs and results locally. Basic pan/zoom, node selection, folder expansion and Fit Graph need explicit UI assertions beyond the current collection script. The present script records Inspector text but does not assert every Vite interaction. No cold/warm distribution or instrumentation-on/off overhead was collected for Vite.
