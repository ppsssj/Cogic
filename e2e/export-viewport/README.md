# Export keeps the view (end to end)

Drives the built extension in a real VS Code on the fixture of `e2e/aggregate-inspector` and
reads only the rendered DOM. Each SVG or JPG export is wrapped in a before/after comparison of:

- the viewport (x, y, zoom) and the inline `.react-flow__viewport` transform;
- drawn node and edge IDs, and collapsed groups;
- the selected nodes, the selected aggregate and its Inspector panel;
- the Focus state;
- the low-detail class, on-screen dash styles, badge texts, and the inline styles of the canvas
  elements.

After an export, a drag by (40, 10) must land exactly 40, 10 from the restored view. React Flow
moves the view from its store, so this shows that the DOM and the store agree.

```
npm run build:all
npm install --no-save playwright-core
set VSCODE_EXE=<path to Code.exe>
node e2e/export-viewport/run.mjs [output-folder]
```

The run covers a panned and zoomed view, zoom 0.1 (SVG and JPG), Focus on, a selected aggregate,
and SVG -> JPG -> SVG. Every file is kept in the output folder. SVG files must contain dashed
strokes and every badge count, and JPG files must be complete JPEGs.

Limits are the same as the other end-to-end runs: a new output folder per run, at least 2200 MiB
of free memory to start, and a stop below 800 MiB. Export sizes the canvas to the whole graph and
JPG uses pixel ratio 2. That needs more memory than the guard leaves with every group expanded,
so the run collapses `src/svc` and `src/app`.

The failure paths (a conversion that throws, a failure halfway through the style changes) are
covered by `src/test/temporaryStyles.test.ts`. Nothing in the product can be made to fail from
here without a test hook.

Seen here and not changed: after an export at a zoom between 0.2 and 0.25, the canvas comes back
without the low-detail class. `LowDetailEdges` starts again from "not low", and that band is its
hysteresis. The run keeps its user view above 0.26.
