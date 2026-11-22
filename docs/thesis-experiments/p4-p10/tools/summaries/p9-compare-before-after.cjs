// P9 interaction Before/After comparison from p8f interaction.json files (prefix p9ba-before / p9ba-after).
// Per (size, state, op): median over runs of each metric; Δ = after − before; change % relative to before.
// Verdict (fixed beforehand): "improved" only if all 3 after-run values are better than all 3 before-run values
// for that metric; "worse" if the opposite; else "inconsistent". Ops failing correctness are excluded per run.
"use strict";
const fs = require("node:fs"); const path = require("node:path");
const RUNS = "<RESULTS>/p9-final/runs";
const med = (a) => { const b = a.filter(Number.isFinite).sort((p, q) => p - q), n = b.length; return !n ? NaN : n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
function load(label) {
  return fs.readdirSync(RUNS).filter((x) => x.startsWith(`p9ba-${label}-`) && x.endsWith(".env.json")).map((x) => {
    const e = JSON.parse(fs.readFileSync(path.join(RUNS, x), "utf8").replace(/^\uFEFF/, ""));
    const sub = fs.readdirSync(e.resultsDir).find((d) => d.startsWith("p8f-"));
    const j = JSON.parse(fs.readFileSync(path.join(e.resultsDir, sub, "interaction.json"), "utf8"));
    return { runId: e.runId, exit: e.exit, size: Number(/s(\d+)/.exec(j.label)[1]), j };
  }).filter((r) => r.exit === 0);
}
const B = load("before"), A = load("after");
const metrics = [["fps", "FPS", +1], ["frameMedianMs", "P50 ms", -1], ["frameP95Ms", "P95 ms", -1], ["over33Pct", ">33.3ms %", -1], ["over50Pct", "≥50ms %", -1], ["inputLatencyP95Ms", "입력→rAF P95", -1]];
const ops = ["pan", "zoom", "group toggle (2 clicks)", "node selection", "node-drag(attempt)", "idle"];
const md = ["# P9 인터랙션 Before/After (before = cand1: 캐시+Fit, after = cand2: + 가상화 임계값)", "", "값 = 실행 3회 값의 중앙값 [최소–최대]. Δ = after − before. 판정: 3 대 3 완전 분리일 때만 개선/악화(사전 규칙). 정확성 실패 조작은 제외.", ""];
const csv = ["size,state,op,metric,before_median,after_median,delta,change_pct,before_runs,after_runs,verdict,correct_before,correct_after"];
for (const n of [100, 500, 1000, 2000]) for (const st of ["collapsed", "expanded"]) {
  md.push(`## ${n}파일 · ${st === "collapsed" ? "접힘" : "확장"}`, "", "| 조작 | 지표 | Before | After | Δ | 변화율 | 판정 | 정확(B/A) |", "|---|---|---|---|---:|---:|---|---|");
  for (const o of ops) {
    const get = (R) => R.filter((r) => r.size === n).map((r) => r.j.ops.find((x) => x.state === st && x.name === o)).filter(Boolean);
    const ob = get(B), oa = get(A); const gb = ob.filter((x) => x.correct), ga = oa.filter((x) => x.correct);
    for (const [k, label, dir] of metrics) {
      if (o === "idle" && k.startsWith("input")) continue;
      const vb = gb.map((x) => x[k]), va = ga.map((x) => x[k]);
      const mb = med(vb), ma = med(va), d = ma - mb, pct = mb ? (d / mb) * 100 : NaN;
      let v = "실행 부족";
      if (vb.length >= 3 && va.length >= 3) {
        const better = dir > 0 ? Math.min(...va) > Math.max(...vb) : Math.max(...va) < Math.min(...vb);
        const worse = dir > 0 ? Math.max(...va) < Math.min(...vb) : Math.min(...va) > Math.max(...vb);
        v = better ? "개선" : worse ? "악화" : "일관되지 않음";
      }
      const rr = (a) => (a.length ? `${f(med(a))} [${f(Math.min(...a))}–${f(Math.max(...a))}]` : "—");
      md.push(`| ${o} | ${label} | ${rr(vb)} | ${rr(va)} | ${f(d)} | ${f(pct)}% | ${v} | ${gb.length}/${ob.length} · ${ga.length}/${oa.length} |`);
      csv.push([n, st, `"${o}"`, `"${label}"`, f(mb), f(ma), f(d), f(pct), `"${vb.map((x) => f(x)).join(" ")}"`, `"${va.map((x) => f(x)).join(" ")}"`, v, `${gb.length}/${ob.length}`, `${ga.length}/${oa.length}`].join(","));
    }
  }
  md.push("");
}
// graph sizes per variant (DOM) for context
md.push("## DOM 크기(실행 1, 접힘 상태): before / after", "");
for (const n of [100, 500, 1000, 2000]) { const b = B.find((r) => r.size === n)?.j.stateCollapsed, a = A.find((r) => r.size === n)?.j.stateCollapsed; md.push(`- ${n}: DOM 노드 ${b?.domNodes} / ${a?.domNodes}, DOM 엣지 ${b?.domEdges} / ${a?.domEdges}`); }
md.push("", `실행: before ${B.length}, after ${A.length}`);
fs.writeFileSync("<RESULTS>\\p9-final\\p9-interaction-before-after.md", md.join("\n") + "\n");
fs.writeFileSync("<RESULTS>\\p9-final\\p9-interaction-before-after.csv", csv.join("\n") + "\n");
console.log(md.join("\n"));
