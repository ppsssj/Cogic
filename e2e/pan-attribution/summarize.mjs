// Summarize a pan-attribution result.json: per condition medians, and the time association of long
// frames with node/edge mount changes, at lags of 0..6 frames.
//   node e2e/pan-attribution/summarize.mjs <result.json>
import fs from "node:fs";

const r = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const med = (a) => {
  const s = a.filter((v) => v != null).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const runs = r.runs.filter((x) => x.label !== "probe" && x.valid);
const conds = [...new Set(runs.map((x) => x.cond))];
const out = { conditions: {}, lag: {} };
console.log("| cond | n | p50 | p95 (range) | max | >50 | >100 | views | commits | node+edge mounts | long tasks | renderer MB | GPU MB |");
for (const c of conds) {
  const g = runs.filter((x) => x.cond === c);
  const row = {
    n: g.length,
    p50: med(g.map((x) => x.p50)),
    p95: med(g.map((x) => x.p95)),
    p95range: [Math.min(...g.map((x) => x.p95)), Math.max(...g.map((x) => x.p95))],
    max: Math.max(...g.map((x) => x.max)),
    over50: med(g.map((x) => x.over50)),
    over100: med(g.map((x) => x.over100)),
    views: med(g.map((x) => x.views)),
    commits: med(g.map((x) => x.commits)),
    mounts: med(g.map((x) => (x.mut ? x.mut.nodeAdds + x.mut.nodeRemoves + x.mut.edgeAdds + x.mut.edgeRemoves : null))),
    longTasks: med(g.map((x) => x.longTasks)),
    rendererMB: med(g.map((x) => x.rendererMB)),
    gpuMB: med(g.map((x) => x.gpuMB)),
  };
  out.conditions[c] = row;
  console.log(`| ${c} | ${row.n} | ${row.p50} | ${row.p95} (${row.p95range.join("-")}) | ${row.max} | ${row.over50} | ${row.over100} | ${row.views} | ${row.commits ?? "-"} | ${row.mounts ?? "-"} | ${row.longTasks} | ${row.rendererMB} | ${row.gpuMB} |`);
  // lag association: frame i is "after a mount change at lag L" when frame i-L had one
  const lagRows = [];
  for (let L = 0; L <= 6; L++) {
    let afterMut = 0, afterMutLong = 0, other = 0, otherLong = 0;
    for (const x of g) {
      if (!x.mut) continue;
      const f = x.frameLog;
      for (let i = L; i < f.length; i++) {
        const m = f[i - L][2] + f[i - L][3] > 0;
        const long = f[i][1] > 50;
        if (m) { afterMut++; if (long) afterMutLong++; } else { other++; if (long) otherLong++; }
      }
    }
    if (afterMut) lagRows.push({ lag: L, pLongAfterMut: Math.round((afterMutLong / afterMut) * 1000) / 1000, nAfterMut: afterMut, pLongOther: Math.round((otherLong / other) * 1000) / 1000 });
  }
  if (lagRows.length) out.lag[c] = lagRows;
  // each long frame: frames since the last mount change
  const since = [];
  for (const x of g) {
    if (!x.mut) continue;
    let last = -1e9;
    x.frameLog.forEach((f, i) => {
      if (f[1] > 50) since.push(i - last);
      if (f[2] + f[3] > 0) last = i;
    });
  }
  if (since.length) out.lag[`${c}:framesSinceMountAtLongFrame`] = since.sort((a, b) => a - b);
}
for (const [c, rows] of Object.entries(out.lag)) {
  if (c.includes(":")) console.log(`${c}: ${rows.slice(0, 60).join(",")}${rows.length > 60 ? "..." : ""} (n ${rows.length})`);
  else console.log(`${c} lag: ${rows.map((x) => `L${x.lag} ${x.pLongAfterMut} (n ${x.nAfterMut}) vs ${x.pLongOther}`).join(" | ")}`);
}
fs.writeFileSync(process.argv[2].replace(/result\.json$/, "summary.json"), JSON.stringify(out, null, 1));
