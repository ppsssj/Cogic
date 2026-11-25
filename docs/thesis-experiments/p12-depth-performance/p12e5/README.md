# P12-E5: reproducible interaction benchmark preparation

This draft depends on unmerged P12-E4 #38, which depends on #37, #36 and #34. It does not include the rejected P12-E1 #35 candidate or any product optimization. [Results](results.md), [reproduction and gating](reproduction.md), [historical Vite manifest](vite-historical-manifest.json), medium fixture manifests and raw logs are retained. The Vite historical manifest is explicitly incomplete; no new Vite run or Vite A/B is claimed.

[E5B follow-up](e5b-results.md) adds hit-tested selection and group lifecycle checks, a multi-file fixture, crossed repeated runs, and a correction for the original OFF build.

[E5C expanded-state follow-up](e5c-results.md) records exact React Flow/DOM counts, ten valid collapsed runs, and invalid expanded runs where Fit bounds fail.

[E5D Fit and interaction-gate investigation](e5d-results.md) classifies the recorded Fit clamp and records why live expanded A/B remains unverified.

[E5D memory-recovery continuation](e5d-resume-results.md) records process safety checks, 89 Node-only tests, the preflight rejection and remaining live work.

[E5D Single/Multiple A/B results](e5d-ab-results.md) reports the completed live ON/OFF series; it supersedes the unverified live items above.

[E5E Chromium trace](e5e-trace-results.md) locates the ON pan stalls in GPU-process Present waits.

[E5F edge paint isolation](e5f-edge-isolation-results.md): hiding edges does not reduce the Present wait; corrects an E5E inference.

[E5G node isolation and layer mapping](e5g-node-isolation-results.md): layer 15 is the nodes container; the stall depends on its tile set, not on paint alone.

[E5H layer state and will-change isolation](e5h-layer-state-results.md): dropping `will-change` from the viewport chain or recreating the nodes layer removes the stall; closes the isolation series.
