// Long-task breakdown on the webview renderer main thread between two user-timing marks.
// Usage: node trace-longtasks.cjs <trace.json> <startMark> <endMark|+ms>
// Top-level tasks = "ThreadControllerImpl::RunTask"/"RunTask" (toplevel) on CrRendererMain of the renderer that emitted the marks.
// For each long task (>= 33.3 ms): self-time union by category of nested events. Also PipelineReporter states in the window.
"use strict";
const fs = require("node:fs");
const [file, sm, em] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(file, "utf8")); const ev = Array.isArray(j) ? j : j.traceEvents;
const mk = ev.filter((e) => String(e.name).startsWith("p8f:"));
const pid = mk[0]?.pid;
const t0 = mk.find((e) => e.name === sm)?.ts;
const t1 = em.startsWith("+") ? t0 + Number(em.slice(1)) * 1000 : mk.find((e) => e.name === em)?.ts;
const tname = {}; for (const e of ev) if (e.ph === "M" && e.name === "thread_name") tname[`${e.pid}:${e.tid}`] = e.args.name;
const PID = Number(process.env.PID || pid); // default: webview renderer (emitted the marks); PID=<other> for workbench renderer
const mainTid = Number(Object.entries(tname).find(([k, v]) => k.startsWith(`${PID}:`) && v === "CrRendererMain")?.[0].split(":")[1]);
const M = ev.filter((e) => e.pid === PID && e.tid === mainTid && e.ph === "X" && e.ts >= t0 && e.ts <= t1);
const top0 = M.filter((e) => /^(ThreadControllerImpl::RunTask|RunTask)$/.test(e.name)).sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
const top = []; let lastEnd = -1;
for (const t of top0) { if (t.ts >= lastEnd) { top.push(t); lastEnd = t.ts + (t.dur ?? 0); } } // drop tasks nested in an earlier top-level task
const cats = [["JS (FunctionCall/EventDispatch/TimerFire/FireAnimationFrame/RunMicrotasks/V8.Execute)", /^(FunctionCall|EventDispatch|TimerFire|FireAnimationFrame|RunMicrotasks|V8\.Execute|v8\.callFunction|v8\.run)$/],
  ["Style (UpdateLayoutTree/RecalculateStyles)", /^(UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet)$/], ["Layout", /^Layout$/], ["PrePaint", /^PrePaint$/], ["Paint", /^(Paint|PaintImage)$/],
  ["Layerize/Commit", /^(Layerize|Commit|UpdateLayer)$/], ["HitTest", /^HitTest$/], ["GC", /^(MinorGC|MajorGC|V8\.GC.*|BlinkGC.*)$/]];
const union = (iv) => { iv.sort((a, b) => a[0] - b[0]); let tot = 0, cs = -1, ce = -1; for (const [a, b] of iv) { if (a > ce) { if (ce > cs) tot += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); } if (ce > cs) tot += ce - cs; return tot / 1000; };
const long = top.filter((t) => (t.dur ?? 0) >= 33300).map((t) => {
  const inside = M.filter((e) => e !== t && e.ts >= t.ts && e.ts + (e.dur ?? 0) <= t.ts + t.dur + 1);
  const br = Object.fromEntries(cats.map(([n, re]) => [n, +union(inside.filter((e) => re.test(e.name)).map((e) => [e.ts, e.ts + (e.dur ?? 0)])).toFixed(1)]));
  const fn = inside.filter((e) => e.name === "FunctionCall" || e.name === "EventDispatch" || e.name === "TimerFire").sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0)).slice(0, 3)
    .map((e) => `${e.name}:${e.args?.data?.type ?? e.args?.data?.functionName ?? ""}@${(e.args?.data?.url ?? "").split("/").pop()}:${e.args?.data?.lineNumber ?? ""}:${e.args?.data?.columnNumber ?? ""} ${((e.dur ?? 0) / 1000).toFixed(1)}ms`);
  const layoutObjs = inside.filter((e) => e.name === "Layout").map((e) => e.args?.beginData?.dirtyObjects ?? 0).reduce((s, x) => s + x, 0);
  return { atMs: +((t.ts - t0) / 1000).toFixed(1), durMs: +(t.dur / 1000).toFixed(1), ...br, topJS: fn, layoutDirtyObjects: layoutObjs };
});
const reps = ev.filter((e) => e.pid === pid && e.name === "PipelineReporter" && e.ph === "b" && e.ts >= t0 && e.ts <= t1 && !e.args?.frame_reporter?.frame_type);
const states = {}; for (const r of reps) { const s = r.args?.frame_reporter?.state ?? "?"; states[s] = (states[s] ?? 0) + 1; }
const allTasks = top.reduce((s, t) => s + (t.dur ?? 0), 0) / 1000;
const renderers = [...new Set(ev.filter((e) => e.ph === "M" && e.name === "process_name" && e.args.name === "Renderer").map((e) => e.pid))];
console.log(JSON.stringify({ pid: PID, webviewPid: pid, renderers, file: file.split(/[\\/]/).slice(-3).join("/"), window: [sm, em], windowMs: +((t1 - t0) / 1000).toFixed(0), mainThreadBusyMs: +allTasks.toFixed(1), longTasks: long.length, longTaskMs: +long.reduce((s, x) => s + x.durMs, 0).toFixed(1), frameReporterStates: states, long }, null, 1));
