// P8-F summary. Unit = run (VS Code launch). For each (size, state, op): per-run values, then median [min–max] over runs.
// A run's op counts toward performance only if its correctness check passed (no correction of failures).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const RUNS = "<RESULTS>\\p8-final\\runs";
const OUT = process.argv[2] || "<RESULTS>\\p8-final";
const PREFIX = process.argv[3] || "p8f-s";
const med = (a) => { const b = a.filter(Number.isFinite).sort((p, q) => p - q), n = b.length; return !n ? NaN : n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const rng = (a) => { const b = a.filter(Number.isFinite); return b.length ? `${f1(med(b))} [${f1(Math.min(...b))}–${f1(Math.max(...b))}]` : "—"; };

const envs = fs.readdirSync(RUNS).filter((x) => x.startsWith(PREFIX) && x.endsWith(".env.json")).map((x) => JSON.parse(fs.readFileSync(path.join(RUNS, x), "utf8").replace(/^\uFEFF/, "")));
const runs = [];
for (const e of envs) {
  const dir = e.resultsDir;
  if (!dir || !fs.existsSync(dir) || fs.existsSync(path.join(dir, "INVALID_RUN.txt")) || fs.existsSync(path.join(dir, "PILOT_RUN.txt"))) continue;
  const sub = fs.readdirSync(dir).find((d) => d.startsWith("p8f-"));
  const j = sub && fs.existsSync(path.join(dir, sub, "interaction.json")) ? JSON.parse(fs.readFileSync(path.join(dir, sub, "interaction.json"), "utf8")) : null;
  if (!j || e.exit !== 0) { runs.push({ runId: e.runId, valid: false }); continue; }
  const size = Number(/s(\d+)/.exec(j.label)[1]);
  runs.push({ runId: e.runId, valid: true, size, j, availableMB: e.availableMB, cpuLoadPct: e.cpuLoadPct });
}
const ok = runs.filter((r) => r.valid);
const sizes = [...new Set(ok.map((r) => r.size))].sort((a, b) => a - b);
const states = ["collapsed", "expanded"];
const ops = ["idle", "pan", "zoom", "node-drag(attempt)", "group toggle (2 clicks)", "node selection"];
const md = [`# P8-F 그래프 조작 성능 요약 (${PREFIX})`, "", "측정 기준: webview rAF 콜백 간격(프레임 콜백 기반 프레임 시간, Paint/표시 아님), 입력 이벤트→다음 rAF 지연, Electron getAppMetrics CPU(%)/작업집합. 값 = 실행별 값의 중앙값 [최소–최대] (실행 수). 성능 통계는 정확성 검증을 통과한 실행만 사용.", ""];
md.push("## 그래프 크기(실행 1 기준)", "", "| 파일 | payload 노드/엣지 | 접힘 상태 DOM 노드/엣지, 그룹(접힘) | 확장 그룹 수 | 확장 상태 DOM 노드/엣지 | Fit 배율(접힘/확장) |", "|---:|---|---|---:|---|---|");
for (const n of sizes) { const j = ok.find((r) => r.size === n).j; const c = j.stateCollapsed, x = j.stateExpanded;
  md.push(`| ${n} | ${j.graphPayload?.n}/${j.graphPayload?.e} | ${c.domNodes}/${c.domEdges}, ${c.groupsInDom}(${c.collapsedInDom}) | ${j.expandedGroups} | ${x.domNodes}/${x.domEdges} | ${c.scale.toFixed(3)} / ${x.scale.toFixed(3)} |`); }
const csv = [["size", "state", "op", "runs", "correctRuns", "fps", "frameMedian", "frameP95", "frameP99", "over33Pct", "over50Pct", "inputLatMedian", "inputLatP95", "cpuTab", "cpuGPU", "cpuBrowser", "wsMB"].join(",")];
for (const st of states) {
  md.push("", `## ${st === "collapsed" ? "기본(접힘) 상태" : "확장 상태"}`, "", "| 파일 | 조작 | 정확 실행 | FPS | 프레임 중앙값 ms | P95 | P99 | >33.3ms % | ≥50ms % | 입력→다음 rAF 중앙값 / P95 ms | CPU% Tab / GPU |", "|---:|---|---|---|---|---|---|---|---|---|---|");
  for (const n of sizes) for (const o of ops) {
    const all = ok.filter((r) => r.size === n).map((r) => r.j.ops.find((x) => x.state === st && x.name === o)).filter(Boolean);
    const good = all.filter((x) => x.correct);
    const v = (k) => good.map((x) => x[k]);
    md.push(`| ${n} | ${o} | ${good.length}/${all.length} | ${rng(v("fps"))} | ${rng(v("frameMedianMs"))} | ${rng(v("frameP95Ms"))} | ${rng(v("frameP99Ms"))} | ${rng(v("over33Pct"))} | ${rng(v("over50Pct"))} | ${f1(med(v("inputLatencyMedianMs")))} / ${f1(med(v("inputLatencyP95Ms")))} | ${f1(med(good.map((x) => x.cpuPctByType?.Tab)))} / ${f1(med(good.map((x) => x.cpuPctByType?.GPU)))} |`);
    csv.push([n, st, `"${o}"`, all.length, good.length, ...["fps", "frameMedianMs", "frameP95Ms", "frameP99Ms", "over33Pct", "over50Pct", "inputLatencyMedianMs", "inputLatencyP95Ms"].map((k) => f1(med(v(k)))), f1(med(good.map((x) => x.cpuPctByType?.Tab))), f1(med(good.map((x) => x.cpuPctByType?.GPU))), f1(med(good.map((x) => x.cpuPctByType?.Browser))), f1(med(good.map((x) => x.workingSetMB)))].join(","));
  }
}
const failed = ok.flatMap((r) => r.j.ops.filter((x) => !x.correct).map((x) => `- ${r.runId} ${x.state} ${x.name}: ${x.correctness}`));
md.push("", "## 정확성 실패(성능 통계에서 제외)", "", ...(failed.length ? failed : ["- 없음"]), "", `## 실행: 유효 ${ok.length}, 무효 ${runs.length - ok.length}; 실행 전 가용 메모리 ${Math.min(...ok.map((r) => r.availableMB))}–${Math.max(...ok.map((r) => r.availableMB))} MB`);
fs.writeFileSync(path.join(OUT, `${PREFIX.replace(/-s$/, "")}-summary.md`), md.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, `${PREFIX.replace(/-s$/, "")}-ops.csv`), csv.join("\n") + "\n");
console.log(md.join("\n"));
