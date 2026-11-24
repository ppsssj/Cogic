# P12-E2: Graph interaction profiling

Two baseline Vite Depth 2 VS Code runs collected Pan, Zoom and node-selection observations with the baseline product build. A separate instrumented React profiling build was validated on a small fixture but Vite profiling runs stopped at the 800 MiB guard. Folder/file collapse, controlled edge-animation comparisons and full-graph Fit bounds were not measured on Vite. [Results and limits](results.md), [method](measurement-method.md), and raw logs are retained. No product graph or rendering code is modified.

This branch is based on unmerged P12-C2 PR #34 (`d3845a6`), not P12-E1 PR #35. The draft PR depends on #34.
