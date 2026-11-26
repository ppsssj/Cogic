# Leaving a trace (end to end)

Drives the built extension in a real VS Code on the fixture of `e2e/aggregate-inspector`. It
reads the rendered DOM and the webview debug log the product already keeps
(`window.__CODEGRAPH_WEBVIEW_DEBUG__`), including the `trace.exit` entry, whose action is
`restore`, `reanalyze` or `empty`.

```
npm run build:all
npm install --no-save playwright-core
set VSCODE_EXE=<path to Code.exe>
node e2e/trace-exit/run.mjs [output-folder]
```

The run first sets up a normal graph at depth 2 with a collapsed folder, a selected node, Focus
on and a panned and zoomed view. Then:

| Scenario | What happens | What is checked |
|---|---|---|
| A, B | Trace three steps, leave from the top bar | Same node and edge IDs, collapsed groups, root and depth; selection and Focus back; the same view |
| C | Leave at cursor 0, and at cursor 1 (the file node only) | Same graph as before |
| D | Finish (`끝`) at the last step, start again, leave | A new trace starts at `0 / N`; nothing is carried over; every exit is a `restore` |
| F | Start and leave immediately | The trace never comes back. The graph is restored if the trace result had arrived, or analyzed again if not; the action taken is recorded |
| E | Another file opened in the editor during the trace | The old graph is not restored: the new file is analyzed, and its graph equals the same file analyzed without a trace |
| Edit | The active file is edited during the trace | The old graph is not reused: it is analyzed again (the edit is undone afterwards) |
| Folder root, file inside | Root `/src`, `main.ts` active, edit during the trace | Analyzed again under the same folder root; the same graph (counts from the product's log, because collapse state is not kept through a new analysis) |
| Folder root, file outside | Root `/src/app`, `main.ts` active, edit during the trace | No file is picked: the root stays (read from the product's log, since the root banner is part of the canvas) and the normal "No graph yet" state shows |

The project picker is not available while a trace runs, so E changes the target through the
editor.

Late responses (a trace result, an empty result or a normal result of an ended trace session, and
a new trace right after an exit) are replayed in a fixed order by `src/test/traceExit.test.ts`. In
this fixture the trace result always arrives before an immediate exit, so a late response does
not happen here.

Same limits as the other end-to-end runs: a new output folder per run, at least 2200 MiB free to
start, and a stop below 800 MiB.
