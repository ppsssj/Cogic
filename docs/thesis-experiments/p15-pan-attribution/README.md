# P15-P0: what a real pan's long frames are made of

Research branch `experiment/real-pan-attribution`, from `main` at `ba10e93`. It is independent of
PRs #54, #55 and #56. No optimization is implemented.

**The only product-side change:** a build-time switch for experiment F.
- With `VITE_COGIC_EXPERIMENT_RENDER_ALL=1`, React Flow's virtualization is off
  (`onlyRenderVisibleElements=false`).
- Normal builds leave the variable unset, so the switch is a constant `false`.

Harness: `e2e/pan-attribution/` (`run.mjs`, `summarize.mjs`, `analyze-trace.mjs`, `make-fixture.mjs`
copied from P15-Z0).

**Environment:**

| | |
|---|---|
| Machine | Windows 11 (10.0.26100), Intel i5-9400F, 8 GB |
| GPU | NVIDIA GeForce GT 710 (GPU compositing and GPU raster on) |
| Software | VS Code's Electron 43.8.9, Chrome 150 |
| Window | 1900 x 1040; the canvas pane is 515 x 860 px |
| rAF floor | 8.3 or 9.6 ms, depending on the session |

On main, all dataflow edges animate (legacy). A harness style stops every dash animation in every
condition: 0 running animations, checked.

## 1. The pan is real (gates)

**Session gates:** each session first runs one straight drag of (−120, +60) px. The view moves by
exactly that, within 1 px.

**Gates on every measured run:**
- the press lands on a point where `elementFromPoint` is `.react-flow__pane`;
- more than 100 distinct viewport transforms: 313 in every pan;
- the excursion equals the ellipse within 10% (256 × 280 px for a 128 × 140 ellipse);
- the view returns within 3 px;
- React Flow's store transform equals the DOM transform at the end, and it is sampled every 10th frame
  during the pan.

**Controls:** without a pan (A, B) exactly 1 transform. B moves the mouse along the same path with
no button and shows that input alone moves nothing.

**What the gates caught:**
- When no empty pane exists for a start, the view is skipped and never replaced by another
  coordinate. For example, 3 of 12 probe views on the large fixture were rejected this way.
- One `GlayersAll` run (removing the transforms of `.react-flow` and its renderer) moved the view
  481 × 697 px for the same path. That run is excluded.

Every other measured run passed every gate.

V0 is the view nearest the fitted graph's center that has an empty-pane start: 1030 flow px off
center on the large fixture. It holds 2 drawn nodes at the start, and the pan brings in 12 nodes
and 134 edges.

## 2. The React instrumentation

**What is counted:**
- **React commits:** a wrapper on the setter of `FiberRoot.current`, which React 19 assigns once per
  commit, installed per run and removed after it.
- **Cross-check:**
  - 5 s pans over empty views show 315 commits for 313 distinct transforms (one viewport commit per
    moved frame);
  - pans with mounts show 317-321.
  - The official React Profiler and DevTools were not used. The build is production, and a
    devtools hook cannot be injected into the webview before React loads (tried in P15-R3), so this
    cross-check is UNVERIFIED.
- **Which components render (condition W):** a walk of the fiber tree at each commit. It counts
  components rendered (a new fiber object whose alternate was in the last tree, with PerformedWork)
  and components mounted, by minified name and first host class.
- **Mounts and DOM changes:** a MutationObserver on `.react-flow__renderer` (React Flow node and edge
  elements, and DOM elements in total, added and removed).

**Overhead (large fixture, 3 runs each, medians):**

| | C (counter + observer) | C0 (rAF only) | W (+ fiber walk per commit) |
|---|---|---|---|
| p95 | 16.7 | 16.7 | 16.7 |
| frames > 50 / > 100 | 14 / 7 | 15 / 7 | 15 / 7 |

No overhead is visible at this resolution.

**What renders per pan commit (W):**
- **Re-renders, every commit:** React Flow's `EdgeRenderer`, `NodeRenderer`, `Viewport` and
  `Background`.
- **Mounts:** Cogic components are only mounted as they enter: per pan at V0, 12 node and 134 edge
  elements added and removed, about 600 DOM elements each way.
- **Not the same as remounts:** commits are not remounts. About 320 commits mount only 146 elements.

## 3. Results

### Large fixture

650 nodes (149 React Flow nodes) and 1266 relations at depth 3, every group expanded; zoom 0.6;
5 s pan.

`large2` (3 rotated repetitions; medians, ms):

