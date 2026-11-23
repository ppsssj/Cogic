// P11 UI summary. node summarize-ui.cjs <outDir> [tag=p11ui]
// Per project x condition x scenario: per-run median of input -> frame callback (settled samples only), median of the run
// medians [min-max]; edit data reflection (probe in result payload) vs visibility (DOM / viewport / hit-test); graph
// identity hash agreement across conditions for the same step; navigation; failed/unsettled samples. Nothing is dropped.
"use strict";
const fs = require("node:fs"), path = require("node:path");
const [outDir, tag = "p11ui"] = process.argv.slice(2);
const RUNS = "<P11>/data/ui-runs";
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (x) => (x == null ? "" : Math.round(x * 10) / 10);
const envs = fs.readdirSync(RUNS).filter((f) => f.startsWith(tag + "-") && f.endsWith(".env.json")).map((f) => JSON.parse(fs.readFileSync(path.join(RUNS, f), "utf8").replace(/^\uFEFF/, "")));
const runs = [];
for (const e of envs) {
  const base = { project: e.project, condition: e.condition, run: e.run, runId: e.runId, exit: e.exit, skipped: e.skipped || "", availableMB: e.availableMB, sessionLocked: e.sessionLocked };
  if (e.skipped) { runs.push({ ...base, rows: [] }); continue; }
  const dir = path.join(e.resultsDir, `p11-ui-${e.project}-cache-${e.condition === "off" ? "off" : "on"}`);
  let rows = []; try { rows = JSON.parse(fs.readFileSync(path.join(dir, "samples.json"), "utf8")).rows; } catch { base.missingSamples = true; }
  const pf = path.join(RUNS, e.runId + ".pressure.json");
  const pr = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, "utf8")) : null;
  runs.push({ ...base, rows, ramPressure: pr ? pr.timedRamPressure ?? null : null, pagingFlag: pr ? pr.timedPagingFlag ?? null : null, monitored: !!(pr && pr.timedSteps) });
}
// valid run per project/condition/run index: exit 0, not skipped, no timed-step RAM pressure; the latest such run is used.
const excluded = [];
const byKey = new Map();
for (const r of runs) { const k = `${r.project}|${r.condition}|${r.run}`; (byKey.get(k) || byKey.set(k, []).get(k)).push(r); }
const valid = [];
for (const [k, list] of byKey) {
  const ok = list.filter((r) => !r.skipped && r.exit === 0 && r.ramPressure !== true && !r.missingSamples).sort((a, b) => (a.runId < b.runId ? 1 : -1));
  if (ok.length) valid.push(ok[0]);
  for (const r of list) if (r !== ok[0]) excluded.push({ runId: r.runId, reason: r.skipped ? "skipped: " + r.skipped : r.exit !== 0 ? "exit " + r.exit : r.ramPressure ? "RAM pressure in a timed step" : "superseded by a later valid run" });
}
const allRuns = [...runs]; runs.length = 0; runs.push(...valid);
const scen = ["first-generate", "repeated-generate", "active-edit", "file-switch"];
const out = [["project", "scenario", "condition", "runs", "samples", "unsettled", "run_medians_ms", "median_of_run_medians_ms", "min_run_median", "max_run_median", "input_to_result_median_ms", "data_updated", "visible_dom_viewport_hit"].join(",")];
for (const p of [...new Set(runs.map((r) => r.project))]) for (const s of scen) for (const c of ["off", "fixed800", "adaptive"]) {
  const rs = runs.filter((r) => r.project === p && r.condition === c);
  const per = rs.map((r) => r.rows.filter((x) => x.scenario === s));
  const all = per.flat();
  const ok = all.filter((x) => x.settled && typeof x.inputToFrameMs === "number" && x.inputToFrameMs > 0);
  const rm = per.map((x) => med(x.filter((y) => y.settled && y.inputToFrameMs > 0).map((y) => y.inputToFrameMs))).filter((v) => v != null);
  const upd = s === "active-edit" ? `${all.filter((x) => x.probeInPayload === true).length}/${all.length}` : (s === "file-switch" ? `${all.filter((x) => x.probeInPayload === true).length}/${all.length}` : "");
  const vis = s === "active-edit" ? `${all.filter((x) => x.probeInDom && x.probeInViewport && x.probeHitTest).length}/${all.length}` : "";
  out.push([p, s, c, rs.length, all.length, all.length - ok.length, rm.map(r1).join("/"), r1(med(rm)), r1(Math.min(...rm)), r1(Math.max(...rm)), r1(med(ok.map((x) => x.inputToResultMs).filter((v) => v > 0))), upd, vis].join(","));
}
// graph identity across conditions: same project, scenario, iteration -> set of gHash values
const g = [["project", "step", "hashes_by_condition", "identical_across_all"].join(",")];
for (const p of [...new Set(runs.map((r) => r.project))]) {
  const steps = new Map();
  for (const r of runs.filter((x) => x.project === p)) for (const x of r.rows.filter((y) => y.gHash)) { const k = `${x.scenario}#${x.iter}`; if (!steps.has(k)) steps.set(k, {}); (steps.get(k)[r.condition] ||= new Set()).add(x.gHash); }
  for (const [k, v] of steps) { const allH = new Set(Object.values(v).flatMap((s) => [...s])); g.push([p, k, Object.entries(v).map(([c, s]) => `${c}:${[...s].join("|")}`).join(" "), allH.size === 1].join(",")); }
}
const nav = runs.flatMap((r) => r.rows.filter((x) => x.scenario === "navigate-source").map((x) => `${r.project},${r.condition},r${r.run},${x.node},${x.moved}`));
const sens = [["project", "scenario", "condition", "runs_without_paging_flag", "median_of_run_medians_ms"].join(",")];
for (const p of [...new Set(runs.map((r) => r.project))]) for (const sc of scen) for (const c of ["off", "fixed800", "adaptive"]) {
  const rs = runs.filter((r) => r.project === p && r.condition === c && r.pagingFlag !== true);
  const rm = rs.map((r) => med(r.rows.filter((y) => y.scenario === sc && y.settled && y.inputToFrameMs > 0).map((y) => y.inputToFrameMs))).filter((v) => v != null);
  sens.push([p, sc, c, rs.length, r1(med(rm))].join(","));
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "p11-ui-sensitivity-no-paging-flag.csv"), sens.join("\n") + "\n");
fs.writeFileSync(path.join(outDir, "p11-ui-excluded-runs.json"), JSON.stringify(excluded, null, 1));
fs.writeFileSync(path.join(outDir, "p11-ui-conditions.csv"), out.join("\n") + "\n");
fs.writeFileSync(path.join(outDir, "p11-ui-graph-identity.csv"), g.join("\n") + "\n");
fs.writeFileSync(path.join(outDir, "p11-ui-navigation.csv"), "project,condition,run,node,moved\n" + nav.join("\n") + "\n");
fs.writeFileSync(path.join(outDir, "p11-ui-runs.json"), JSON.stringify(allRuns.map((full) => { const { rows, ...r } = full; return { ...r, rows: rows.length, used: valid.includes(full) }; }), null, 1));
console.log(out.join("\n")); console.log(`graph identity: ${g.slice(1).filter((l) => l.endsWith(",true")).length}/${g.length - 1} steps identical across conditions`);
console.log(`navigation moved: ${nav.filter((l) => l.endsWith(",true")).length}/${nav.length}`);
console.log(`valid runs used=${valid.length} excluded=${excluded.length}: ${excluded.map((x) => x.runId + " (" + x.reason + ")").join("; ")}`);
