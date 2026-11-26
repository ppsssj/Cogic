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
