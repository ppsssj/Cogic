# E5D Single / Multiple expanded A/B results

Continues [e5d-resume-results.md](e5d-resume-results.md), whose "unverified" live items this document supersedes. Product code and GraphPayload are unchanged (`git diff e0654a8` outside `docs` is empty). All numbers come from [e5d-aggregate.json](e5d-aggregate.json), produced by [aggregate-e5d.cjs](aggregate-e5d.cjs). Values are median [min..max] of per-run values. rAF intervals are callback intervals, **not display FPS**; "attach/detach" counts `.react-flow__node` DOM additions/removals, **not React mount/unmount**. A "gap" is an rAF interval > 50 ms. These are one machine (i5-9400F, GT 710, 8 GB), one synthetic fixture, n = 5-6 per arm.

## Status summary

| Claim | Status |
| --- | --- |
| Same graph, manifest fields, React Flow node/edge IDs, node layout, start viewport across arms | VERIFIED (gates; sha `09b3c6b2...` in every run) |
| Arms differ by one source line (`onlyRenderVisibleElements`) | VERIFIED (source diff; built extensions differ only in the Webview bundle and the index that names it) |
| ON has rAF gaps during pan, OFF (almost) none, at 125 ms pacing | VERIFIED, every run, Single and Multiple |
| In Multiple at 125 ms, ON does not keep up with the input schedule | VERIFIED, 6/6 runs (plus the earlier pilot) |
| At 500 ms pacing the pan difference nearly disappears | VERIFIED, 5/5 vs 5/5 |
| OFF costs more long tasks in selection/expand | VERIFIED for Multiple, partly for Single |
| The DOM churn itself causes the gaps | INFERRED; see "Bottleneck" |
| What executes in the gaps (JS, style, layout, raster, GPU) | UNVERIFIED |
| Vite full graph, other hardware, wheel/trackpad, user-perceived latency | UNVERIFIED |

## Memory, tests, harness

- Chrome was closed normally by the preceding agent with user approval: 1830.5 -> 3126.1 MiB ([record](e5d-approved-chrome-close.json)). Before the Multiple series, windowless background Notion (26084) and Edge (13432) did not exit on a normal request and were force-stopped by verified PID, with user approval: 2805.8 -> 3424.6 MiB ([record](e5d-multiple-memory-recovery.json)). The 2200/800 MiB limits are unchanged. No run in this document hit the guard; its lowest recorded free memory was 1059 MiB (a Multiple pilot before the cleanup).
- The preceding agent's `npm test` passed 90 ([memory record](e5d-approved-npm-memory.json); its console log exists only in that agent's session). Re-run on the final tree: `npm run build:all` passed ([log](e5d-final-build.log)) and `npm test` **90 passing** ([log](e5d-final-npm-test.log)); lowest free memory sampled 1645 MiB, with coarse process-spawn sampling, not the 250 ms guard.
- Gates: E5D 9, Fit 4, E5C 4, manifest 4 passed. One check was added: arms with a different pan step schedule are rejected.
- Click routing: the old `locator.click()` could scroll/shift the page. The harness now clicks at page coordinates, records the trusted event's group ID and button title, and only accepts a click on the intended group. In every functional run `alpha/a.ts` collapsed and re-expanded, the `alpha` folder was restored, and final node/edge IDs and group states equalled the start. The earlier wrong-target problem is VERIFIED fixed **in the harness**; no product defect was shown. In Multiple, `beta` was expanded by real clicks and stayed intact, but its collapse/re-expand was not exercised.
- Remaining harness weakness: `e5d-multiple-off-p125-r3` exhausted 16 attempts to bring the `alpha` folder header into view. No expand click was sent, so this is a target-search failure, not evidence about the product. It stays invalid; pair r6 was added as a declared supplement.

## Protocols and sample accounting

- **Single, 125 ms steps**: `pilot-6`(ON), `pilot-2`(OFF) and r2-r5 of each arm, one harness version. Re-verified 5 + 5 matched. Invalid/excluded: ON pilot-2 and pilot-5 (failed phases), and ON pilot-3/-4 + OFF pilot-1, which predate the warm-up and used an 80-step pan (pilot-4/OFF-1 failed the speed gate). Note that ON was already slower there (13.2 s vs 6.2 s); those pilots were replaced by a protocol with half as many pan steps and a warm-up. The Single result is therefore conditional on a pace ON can sustain.
- **Multiple, 125 ms steps**: 5 crossed pairs fixed in advance + the r6 supplement. ON 6/6 functionally valid, **0/6 matched** because the speed gate rejects them. OFF 5/6 functional and matched. A gate on achieved speed would discard the outcome being studied, so this series is reported as *input schedule not sustained*, **not** as a matched-speed comparison, and the gate was not relaxed. `e5d-multiple-on-pilot-1` (the run at which work was interrupted) had completed, functionally valid (pan 11.0 s); with `off-pilot-1` it is excluded as a pilot.
- **Multiple, 500 ms steps**: same path and step size, slower for both arms. Pace chosen after the 125 ms pilots and one ON pilot (`slow500-pilot-1`, excluded). 5/5 + 5/5 matched.
- The Single series ran with Notion/Edge in the background, the Multiple series without. Do not compare Single against Multiple quantitatively.

## Pan

