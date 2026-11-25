# E5B: medium interaction benchmark

## Outcome and scope

The existing 201-node/398-edge single-file fixture and its original graph remain unchanged. A separate deterministic four-file nested-folder fixture produces 188 nodes, 360 edges, SHA-256 `09b3c6b2d578b41353645055476c967e4868c8354b7495708ea6ae7b998b33bc`; its generated files and cross-file calls are specified by [generate-multifile.cjs](generate-multifile.cjs). No Vite execution or product change was performed. VS Code 1.147.0, Windows 8GB, isolated TypeScript-language-feature-disabled profile, cache MISS, session ON; each fresh VS Code was launched and stopped sequentially. The original/alternate Vite graph hashes are preserved in [historical manifest](vite-historical-manifest.json).

The single-variable OFF build was reconstructed from pristine `4b272bc`. The [complete source diff](e5b-clean-off-source.diff) shows exactly one changed expression (`onlyRenderVisibleElements`), no product source change; both extension copies used the same TypeScript analyzer and manifest probe. The prior E3/E5 OFF copy had Unicode corruption in comments and a button label due to a PowerShell text rewrite. Its performance comparison is invalid; graph equality alone does not fix this. Its logs remain preserved. The first OFF pilot in this E5B investigation also used the corrupt copy and is excluded. No earlier PR was changed.

## Validity and observations

The new harness selects only in-pane elements which actually pass `document.elementFromPoint`; if unavailable it uses the real Fit and zoom-out buttons to reposition the viewport. Selection requires a click event and a changed Inspector section containing the selected node name. Each file and folder collapse/expand checks the title state of the **same group ID** before and after. Pan verifies a changing viewport, zoom verifies viewport change; Fit was clicked and its viewport recorded, but overall graph bounds were not asserted. A failed or unavailable phase marks the whole execution invalid and the runner returns failure; per-phase logs remain. This handles the old missing selection and offscreen expansion failure without silently treating them as pass.

Five independent ON and five OFF runs, executed in crossed order OFF/ON on even numbers and ON/OFF on odd numbers, have matching graph SHA and required recorded input manifests, no guard abort, and all eight stages valid. The first clean pilot runs used an earlier harness revision and are not included below. File and folder group title transitions succeeded in all ten. The captured DOM edge-group count for selection/file collapse/file expand/folder collapse/folder expand was **4/4/4/0/4** for each run, providing an observed hide/restore check for those rendered relationships, not a proof about all 360 logical edges. The test clicked the root `main.ts` file group (one node) and root `src` folder group (four files). Graph input equality and these UI observations do not verify full-edge semantics or expanded large-node group behavior.

| Run | Mode | Pan rAF P50/P95/P99 ms | Zoom rAF P50/P95/P99 ms | Click to Inspector DOM ms | Min free RAM MiB |
| --- | --- | --- | --- | ---: | ---: |
| e5b-multi-on-r2 | virtual-on | 8.3/8.5/8.6 | 8.3/8.5/8.5 | 8.0 | 1332 |
| e5b-multi-off-r2 | virtual-off | 8.3/8.5/8.6 | 8.3/8.5/8.6 | 11.8 | 1306 |
| e5b-multi-on-r3 | virtual-on | 8.3/8.5/8.6 | 8.3/8.5/8.5 | 8.1 | 1327 |
| e5b-multi-off-r3 | virtual-off | 8.3/8.5/8.6 | 8.3/8.5/8.5 | 11.5 | 1316 |
| e5b-multi-on-r4 | virtual-on | 8.3/8.5/8.6 | 8.3/8.5/8.5 | 8.6 | 1333 |
| e5b-multi-off-r4 | virtual-off | 8.3/8.5/8.6 | 8.3/8.5/8.5 | 8.8 | 1313 |
| e5b-multi-on-r5 | virtual-on | 8.3/8.5/8.6 | 8.3/8.5/8.5 | 8.9 | 1355 |
| e5b-multi-off-r5 | virtual-off | 8.3/8.5/8.6 | 8.3/8.5/8.5 | 8.4 | 1299 |
| e5b-multi-on-r6 | virtual-on | 8.3/8.5/8.6 | 8.3/8.4/8.6 | 8.6 | 1332 |
| e5b-multi-off-r6 | virtual-off | 8.3/8.5/8.6 | 8.3/8.5/8.5 | 8.2 | 1343 |

All frame interval percentiles for every phase/run are in [e5b-summary.json](e5b-summary.json); raw interaction, pipeline, per-process memory and manifest files are in each named directory. rAF intervals describe callback scheduling within the test phase (including deliberate waits), not physical frames, interaction settle time or INP. Input automation is sequential and only five samples per arm, unrandomized crossover order, with limited rendered content: no meaningful conclusion about a virtualization performance advantage or large Vite graph is supported. During pan the observed DOM was only five nodes and four edges. File collapse windows' P95 median was 25.0 ms in each mode; folder collapse P95 medians 16.8 and 16.9 ms. These windows include waits and are not collapse latency.

## Selection decomposition

A separate test-only React profiling run on the same 188/360 graph observed click to Inspector DOM mutation **11.6 ms**, one node conversion **0.7 ms**, one edge conversion **2.5 ms**, first ReactFlow Profiler actualDuration **0.9 ms**, and first Inspector actualDuration **2.7 ms**. More commits occurred; scopes overlap and are not additive. Handler began 1.0 ms after captured click and returned 0.1 ms later; the selected-IDs effect was after commit and is not the state-set time. This one observation is not comparable to the uninstrumented five-run samples or the Vite graph; React profiling overhead was not isolated, and DOM mutation is not physical display. [Raw profiling](e5b-multi-react-1/interaction.json).

## Constraints and reproduction

The 800 MiB / 250 ms memory guard and 2200 MiB preflight were unchanged. Across the ten accepted samples, minimum observed available RAM ranged from 1299 to 1355 MiB. Renderer role inference and 3 s process samples are recorded but do not identify Webview RSS or its true maximum precisely. Complete expanded 60-node file interaction, Fit full-bound correctness, animation/edge count isolation, overhead-controlled React profiling, and Vite remain unverified. The user-requested 201-node fixture is retained but no new valid full ON/OFF E5B series was obtained for it.

Generate the fixture into a new directory, prepare clean isolated ON/OFF builds as described in [E5 reproduction](reproduction.md) and the [clean source diff](e5b-clean-off-source.diff). Set root `src/main.ts`, picker `main.ts`, the SHA above, and use [run-e5b-pair.ps1](run-e5b-pair.ps1); it requires the ON pilot manifest for comparison and changes arm order by run parity. [run-e5b.ps1](run-e5b.ps1) and [p13-p12e5b.spec.ts](p13-p12e5b.spec.ts) record each stage and failures. Use `node summarize-e5b.cjs <run-dir>...` after checking each exit code. Reproducible manifests record only selected dependency inputs; see E5 limitations before interpreting equality. Any unexpected graph, failed phase, missing manifest, or memory abort invalidates the run.

No optimization was adopted. A larger-memory Vite experiment with expanded groups, all input/declaration bytes controlled, and separately measured rendering costs remains the next step.

Final checks: `npm run build:all` passed; `npm test` passed 90 tests including lint; `git diff --check` passed.
