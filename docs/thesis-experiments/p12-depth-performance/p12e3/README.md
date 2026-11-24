# P12-E3 Interaction Bottleneck Isolation

This draft depends on unmerged P12-E2 PR #36, itself based on P12-C2 PR #34. Baseline product source is `4b272bc`; no P12-E1 candidate or product optimization is included. See [results](results.md), [method and reproduction](measurement-method.md), and the per-run raw directories. The Vite profiler run hit the memory guard and the no-TypeScript-server control failed graph equivalence; neither is a valid A/B result. The small fixture validates the tools, not a Vite optimization.