| | Single 125 ON | Single 125 OFF | Multiple 125 ON (n=6) | Multiple 125 OFF (n=5) | Multiple 500 ON | Multiple 500 OFF |
| --- | --- | --- | --- | --- | --- | --- |
| P50 ms | 8.3 | 8.3 | 8.4 | 8.3 | 8.3 | 8.3 |
| P95 ms | 8.6 [8.5..16.6] | 8.5 | 304.5 [283.3..341.7] | 8.5 | 8.4 | 8.5 |
| P99 ms | 66.9 [58.3..108.5] | 8.5 [8.5..8.6] | 541.7 [400.0..558.2] | 16.5 [8.6..16.5] | 8.5 [8.5..8.6] | 8.5 |
| Max ms | 166.8 [158.4..208.3] | 8.7 [8.6..16.6] | 787.5 [658.3..991.6] | 16.7 [16.6..183.3] | 41.8 [24.9..66.7] | 24.9 [16.6..25.1] |
| rAF callbacks/s | 94.9 [87.5..97.5] | 120.0 | 17.6 [16.7..19.0] | 118.5 [114.7..119.1] | 118.9 [118.6..119.3] | 119.7 [119.5..119.7] |
| Gaps > 50 ms | 8 [8..12] | 0 | 29.5 [28..31] | 0 [0..1] | 0 [0..1] | 0 |
| Time inside gaps ms | 909 [792..1333] | 0 | 7746 [7476..8009] | 0 [0..183] | 0 [0..67] | 0 |
| Time to last input sample ms | 4926 | 4903 | 8603 [8378..8776] | 4903 | 19531 | 19527 |
| DOM nodes / edge groups at start | 21 / 38 | 67 / 122 | 41 / 76 | 130 / 242 | 41 / 76 | 130 / 242 |
| DOM attach / detach | 60 / 60 | 0 / 0 | 120 / 120 | 0 / 0 | 120 / 120 | 0 / 0 |
| Long tasks | 0 | 0 | 0 | 0 | 0 | 0 |

React Flow input is 67/122 (Single) and 130/242 (Multiple) in both arms. In both 125 ms series the ON and OFF ranges of P99, max, callbacks/s and gap time do not overlap. Percentiles hide rare gaps in the long 500 ms runs, so max and gap time are given too. ON never had a long task during pan: the gaps are not explained by main-thread tasks >= 50 ms.

Zoom shows the same direction: OFF has 0 gaps in all runs; ON has 2-4 gaps per run, gap time 275 ms (Single), 1071 ms (Multiple 125) and 458 ms (Multiple 500).

## Selection, groups, long tasks, memory

| | Single ON | Single OFF | Multiple 125 ON | Multiple 125 OFF | Multiple 500 ON | Multiple 500 OFF |
| --- | --- | --- | --- | --- | --- | --- |
| Click -> Inspector DOM ms | 21.4 [18.8..23.8] | 22.1 [18.3..23.1] | 23.5 [21.5..25.8] | 23.7 [23.6..26.8] | 22.6 [20.1..26.5] | 26.0 [23.3..28.5] |
| Runs with long task: selection | 0/5 | 0/5 | 0/6 | 5/5 | 0/5 | 5/5 |
| file-collapse | 0/5 | 3/5 | 2/6 | 2/5 | 0/5 | 2/5 |
| file-expand | 0/5 | 4/5 | 0/6 | 5/5 | 0/5 | 5/5 |
| folder-collapse | 0/5 | 0/5 | 0/6 | 3/5 | 0/5 | 3/5 |
| folder-expand | 0/5 | 0/5 | 0/6 | 5/5 | 0/5 | 5/5 |
| fit | 0/5 | 0/5 | 4/6 | 0/5 | 2/5 | 0/5 |
| Minimum free MiB | 1460 | 1489 | 1689 | 1630 | 1734 | 1696 |
| Peak renderer working set MiB | 694 | 707 | 731 | 750 | 727 | 743 |

- Virtualization helps here: OFF selection/collapse/expand long tasks are roughly 50-90 ms each in almost every Multiple run; ON has nearly none. It did not produce a reliable difference in click-to-Inspector time (ranges overlap).
- ON's `fit` long tasks are sporadic but up to 1021 ms (`on-p500-r5`); cause UNVERIFIED.
- Selected node was the same function ID in all runs. Memory ranges overlap: no memory benefit established (3 s sampling, whole process tree).
- Group phase durations, gaps and intervals include harness search panning/zooming (folder-expand in Multiple: about 7-10 s of gap time) and must not be read as product expand latency. Long tasks in those phases can also come from that panning. DOM counts at phase end depend on the viewport.
- Fit is `FIT_CLAMPED_BY_MIN_ZOOM` before and after in every functional run. E5C invalid samples are not reclassified.

## Bottleneck

INFERRED: virtualization trades a one-off cost (more DOM in selection/expand) for repeated subtree attach/detach during viewport movement; at 125 ms pacing the latter dominates. Evidence: the only code difference, attach/detach 60-120 vs 0, and gaps in ON only. Against a simple "each attach costs X" reading: 500 ms pacing had **the same 120/120 attach/detach with almost no gaps**, so cost is strongly pace dependent. Backlog, sub-50 ms task accumulation, or raster/GPU work (low-end GPU, Chrome Remote Desktop running) are unresolved hypotheses. Zero LoAF entries were recorded anywhere, including phases with long tasks, so LoAF absence is not evidence.

## Adoption

**No product change is adopted.** Turning virtualization off removes pan/zoom gaps on this fixture but adds selection/expand long tasks and scales DOM with graph size; at 188 logical nodes that says nothing about the Vite graph. The current default also should not be described as a pan optimization on this fixture.

Next single priority: record a Chromium performance trace (main, compositor, raster, GPU threads) of one ON and one OFF Multiple pan at 125 ms, to identify what occupies the gaps.

Reproduce: [run-e5d-pair.ps1](run-e5d-pair.ps1) (Single), [run-e5d-multiple.ps1](run-e5d-multiple.ps1) (Multiple), then `node aggregate-e5d.cjs`.
