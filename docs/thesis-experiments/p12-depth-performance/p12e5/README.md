# P12-E5: reproducible interaction benchmark preparation

This draft depends on unmerged P12-E4 #38, which depends on #37, #36 and #34. It does not include the rejected P12-E1 #35 candidate or any product optimization. [Results](results.md), [reproduction and gating](reproduction.md), [historical Vite manifest](vite-historical-manifest.json), medium fixture manifests and raw logs are retained. The Vite historical manifest is explicitly incomplete; no new Vite run or Vite A/B is claimed.

[E5B follow-up](e5b-results.md) adds hit-tested selection and group lifecycle checks, a multi-file fixture, crossed repeated runs, and a correction for the original OFF build.

[E5C expanded-state follow-up](e5c-results.md) records exact React Flow/DOM counts, ten valid collapsed runs, and invalid expanded runs where Fit bounds fail.
