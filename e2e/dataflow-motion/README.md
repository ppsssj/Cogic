# Dataflow motion policy (P15-R1), end to end

Checks and benchmarks `src/shared/dataflowMotion.ts` in a real VS Code. The policy is the hidden
setting `cogic.experimental.dataflowMotion`:

- `"focused"`: only an explicitly highlighted relation moves;
- anything else: `legacy`, the shipped behaviour.

The setting is not declared in `package.json`, so it does not appear in the Settings UI. The run
writes it to the profile's `settings.json`, and the extension forwards changes live with no new
analysis.

The run uses no test hooks:

- the policy comes from the setting;
- the selection, the Param Flow highlight, Focus, export and the views go through the UI;
- everything is read from the DOM, computed styles, and the webview debug log the product already
  keeps (selection, graph counts, analyses).

The fixture is `make-fixture.mjs`, copied from P15-Z0 (PR #52): 650 nodes and 1266 relations at
depth 3. Every group is expanded through its header.

```
npm run build:all
set VSCODE_EXE=<path to Code.exe>
node e2e/dataflow-motion/run.mjs <new output folder>
node e2e/dataflow-motion/summarize.mjs <output folder>/result.json
```

## Checks

- Nothing set means legacy.
- Switching the policy needs no new analysis and leaves nodes, positions and edge IDs unchanged.
- Focused:
  - with nothing highlighted, or only a node selected, no edge animation runs (computed
    `animation-name`, not just the class);
  - dashes and arrows stay;
  - one Param Flow highlighted makes exactly that dataflow edge move, and clearing it stops it;
  - with Focus + Context on, no dimmed edge moves.
- Legacy: a selected node's flows and a highlighted flow move as before.
- The highlighted relation is the same edge under both policies.
- An SVG export under focused, with a relation highlighted, keeps dashed strokes and arrow markers.
  It runs in the default collapsed state, because exporting the fully expanded graph exceeds the
  memory guard (an export cost of its own; see P15-S1).

## Benchmark

| Condition | Policy | Selection |
|---|---|---|
| A | legacy | none |
| B | focused | none |
| C | focused | `main()`'s first Param Flow highlighted |
| D | legacy | the same flow highlighted |
| E | legacy | `main()` selected only |
| F | focused | `main()` selected only |

| View | Conditions | Repetitions |
|---|---|---|
| The fitted centre at zoom 0.6 | all | 5 |
| The fitted centre at zoom 0.15 | A, B, C, D | 3 |
| `main()` at zoom 0.6, where the highlighted flow is on screen | A, B, C, D | 3 |

Each repetition rotates the condition order. The view is reached with small wheel steps and an
exact drag. Each run has 2 s idle, a 5 s pan along an ellipse, and a wheel sweep. It records
rAF gaps (not display FPS), long tasks, drawn nodes, edges and DOM, running edge animations, and
the renderer working set. GPU time is not measured.

Memory: at least 2200 MiB free to start, stop below 800 MiB.

`R1_REPS` and `R1_REPS_LOW` set the repetitions.

## Release checks (P15-R2): `release.mjs`

`R2_PHASE` selects the phase. Each phase starts its own VS Code under the focused policy. The
harness may add a style to the page to pause an animation; it adds nothing to the product.

**`long`**: one highlighted dataflow edge at a time, from short to screen-crossing.
- On the P15-R1 fixture with every group expanded, dataflow path lengths are measured with
  `getTotalLength()` in a few overviews.
- Four edges are picked: about the 5th percentile, the median, the 90th percentile, and the
  longest.
- For each edge, the harness finds the Inspector Param Flow row of its source node that highlights
  it.
- Each condition is measured at zoom 0.6, centred on the edge, with 2 s idle and a 5 s pan:

  | Condition | State |
  |---|---|
  | A | nothing highlighted (static dashes) |
  | B | that relation highlighted (it runs) |
  | C | that relation highlighted, with the animation paused by a style on the page |

  Repetitions rotate the order. Each run checks the running count and the running edge's ID.

**`trace`**: a trace on `e2e/aggregate-inspector/fixture/src/app/a.ts`.
- At a dataflow step, exactly one dataflow edge runs, and both its drawn ends (aggregate keys and
  class members resolved to their card) are the nodes highlighted for the flow.
- At any other step, nothing runs.
- After the trace ends, the graph is back and nothing runs.

**`runtime`**: a small JS program with a `debugger` statement, started with F5.
- Runtime Debug marks the paused frame's node; it sets no relation highlight.
- Under focused nothing runs while paused or after Shift+F5.
- Under legacy, flows run as before.

```
set R2_PHASE=long
node e2e/dataflow-motion/release.mjs <new output folder>
```

## Safe motion (P15-R3): more `release.mjs` phases

The policies `safe` (no dash motion, the highlight kept) and `safe-marker` (as safe, plus one
compositor-only dot moving along the highlighted relation) are opt-in values of the same setting.

**`safe`:** the four `long` edges.
- Each edge stays highlighted while the policy changes live:

  | Condition | Policy | Highlight |
  |---|---|---|
  | A | focused | that relation |
  | B | safe | that relation |
  | C | safe-marker | that relation |
  | D (control) | safe | nothing highlighted |

- Each run records the running animations, markers and React commits. The harness counts commits
  by wrapping the root's `current` field.
- Checks:
  - the highlight's color, width, dashes and arrow;
  - the path right across each switch;
  - no re-analysis or remount;
  - at most one marker;
  - that every pan moved the view;
  - no commit while idle.

**`trace`:** the trace runs under focused, then safe, then safe-marker.
- Every step must show the same edge styles and labels as under focused.
- No dash moves.
- Under safe-marker, one marker exactly where focused moved an edge.

**`runtime`:** safe and safe-marker sessions: the same node is marked, and nothing moves.

**`export`:** SVG and JPG with a relation highlighted under safe and safe-marker. The SVG keeps
dashes, arrows and the highlight color, and does not contain the marker.

**`probe`:** checks that the pan moves the view and that the commit counter sees commits.

**The pan:** it starts on empty pane and is sized to the pane. The earlier start point, used by
P15-R2 and `run.mjs`, lay outside the 515 px wide pane, on the Inspector, and did not pan. See
`docs/thesis-experiments/p15-semantic-zoom/r3`.
