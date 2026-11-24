# P12-D final decision evidence (d5ee28b)

VS Code 1.147.0 on Windows, 8 GB RAM, sequential isolated extension/profile runs. Product code was not changed in this follow-up. All gates are injected into a disposable compiled extension. A one-second memory monitor stops a run below 400 MiB; launch is not sampled. Previous raw evidence is preserved. Twenty unreferenced `final-*` log files were removed only after byte-for-byte comparison with their retained `e2e-*` counterparts; distinct runs and failures remain.

## Third-file race

The disposable fixture copies the P14 files and adds `src/third.ts` containing `export function thirdMarker() { return 3; }`. The host test gate holds B (`target.ts`) before document opening, then opens C (`third.ts`) in the editor column with `showTextDocument`, which triggers an actual VS Code activation. This is a controlled test-only trigger, not a physical user click. After the activation and while B is pending, B remains loading; releasing the gate shows B root, B active file, Inspector and B graph. [Run 4](final-third-4.txt) passed, with request `web-4248cfc3-a7e0-49cc-a498-692afa1954a1`, zero automatic requests while held and zero afterward in this run. [Activation events](final-third-4-activations.jsonl) and [pipeline events](final-third-4.jsonl) are preserved.

[Run 3](final-third-3.txt) failed the initial stricter no-auto assertion: after B posted, one automatic request ran with a cache HIT and delivered a 2-node, 0-edge result; B also had 2 nodes, 0 edges, and Inspector/root showed B. This run did not capture both complete payloads, so their byte equality and the precise activation responsible are unverified. No C result overwriting B was observed. Runs 1 and 2 failed as harness attempts: Quick Open hid the panel and reopening created a fresh panel; neither validates the race. Product policy was not changed based solely on the extra auto request.

## Final-commit graph and compatibility

Using the same P14 fixture, cache OFF and normalization as the previous baseline comparison, [d5ee28b](final-graph-d5ee28b-summary.json) yielded 10 nodes, 11 edges and SHA-256 `56f6e1fea2c0579ace421c4c358e3fd3b2ae491ce37fad5a13918ec1b38b6af2`, matching `381d822`. Request ID `web-6f0947e9-4600-4022-93fe-093baf7dbf24`; minimum sampled free memory 932 MiB. [Normalized graph](final-graph-d5ee28b-graph.json) and [pipeline](final-graph-d5ee28b.jsonl).

The debugger fixture adds a Node launch configuration and `server.js` with `function p12dPause() { const p12dLocal = 42; debugger; setInterval(() => console.log(p12dLocal), 1000); } p12dPause();`. A `debugger` statement provides the breakpoint. [Paused cancellation run](final-debug-paused.txt) verified an active VS Code debug session, frame `global.p12dPause`, `p12dLocal = 42`, cancellation without graph post, and Generate recovery. Minimum sampled free memory 1,257 MiB.

Using that same fixture and cache OFF, trace compatibility compares the full received `payload.graph` and `payload.trace` after normalizing the fixture path, excluding unrelated analysis metadata. Baseline and P12-D both yielded 7 nodes, 9 edges, 16 trace events and SHA-256 `148c94df9fb956f5575f1248c17604dbd4485c0a6481d75ca59c421698e52f3b`: [baseline](final-trace-baseline-payload.json), [current](final-trace-current-payload.json).

Debugger compatibility compares the normalized semantic subset: state, frame name/source/path/line/column and the named local variable scope/name/value/type/evaluateName. Baseline and P12-D both hash to `521c501bbcff64ae97125af2accd5f8c945a0f9a666230e98b9a556c8e2aebbd`: [baseline](final-debug-baseline-payload.json), [current](final-debug-current-payload.json). Session IDs, frame/variable references, timestamps and other variables were deliberately excluded as run-specific; full Runtime Debug message equality is not claimed.

## Reproduction and limits

Run `npm run build:all`, copy the compiled extension into an isolated extensions directory, and run `prepare-race.cjs` on that copy. Create the extra-file and paused-debug fixtures as above. `run-race.ps1 -Mode third-file` and `-Mode debug-paused` reproduce the controlled scenarios; `run-graph.ps1` captures the Depth 2 graph; `run-compat.ps1 -Mode trace` and `-Mode debug` capture compatibility payloads. Each runner requires explicit harness, workspace, extension, VS Code executable and new output paths. Run baseline using a separate clean `381d822` extension and the identical workspace.

The activated-third sequence is a single controlled ordering, not proof for all schedules. Run 3's extra auto result was not fully compared. Paused-debug equivalence covers one frame and one local, not all adapters or entire payloads. Full Vite D2 performance remains P12-C2 work; no physical paint or interaction readiness is inferred.

Final checks after the follow-up harness changes: `npm run build:all`, `npm test` (90 passing, including compilation and lint), and `git diff --check` passed.
