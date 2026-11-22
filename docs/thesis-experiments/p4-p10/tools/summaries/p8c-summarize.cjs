// P8-D: summarise P8-C runs (p8-final/runs/p8c-*.env.json + harness samples.json).
// Unit of independence = one VS Code launch (run). Edit samples are valid only if settled && probeInDom &&
// probeInViewport && probeHitTest (no correction of failed samples). Run valid only if exit 0 and no restore warning.
// Cache verdict rule (fixed beforehand, same as P6 r3): ON faster only if all ON run-medians < all OFF run-medians.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const RUNS = "<RESULTS>\\p8-final\\runs";
const OUT = "<RESULTS>\\p8-final";
const sorted = (a) => a.filter(Number.isFinite).sort((p, q) => p - q);
const med = (a) => { const b = sorted(a), n = b.length; return !n ? NaN : n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const pct = (a, p) => { const b = sorted(a); return b.length ? b[Math.min(b.length - 1, Math.ceil(p * b.length) - 1)] : NaN; };
const mean = (a) => { const b = sorted(a); return b.length ? b.reduce((s, x) => s + x, 0) / b.length : NaN; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "");

const envs = fs.readdirSync(RUNS).filter((x) => /^p8c-.*\.env\.json$/.test(x)).map((x) => JSON.parse(fs.readFileSync(path.join(RUNS, x), "utf8").replace(/^\uFEFF/, "")));
const runs = [];
for (const e of envs) {
  const m = /p8c-s(\d+)-slot(\d+)-(on|off)/.exec(e.runId);
  const r = { runId: e.runId, files: Number(m[1]), slot: Number(m[2]), cache: m[3], exit: e.exit, skipped: e.skipped, availableMB: e.availableMB, availableAfterMB: e.availableAfterMB, commitMB: e.commitMB, cpuLoadPct: e.cpuLoadPct, sessionLocked: e.sessionLocked, rows: [] };
  if (!e.skipped) {
    const dir = e.resultsDir; const sub = fs.existsSync(dir) ? fs.readdirSync(dir).find((d) => d.startsWith("p8c-ui-")) : null;
    const sj = sub ? path.join(dir, sub, "samples.json") : null;
    if (sj && fs.existsSync(sj)) r.rows = JSON.parse(fs.readFileSync(sj, "utf8")).rows;
  }
  r.restoreWarning = r.rows.some((x) => x.scenario === "restore-warning");
  r.valid = !r.skipped && r.exit === 0 && !r.restoreWarning && r.rows.length > 0;
  r.invalidReason = r.valid ? "" : r.skipped ? `skipped: ${r.skipped}` : r.exit !== 0 ? `exit ${r.exit}` : r.restoreWarning ? "restore warning" : "no samples";
  const meta = r.rows.flatMap((x) => (x.events ?? []).filter((ev) => ev.k === "analysisResult" && ev.meta).map((ev) => ev.meta)).pop();
  try { r.rootFiles = JSON.parse(meta ?? "null")?.rootFiles ?? null; } catch { r.rootFiles = null; }
  runs.push(r);
}
const sampleValid = (x) => x.scenario !== "active-edit" ? x.settled === true : x.settled === true && x.probeInDom === true && x.probeInViewport === true && x.probeHitTest === true;
const scen = ["cold-start", "repeated-generate", "active-edit"];
const metrics = ["inputToFrameMs", "inputToResultMs", "resultToDomSettledMs", "domSettledToFrameMs"];

// per-run CSV
const perRun = [["runId", "files", "rootFiles", "slot", "cache", "valid", "invalidReason", "availableMB", "availableAfterMB", "commitMB", "cpuLoadPct", "sessionLocked", "scenario", "samples", "validSamples", "screenSuccess", ...metrics.map((m) => `${m}_median`), "payloadNodes", "payloadEdges"].join(",")];
const agg = {};
for (const r of runs.sort((a, b) => a.files - b.files || a.slot - b.slot)) for (const sc of scen) {
  const rs = r.rows.filter((x) => x.scenario === sc);
  if (!rs.length && r.valid) continue;
  const vs = rs.filter(sampleValid);
  const ms = Object.fromEntries(metrics.map((m) => [m, med(vs.map((x) => x[m]))]));
  perRun.push([r.runId, r.files, r.rootFiles, r.slot, r.cache, r.valid, `"${r.invalidReason}"`, r.availableMB, r.availableAfterMB, r.commitMB, r.cpuLoadPct, r.sessionLocked, sc, rs.length, vs.length,
    sc === "active-edit" ? `${vs.length}/${rs.length}` : "", ...metrics.map((m) => f1(ms[m])), rs[0]?.payloadNodes ?? "", rs[0]?.payloadEdges ?? ""].join(","));
  if (!r.valid) continue;
  const k = `${r.files}|${sc}|${r.cache}`;
  (agg[k] ??= { runMedians: [], slots: [], samples: [], total: 0, valid: 0, nodes: rs[0]?.payloadNodes, edges: rs[0]?.payloadEdges });
  agg[k].runMedians.push(ms.inputToFrameMs); agg[k].slots.push(r.slot); agg[k].samples.push(...vs); agg[k].total += rs.length; agg[k].valid += vs.length;
}
fs.writeFileSync(path.join(OUT, "p8c-per-run.csv"), perRun.join("\n") + "\n");

const md = ["# P8-C/D 대규모 UI 반복 측정 요약", "", "ms, 시간 기준 = 입력 → 두 번째 rAF(프레임 콜백, P6와 동일). 실제 페인트가 아님. 표본 통계는 유효 표본을 모은 값이며, 독립 단위는 실행(VS Code 1회)이다.", ""];
md.push("## 조건별 통계 (입력→프레임 콜백)", "", "| 파일 | 시나리오 | 캐시 | 실행 수 | 유효/전체 표본 | 평균 | 중앙값 | 최소 | 최대 | P95 | 실행별 중앙값 | 화면 반영 성공 |", "|---:|---|---|---:|---|---:|---:|---:|---:|---:|---|---|");
const csv = [["files", "scenario", "cache", "runs", "validSamples", "totalSamples", "mean", "median", "min", "max", "p95", "runMedians", "slots"].join(",")];
for (const n of [1000, 2000]) for (const sc of scen) for (const c of ["off", "on"]) {
  const a = agg[`${n}|${sc}|${c}`]; if (!a) continue;
  const v = a.samples.map((x) => x.inputToFrameMs);
  md.push(`| ${n} | ${sc} | ${c} | ${a.runMedians.length} | ${a.valid}/${a.total} | ${f1(mean(v))} | ${f1(med(v))} | ${f1(Math.min(...v))} | ${f1(Math.max(...v))} | ${f1(pct(v, 0.95))} | ${a.runMedians.map(f1).join(" / ")} (slot ${a.slots.join(",")}) | ${sc === "active-edit" ? `${a.valid}/${a.total}` : "—"} |`);
  csv.push([n, sc, c, a.runMedians.length, a.valid, a.total, f1(mean(v)), f1(med(v)), f1(Math.min(...v)), f1(Math.max(...v)), f1(pct(v, 0.95)), `"${a.runMedians.map(f1).join(" ")}"`, `"${a.slots.join(" ")}"`].join(","));
}
md.push("", "P95는 조건당 표본 3–15개에서 계산한 nearest-rank 값이라 사실상 상위 1–2개 값이다. 해석을 제한한다.", "");
md.push("## 캐시 ON/OFF (실행별 중앙값 기준, 사전 규칙)", "", "| 파일 | 시나리오 | OFF 실행별 중앙값 | ON 실행별 중앙값 | Δ(중앙값의 중앙값, OFF−ON) | 판정 |", "|---:|---|---|---|---:|---|");
for (const n of [1000, 2000]) for (const sc of scen) {
  const off = agg[`${n}|${sc}|off`]?.runMedians ?? [], on = agg[`${n}|${sc}|on`]?.runMedians ?? [];
  let v = "실행 수 부족";
  if (off.length >= 3 && on.length >= 3) v = Math.max(...on) < Math.min(...off) ? "ON 빠름(완전 분리)" : Math.max(...off) < Math.min(...on) ? "OFF 빠름(완전 분리)" : "일관되지 않음";
  md.push(`| ${n} | ${sc} | ${off.map(f1).join(" / ")} | ${on.map(f1).join(" / ")} | ${f1(med(off) - med(on))} | ${v} |`);
}
md.push("", "## 구간 분해 (유효 표본 중앙값, OFF / ON)", "", "| 파일 | 시나리오 | 입력→결과 | 결과→DOM | DOM→프레임 콜백 |", "|---:|---|---|---|---|");
for (const n of [1000, 2000]) for (const sc of ["repeated-generate", "active-edit"]) {
  const g = (c, m) => f1(med((agg[`${n}|${sc}|${c}`]?.samples ?? []).map((x) => x[m])));
  md.push(`| ${n} | ${sc} | ${g("off", "inputToResultMs")} / ${g("on", "inputToResultMs")} | ${g("off", "resultToDomSettledMs")} / ${g("on", "resultToDomSettledMs")} | ${g("off", "domSettledToFrameMs")} / ${g("on", "domSettledToFrameMs")} |`);
}
md.push("", "## 실행 순서(slot)에 따른 변동", "", "| 파일 | 시나리오 | 캐시 | slot: 실행별 중앙값 |", "|---:|---|---|---|");
for (const n of [1000, 2000]) for (const sc of scen) for (const c of ["off", "on"]) {
  const a = agg[`${n}|${sc}|${c}`]; if (!a) continue;
  md.push(`| ${n} | ${sc} | ${c} | ${a.slots.map((s, i) => `${s}: ${f1(a.runMedians[i])}`).join(", ")} |`);
}
md.push("", "## 실행 상태", "", `총 ${runs.length}, 유효 ${runs.filter((r) => r.valid).length}, 무효 ${runs.filter((r) => !r.valid).length}`, ...runs.filter((r) => !r.valid).map((r) => `- 무효 ${r.runId}: ${r.invalidReason}`));
md.push(`- 실제 분석 파일 수(payload meta.rootFiles): ${[...new Set(runs.map((r) => `${r.files}→${r.rootFiles}`))].join(", ")}`);
md.push(`- 실행 전 가용 메모리 범위: ${Math.min(...runs.map((r) => r.availableMB))}–${Math.max(...runs.map((r) => r.availableMB))} MB, 세션 잠금: ${[...new Set(runs.map((r) => r.sessionLocked))].join("/")}`);
fs.writeFileSync(path.join(OUT, "p8c-summary.md"), md.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "p8c-conditions.csv"), csv.join("\n") + "\n");
console.log(md.join("\n"));
