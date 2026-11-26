// Summarizes a P15-Z0 result.json: per zoom, condition and kind, the median over repetitions of
// each run's rAF-gap p50 and p95, the range of p95 across repetitions (the run-to-run spread),
// frames over 50 ms, long tasks, render calls and drawn counts. rAF gaps are not display FPS.
import fs from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: node summarize.mjs <result.json>");
const r = JSON.parse(fs.readFileSync(file, "utf8"));
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const round = (x) => (x == null ? null : Math.round(x * 10) / 10);
const rows = [];
for (const zoom of r.zooms) {
  for (const kind of ["idle", "pan", "zoom"]) {
    for (const cond of ["A0", "B0", "A1", "B1", "C1"]) {
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
        over50: med(runs.map((x) => x.over50)),
        longTasks: med(runs.map((x) => x.longTasks)),
        longTaskMs: med(runs.map((x) => x.longTaskMs)),
        codeNodeRenders: med(runs.map((x) => x.renders.codeNode)),
        edgeRenders: med(runs.map((x) => x.renders.customEdge)),
        nodes: runs[0].drawn.rfNodes,
        edges: runs[0].drawn.rfEdges,
        dom: runs[0].drawn.domInCanvas,
        animated: runs[0].drawn.animatedEdges,
        overlay: runs[0].drawn.overlay,
        heapMB: med(runs.map((x) => x.heapMB)),
        rendererMB: med(runs.map((x) => x.rendererMB)),
      });
    }
  }
}
const transitions = {};
for (const t of r.transitions.filter((x) => x.phase === "bench")) {
  const key = `${t.mode}`;
  (transitions[key] ??= []).push(t.settleMs);
}
const tSummary = Object.fromEntries(
  Object.entries(transitions).map(([k, v]) => [k, { n: v.length, median: round(med(v)), max: round(Math.max(...v)) }]),
);
const out = { graph: r.graph, defaultState: r.defaultState, expandedState: r.expandedState, memory: r.memory, checks: r.checks.map((c) => `${c.pass ? "ok" : "FAIL"} ${c.name}`), transitionsToMode: tSummary, rows };
console.log(JSON.stringify(out, null, 1));
const header = "| zoom | kind | cond | n | p50 ms | p95 ms | p95 range | >50 ms | long tasks | code renders | nodes | edges | DOM | animated |";
console.log(`\n${header}\n|${"---|".repeat(14)}`);
for (const x of rows) {
  console.log(`| ${x.zoom} | ${x.kind} | ${x.cond} | ${x.n} | ${x.p50} | ${x.p95} | ${x.p95Range} | ${x.over50} | ${x.longTasks} | ${x.codeNodeRenders} | ${x.nodes} | ${x.edges} | ${x.dom} | ${x.animated} |`);
}
