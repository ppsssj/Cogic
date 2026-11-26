# P15-Z0A: dataflow edge animation cost isolation (experiment)

P15-Z0 found that, at zoom 0.6 with no selection, the canvas was slow even when idle. A
selection removed that cost, and with it most of the animated dataflow edges. This run separates
the edge animation from everything else.

It runs on the P15-Z0 experiment branch: the same fixture (`e2e/semantic-zoom/make-fixture.mjs`,
650 nodes and 1266 relations at depth 3, every group expanded), the same viewport `{x: 40, y: 40}`,
and the same measurements.

| Condition | Selection | Edges |
|---|---|---|
| A | none | as shipped: animated dashed dataflow edges |
| B | none | the same edges, dash animation stopped (`animation: none`) |
| C | none | the same edges, no animation and solid strokes (`stroke-dasharray: none`) |
| D | `main()` | as shipped (the control) |

The edge style is two classes on the canvas container
(`window.__cgSemanticZoomExperiment.setEdgeStyle`). They cause no React render and change
neither React Flow's `animated` flag nor any node or edge.

Each run records what the edges really do, and stops if the selection state is wrong:

- how many edges have the `animated` class;
- how many of their paths have a running CSS animation;
- running document animations;
- dashed dataflow edges;
- the low-detail class.

Zoom 0.6: 5 repetitions. Zoom 0.15: 3 repetitions (low-detail solid strokes). In each repetition
the conditions run in a rotated order, each with 2 s idle, a 5 s pan and a wheel sweep.

```
npm run build:all
set VSCODE_EXE=<path to Code.exe>
node e2e/dataflow-animation/run.mjs <new output folder>
node e2e/dataflow-animation/summarize.mjs <output folder>/result.json
```

`Z0A_REPS` and `Z0A_REPS_LOW` set the repetitions. Memory: at least 2200 MiB free to start, stop
below 800 MiB. rAF gaps are not display FPS. GPU time is not measured.
