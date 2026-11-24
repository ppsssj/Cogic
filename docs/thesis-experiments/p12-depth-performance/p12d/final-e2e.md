# P12-D final E2E investigation

## Method and restoration

The resumed work preserved the uncommitted pending-selection policy and the `prepare-race.cjs`, `run-race.ps1`, and Playwright harness. Tests ran sequentially on Windows with 8 GB RAM, VS Code archive 1.147.0, fresh isolated profiles and the P14 cross-file fixture. Delay/failure gates are injected into a **disposable compiled extension copy**, not product code. The open test holds completion of an already-started `openTextDocument` call; the show test holds the activation callback after `showTextDocument` has returned, while the serialized selection remains in progress. The replay test redispatches a previously observed real `analysisResult` to the actual Webview message handler: it is a controlled synthetic delivery, not a naturally delayed VS Code message.

## VERIFIED — real VS Code observations

| Scenario | Evidence and observation |
| --- | --- |
| A open delayed, then B | [open-3](e2e-open-3.txt): A `web-ae57305b-c7d1-413a-8bcd-7ffe1919dfcc`, B `web-482d490c-a905-4c99-81d9-5ad76ed7777d`; B displayed `target.ts` as root, active file and graph; A had zero Program events and no result post. |
| A show delayed, then B | [show-3](e2e-show-3.txt): A `web-2987317b-ceb3-43b6-b210-bd518d0353e4`, B `web-7c8f3e0f-8926-4370-97a1-e49dd4eb7b7c`; final root/Inspector/graph were `target.ts`; A had zero Program events and no result post. |
| A Depth analysis held, then B Generate | [analysis-generate-1](e2e-analysis-generate-1.txt): A `web-6d75ef86-808a-41fe-b7f7-64bf5e0f04fa` cancelled after one Program; B `web-a99a29a8-ddd0-40ae-8594-7ebc08570a38` completed and loading cleared. [analysis-3](e2e-analysis-3.txt) also covers switching to `target.ts`. |
| B fails after A | [failure-5](e2e-failure-5.txt): A `web-84a4109f-c09a-448d-9a8e-fdeb3158d52d` cancelled after one Program; B `web-9ef3cde4-ba10-4f69-85d9-7905c45d4e9f` failed, error remained visible, loading cleared, and a redispatched older result did not apply. |
| Older result delivered during B | [replay-2](e2e-replay-2.txt): prior `web-dee4432e-4b2c-4452-89bb-7fa755fdfa6e` was redispatched while B was gated; B's loading remained, then `target.ts` was displayed. |
| Debug start/stop | [debug-9](e2e-debug-9.txt): VS Code reported an active debug session; Webview Runtime Debug reported `running` then `inactive`; A `web-d75f5d3d-a4c8-4e4b-a988-5134a1792431` was cancelled without result post and loading cleared; after stopping debug, `web-92443391-5f9e-4c1b-9643-4fa3a7790aeb` completed and Inspector recovered. No paused frame/variable comparison was performed. |
| Depth, repeated Generate, edit and save | [interactions-5](e2e-interactions-5.txt): Depth 0→1→2, two Generates and latest result succeeded. Editing added `p12dUpdatedValue` to the graph before saving; separate automatic analyses followed edit and save (counts 0→1→2). The test uses a disposable fixture copy. |
| Expansion | [expand-1](e2e-expand-1.txt) verified a normal merge increased graph nodes; [expand-cancel-1](e2e-expand-cancel-1.txt) verified no stale expansion post; [expand-pending-1](e2e-expand-pending-1.txt) held both requests and confirmed cancelled Expansion did not clear Active loading. |
| Trace cancellation | [trace-1](e2e-trace-1.txt): pending Trace `web-0a8264fe-be8f-4cc1-85f8-93f560da11c3` was cancelled on exit without posting; subsequent normal Generate completed. |
| Late activation | [late-activation-3](e2e-late-activation-3.txt) reproduced a redundant auto request after leaving and returning to `main.ts`; [late-activation-6](e2e-late-activation-6.txt) observed the real editor activations and no extra auto request. The matching `request.suppressed` event states `unchanged-delivered-result`. The final build passed with both [cache disabled](e2e-late-off-1.txt) and [cache enabled](e2e-late-on-1.txt), with auto requests remaining at zero. |

JSONL files with the same `e2e-<run>` prefix contain raw request IDs and events. The cache-enabled Expansion run observed both HIT and MISS; analysis/failure tests deliberately disabled cache. P12-C `request.begin`, `request.cancelled`, `request.suppressed`, `depth.end`, and `postMessage.call` were observed. No `request.dropped` was observed in these selected runs; cooperative cancellation occurred earlier.

## Change and graph equivalence

Pending-selection activation suppression is restricted to the selected or currently programmatically shown file, so a different editor activation and change/save events are not blanket-suppressed. For a late activation after completion, an analysis is skipped only when the last successfully delivered result matches file, language, content hash, Depth, Trace settings, cache invalidation epoch and Graph Root epoch, regardless of the cache setting. Cache invalidation and Root changes invalidate the match; edits/saves and explicit Generate remain scheduled. This is request deduplication, not a new Program cache.

Completed VS Code Depth 2 GraphPayloads for the same fixture and cache-disabled condition were compared against merged main `381d822` and the P12-D build. Both had 10 nodes, 11 edges and normalized SHA-256 `56f6e1fea2c0579ace421c4c358e3fd3b2ae491ce37fad5a13918ec1b38b6af2`; the normalized JSON files [baseline](ui-graph-baseline-graph.json) and [P12-D](ui-graph-current-final-graph.json) match byte for byte. The P12-D snapshot preceded the final extraction of the unchanged fingerprint serializer into a helper its defensive editor-read error handling, and making activation deduplication independent of the result-cache setting; graph construction was unchanged. Cancelled work is excluded from equality comparison. Trace-event and paused Runtime Debug payload equality with baseline was not measured.

## Environment incidents and remaining limits

The initially restored debug test used an incorrect `.debug-toolbar` selector; the accessibility tree showed an active session and the test was corrected to the accessible Run and Debug tab. Debug attempts 3–6 hit the preflight or 400 MiB guard; their logs are preserved. One later failure test sampled 36 MiB and was interrupted during shutdown; it is **not counted as a pass**. The harness was corrected to fail when the guard fires, and [failure-5](e2e-failure-5.txt) passed after memory recovered. The successful final runs sampled minima between 842 MiB and 1,561 MiB (one-second sampling; launch is not sampled). No unrelated user processes were terminated.

**UNVERIFIED:** full Runtime Debug paused-frame/variable behavior, Trace and Runtime Debug payload equality against the baseline, actual editor activation of a third file while another selection is pending, and large Vite D2. The tests cover selected controlled interleavings, not all VS Code scheduling possibilities. Two animation-frame callbacks are not a physical paint measurement. Keep PR Draft until the remaining important regressions are reviewed or explicitly accepted; P12-C2 Vite measurements need a suitable memory environment.

## Final local checks

After the final product change, `npm run build:all` passed and `npm test` passed all 90 tests (including compilation and both lint targets). `git diff --check` passed. The late-activation cache ON and OFF VS Code tests both passed against that build. The graph equivalence snapshot and the other E2E runs precede the final cache-setting guard removal; they are not represented as reruns of that final build.
