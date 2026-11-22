// Summarise the counterbalanced UI series (p6-data/ui-r3). Unit of independence = one VS Code launch (run).
// For each (target, scenario, cache): per-run median of each metric, then across-run median/min/max.
// Cache claim rule (decided before looking at data): "ON faster" only if every ON run median < every OFF
// run median (complete separation, >=3 runs each); "OFF faster" likewise; otherwise "inconsistent".
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const DIR = "<RESULTS>\\p6-data\\ui-r3";
const med = (a) => { const b = a.filter(Number.isFinite).sort((p, q) => p - q); const n = b.length; if (!n) return NaN; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const p95 = (a) => { const b = a.filter(Number.isFinite).sort((p, q) => p - q); return b.length ? b[Math.min(b.length - 1, Math.ceil(0.95 * b.length) - 1)] : NaN; };
const f = (x) => (Number.isFinite(x) ? x.toFixed(1) : "");

const envs = fs.readdirSync(DIR).filter((x) => x.startsWith("env-")).map((x) => JSON.parse(fs.readFileSync(path.join(DIR, x), "utf8").replace(/^\uFEFF/, "")));
const runs = [];
for (const e of envs) {
  if (!e.samples) { runs.push({ ...e, ok: false, rows: [] }); continue; }
  const d = JSON.parse(fs.readFileSync(path.join(DIR, e.samples), "utf8"));
  const rows = d.rows.filter((r) => r.scenario && r.scenario !== "restore-warning");
  const warn = d.rows.some((r) => r.scenario === "restore-warning");
  runs.push({ ...e, ok: e.exit === 0 && !warn, restoreWarning: warn, rows });
}
const metrics = { inputToFrameMs: "input→frame", inputToResultMs: "input→result", resultToDomSettledMs: "result→DOM", domSettledToFrameMs: "DOM→frame" };
const scen = ["cold-start", "repeated-generate", "active-edit"];
const targets = ["fixture", "synthetic-100", "synthetic-500", "synthetic-1000", "synthetic-2000"];
const perRun = [["target", "cache", "slot", "orderPattern", "exit", "restoreWarning", "availableMB", "commitMB", "cpuLoadPct", "sessionLocked", "scenario", "n", "allSettled", "allVisible", "allRaf", "probeVisibleAll", ...Object.keys(metrics).map((m) => `${m}_median`), "inputToFrame_p95", "payloadNodes", "payloadEdges"].join(",")];
const agg = {};
for (const r of runs) for (const sc of scen) {
  const rs = r.rows.filter((x) => x.scenario === sc);
  if (!rs.length) continue;
  const m = Object.fromEntries(Object.keys(metrics).map((k) => [k, med(rs.map((x) => x[k]))]));
  perRun.push([r.target, r.cache, r.slot, `"${r.orderPattern}"`, r.exit, r.restoreWarning, r.availableMB, r.commitMB, r.cpuLoadPct, r.sessionLocked, sc, rs.length,
    rs.every((x) => x.settled), rs.every((x) => x.visibility === "visible"), rs.every((x) => x.rafObserved),
    sc === "active-edit" ? rs.every((x) => x.probeVisibleAfterFit) : "", ...Object.keys(metrics).map((k) => f(m[k])), f(p95(rs.map((x) => x.inputToFrameMs))), rs[0].payloadNodes, rs[0].payloadEdges].join(","));
  if (!r.ok) continue;
  const key = `${r.target}|${sc}|${r.cache}`;
  (agg[key] ??= []).push({ slot: r.slot, ...m, samples: rs.map((x) => x.inputToFrameMs) });
}
fs.writeFileSync(path.join(DIR, "per-run.csv"), perRun.join("\n") + "\n");

const md = ["# P6 UI 반복 측정 요약 (교차 순서, 조건당 독립 실행)", "", "단위 ms. 실행 1회 = VS Code 새 프로세스 1회. 표 값: 실행별 중앙값들의 중앙값 [최소–최대], (실행 수). 시간 기준은 프레임 콜백(DOM 반영 후 두 번째 requestAnimationFrame)이며 실제 페인트 시간이 아니다.", ""];
const verdictRows = ["target,scenario,metric,off_run_medians,on_run_medians,verdict"];
for (const [mk, label] of Object.entries(metrics)) {
  md.push(`## ${label}`, "", "| 대상 | 시나리오 | OFF | ON | 판정 |", "|---|---|---|---|---|");
  for (const t of targets) for (const sc of scen) {
    const off = agg[`${t}|${sc}|off`] ?? [], on = agg[`${t}|${sc}|on`] ?? [];
    if (!off.length && !on.length) continue;
    const ov = off.map((x) => x[mk]), nv = on.map((x) => x[mk]);
    const cell = (v) => v.length ? `${f(med(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}] (${v.length})` : "—";
    let verdict = "실행 수 부족";
    if (ov.length >= 3 && nv.length >= 3) verdict = Math.max(...nv) < Math.min(...ov) ? "ON 빠름(완전 분리)" : Math.max(...ov) < Math.min(...nv) ? "OFF 빠름(완전 분리)" : "일관되지 않음";
    md.push(`| ${t} | ${sc} | ${cell(ov)} | ${cell(nv)} | ${verdict} |`);
    verdictRows.push([t, sc, mk, `"${ov.map(f).join(" ")}"`, `"${nv.map(f).join(" ")}"`, verdict].join(","));
  }
  md.push("");
}
const bad = runs.filter((r) => !r.ok);
md.push("## 실행 상태", "", `총 실행 ${runs.length}, 유효 ${runs.length - bad.length}, 제외 ${bad.length}`, ...bad.map((r) => `- 제외: ${r.target} slot${r.slot} ${r.cache} exit=${r.exit} restoreWarning=${r.restoreWarning ?? ""} samples=${r.samples ?? "없음"}`));
fs.writeFileSync(path.join(DIR, "verdicts.csv"), verdictRows.join("\n") + "\n");
fs.writeFileSync(path.join(DIR, "r3-summary.md"), md.join("\n") + "\n");
console.log(md.join("\n"));
