# Results

**Update:** the initial abort below was followed by completed Vite runs; see [resumed results](resumed-results.md). This page preserves the original attempt.

## Vite Depth 2: incomplete

| Metric | Result |
| --- | --- |
| End-to-end Generate completion | N/A: manual Generate was never reached; Depth-change preparation was aborted. |
| TypeScript analysis / Depth | N/A: `depth.begin` exists, no `depth.end`. |
| Program creation count and time | No completed `analyzer.program.created` event; not evidence that creation never started. |
| Workspace / cache lookup | 692.22 ms / 4.44 ms MISS, 1,654 files, one preparation request. |
| Payload generation, transfer | N/A: no payload/post. |
| Webview processing, node/edge conversion, Canvas commit | N/A: no received graph. |
| Memory | 2,278 MiB available before launch; guard sampled 768 MiB during the run. WMI's slower independent lowest sample was 1,011,212 KiB. Extension-host parent inferred from TypeScript-server children sampled at most 301 MiB; largest renderer 637 MiB; largest TS server 302 MiB. Working sets are per-process maxima from 3-second samples, not peak RSS or isolated webview RSS. |
| Graph counts, hash, root, interactions | N/A: no completed graph. |

Preparation request `web-9356c655-3521-4d13-a139-43e89be6a09a` ran with cache ON. `request.suppressed` recorded selection-pending activation. No post, Depth completion or cancellation event was recorded before the guard closed the test VS Code. The following runner interruption was cleanup, not a pass. It is not a cold Generate or a Vite completion. No warm, cache OFF, repeated samples, median, variance or Vite graph comparison exists.

## Small fixture: collection smoke only

P14 cross-file fixture, cache ON. Depth-change request `web-7de45937-c29e-4182-944e-2b2c53eff3f5` missed cache and completed Depth in 1,694.76 ms. The subsequent Generate `web-523b1618-e36c-43bc-9cb3-d2f3eab90308` was a cache HIT. The harness measured 315.95 ms from initiating its Playwright click to observing the forwarded two-frame event; this includes input/polling and is not physical paint or interaction-ready time. Its payload had 10 nodes / 11 edges, normalized SHA-256 `56f6e1fea2c0579ace421c4c358e3fd3b2ae491ce37fad5a13918ec1b38b6af2`, matching the same fixture baseline. Inspector displayed Dataflow relationships. For this Generate, host payload preparation was 0.056 ms; result handler preparation 0.20 ms; Canvas reported node conversion/layout 0.30 ms and edge conversion 0.20 ms, 5 flow nodes / 9 flow edges and 5 observed DOM nodes. These are one fixture run, not Vite performance. The smoke did not separately assert pan, zoom, node selection, folder expansion or Fit Graph. Minimum sampled free memory was 584 MiB; initial fixture guard was 500 MiB.

## Conclusion

**VERIFIED:** Vite hit the memory protection condition before completing preparation. The small-fixture collection path reached result, Canvas commit and two frame callbacks. **INFERRED:** available memory was insufficient for a safe comparable run under this setup; the precise allocation source and causality are not isolated. **UNVERIFIED:** whether Vite analysis, transfer, React conversion, rendering or any particular component is the dominant bottleneck; physical paint, interaction readiness, Vite graph correctness, cache comparisons and repeated distributions.

Do not choose a P12-E performance optimization from this incomplete run. First repeat on a larger-memory machine with the same pinned project and a validated cold/warm setup; then rank stages using complete request-correlated evidence. No claim is made that memory alone explains historical P13 timings.
