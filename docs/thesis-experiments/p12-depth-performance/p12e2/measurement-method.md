# Method and reproduction

## Conditions

Baseline: Cogic `d3845a6473bdd7da750cf74b04ebb3c37dcf1723`, Vite `3567471998e3da315675086f44368e266c9c0e33`, root `packages/vite/src/node/server/index.ts`, Depth 2, result cache ON, existing P12-C diagnostics ON, Windows 11 Pro 8 GB, VS Code 1.147.0, 1600x960 window, devicePixelRatio 1. Fresh isolated profile and one test VS Code at a time. Both baseline graph snapshots had 1,078 nodes, 3,755 edges and normalized SHA-256 `baf0b1c591a5ad4af4f0fb5c1a947b3124d220acd1fded6e50d00e6ee9117049`. No product source was changed. Chrome windows PID 6288 and later 16408 were each normally closed with previously authorized permission; no user application was force-killed.

## Observable measures

The harness installs test-only observers in the actual Webview after graph load. A requestAnimationFrame loop records callback timestamps. `summarize.py` uses sorted consecutive intervals and index `floor((n-1)*p)` for P50/P95/P99; callback FPS is `1000 * intervalCount / sum(intervalMs)`. It is a scheduling proxy, **not verified physical display FPS or an exact count of dropped frames**. The test sends 80 mouse moves over about five seconds; `pointerPathCssPx` sums received pointer coordinates, not graph viewport travel. The pan traverses four oscillations and ends near its starting transform. Only final viewport style is retained, so cumulative graph movement and path fidelity are unverified.

Long Task and Long Animation Frame observers are enabled only if supported. A zero observed count means no entries captured while the phase was active, not proof of no browser/compositor work. Playwright input, DOM queries, synchronous observer collection, profiling diagnostics, automatic camera focusing, Windows scheduling and background activity can distort timings. No randomized observer-OFF Vite comparison was completed.

Selection latency starts at the Webview capture-phase `click` handler and stops at a MutationObserver detecting changed Inspector selected-node text. This excludes hardware/OS input delay and physical presentation; it is not INP. It uses only three accessible nodes per large-graph run. Canvas `pipeline.canvas.commit` is correlated using the Webview monotonic clock, not Extension Host time. Its existing `nodesMs` and `edgesMs` are the latest memo calculation values and must not alone prove which function ran at a particular commit. Counts are logical or virtualized DOM counts as labelled; DOM nodes and SVG edges change with viewport.

Zoom uses eight alternating Zoom-in/out button clicks and records DOM counts after each click; it is not a fixed-speed wheel gesture. Collapse looks for an unobstructed visible header point; unsuccessful lookup is recorded as unavailable, not zero duration. The initial attempt waited 1.2 s after click, so its automation elapsed time would not be a React commit duration. Fit Graph records viewport before/after and frames, but cannot establish full graph bounds from the virtualized DOM.

## React profiling build

[prepare-react-profile.cjs](prepare-react-profile.cjs) modifies only an isolated detached worktree. It switches to React's profiling renderer, wraps CanvasPane and Inspector in React Profilers, and logs `toReactFlowNodes`/`toReactFlowEdges` measurement callback invocations into the Webview. It is not the shipped React build; profiler overhead was not isolated. A small fixture completed and validates the instrumentation. Vite React profile runs were aborted by the memory guard, including a separate no-language-server condition. Their partial logs do not establish Vite React render time.

The no-language-server condition is recreated by [prepare-no-ts-harness.ps1](prepare-no-ts-harness.ps1), which copies the P13 harness and adds `--disable-extension=vscode.typescript-language-features` in that *copy*. Set `P12E2_NO_TS=1` only with that prepared copy. It skips readiness waits and is a different VS Code condition, not comparable to baseline as a controlled optimization.

## Run

Prepare the P13 Playwright harness and an isolated extension built from `d3845a6`; do not modify the user installation. Use a new output directory and run a small fixture first. `run.ps1` retains the 2,200 MiB preflight and 800 MiB guard (250 ms sampler); asynchronous close cannot guarantee protection from a transient OOM.

```powershell
./docs/thesis-experiments/p12-depth-performance/p12e2/run.ps1 `
  -Harness C:/path/to/harness -Workspace C:/path/to/pinned-vite `
  -Extensions C:/path/to/isolated-extensions -CodeExe C:/path/to/Code.exe `
  -Output C:/path/to/new-run -File packages/vite/src/node/server/index.ts -Cache on
python ./docs/thesis-experiments/p12-depth-performance/p12e2/summarize.py C:/path/to/new-run/interaction.json C:/path/to/new-run/pipeline.jsonl
```

For React profiling, make a new detached worktree and isolated extension copy, run the preparation script on that worktree, build its `webview-ui` and copy its media only into the isolated extension. An opt-in test-only `P12E2_VARIANT=animation-off` injects CSS hiding path animation, but the two Vite attempts failed before analysis started and the condition was not validated. Do not interpret them as an A/B result. Logs may contain local paths.
