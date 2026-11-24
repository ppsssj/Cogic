# Method and reproduction

Windows 11, 8,331,380 KiB physical RAM, VS Code 1.147.0; one isolated VS Code per run. `run.ps1` uses the existing P12-C2 pipeline and 3-second process memory monitor, plus a 250 ms free-physical-memory guard that closes the isolated test below 800 MiB. A preflight requires 2200 MiB. Sampling can miss shorter minima. System free RAM is not per-process RSS. Test output directories must not exist; logs are preserved. P12-E2 describes environment and baseline in [its method](../p12e2/measurement-method.md).

`prepare-selection-profile.cjs` is only for a disposable checkout at `4b272bc`: it invokes the P12-E2 instrumentation, adds ReactFlow Profiler, handler timestamps and a post-commit effect. `prepare-virtual-off.cjs` also modifies only a disposable checkout. Build each with its own `node_modules` links and `npm run build --prefix <checkout>/webview-ui`; copy its `media/webview` into a separate isolated extension copy. Never apply either patch to the product worktree. The two Profiler scopes overlap. Synthetic Playwright pointer movements, rAF timestamps, Long Task API, and MutationObserver do not prove presentation, GPU cost, or physical input latency. Mouse-click-to-DOM begins at captured Webview click event; the handler markers and conversion end times share that Webview's performance clock. React's effect timestamp is not the state setter time. Collapse windows include deliberate delays.

Example after preparing an isolated instrumented extension and the existing P13 harness (set values for your machine):

```powershell
$env:P12E2_FIXTURE='1'; $env:P12E2_REACT_ONLY='1'
./docs/thesis-experiments/p12-depth-performance/p12e3/run.ps1 `
  -Harness C:/path/to/harness -Workspace C:/path/to/p14/fixture `
  -Extensions C:/path/to/isolated-extensions -CodeExe C:/path/to/Code.exe `
  -Output C:/path/to/new-output -File src/main.ts
```

For Vite use the pinned checkout, root `packages/vite/src/node/server/index.ts`, `P12E2_FIXTURE=0`, and an otherwise identical environment and dependency resolution for both arms. `P12E2_NO_TS=1` only with a harness that actually disables TypeScript language features; it is a separate environment, not the E2 default. Unset `P12E2_REACT_ONLY` for full interactions. `P12E2_VARIANT` labels output; it does not switch virtualization. Build and select the appropriate extension copy. Assert the graph hash before analyzing interactions. Hold installed dependency versions, actual resolved external declarations, cache and diagnostics constant, randomize arm order and repeat. Do not lower the 800 MiB guard. To compare collapse, ensure target group headers are actually visible, confirm the collapsed state and layout, and measure input to settled state separately; the current broad window is not such a metric.
