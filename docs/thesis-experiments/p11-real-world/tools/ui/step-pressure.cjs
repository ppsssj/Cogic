// Timed-step memory-pressure evaluation for one P11 UI run. node step-pressure.cjs <runId>
// Refinement adopted 2026-11-23 after the first monitored hono runs (documented in POLICY-CHANGES.md): the run-level rule
// (min available < 500 MB or a 10 s mean Pages Input/sec > 500 anywhere in the run) also fires on VS Code start-up, whose
// hard faults are mostly mapped executable/DLL reads, outside every timed interval. The same thresholds are therefore
// also evaluated only on samples inside TIMED steps (generate-*, edit-*, switch-*). The run-level flag stays in env.json.
"use strict";
const fs = require("node:fs"), path = require("node:path");
const OUT = "<P11>/data/ui-runs";
const runId = process.argv[2];
const env = JSON.parse(fs.readFileSync(path.join(OUT, `${runId}.env.json`), "utf8").replace(/^\uFEFF/, ""));
const res = { runId, criteria: "timed steps (generate-*, edit-*, switch-*): any sample with available < 500 MB or Pages Input/sec > 500", runLevelFlag: env.memoryPressure ?? null };
const memF = path.join(OUT, `${runId}.mem.csv`);
const dir = fs.existsSync(env.resultsDir || "") ? fs.readdirSync(env.resultsDir).find((d) => d.startsWith("p11-ui-")) : null;
if (!fs.existsSync(memF) || !dir) { res.timedPressure = null; res.note = "not monitored (no mem.csv) or no harness log"; }
else {
  const m = fs.readFileSync(memF, "utf8").replace(/^\uFEFF/, "").trim().split("\n").slice(1).map((l) => { const a = l.replace(/^\uFEFF/, "").split(","); return { t: Date.parse(a[0]), av: +a[1], pin: +a[4] }; });
  const steps = [];
  for (const l of fs.readFileSync(path.join(env.resultsDir, dir, "run.log"), "utf8").split("\n")) { const s = l.match(/^\[(.+?)\] STEP (\S+)/); if (s) steps.push({ t: Date.parse(s[1]), name: s[2] }); }
  const stepAt = (t) => { let n = "pre-launch"; for (const s of steps) if (s.t <= t) n = s.name; return n; };
  const timed = /^(generate|edit|switch)-\d+$/;
  const per = {};
  for (const x of m) { const k = stepAt(x.t); if (!timed.test(k)) continue; const a = (per[k] ||= { samples: 0, minAvailMB: Infinity, maxPagesInput: 0 }); a.samples++; a.minAvailMB = Math.min(a.minAvailMB, x.av); a.maxPagesInput = Math.max(a.maxPagesInput, x.pin); }
  res.timedSteps = per;
  res.pressuredSteps = Object.entries(per).filter(([, a]) => a.minAvailMB < 500 || a.maxPagesInput > 500).map(([k]) => k);
  res.timedPressure = res.pressuredSteps.length > 0;
  // Second refinement (same day, same thresholds): Pages Input/sec also counts file reads (opening project files, tsserver),
  // so it cannot separate RAM shortage from disk I/O. RAM pressure = available < 500 MB in a timed step -> run excluded and
  // re-measured. Paging > 500 in a timed step -> run kept, marked, and dropped in a sensitivity analysis.
  res.ramPressureSteps = Object.entries(per).filter(([, a]) => a.minAvailMB < 500).map(([k]) => k);
  res.pagingSteps = Object.entries(per).filter(([, a]) => a.maxPagesInput > 500).map(([k]) => k);
  res.timedRamPressure = res.ramPressureSteps.length > 0;
  res.timedPagingFlag = res.pagingSteps.length > 0;
}
fs.writeFileSync(path.join(OUT, `${runId}.pressure.json`), JSON.stringify(res, null, 1));
console.log(`${runId} runLevel=${res.runLevelFlag} ramPressure=${res.timedRamPressure} [${(res.ramPressureSteps||[]).join(" ")}] paging=${res.timedPagingFlag} [${(res.pagingSteps||[]).join(" ")}] ${res.note || ""}`);
