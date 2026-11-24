# Reproduction

Run from the repository root. Compare committed graph snapshots:

```powershell
node docs/thesis-experiments/p12-depth-performance/p12e4/compare-graphs.cjs `
 docs/thesis-experiments/p12-depth-performance/p12c2/vite-graph.normalized.json `
 docs/thesis-experiments/p12-depth-performance/p12e3/vite-control-no-ts-1/preparation-graph.normalized.json `
 C:/path/to/new-diff.json
node docs/thesis-experiments/p12-depth-performance/p12e4/inventory.cjs C:/path/to/vite C:/path/to/Cogic C:/path/to/isolated-extension
```

Vite pinned SHA `3567471998e3da315675086f44368e266c9c0e33`; extension built from the P12-C2 product code, TypeScript 5.9.3; VS Code 1.147.0; Depth 2; result cache ON. Preserve and fingerprint the installed dependency tree and workspace; a Git commit does not pin an existing ignored node_modules directory. [inventory.json](inventory.json) shows this run's directory inventory and selected package metadata, not all bytes. See [P12-E2 method](../p12e2/measurement-method.md) and [P12-E3 method](../p12e3/measurement-method.md) for harness setup.

Copy the compiled extension to a **new** disposable extensions directory and run `node prepare-environment-probe.cjs <isolated-extension-dir>`. The script changes one compiled analyzer file solely to emit host metadata once; it does not alter GraphPayload. Check it with `node --check`. Do not edit the installed user extension or product checkout. Run a small fixture first.

For the no-TS condition, create the isolated harness using `../p12e2/prepare-no-ts-harness.ps1` and confirm the actual launch flag. Set `P12E2_NO_TS=1`, `P12E2_FIXTURE=0`, `P12E4_EXPECT_NEW=1`, `P12E4_GRAPH_ONLY=1`; run:

```powershell
./docs/thesis-experiments/p12-depth-performance/p12e4/run.ps1 `
 -Harness C:/path/to/no-ts-harness -Workspace C:/path/to/vite `
 -Extensions C:/path/to/probed-extensions -CodeExe C:/path/to/Code.exe `
 -Output C:/path/to/new-output -File packages/vite/src/node/server/index.ts
```

The runner refuses an existing output directory and retains raw events, normalized graph and memory samples. One test VS Code at a time; 2200 MiB preflight, 250 ms sampling and 800 MiB stop remain unchanged. Use a larger-RAM host for repeated Vite arms. The E4 expected hash is only for precisely this known new input and must not silently replace the old reference; inspect dependencies and the assertion before comparing. A program-created event is not a completed graph. Do not use incomplete or mismatching runs for performance comparisons.