| Condition | p95 | Max | Frames > 50 | Frames > 100 | Node+edge mounts |
|---|---|---|---|---|---|
| A static | 8.4 | 8.6 | 0 | 0 | 0 |
| B mouse only | 8.4 | 16.7 | 0 | 0 | 0 |
| C real pan (V0) | 16.7 | 242 | 14 | 7 | 292 |
| D few entering (P02) | 8.5 | 158 | 4 | 2 | 202 |
| E many entering (P12) | 8.5 | 300 | 4 | 3 | 248 |
| C0 C without instrumentation | 16.7 | 258 | 15 | 7 | - |
| Gnodes: nodes not painted | 16.8 | 250 | 16 | 7 | 292 |
| Gbg: background not painted | 25.0 | 242 | 12 | 4 | 292 |
| Gedges: edges not painted | **8.5** | **83** | 6 | **0** | 292 |
| GlayersAll: every layer hint removed (2 valid) | **150** | 158 | **312** | **147** | 292 |

**Probes:** 6 of the 9 usable probe views draw nothing and have no mount changes. They pan with
max 8.5-16.7 ms and 0 frames over 50 ms despite 315 commits. The 3 views with mount changes (202-282)
have 4-6 frames over 50 ms.

`large3`, the edges broken down (3 repetitions; this session's floor is 9.6 ms):

| Condition | p95 | Max | Frames > 50 | Frames > 100 |
|---|---|---|---|---|
| C | 19.5 | 248 | 13 | 7 |
| Gedges: edges not painted | 10.4 | 69 | 3 | **0** |
| Gdash: solid strokes instead of dashes | 27.7 | 99 | 8 | **0** |
| Garrows: no arrow markers | 19.4 | 211 | 13 | 7 |
| Gbadges: aggregate badges not painted | 19.2 | 240 | 13 | 7 |
| Gbackface: `translateZ(0)` kept, backface visible | 20.0 | 243 | 12 | 7 |
| Glayers: edges and nodes layers without `translateZ(0)` | **131** | 338 | 32 | **30** |

### Time association

A frame is "after a mount change at lag L" when frame i−L added or removed node or edge elements. The
table gives P(frame > 50 ms):

| | Lag 0 | Lag 1 | Lag 2 | Lag 3 | Lag 4 | Other frames |
|---|---|---|---|---|---|---|
| C (n = 51 mount frames) | 0.06 | 0.04 | 0.14 | **0.22** | 0.12 | 0.02 |
| D (n = 39) | 0 | 0 | 0.08 | **0.21** | 0.03 | 0.002-0.007 |
| E (n = 36) | 0 | 0 | 0.11 | **0.17** | 0.06 | 0.004-0.007 |
| Gedges | 0.04 | 0 | 0 | 0 | 0 | 0.01 |

- In C, 22 of 43 long frames come 1-4 frames after a mount change; in D and E, all of them do (2-4
  frames).
- With edges not painted, the remaining long frames are not tied to mounts (6-23 frames later).

### Virtualization ON/OFF (F)

Small fixture: 4 folders × 4 leaves × 4 functions, every group expanded, 3 repetitions per build. The
builds differ only in the switch, and each ran in its own session.

| Build | Drawn | Mounts per pan | p95 | Max | Frames > 50 | Frames > 100 | Renderer / GPU MB |
|---|---|---|---|---|---|---|---|
| ON (default) | 10 of 108 | 104 | 10.4 | 112 | 5 | 2 | 569 / 268 |
| OFF | 163 of 163 | 0 | 10.3 | 76 | 1 | **0** | 652 / 358 |

- Under ON, long frames again follow mounts at lag 2-3 (P 0.23 / 0.17 against 0.01).
- OFF has no mount changes and no frame over 100 ms, but costs about 80 MB of renderer and 90 MB of
  GPU memory on this small graph.
- The large expanded graph with everything drawn exceeded the memory guard before (P15-S1), so OFF
  was not run there.

### Chromium traces

One traced pan per condition. Electron `contentTracing`, inside the pan window (performance marks),
busy time as the union of event intervals:

| Trace | Window | Webview main | Compositor | GPU main | GPU raster (`DoRaster`) | GPU `Present` |
|---|---|---|---|---|---|---|
| C (large3) | 5806 | 1916 | 521 | 2943 | **1939** | 714 |
| Gedges | 5056 | 1963 | 526 | 1288 | **380** | 650 |
| Gdash | 5258 | 1943 | 504 | 2227 | **888** | 1055 |
| C (large2) | 6659 | 2246 | 616 | 3000 | 2012 | 674 |
| Gbg | 5950 | 1993 | 417 | 2618 | 1764 | 662 |
| GlayersAll | 36676 | 2005 | 514 | 36609 | **36337** | 51 |

- The webview main thread is the same in every trace: about 1.9-2.2 s in 5-6 s. React, script and
  paint recording do not change with the conditions.
- What changes is GPU-process raster. Edges not painted remove 80% of it, solid strokes 54%.
- Without the layer hints, the GPU re-rasterizes on every frame. The pan then takes 36.7 s, because
  input waits for frames (as P12-E5E found).

## 4. Hypotheses

| Hypothesis | Verdict |
|---|---|
| H1: virtualization (entering and leaving) triggers the cost | **VERIFIED as the trigger.** Long frames follow mount changes at lag 2-4 frames (about 10 to 100 times the base rate). Views with no mount changes are smooth. OFF on the small fixture removes the frames over 100 ms. |
| H2: React Flow state updates without virtualization changes | **Not the cause (VERIFIED).** About 315 commits per pan over empty views cost nothing. The main thread's busy time does not change across conditions, and only four React Flow components re-render per commit. |
| H3: paint, raster and compositing | **VERIFIED as the mechanism.** GPU-process raster of newly drawn edges, dashed strokes most. Hiding edges removes the frames over 100 ms and 80% of GPU raster; solid strokes remove the frames over 100 ms and 54%; arrows, badges, nodes and background change little or nothing. The `translateZ(0)` layers protect: without them every frame is re-rastered. |
| H4: input automation or instrumentation | **Not the cause (VERIFIED).** B (input without a pan) and A are at the floor; C0 equals C; W equals C. Playwright's input waits on stalled frames, which stretches the pan (as in P12-E5E), but does not create the stalls. |

**In short:** the pan itself is cheap. Each time virtualization mounts edges, the GPU (a GT 710 here)
must rasterize them, and dashed strokes cost about twice as much as solid ones. That raster burst
shows up 2-4 frames later as a 100-300 ms frame.

## 5. The smallest next fixes (not implemented, to be measured)

1. **Solid strokes while the view moves.** Cogic already draws solid strokes when zoomed out
   (`canvasFlow--lowDetailEdges`). Applying the same class during a pan, and restoring dashes when
   the view stops, removed all frames over 100 ms here (Gdash). It is a CSS class toggle on pan
   start and end, with no change to virtualization or to the graph.
   - It needs measuring with the class toggled on real pan events, not by a harness style.
   - Dashes would flicker to solid while panning; that needs a UX judgement.
2. **Fewer edge elements entering at once.** For example, a larger virtualization margin. This is
   INFERRED only and not measured; it trades memory, as F shows.
3. **Not recommended:** removing `translateZ(0)` (measured worse), and turning virtualization off on
   large graphs (memory).

## 6. Verified, inferred, unverified

- **Verified:**
  - the pan gates;
  - the instrumentation overhead (none visible);
  - the per-commit render set;
  - every table above;
  - the lag association;
  - the trace totals.

  All on one machine, GPU and fixture.
- **Inferred:**
  - that the GPU raster burst is what delays those frames: the traces give totals per pan, not a
    per-frame alignment;
  - that a pan-time solid-stroke class would give the Gdash result;
  - that a larger margin would help.
- **Unverified:**
  - GPU hardware time (Chromium tracing cannot see the queue);
  - other GPUs and refresh rates;
  - the official React Profiler;
  - Vite.

## 7. Reproduce

```
npm run build:all
set VSCODE_EXE=<path to Code.exe>
node e2e/pan-attribution/run.mjs <new folder>                       # large, all conditions, 3 reps
set PA_TRACE=1& set PA_CONDS=C,Gedges,Gdash& set PA_TRACED=C,Gedges,Gdash
node e2e/pan-attribution/run.mjs <new folder>
set PA_SHAPE=small& set PA_CONDS=A,B,C
node e2e/pan-attribution/run.mjs <new folder>                       # F: ON
set VITE_COGIC_EXPERIMENT_RENDER_ALL=1& npm run build:all            # F: OFF build, then the same run
node e2e/pan-attribution/summarize.mjs <folder>/result.json
node e2e/pan-attribution/analyze-trace.mjs <folder>/trace-C.json ...
```

**Records:**
- `large2`, `large3`, `small-on`, `small-off`: `result.json` with per-frame logs, and `summary.json`.
- `trace-analysis.jsonl`: the trace totals. The raw traces (75-99 MB each) are not committed.
- `large1-aborted-result.json`: the first attempt, which stopped at a probe view without a start.
- `smoke6`: the first small run.

**Note:** in `large2`, the condition named `Glayers` is what the harness now calls `GlayersAll`. The
definition was split after that run.
