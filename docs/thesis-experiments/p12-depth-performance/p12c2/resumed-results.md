# P12-C2 resumed results

## Conditions and scope

After [resource preparation](resource-cleanup.md), four sequential isolated VS Code 1.147.0 runs used Cogic main `66228e1`, the pinned Vite commit and V1 root, Depth 2, profiling ON and analysis cache ON. Each used a new extension host/profile; the first Depth-change request was a cache MISS. The subsequent explicit Generate was a cache HIT. Windows filesystem and TypeScript caches were not reset between runs; these are fresh-host measurements, not four independent disk-cold experiments. Each run was attempted once, with no simultaneous test VS Code instances. The first run after cleanup is R2; R1 was the previously aborted attempt.

## Depth 2 and rendering

| Run | Depth ms | Program count / sum ms | First Program ms | Webview request sent to two frames ms | Webview receive to Canvas commit ms | node/layout ms | edge conversion ms | Minimum available MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| R2 | 27,908.3 | 35 / 24,523.8 | 21,356.4 | 28,668.9 | 177.1 | 6.3 | 27.7 | 1,206 |
| R3 | 11,322.2 | 35 / 7,144.8 | 4,016.8 | 11,881.1 | 158.3 | 4.6 | 31.1 | 898 |
| R4 | 11,190.1 | 35 / 7,270.5 | 4,173.1 | 12,375.2 | 197.5 | 7.5 | 37.4 | 885 |
| R5 | 11,347.9 | 35 / 7,026.4 | 3,851.3 | 11,956.7 | 145.5 | 5.4 | 26.8 | 922 |

Depth median 11,335.1 ms, range 11,190.1?27,908.3 ms; request-to-two-frames median 12,165.95 ms, range 11,881.1?28,668.9 ms. Program sum is **contained within** Depth, not an additional duration. The first run's larger first Program time is observed; disk cache, system load and other causes were not isolated. Four consecutive runs do not establish a general distribution or an optimization effect.

For R2, host `workspace.ready` was 0.062 ms from its already prepared list (1,654 files), `cache.lookup` 4.195 ms MISS, and `payload.ready` 0.169 ms. Host `postMessage.call` to the host receiving the forwarded Webview result diagnostic was 86.6 ms: this includes the return diagnostic and is an upper-bound observation, not a one-way transfer or serialization time. The Webview handler's `result.prepare` reported 0.4 ms. R2's receive-to-Canvas commit was 177.1 ms, followed by 208.1 ms until two animation-frame callbacks. The callback pair does not prove physical paint or interaction readiness. Node conversion includes application layout; `filterGraph`, React Flow internal reconciliation and browser paint are not separately timed.

R2 request ID `web-c740ac6b-1b1f-426e-9308-51badf90a903`; [raw pipeline](vite-r2.jsonl), [memory](vite-r2-memory.jsonl), [harness](vite-r2-harness.txt). R3?R5 raw logs are adjacent. Each request observed 1,078 GraphPayload nodes / 3,755 edges, while Canvas reported 106 React Flow nodes / 1,627 edges; the R2 two-frame DOM observation counted 17 nodes. These are different layers, not a lost-edge calculation.

Warm Generate observations from initiating the Playwright click through observing the forwarded two-frame event were 1,374.4 / 1,266.7 / 1,373.2 / 1,318.9 ms (R2?R5), including automation and polling. They are cache HITs, not full analysis. No profiling-OFF or cache-OFF comparison was performed.

## Graph and interaction evidence

All four first requests and their warm Generate results produced normalized graph SHA-256 `baf0b1c591a5ad4af4f0fb5c1a947b3124d220acd1fded6e50d00e6ee9117049`; [normalized graph](vite-graph.normalized.json). Same-run first/warm and cross-run hashes match under this harness's normalization. The P12-B Vite counts are also 1,078 / 3,755, but P12-B uses a different normalization and source payload context, so equality with its historical hash is **not verified** from counts alone.

R4 recorded Zoom transform changing from scale 0.1 to 0.141421, node click and Fit Graph click, but Pan did not change because the selected start point was obstructed; its combined assertion failed. R5 selected a verified blank pane and Pan changed translate `(184,-1279)` to `(264,-1224)`, selected a code node, and Inspector showed its function, calls and Dataflow mappings; Zoom did not change at the subsequent coordinate and the combined assertion failed. [R4](vite-r4-interactions.json), [R5](vite-r5-interactions.json), and the failed harness logs are preserved. These are individual UI observations across different runs, **not a single passing combined interaction smoke**. The final change to the wheel coordinate is unverified. Folder expansion and a quantitative interaction latency test were not performed.

## Memory and interpretation

The 250 ms guard sampled minima above; R4's 885 MiB was the lowest recorded and no guard fired. Three-second process samples across these runs observed at most 670.7 MiB for the process inferred to be the Extension Host, 756.2 MiB for an individual renderer, and 333.1 MiB for an individual TypeScript server. Renderer processes were not reliably attributable to Webview versus workbench, these are working-set samples rather than exact peak RSS, and maxima across roles need not be simultaneous. R2's host `payload.ready` reported RSS 673,918,976 bytes as a point snapshot. Samples and guard are not continuous.

**VERIFIED:** in these completed runs, host Depth and in particular Program creation account for far more observed time than Webview receive-to-commit or the measured node/edge conversions. **INFERRED:** investigating first `createProgram` startup and file-system/cache conditions is the strongest next P12-E profiling priority; the high first run alone does not establish why it was slower, or justify a specific cache or implementation change. **UNVERIFIED:** physical paint, precise one-way transport, full historical graph equivalence, cache-OFF behavior, profiling overhead, and a single all-pass interaction smoke. The historical P13 automation duration is not directly comparable.

Final local checks after the resumed work: `npm run build:all`, `npm test` (90 passing, including compile and lint), and `git diff --check` passed. No product code was changed.
