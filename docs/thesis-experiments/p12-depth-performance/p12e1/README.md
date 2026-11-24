# P12-E1: SourceFile reuse experiment

**Decision: do not adopt the candidate.** A disposable compiled-extension prototype removed a repeated path normalization without removing file `stat` or invalidation checks. In two instrumented VS Code samples per condition, depth was 11,631.7 / 11,246.9 ms for baseline and 11,409.3 / 12,157.7 ms for candidate. The candidate did not show a consistent overall improvement; two observations per group do not establish statistical significance. Product code is unchanged. See [results and safety limits](results.md).

This branch starts at PR #34 head `d3845a6473bdd7da750cf74b04ebb3c37dcf1723`; its Draft PR targets the P12-C2 branch while #34 remains unmerged. The prior experiment's artifacts remain intact.
