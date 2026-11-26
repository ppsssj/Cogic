// Summarizes a P15-R1 result.json per view ("0.6", "0.15", "main"), kind and condition: medians
// over repetitions of each run's rAF-gap p50 and p95, the p95 range, frames over 50 ms, and the
// drawn and running counts. rAF gaps are not display FPS.
import fs from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: node summarize.mjs <result.json>");
const r = JSON.parse(fs.readFileSync(file, "utf8"));
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const round = (x) => (x == null ? null : Math.round(x * 10) / 10);
const POLICY = { A: "legacy/none", B: "focused/none", C: "focused/flow", D: "legacy/flow", E: "legacy/node", F: "focused/node" };
const views = [...new Set(r.runs.map((x) => String(x.zoom)))];
console.log("| view | kind | cond | policy/selection | n | p50 ms | p95 ms | p95 range | >50 ms (sum) | long tasks (sum) | running | nodes / edges | DOM | renderer MB |");
console.log(`|${"---|".repeat(14)}`);
for (const view of views) {
  for (const kind of ["idle", "pan", "zoom"]) {
    for (const cond of Object.keys(POLICY)) {
      const runs = r.runs.filter((x) => String(x.zoom) === view && x.kind === kind && x.cond === cond);
      if (!runs.length) continue;
      const p95s = runs.map((x) => x.p95);
      const running = [...new Set(runs.map((x) => x.drawn.running))].join("/");
      console.log(`| ${view} | ${kind} | ${cond} | ${POLICY[cond]} | ${runs.length} | ${round(med(runs.map((x) => x.p50)))} | ${round(med(p95s))} | ${round(Math.min(...p95s))}-${round(Math.max(...p95s))} | ${runs.reduce((a, x) => a + x.over50, 0)} | ${runs.reduce((a, x) => a + x.longTasks, 0)} | ${running} | ${runs[0].drawn.nodes} / ${runs[0].drawn.edges} | ${runs[0].drawn.dom} | ${med(runs.map((x) => x.rendererMB))} |`);
    }
  }
}
console.log(`\nchecks: ${r.checks.filter((c) => c.pass).length}/${r.checks.length}; min free ${r.memory.minimum} MiB; export ${JSON.stringify(r.export)}`);
