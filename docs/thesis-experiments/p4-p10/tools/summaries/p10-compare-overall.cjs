// Overall Before/After (UI, P8-C protocol, cache ON). baseline = 9126f35 VSIX, final = P9 56c317e VSIX.
"use strict";
const fs = require("node:fs"); const path = require("node:path");
const RUNS = "<RESULTS>/p10-final/runs";
const med = (a) => { const b = a.filter(Number.isFinite).sort((p, q) => p - q), n = b.length; return !n ? NaN : n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const f = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const runs = fs.readdirSync(RUNS).filter((x) => /^p10ov3-.*\.env\.json$/.test(x)).map((x) => {
  const e = JSON.parse(fs.readFileSync(path.join(RUNS, x), "utf8").replace(/^\uFEFF/, ""));
  const m = /p10ov3-(baseline|cacheonly)-s(\d+)-k(\d+)/.exec(e.runId);
  const sub = fs.readdirSync(e.resultsDir).find((d) => d.startsWith("p8c-ui-"));
  const rows = JSON.parse(fs.readFileSync(path.join(e.resultsDir, sub, "samples.json"), "utf8")).rows;
  return { runId: e.runId, v: m[1], n: Number(m[2]), k: Number(m[3]), exit: e.exit, rows, avail: e.availableMB };
});
const valid = (x) => x.scenario !== "active-edit" ? x.settled === true : x.settled && x.probeInDom && x.probeInViewport && x.probeHitTest;
const md = ["# P10 캐시만 적용(e753f5e) vs Baseline (UI, P8-C 방식, 캐시 ON)", "", "baseline = cogic-p4-final.vsix(9126f35), cacheonly = cogic-p10-cache-only-e753f5e.vsix. 입력→프레임 콜백 ms, 실행별 중앙값의 중앙값 [최소–최대]. 판정: 3 대 3 완전 분리(사전 규칙).", "",
  "| 파일 | 시나리오 | Baseline | Cache-only | Δ | 변화율 | 판정 | 화면 반영(B) / (F) | 편집 전 pan 합(B/F) |", "|---:|---|---|---|---:|---:|---|---|---|"];
const csv = ["size,scenario,baseline_runs,final_runs,baseline_median,final_median,delta,change_pct,verdict"];
for (const n of [1000, 2000]) for (const sc of ["cold-start", "repeated-generate", "active-edit"]) {
  const g = (v) => runs.filter((r) => r.v === v && r.n === n && r.exit === 0);
  const rm = (v) => g(v).map((r) => med(r.rows.filter((x) => x.scenario === sc && valid(x)).map((x) => x.inputToFrameMs)));
  const vis = (v) => { const e = g(v).flatMap((r) => r.rows.filter((x) => x.scenario === "active-edit")); return `${e.filter(valid).length}/${e.length}`; };
  const pans = (v) => g(v).flatMap((r) => r.rows.filter((x) => x.scenario === "active-edit").map((x) => x.pansBeforeEdit ?? 0)).reduce((s, x) => s + Math.max(0, x), 0);
  const b = rm("baseline"), fi = rm("cacheonly"); const mb = med(b), mf = med(fi);
  let v = "실행 부족"; if (b.length >= 3 && fi.length >= 3) v = Math.max(...fi) < Math.min(...b) ? "개선" : Math.min(...fi) > Math.max(...b) ? "악화" : "일관되지 않음";
  const rr = (a) => `${f(med(a))} [${f(Math.min(...a))}–${f(Math.max(...a))}]`;
  md.push(`| ${n} | ${sc} | ${rr(b)} | ${rr(fi)} | ${f(mf - mb)} | ${f(((mf - mb) / mb) * 100)}% | ${v} | ${sc === "active-edit" ? `${vis("baseline")} / ${vis("cacheonly")}` : "—"} | ${sc === "active-edit" ? `${pans("baseline")} / ${pans("cacheonly")}` : "—"} |`);
  csv.push([n, sc, `"${b.map(f).join(" ")}"`, `"${fi.map(f).join(" ")}"`, f(mb), f(mf), f(mf - mb), f(((mf - mb) / mb) * 100), v].join(","));
}
md.push("", `실행 ${runs.length}개, exit≠0 ${runs.filter((r) => r.exit !== 0).length}개. 실행 전 가용 메모리 ${Math.min(...runs.map((r) => r.avail))}–${Math.max(...runs.map((r) => r.avail))} MB.`);
fs.writeFileSync("<RESULTS>/p10-final/p10-cacheonly-vs-baseline.md", md.join("\n") + "\n");
fs.writeFileSync("<RESULTS>/p10-final/p10-cacheonly-vs-baseline.csv", csv.join("\n") + "\n");
console.log(md.join("\n"));
