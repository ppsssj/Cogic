# Focus + Context 1-hop (end to end)

Drives the built extension in a real VS Code on the fixture of `e2e/aggregate-inspector` and
reads only the rendered DOM. The expected center, 1-hop and context sets are worked out from the
drawn relation IDs (`kind:source->target@@...`) and the members the Inspector lists, not from
the product's focus code.

```
npm run build:all
npm install --no-save playwright-core
set VSCODE_EXE=<path to Code.exe>
node e2e/focus-context/run.mjs [output-folder]
```

Same requirements as `e2e/aggregate-inspector`: a new output folder per run, at least 2200 MiB of
free memory to start, and the run stops below 800 MiB. The result is `result.json`; the exit code
is 1 if a check fails. The save dialog is answered through `files.simpleDialog.enable`, so the
export files land in the output folder.

Covered: Focus on and off, no change to nodes, edges, positions, paths, counts or viewport,
center changes, a context node selected, multi-selection, clearing the selection, pan, wheel
zoom, zoom 0.1, Param Flow and trace precedence, collapsed folders and files, aggregate badges
with some related members, the Inspector after a badge, root change, SVG and JPG export, and the
toggle time inside the webview.

Seen here and present before this change (checked on `b87fe45`): the first trace steps can show
an empty canvas, so the run steps through the trace to a step with code. The viewport after export
is checked by `e2e/export-viewport`.
