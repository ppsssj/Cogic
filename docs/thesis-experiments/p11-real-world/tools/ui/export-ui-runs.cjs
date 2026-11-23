// Exports a path-free per-sample CSV of all P11 UI runs (valid and excluded, with flags). node export-ui-runs.cjs <out.csv>
"use strict";
const fs = require("node:fs"), path = require("node:path");
const RUNS = "<P11>/data/ui-runs";
const used = new Set(JSON.parse(fs.readFileSync("<P11>/summary-ui/p11-ui-runs.json", "utf8")).filter((r) => r.used).map((r) => r.runId));
const cols = ["runId", "project", "condition", "run", "used", "exit", "monitored", "ramPressure", "pagingFlag", "scenario", "iter", "settled", "inputToFrameMs", "inputToResultMs", "resultToDomSettledMs", "payloadNodes", "payloadEdges", "gHash", "probeInPayload", "probeInDom", "probeInViewport", "probeHitTest", "pansBeforeEdit", "analysisResults", "moved", "file"];
const out = [cols.join(",")];
for (const f of fs.readdirSync(RUNS).filter((x) => /^p11ui-.*\.env\.json$/.test(x)).sort()) {
  const e = JSON.parse(fs.readFileSync(path.join(RUNS, f), "utf8").replace(/^\uFEFF/, ""));
  const pf = path.join(RUNS, e.runId + ".pressure.json"); const pr = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, "utf8")) : {};
  const dir = e.resultsDir && fs.existsSync(e.resultsDir) ? fs.readdirSync(e.resultsDir).find((d) => d.startsWith("p11-ui-")) : null;
  const rows = dir ? JSON.parse(fs.readFileSync(path.join(e.resultsDir, dir, "samples.json"), "utf8")).rows : [];
  for (const r of rows.filter((x) => ["first-generate", "repeated-generate", "active-edit", "file-switch", "navigate-source"].includes(x.scenario))) {
    const v = { runId: e.runId, project: e.project, condition: e.condition, run: e.run, used: used.has(e.runId), exit: e.exit, monitored: !!pr.timedSteps, ramPressure: pr.timedRamPressure ?? "", pagingFlag: pr.timedPagingFlag ?? "", ...r };
    out.push(cols.map((c) => (v[c] === undefined || v[c] === null ? "" : String(v[c]).replace(/,/g, ";"))).join(","));
  }
}
fs.writeFileSync(process.argv[2], out.join("\n") + "\n");
console.log(`rows=${out.length - 1}`);
