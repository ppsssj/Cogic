# P11 run-policy changes (affects comparability; cited in limitations/methodology)

## 2026-11-23 — memory policy relaxed (user decision)
- Start gate lowered from 1,500 MB to 1,000 MB available (run-p11.cjs, run-corr.cjs, run-p11-ui.ps1).
- Claude Code's background-shell memory reaper to be disabled for the P11 session only
  (CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1, set in the launching shell; requires a Claude Code restart).
  OS memory management and the Windows page file are unchanged.
- UI runs now sample available memory, committed bytes and paging every ~2 s (<runId>.mem.csv). Pre-registered:
  abort if available < 300 MB or commit > 95 % of the commit limit for 30 s; pressure flag if minimum available
  < 500 MB or a 10 s mean of Pages Input/sec > 500. Flagged runs are kept, excluded from statistics and re-measured once.
- Already-completed blocks/runs measured under the old 1,500 MB gate are kept:
  - analyzer benchmark: all 225 blocks (p11-hono/excalidraw/vite/typeorm/query) and p11-corr — gate 1,500 MB;
  - UI: p11ui-hono-fixed800-r0 and p11ui-hono-adaptive-r0 — gate 1,500 MB, measured before run-time memory
    monitoring existed (no mem.csv; pressure state not observed).
- p11ui-hono-off-r0-20261123-043132 was interrupted by the reaper and is invalid (see its .INCOMPLETE.txt).

## 2026-11-23 — pressure rule refined after the first monitored hono runs (decided after seeing data; reported as such)
- Observation: the run-level rule flagged 6 of 7 monitored hono runs. In 5 of them the paging (Pages Input/sec up to
  68,302) and the available-memory minimum occurred during VS Code launch/prepare and the untimed Root-clearing wait;
  Pages Input/sec also counts mapped executable/DLL and file reads, so it does not isolate RAM shortage.
- Refinement (same thresholds, tools/step-pressure.cjs, per run <runId>.pressure.json):
  - RAM pressure = available < 500 MB during a timed step (generate-*, edit-*, switch-*) -> run excluded, re-measured once.
  - Paging flag = Pages Input/sec > 500 during a timed step -> run kept and marked; results are also reported without
    paging-flagged runs (sensitivity analysis).
- hono result: RAM pressure only in off-r0 (generate-0..2, minimum 340 MB; first Generate 22.7 s vs ~3.0 s) -> re-measured.
  Paging flag: adaptive-r2 (switch-0..2), fixed800-r2 (switch-1), off-r1 (generate-5), off-r0.
