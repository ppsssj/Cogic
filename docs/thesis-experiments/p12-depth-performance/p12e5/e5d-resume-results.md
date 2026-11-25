# E5D resume: resource recovery and validation

## Memory recovery and safe actions

At turn start Windows reported 2,179,248 KiB (~2128 MiB) free, below the required 2200 MiB test preflight. The largest user processes included Chrome's active conversation (main PID 10384; renderer PID 20232), background Notion PID 26084 and Edge PID 13432; security, remote access and Codex were also active. The only separate development server identified was a SpatialFlex Vite preview (Node PID 13436, 9 MiB; parent CMD 17716 and pnpm 23136). It had no attachable console, so it was not forcibly stopped. `CloseMainWindow()` was attempted for Notion 26084 and Edge 13432; both returned false because no main window was available. No user application or process was terminated. The Windows computer-use helper's native pipe was unavailable after retry and reset, so hidden app windows could not be assessed. Codex, current conversation, remote access, and Windows/security services were protected. [Action and before/after record](e5d-resume-memory.json).

A later check immediately before the normal-close attempts recorded 1978 MiB, and 1968.6 MiB afterward; the difference is normal system variation, not memory gained by the attempts. Following the Node-only test run, physical free memory sampled about 2155 MiB, but launching the E5D Playwright preflight itself measured **1834 MiB**, so it stopped before VS Code launch ([attempt log](e5d-single-on-resume-1/harness.log)). The 2200 MiB preflight and 800 MiB stop threshold were not lowered. No repeated identical attempt or Multi run was performed. Single ON/OFF 5? live observations remain **unverified**.

## Validation completed without launching VS Code

- `npm run build:all`, `npm run compile`, and `npm run lint:all` passed.
- Direct Node/Mocha run of all compiled test files except `extension.test.js` passed **89 tests**. The excluded file requires VS Code's `vscode` API. This is **not** `npm test` and does not establish 90 tests passing; [run summary](e5d-resume-node-tests.json). Memory was manually sampled during the run; the smallest recorded sample was 1,038,796 KiB, not a continuously monitored minimum.
- E5D interaction gate: **8 checks**; E5C state gate: 4 checks; manifest gate: 4 checks; E5D geometry helper: 4 checks passed. The E5D gate now also rejects differing measured node positions/dimensions and excessive per-waypoint timing divergence, in addition to graph/state/viewport and pan-path mismatches. These are offline tests against manipulated recorded data, not a live validation of the E5D Playwright harness.
- `playwright test ... --list` loaded the current E5D spec and found one test; it did not launch VS Code or execute the interaction.
- The most recent actual `npm test` attempt was in the preceding turn and was interrupted below 800 MiB; it has not been rerun to completion. Prior E5C's 90 passing tests do not establish this turn's full test result.

## Re-expansion and Fit evidence

Reinspection of the retained E5C ON and OFF debug entries shows the same ordering in each: event 37 selected the `alpha/a.ts` file group, event 41 recorded the topology contraction from 67 to 6, and event 42 recorded `canvas.node.click` for the parent `alpha` folder. The intended file-header re-expansion click cannot be proven from that record. The old tests did not capture actual click-time `elementFromPoint` or trusted event target, so stale layout/viewport, hit-test timing, virtualized DOM removal and a model-state defect are not conclusively separable. [Extracted raw events](e5d-resume-reexpand-events.json). No product bug is asserted.

The E5D geometry conclusion is unchanged: for the recorded 581 px pane and 20,592-unit width, containment requires zoom ?0.028215 without padding, below the 0.1 product minimum. The historical animation completion is still not directly observed. Full methods, E5D separation of Fit correctness from interaction validity, invalid samples, and reproducible run commands are in [E5D results](e5d-results.md).

## Remaining work

On a host with sufficient free RAM, first rerun `npm test` under the memory guard; then run the clean isolated E5D Single ON/OFF crossover with the required hash and manifest comparison, five valid independent runs per arm. Classify Fit separately, require actual target and state restoration, and only after the Single comparison passes attempt Multiple. None of the new performance, live click-routing, Multiple or full-test completion goals is claimed. No product code, GraphPayload, memory thresholds, merge or release was changed.
