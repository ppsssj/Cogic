# P15-Z0A: dataflow edge animation cost isolation

The experiment is on branch `experiment/dataflow-animation-isolation`, stacked on the P15-Z0
branch (PR #52). How to run it: see `e2e/dataflow-animation/README.md`.

**Raw records:**
- `bench1-result.json`: 96 runs, with every rAF gap and the edge state of each run;
- `bench1-summary.txt`: the summary.

## Question

In P15-Z0, at zoom 0.6 with no selection, the canvas idled at p50 29.7 ms and panned at p50
37 ms. With a node selected, both were near the rAF floor. Is the animated dataflow edge the
cause?

## Conditions (same graph, nodes, edges, viewport and semantic mode)

| Condition | Selection | Edges | Animated class / running animations | Dashed dataflow edges |
|---|---|---|---|---|
| A | none | as shipped | 32 / 32 | 32 of 32 |
| B | none | dash animation stopped | 32 / 0 | 32 of 32 |
| C | none | stopped and solid | 32 / 0 | 0 of 32 |
| D | `main()` | as shipped | 8 / 8 | 32 of 32 |

These are the counts at zoom 0.6, read from the DOM and the computed styles in every run.

**Correctness (8/8):**
- A, B, C and D draw the same node IDs at the same positions and the same edge IDs. D's
  selection only adds the selected class.
- Each condition shows the intended edge state.

The style is two classes on the canvas container: no React render, and React Flow's `animated`
flag is unchanged.

## Results

The floor of rAF gaps was 8.3 ms (120 Hz) in this run. Values are medians over repetitions, with
the p95 range across repetitions in brackets.

| Zoom | Measure | A | B | C | D |
|---|---|---|---|---|---|
| 0.6 (n = 5) | idle p50 / p95 | **37.2 / 41.8** | 8.3 / 8.4 | 8.3 / 8.4 | 9.5 / 16.8 |
| 0.6 | pan p50 / p95 | **41.6 / 41.8** (39.4-41.9) | 8.3 / 8.4 (8.4-10.2) | 8.3 / 8.4 (8.4-10.2) | 16.6 / 16.8 (16.8-19.9) |
| 0.6 | pan frames in 5 s | 319 | 634 | 633 | 397 |
| 0.6 | wheel zoom p95 | 41.8 (38.8-50) | 25.0 (20.2-27.7) | **16.8** (16.7-20.3) | 41.6 (29.5-41.7) |
| 0.6 | wheel zoom frames > 50 ms (sum of 5 runs) | 19 | 14 | **0** | 22 |
| 0.15 (n = 3) | idle p50 / p95 | 9.2 / 10.2 | 9.2 / 10.1 | 9.2 / 10.1 | 9.2 / 10.2 |
| 0.15 | pan p50 / p95 | 10.1 / 10.2 | 9.2 / 10.2 | 9.2 / 10.2 | 9.2 / 10.2 |
| 0.15 | wheel zoom p95 | 50.1 | 47.5 | **28.5** | 50.0 |

- **At zoom 0.15** every dataflow stroke is already solid (low-detail mode, 0/122 dashed). A has
  122 running animations.
- **Long tasks:** none in any run.
- **Render calls of Cogic components:** 0 during idle and pan in every condition. During the
  wheel sweep, 46 (0.6) or 15 (0.15) code-node renders in every condition: the same
  virtualization mounts, unrelated to the edge style.
- **Renderer working set:** A and D 555-668 MB, B and C 552-610 MB.
- **Minimum free memory:** 1195 MiB (guard 800 MiB).

## Findings

1. **The dash animation causes the idle and pan cost (verified by isolation).**
   - At 0.6, stopping only the animation (B) puts idle and pan at the floor. The graph, the
     dashes, the nodes and the DOM stay identical. Pan draws 634 frames in 5 s against A's 319.
   - Idle and pan are equally slow in A, so this is a continuous rendering cost, not
     input-handling cost.
2. **The cost scales with the number of visible animated dashed edges.** D's 8 animated edges
   still halve the frame rate (16.6 ms against 8.3 ms).
3. **Animated solid strokes are nearly free.** At 0.15 (low detail, solid strokes), 122 running
   animations cost about 1 ms of pan p50 (10.1 against 9.2 ms) and nothing idle. The animation
   moves the dash offset, so without dashes there is little to repaint (inferred from that
   mechanism).
4. **Dashes cost something during zoom.**
   - At 0.6, the wheel-zoom p95 drops from 41.8 ms (A) to 25.0 ms (B, dashes still drawn) to
     16.8 ms (C, solid), with no frames over 50 ms in C.
   - At 0.15, C's lower zoom p95 (28.5 ms against about 48-50 ms) is inferred to come from the
     sweep zooming above 0.25, where low detail ends and A and B draw dashes again while C does
     not.
5. **The earlier object-count explanation does not hold for this cost.** B and C have exactly
   A's nodes, edges and DOM.

## Verified, inferred, unverified

- **Verified:**
  - findings 1, 2 and 5;
  - the zoom-0.6 part of 4;
  - the numbers in the tables, on this fixture, this machine and a 120 Hz display.
- **Inferred:**
  - why animated solid strokes are cheap (finding 3);
  - the cause of C's lower zoom p95 at 0.15.
- **Unverified:**
  - GPU and raster time (no API);
  - other refresh rates or GPUs;
  - Vite or other real projects;
  - hover-only animation (not implemented here).

## Rendering policy options (comparison only; nothing is changed)

| Policy | Expected effect, from these data | Visual cost |
|---|---|---|
| Keep the default | A: about 37-42 ms frames, idle and pan, whenever about 30 or more animated dashed edges are in view and nothing is selected. A continuous cost, also for power use. | none |
| Animate only selected or hovered relations | Like D: the cost follows the number of animated edges in view (8 edges gave 16.6 ms frames). Free when none are highlighted. | Unselected flows stop moving; the highlight keeps its motion. |
| Static dashes everywhere | Like B: idle and pan at the floor; zoom p95 25 ms against 42 ms. | The flowing motion is gone. Direction stays visible through the arrowheads, and dataflow stays distinguishable from calls by its dash and color. |
| Performance mode (no animation, solid) | Like C: the cheapest, also for zoom. | Dataflow and calls are then told apart by color and lane only; the dash cue is lost. |

**Recommendation (not applied, needs approval):**
- Stop animating dataflow edges that are not highlighted. Keep their dashes static, which keeps
  the kind distinction, and keep motion for the selected or hovered relations.
- This removes the measured continuous cost in the no-selection state, which is Cogic's default
  state after a graph loads.
- A solid-stroke performance mode would further reduce the zoom cost, at the price of the dash
  cue.
