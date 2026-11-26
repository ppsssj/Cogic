// Summarizes a P15-Z0A result.json: per zoom, kind and condition, the median over repetitions of
// each run's rAF-gap p50 and p95, the p95 range across repetitions, frames over 50 ms, and what
// the edges did (animated class, running animations, dashed dataflow edges). Not display FPS.
import fs from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: node summarize.mjs <result.json>");
const r = JSON.parse(fs.readFileSync(file, "utf8"));
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const round = (x) => (x == null ? null : Math.round(x * 10) / 10);
const conds = [...new Set(r.runs.map((x) => x.cond))].sort();
const rows = [];
for (const zoom of r.zooms) {
  for (const kind of ["idle", "pan", "zoom"]) {
    for (const cond of conds) {
      const runs = r.runs.filter((x) => x.zoom === zoom && x.kind === kind && x.cond === cond);
      if (!runs.length) continue;
      const p95s = runs.map((x) => x.p95);
      rows.push({
        zoom,
        kind,
        cond,
        n: runs.length,
        p50: round(med(runs.map((x) => x.p50))),
        p95: round(med(p95s)),
        p95Range: `${round(Math.min(...p95s))}-${round(Math.max(...p95s))}`,
        frames: med(runs.map((x) => x.frames)),
        over50: runs.reduce((a, x) => a + x.over50, 0),
        longTasks: runs.reduce((a, x) => a + x.longTasks, 0),
        codeRenders: med(runs.map((x) => x.renders.codeNode)),
        edgeRenders: med(runs.map((x) => x.renders.customEdge)),
        nodes: runs[0].drawn.rfNodes,
        edges: runs[0].drawn.rfEdges,
        dom: runs[0].drawn.domInCanvas,
        animatedClass: runs[0].drawn.animatedClass,
        running: runs[0].drawn.animatedRunning,
        dashed: `${runs[0].drawn.dataflowDashed}/${runs[0].drawn.dataflowEdges}`,
        rendererMB: med(runs.map((x) => x.rendererMB)),
      });
    }
  }
}
console.log(JSON.stringify({ graph: r.graph, memory: r.memory, checks: r.checks.map((c) => `${c.pass ? "ok" : "FAIL"} ${c.name}`), rows }, null, 1));
console.log("\n| zoom | kind | cond | n | p50 ms | p95 ms | p95 range | frames | >50 ms (sum) | long tasks (sum) | code renders | animated / running | dashed | nodes / edges | DOM | renderer MB |");
console.log(`|${"---|".repeat(16)}`);
for (const x of rows) {
  console.log(`| ${x.zoom} | ${x.kind} | ${x.cond} | ${x.n} | ${x.p50} | ${x.p95} | ${x.p95Range} | ${x.frames} | ${x.over50} | ${x.longTasks} | ${x.codeRenders} | ${x.animatedClass} / ${x.running} | ${x.dashed} | ${x.nodes} / ${x.edges} | ${x.dom} | ${x.rendererMB} |`);
}
