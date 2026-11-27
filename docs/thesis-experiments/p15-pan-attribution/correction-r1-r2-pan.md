# Correction: the pan measurements of P15-R1 and P15-R2

**Found in:** P15-R3 (PR #56, `docs/thesis-experiments/p15-semantic-zoom/r3`).

**The defect:** the harness pan pressed the mouse at `0.55 × pane width + 240`. In the harness window
the canvas pane is 515 px wide, so the press landed outside it, on the Inspector, and the view did not
move.
- Probe in P15-R3: 1 distinct viewport transform and 2 React commits in a 5 s "pan".
- A real pan shows 313 transforms and about 320 commits.

No record is deleted; this note reclassifies them.

## How to read the earlier records

| Record | Status | Use as evidence |
|---|---|---|
| Idle measurements (P15-Z0, Z0A, R1, R2) | valid | yes |
| Animation isolation (P15-Z0A): the cause established from idle runs | valid | yes |
| P15-R1 `run.mjs` "pan" | **real pan not confirmed**. The same start point is used; that it never moved is inferred, as no transform count was recorded | **no**: exclude from performance claims |
| P15-R2 `release.mjs` "pan" (PR #55 records) | **not a pan**: idle with mouse moves over the Inspector (confirmed with the same harness and layout in P15-R3) | **no** |
| P15-R3 `release.mjs` pan, and this study | **real pan, verified per run** (more than 100 distinct transforms; excursion and return checked) | yes |

**Consequences:**
- **P15-R2:** the pan columns of its tables repeat its idle result and add nothing. Its idle columns
  stand. "Idle equals pan" in P15-R2 is not evidence that the cost does not depend on input.
- **P15-R1:** the pan p50/p95 of its conditions are not pan numbers. Its idle conclusions stand.
- **Where a real pan was measured** (P15-R3): focused dash animation costs more during a real pan
  than idle. For example, the medium edge has pan p95 212 ms against idle 157 ms.

## Proposed way to apply this

The documents in PRs #54 and #55 are not edited here. The proposal is one of:

1. **Before they merge:** add a short "Correction" paragraph at the top of
   `docs/thesis-experiments/p15-semantic-zoom/r1/README.md` (#54) and `.../r2/README.md` (#55),
   linking to this note, and mark the pan columns "not a pan (see correction)". Numbers stay
   unchanged.
2. **Or after they merge:** merge this note with the study, and add the same one-line pointer in each
   README in a follow-up docs-only PR.

**In any case:**
- the R1 and R2 pan numbers should not be quoted as improvement evidence;
- the thesis text should quote pan figures from P15-R3 or P15-P0 only.
