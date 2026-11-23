// P13 aggregation. node aggregate-p13.cjs <outDir>
// Stage A: tasks.csv of the unchanged P3 specs (status mapped to the P13 classes, pre-registered mapping).
// Stage B: p13-tasks.json of p13-real.spec.ts. Representative class = class seen in >= 2 of 3 runs (pre-registered).
"use strict";
const fs = require("node:fs"), path = require("node:path");
const [outDir] = process.argv.slice(2);
const RUNS = "<HARNESS_WORKDIR>/harness/e2e-results/runs";
fs.mkdirSync(outDir, { recursive: true });
const readEnv = (dir, prefix) => fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".env.json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8").replace(/^\uFEFF/, "")));
const majority = (xs) => { const c = {}; for (const x of xs) c[x] = (c[x] || 0) + 1; const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return top && top[1] >= 2 ? top[0] : `MIXED(${xs.join("/")})`; };
const med = (a) => { const s = a.filter((x) => typeof x === "number").sort((x, y) => x - y); if (!s.length) return ""; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const esc = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// ---------------- Stage A
const mapA = (st, notes) => st === "pass" ? "SUPPORTED_AND_VERIFIED" : st === "partial" ? "PARTIALLY_SUPPORTED" : st === "unsupported" ? "UNSUPPORTED_BY_DESIGN" : st === "fail" ? "EXECUTION_FAILED" : /No usable worker runtime|worker unavailable/i.test(notes) ? "ENVIRONMENT_BLOCKED" : st === "unverified" ? "ENVIRONMENT_BLOCKED" : "NOT_TESTED";
const envA = readEnv("<P13>/data/stage-a", "p13a-");
const rowsA = [];
for (const e of envA) {
  const dir = path.join(RUNS, e.runId); if (!fs.existsSync(dir)) continue;
  for (const suite of fs.readdirSync(dir)) {
    const rj = path.join(dir, suite, "result.json"); if (!fs.existsSync(rj)) continue;
    const r = JSON.parse(fs.readFileSync(rj, "utf8"));
    for (const t of r.tasks ?? []) rowsA.push({ run: e.run, runId: e.runId, tool: t.tool, task: t.task, raw: t.status, cls: mapA(t.status, t.notes ?? ""), ops: t.userOperations, switches: t.fileSwitches, returnOps: t.returnOperations, graphPersists: t.graphPanelPersists, startPersists: t.startingFocusPersists, selectionPersists: t.selectionPersists, staticCalls: t.staticCallsShown, dataflow: t.dataflowShown, debugFrame: t.debugFrameMapped, notes: (t.notes ?? "").slice(0, 400) });
  }
}
const keyA = (r) => `${r.tool}|${r.task}`;
const sumA = [];
for (const k of [...new Set(rowsA.map(keyA))]) {
  const rs = rowsA.filter((r) => keyA(r) === k).sort((a, b) => a.run - b.run);
  sumA.push({ tool: rs[0].tool, task: rs[0].task, runs: rs.length, classes: rs.map((r) => r.cls).join("/"), representative: majority(rs.map((r) => r.cls)), ops: rs.map((r) => r.ops).join("/"), switches: rs.map((r) => r.switches).join("/"), returnOps: rs.map((r) => r.returnOps ?? "").join("/"), graphPersists: rs[0].graphPersists, startPersists: rs[0].startPersists, selectionPersists: rs[0].selectionPersists, staticCalls: rs[0].staticCalls, dataflow: rs[0].dataflow, debugFrame: rs[0].debugFrame });
}
const colsA = ["tool", "task", "runs", "classes", "representative", "ops", "switches", "returnOps", "graphPersists", "startPersists", "selectionPersists", "staticCalls", "dataflow", "debugFrame"];
fs.writeFileSync(path.join(outDir, "stage-a-summary.csv"), [colsA.join(","), ...sumA.map((r) => colsA.map((c) => esc(r[c])).join(","))].join("\n") + "\n");
fs.writeFileSync(path.join(outDir, "stage-a-per-run.json"), JSON.stringify(rowsA, null, 1));

// ---------------- Stage B
const envB = readEnv("<P13>/data/stage-b", "p13b-");
const rowsB = [];
for (const e of envB) {
  const dir = path.join(RUNS, e.runId);
  const suite = fs.existsSync(dir) ? fs.readdirSync(dir).find((s) => fs.existsSync(path.join(dir, s, "p13-tasks.json"))) : null;
  if (!suite) { rowsB.push({ run: e.run, runId: e.runId, task: e.task, toolKey: e.tool, kind: "ALL", cls: e.skipped ? "NOT_TESTED" : "EXECUTION_FAILED", note: e.skipped || `no p13-tasks.json (exit ${e.exit})` }); continue; }
  // failed UI steps recorded by the harness (used for the documented judgment corrections C1-C3)
  const log = fs.readFileSync(path.join(dir, suite, "run.log"), "utf8").split(/\r?\n/);
  const failed = new Set(); log.forEach((l, i) => { if (/FAILED:/.test(l)) { for (let j = i - 1; j >= 0; j--) { const m = /STEP (\S+)/.exec(log[j]); if (m) { failed.add(m[1]); break; } } } });
  const tasks = JSON.parse(fs.readFileSync(path.join(dir, suite, "p13-tasks.json"), "utf8"));
  for (const t of tasks) {
    const kind = t.task.split("-")[1];
    let cls = t.status, correction = "";
    if (t.tool === "Trace Function Flow" && kind === "R2" && failed.has("r2-select-target") && cls === "UNSUPPORTED_BY_DESIGN") { cls = "EXECUTION_FAILED"; correction = "C1: target node could not be selected; unsupported requires the detail panel to be read after selection"; }
    if (t.tool === "VS Code" && kind === "R3" && failed.has("r3-open-target-row")) { cls = "EXECUTION_FAILED"; correction = "C3: target row absent from Call Hierarchy; the editor was already on the target file from the R2 Go to Definition chain"; }
    rowsB.push({ run: e.run, runId: e.runId, task: e.task, toolKey: e.tool, tool: t.tool, kind, rawClass: t.status, cls, correction, failedSteps: [...failed].join(" "), ops: t.userOperations, switches: t.fileSwitches, automationMs: t.automationMs, returnOps: t.returnOperations ?? "", detail: t });
  }
  for (const k of ["R1", "R2", "R3"]) if (!tasks.some((t) => t.task.endsWith("-" + k))) {
    rowsB.push({ run: e.run, runId: e.runId, task: e.task, toolKey: e.tool, tool: tasks[0]?.tool ?? e.tool, kind: k, rawClass: "(not recorded)", cls: "EXECUTION_FAILED", correction: `C2: the spec ended (exit ${e.exit}) before recording ${k}; no tool view existed to perform it`, failedSteps: [...failed].join(" "), ops: "", switches: "", returnOps: "", detail: {} });
  }
}
const keyB = (r) => `${r.task}|${r.toolKey}|${r.kind}`;
const sumB = [];
for (const k of [...new Set(rowsB.map(keyB))]) {
  const rs = rowsB.filter((r) => keyB(r) === k).sort((a, b) => a.run - b.run);
  const d = rs[0].detail ?? {};
  sumB.push({ task: rs[0].task, tool: rs[0].tool ?? rs[0].toolKey, kind: rs[0].kind, runs: rs.length, rawClasses: rs.map((r) => r.rawClass ?? r.cls).join("/"), corrections: [...new Set(rs.map((r) => (r.correction ?? "").split(":")[0]).filter(Boolean))].join(" "), classes: rs.map((r) => r.cls).join("/"), representative: majority(rs.map((r) => r.cls)), ops: rs.map((r) => r.ops).join("/"), opsMedian: med(rs.map((r) => r.ops)), switches: rs.map((r) => r.switches).join("/"), returnOps: rs.map((r) => r.returnOps).join("/"),
    pairs: d.pairs ? Object.entries(d.pairs).map(([p, v]) => `${p}:${v ? "Y" : "N"}`).join(" ") : "", segments: d.segments ? d.segments.map((s) => `${s.id}:${s.edge ? (s.viaGraphEdge ? "edge" : s.viaParamFlowRow ? "row" : "Y") : "N"}`).join(" ") : (d.segmentsShown ? `shown=${d.segmentsShown.join("|")} callSite=${d.callSite ?? ""}` : ""),
    viewKept: d.viewKept ?? "", generateMs: rs.map((r) => r.detail?.generateMs ?? "").join("/"), automationMsMedian: med(rs.map((r) => r.automationMs)) });
}
const colsB = ["task", "tool", "kind", "runs", "rawClasses", "corrections", "classes", "representative", "ops", "opsMedian", "switches", "returnOps", "pairs", "segments", "viewKept", "generateMs", "automationMsMedian"];
sumB.sort((a, b) => (a.task + a.kind + a.tool < b.task + b.kind + b.tool ? -1 : 1));
fs.writeFileSync(path.join(outDir, "stage-b-summary.csv"), [colsB.join(","), ...sumB.map((r) => colsB.map((c) => esc(r[c])).join(","))].join("\n") + "\n");
fs.writeFileSync(path.join(outDir, "stage-b-per-run.json"), JSON.stringify(rowsB, null, 1));
const fails = [...envA, ...envB].filter((e) => e.skipped || e.exit !== 0).map((e) => ({ runId: e.runId, exit: e.exit, skipped: e.skipped ?? "" }));
fs.writeFileSync(path.join(outDir, "run-status.json"), JSON.stringify({ stageA: envA.length, stageB: envB.length, nonZeroOrSkipped: fails }, null, 1));
console.log(`stage A rows=${rowsA.length} summary=${sumA.length}; stage B rows=${rowsB.length} summary=${sumB.length}; nonzero/skip=${fails.length}`);
for (const r of sumB) console.log(r.task, r.kind, r.tool.padEnd(20), r.representative.padEnd(24), "ops", r.ops, r.pairs || r.segments);
