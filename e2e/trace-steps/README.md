# Trace steps on the canvas (end to end)

Drives the built extension in a real VS Code on the fixture of `e2e/aggregate-inspector`.
It reads the rendered DOM and the webview debug log the product already keeps
(`window.__CODEGRAPH_WEBVIEW_DEBUG__`: `trace.step` for the step graph and
`canvas.reactflow.topology-changed` for the React Flow counts).

```
npm run build:all
npm install --no-save playwright-core
set VSCODE_EXE=<path to Code.exe>
node e2e/trace-steps/run.mjs [output-folder]
```

The run starts a trace from `src/main.ts`, then from `src/app/a.ts` after a root change. For
every cursor from 0 to the end it records:

- the step label;
- the event type and the node kind;
- the step graph counts;
- the React Flow counts;
- the DOM nodes, code nodes and edges, and how many nodes are in view;
- the viewport;
- the empty state.

Each sample is taken once the view has settled.

Checks per trace:

- cursor 0 is "ready" and cursor 1 (the file node only) is "file-only", without the error state or
  the Generate button;
- every later step draws code nodes in view;
- an edge step adds no node and a node step adds one;
- Prev back to 0 and Next again show the same graph at each cursor;
- after the trace ends, the canvas still draws a graph;
- a restarted trace is ready at 0 with the same total.

Same limits as the other end-to-end runs: a new output folder per run, at least 2200 MiB free
to start, and a stop below 800 MiB.

Ending a trace keeps the last step's graph and starts no new analysis. This is existing
behaviour, also before this change. The run records the counts after the trace and the normal
counts, but does not expect them to match.
