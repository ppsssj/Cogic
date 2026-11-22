// P10 three-way interaction comparison: S (stable c951ccb), R (render-all 56c317e), A (render-all + node reuse f2a60fc).
// Value = median over 3 runs [min–max]. Verdict vs S (fixed rule): better/worse only on complete 3-vs-3 separation.
"use strict";
const fs = require("node:fs"); const path = require("node:path");
const RUNS = "<RESULTS>/p10-final/runs";
const med = (a) => { const b = a.filter(Number.isFinite).sort((p, q) => p - q), n = b.length; return !n ? NaN : n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const f = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const runs = fs.readdirSync(RUNS).filter((x) => /^p10i-.*\.env\.json$/.test(x)).map((x) => {
  const e = JSON.parse(fs.readFileSync(path.join(RUNS, x), "utf8").replace(/^\uFEFF/, ""));
  const m = /p10i-([SRA])-s(\d+)-r(\d)/.exec(e.runId);
  const sub = fs.readdirSync(e.resultsDir).find((d) => d.startsWith("p8f-"));
  return { v: m[1], n: Number(m[2]), r: Number(m[3]), exit: e.exit, j: JSON.parse(fs.readFileSync(path.join(e.resultsDir, sub, "interaction.json"), "utf8")) };
}).filter((r) => r.exit === 0);
const metrics = [["fps", "FPS", 1], ["frameP95Ms", "P95 ms", -1], ["over33Pct", ">33.3ms %", -1], ["over50Pct", "≥50ms %", -1], ["inputLatencyP95Ms", "입력→rAF P95", -1]];
const ops = ["pan", "zoom", "group toggle (2 clicks)", "node selection"];
const verdict = (base, x, dir) => {
  if (base.length < 3 || x.length < 3) return "부족";
  const better = dir > 0 ? Math.min(...x) > Math.max(...base) : Math.max(...x) < Math.min(...base);
  const worse = dir > 0 ? Math.max(...x) < Math.min(...base) : Math.min(...x) > Math.max(...base);
  return better ? "개선" : worse ? "악화" : "=";
};
const md = ["# P10 렌더링 후보 3자 비교 (S 안정 / R 전체 렌더 / A 전체 렌더 + 미변경 노드 재사용)", "", "값 = 실행 3회 중앙값 [최소–최대]. 판정은 S 대비, 3 대 3 완전 분리일 때만 개선/악화, 아니면 '='. 정확성 실패 조작은 제외.", ""];
const csv = ["size,state,op,metric,S,R,A,R_vs_S,A_vs_S,A_vs_R,correct_S,correct_R,correct_A"];
for (const n of [1000, 2000]) for (const st of ["collapsed", "expanded"]) {
  md.push(`## ${n}파일 · ${st === "collapsed" ? "접힘" : "확장"}`, "", "| 조작 | 지표 | S | R | A | R vs S | A vs S | A vs R | 정확 S/R/A |", "|---|---|---|---|---|---|---|---|---|");
  for (const o of ops) {
    const get = (v) => runs.filter((r) => r.v === v && r.n === n).map((r) => r.j.ops.find((x) => x.state === st && x.name === o)).filter(Boolean);
    const all = { S: get("S"), R: get("R"), A: get("A") };
    const ok = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.filter((x) => x.correct)]));
    for (const [k, label, dir] of metrics) {
      const val = Object.fromEntries(Object.entries(ok).map(([v, xs]) => [v, xs.map((x) => x[k])]));
      const rr = (a) => (a.length ? `${f(med(a))} [${f(Math.min(...a))}–${f(Math.max(...a))}]` : "—");
      const vRS = verdict(val.S, val.R, dir), vAS = verdict(val.S, val.A, dir), vAR = verdict(val.R, val.A, dir);
      md.push(`| ${o} | ${label} | ${rr(val.S)} | ${rr(val.R)} | ${rr(val.A)} | ${vRS} | ${vAS} | ${vAR} | ${ok.S.length}/${all.S.length} ${ok.R.length}/${all.R.length} ${ok.A.length}/${all.A.length} |`);
      csv.push([n, st, `"${o}"`, `"${label}"`, f(med(val.S)), f(med(val.R)), f(med(val.A)), vRS, vAS, vAR, `${ok.S.length}/${all.S.length}`, `${ok.R.length}/${all.R.length}`, `${ok.A.length}/${all.A.length}`].join(","));
    }
  }
  md.push("");
}
md.push(`실행: ${["S", "R", "A"].map((v) => `${v} ${runs.filter((r) => r.v === v).length}`).join(", ")}`);
fs.writeFileSync("<RESULTS>/p10-final/p10-three-way.md", md.join("\n") + "\n");
fs.writeFileSync("<RESULTS>/p10-final/p10-three-way.csv", csv.join("\n") + "\n");
console.log(md.join("\n"));
