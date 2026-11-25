# Reproduction and gates

Use a clean disposable workspace and isolated extension copies; never patch a user's installed extension. Keep P12-E2/E3/E4 logs. The E4 Vite run memory floor was 818 MiB, so use a larger-RAM host for Vite; guard stays at 800 MiB with 250 ms sampling and 2200 MiB preflight. The guard is asynchronous and cannot prevent all transient OOMs. Run one VS Code at a time.

1. Build an isolated extension from P12-C2 product source. Copy it twice. Apply `node prepare-manifest-probe.cjs <extension-copy>` to each compiled copy. For the OFF arm, use a disposable source worktree and E3 `prepare-virtual-off.cjs` before building its Webview, then apply the same manifest probe to its extension copy. Keep the original compiled analyzer for its SHA-256. There must be exactly one intended rendering variable.
2. Prepare the P13 Playwright harness described in [E2](../p12e2/measurement-method.md). For this specific medium setup use the isolated `prepare-no-ts-harness.ps1`; assert that its launch actually includes `--disable-extension=vscode.typescript-language-features`. `P12E2_NO_TS=1` only skips a wait: it does not disable the extension by itself. The test's active extension set is not fully enumerated; lock it externally for serious comparison.
3. `node generate-medium.cjs C:/path/to/new-medium 200` generates a fresh fixture and refuses an existing destination. `P12E4_GRAPH_ONLY=1` permits graph discovery without an expected hash; do not compare timings from discovery. Configure `P12E2_NO_TS=1`, `P12E5_PICKER=entry.ts`, `P12E5_EXPECT_SHA256=<discovered-sha>`, unset `P12E4_GRAPH_ONLY`, and run each arm with a unique output directory:

```powershell
./docs/thesis-experiments/p12-depth-performance/p12e5/run.ps1 `
 -Harness C:/path/to/no-ts-harness -Workspace C:/path/to/new-medium `
 -Extensions C:/path/to/isolated-extensions -CodeExe C:/path/to/Code.exe `
 -Output C:/path/to/new-output -File src/entry.ts
```

A hash mismatch fails before interaction phases. Graph normalization matches the E2 harness: slash normalization and case-insensitive replacement of the workspace root before JSON.stringify. Other absolute paths are retained; equivalent files in another location may require an explicitly documented new reference. The runner's successful exit alone does not mean all phases passed: inspect `interaction.json` for unavailable and error phases.

4. After each run, create the manifest and compare:

```powershell
$env:P12E5_VSCODE_VERSION='1.147.0' # record actual independently verified version
node docs/thesis-experiments/p12-depth-performance/p12e5/manifest.cjs C:/path/to/output C:/path/to/workspace C:/path/to/isolated-extension C:/path/to/unmodified/out/analyzer/analyze.js virtual-on ts-disabled
node docs/thesis-experiments/p12-depth-performance/p12e5/compare-manifests.cjs C:/path/to/on/manifest.json C:/path/to/off/manifest.json
node docs/thesis-experiments/p12-depth-performance/p12e5/test-manifest.cjs
```

For Vite, add `--require-vite` to the comparator and use pinned SHA `3567471998e3da315675086f44368e266c9c0e33`, Depth 2, `packages/vite/src/node/server/index.ts`, a locked and verified installed tree, and the correct environment-specific expected graph. The user-supplied metadata and retained declarations are not a complete dependency-tree hash; record or hash all other relevant dependencies and independently enumerate active extensions and code differences. Root and declaration hashes must be collected without concurrent edits. Treat any missing evidence as unverified. Compare same-environment arms only after both graphs and manifests pass; preserve different historical baselines. For selection, collapse and expand, update the harness to explicitly fail or mark incomplete when targets cannot be reached, and collect UI state assertions before drawing performance conclusions.
