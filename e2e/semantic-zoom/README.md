# P15-Z0: semantic zoom rendering feasibility (experiment)

An A/B/C rendering experiment, not a product feature. On this branch,
`window.__cgSemanticZoomExperiment` switches the mode. The default is the baseline, and no product
UI changes it.

| Condition | What is drawn |
|---|---|
| A, baseline | The graph as it is. The benchmark expands every group, the heavy state of exploration. |
| B, overview | `src/shared/semanticOverview.ts`: every leaf folder and every file collapsed through the existing collapse. Fewer nodes and edges go to React Flow, and the aggregates keep their original relations. |
| C, local detail | A plus one fixed overlay (outside React Flow) for the selected function: name, kind, signature, location, and up to 8 source lines when the function is in the active file. |

Selection is a factor of its own, because a selection mutes and stops animating the unrelated
dataflow edges:

- **A0, B0:** no selection.
- **A1, B1, C1:** `main()` selected.

## Run

```
npm run build:all
set VSCODE_EXE=<path to Code.exe>
node e2e/semantic-zoom/run.mjs <new output folder>
node e2e/semantic-zoom/summarize.mjs <output folder>/result.json
```

`Z0_REPS` sets the repetitions (default 5).

The fixture comes from `make-fixture.mjs`: 8 folders x (1 hub + 6 leaf files x 6 functions), with
cross-folder calls. At depth 3 from `src/main.ts` the graph has 650 nodes and 1266 relations.

Memory: at least 2200 MiB free to start, stop below 800 MiB.

## Steps

1. **Correctness.** B collapses exactly the leaf folders and the files outside them. Sampled
   aggregates (every 6th; opening all of them in a row exceeds the memory guard) open all of their
   original relations, of their own kind. Back in A, every node is at the same position. C shows
   one overlay for the selected function with its real source, and moves no node.
2. **Warm-up.** One pan per condition.
3. **Repetitions.** In each repetition and at each zoom (0.6 and 0.15), every condition runs in an
   order rotated by repetition. The viewport is fixed at `{x: 40, y: 40, zoom}` for every condition.
   Each condition gets:
   - 2 s idle;
   - a 5 s pan along the same ellipse (240 x 140 px, 16 ms steps);
   - a wheel sweep (12 steps out, 12 in, 60 ms apart).

## What is measured

- **rAF gaps** inside the webview, in ms. These are not display FPS; at 120 Hz the floor is 8.3 ms.
- **Long tasks** from `PerformanceObserver("longtask")`.
- **Render calls** of Cogic's own components (code, file and folder nodes, custom edges, overlay).
  These are not React commits; React Flow's built-in edges are not counted.
- **Counts:** drawn React Flow nodes and edges, DOM elements in the canvas, animated edges.
- **Memory:** JS heap (`performance.memory`) and the renderer working set (`app.getAppMetrics`).
- **Mode switch time:** until the drawn counts hold for 5 frames.

GPU time is not measured (no API for it here).
