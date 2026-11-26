# Aggregated edge drill-down (end to end)

Drives the built extension in a real VS Code and reads only the rendered DOM. It does not call
the product's aggregation code and needs no test hook in the product.

```
npm run build:all
npm install --no-save playwright-core
set VSCODE_EXE=<path to Code.exe>
node e2e/aggregate-inspector/run.mjs [output-folder]
```

`VSCODE_EXE` must be a VS Code desktop binary. `PLAYWRIGHT_CORE` may point at an existing
`playwright-core` folder. Every run uses a new profile in the output folder.
The result is `result.json`; the exit code is 1 if a check fails. The run does not start below
2200 MiB of free memory and stops below 800 MiB.

`verify-graph.cjs <capture.json>` is an independent calculator for a captured graph. It checks
which relations every drawn edge must stand for. See the header of the file for its rules.

Not covered here: the real Tab order, dragging from a badge, badge overlap with group headers,
export, and regenerating the graph.
