// P8-B trace analyzer. All timestamps come from ONE Chromium trace (same clock, microseconds), no cross-process subtraction.
// Chain per traced update (webview renderer = process that emitted the p8:* user-timing marks):
//  T0 p8:T0 mark (Generate pointerdown, webview) | T2 p8:T2 mark (analysisResult message received)
//  T3 last p8:T3#k mark after T2 (MutationObserver callback for the last graph DOM mutation) | T4 matching p8:T4#k (2nd rAF)
//  T5 first Paint on the renderer main thread, ts >= T3, whose nodeName is a React Flow graph container
//     (react-flow__nodes / __edges / __viewport / react-flow) in the same frame id  -> "graph Paint"
//  C  first main-thread Commit with ts >= T5 end | A first compositor ActivateLayerTree >= C
//  F  first compositor DrawFrame >= A (frameSeqId = N)
//  T6a begin of SubmitCompositorFrameToPresentationCompositorFrame for the PipelineReporter whose frame_sequence = N
//  T6b end of that PipelineReporter / Submit…Presentation span = Chromium presentation-feedback timestamp
//  T1 (extension-host analysis start) is NOT in the Chromium trace -> reported as not measured.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

function load(f) { const j = JSON.parse(fs.readFileSync(f, "utf8")); return Array.isArray(j) ? j : j.traceEvents; }

function pairAsync(events, name) {
  // pair b/e by (pid, tid, id2.local|id) in ts order
  const open = new Map(), out = [];
  for (const e of events.filter((x) => x.name === name && (x.ph === "b" || x.ph === "e")).sort((a, b) => a.ts - b.ts || (a.ph === "b" ? -1 : 1))) {
    const key = `${e.pid}:${e.tid}:${e.id2?.local ?? e.id2?.global ?? e.id}`;
    if (e.ph === "b") { (open.get(key) ?? open.set(key, []).get(key)).push(e); }
    else { const st = open.get(key); const b = st?.shift(); if (b) out.push({ b, e, begin: b.ts, end: e.ts, args: b.args }); }
  }
  return out;
}

function analyze(file) {
  const ev = load(file);
  const marks = ev.filter((e) => String(e.name).startsWith("p8:"));
  if (!marks.length) return { file, error: "no p8 marks" };
  const pid = marks[0].pid;
  const mt = marks[0].tid;
  const m = (n) => marks.find((x) => x.name === n)?.ts;
  const T0 = m("p8:T0");
  // T3 = last graph DOM mutation after T0; T2 = the last analysisResult received before T3 (the result that produced
  // the final graph). If >1 result arrived after T0 (a preceding auto-analysis), the trace is flagged multiResult and
  // excluded from T0→T2 statistics; the post-T2 render chain is still valid.
  const results = marks.filter((x) => x.name === "p8:T2" && x.ts > T0).sort((a, b) => a.ts - b.ts);
  const t3s = marks.filter((x) => x.name.startsWith("p8:T3#") && x.ts > (results[0]?.ts ?? Infinity)).sort((a, b) => a.ts - b.ts);
  const last3 = t3s[t3s.length - 1];
  const T3 = last3?.ts;
  const T2 = results.filter((x) => x.ts <= (T3 ?? Infinity)).pop()?.ts;
  const multiResult = results.length > 1;
  const T4 = last3 ? m(last3.name.replace("T3", "T4")) : undefined;
  const R = ev.filter((e) => e.pid === pid);
  const graphPaint = R.filter((e) => e.name === "Paint" && e.tid === mt && e.ts >= T3 && /react-flow(__nodes|__edges|__viewport| |'|$)/.test(e.args?.data?.nodeName ?? "")).sort((a, b) => a.ts - b.ts)[0];
  const T5 = graphPaint?.ts;
  const T5end = graphPaint ? graphPaint.ts + (graphPaint.dur ?? 0) : undefined;
  const commit = R.filter((e) => e.name === "Commit" && e.tid === mt && e.ph === "X" && e.ts >= (T5end ?? Infinity)).sort((a, b) => a.ts - b.ts)[0];
  const ctid = R.find((e) => e.name === "DrawFrame")?.tid;
  const activate = R.filter((e) => e.name === "ActivateLayerTree" && e.tid === ctid && e.ts >= (commit?.ts ?? Infinity)).sort((a, b) => a.ts - b.ts)[0];
  const draw = R.filter((e) => e.name === "DrawFrame" && e.tid === ctid && e.ts >= (activate?.ts ?? Infinity)).sort((a, b) => a.ts - b.ts)[0];
  const N = draw?.args?.frameSeqId;
  const reporters = pairAsync(R, "PipelineReporter");
  // first reporter for frame N that was actually presented; if frame N was not presented (e.g. dropped),
  // take the first presented reporter with frame_sequence > N (flagged as nextPresented)
  const presentedRep = (r) => /PRESENTED/.test(String(r.args?.frame_reporter?.state));
  let rep = reporters.find((r) => r.args?.frame_reporter?.frame_sequence === N && presentedRep(r));
  let nextPresented = false;
  if (!rep && N !== undefined) { rep = reporters.filter((r) => (r.args?.frame_reporter?.frame_sequence ?? -1) > N && presentedRep(r)).sort((a, b) => a.args.frame_reporter.frame_sequence - b.args.frame_reporter.frame_sequence)[0]; nextPresented = !!rep; }
  const submits = pairAsync(R, "SubmitCompositorFrameToPresentationCompositorFrame");
  const sub = rep ? submits.find((s) => s.begin >= rep.begin && s.end <= rep.end + 1) : undefined;
  const state = rep?.args?.frame_reporter?.state;
  const ms = (a, b) => (a !== undefined && b !== undefined ? +((b - a) / 1000).toFixed(2) : null);
  const T6a = sub?.begin, T6b = rep?.end;
  // stage durations inside the graph frame on the renderer main thread between T3 and commit
  // union of intervals (Paint events nest: parent includes children) to avoid double counting
  const between = (name) => {
    const iv = R.filter((e) => e.name === name && e.tid === mt && e.ph === "X" && e.ts >= T3 && e.ts <= (commit?.ts ?? T3)).map((e) => [e.ts, e.ts + (e.dur ?? 0)]).sort((a, b) => a[0] - b[0]);
    let tot = 0, cs = -1, ce = -1;
    for (const [a, b] of iv) { if (a > ce) { if (ce > cs) tot += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); }
    if (ce > cs) tot += ce - cs;
    return tot / 1000;
  };
  // conservative upper bound: first reporter (any) at/after draw with state PRESENTED_ALL
  const repAll = reporters.filter((r) => r.begin >= (rep?.begin ?? Infinity) && /PRESENTED_ALL/.test(String(r.args?.frame_reporter?.state))).sort((a, b) => a.end - b.end)[0];
  return {
    file: path.basename(file), rendererPid: pid, frameId: graphPaint?.args?.data?.frame ?? null, graphPaintNode: graphPaint?.args?.data?.nodeName ?? null,
    resultsAfterT0: results.length, multiResult, frameSeq: N ?? null, presentedFrameSeq: rep?.args?.frame_reporter?.frame_sequence ?? null, nextPresented, reporterState: state ?? null,
    ts_us: { T0, T2, T3, T4, T5, T5end, commit: commit?.ts, activate: activate?.ts, draw: draw?.ts, T6a, T6b },
    ms: {
      "T0→T2": ms(T0, T2), "T2→T3": ms(T2, T3), "T3→T4(2nd rAF)": ms(T3, T4), "T3→T5(graph Paint start)": ms(T3, T5),
      "T5 Paint dur": graphPaint ? +((graphPaint.dur ?? 0) / 1000).toFixed(2) : null, "T5end→Commit": ms(T5end, commit?.ts),
      "Commit→Draw": ms(commit?.ts, draw?.ts), "T3→T6a(submit)": ms(T3, T6a), "T3→T6b(presentation feedback)": ms(T3, T6b),
      "T0→T4": ms(T0, T4), "T0→T6b": ms(T0, T6b), "T4 vs T6b (T6b−T4)": ms(T4, T6b), "T3→T6b' (first PRESENTED_ALL, upper bound)": ms(T3, repAll?.end),
    },
    mainThreadBetweenT3andCommit_ms: { Layout: +between("Layout").toFixed(2), PrePaint: +between("PrePaint").toFixed(2), Paint: +between("Paint").toFixed(2), Layerize: +between("Layerize").toFixed(2) },
    checks: {
      orderOK: [T0, T2, T3, T5, commit?.ts, draw?.ts, T6a, T6b].every((v, i, a) => v !== undefined && (i === 0 || v >= a[i - 1])),
      paintIsGraph: !!graphPaint, reporterFound: !!rep, presented: /PRESENTED/.test(String(state ?? "")),
    },
  };
}

const files = process.argv.slice(2);
const res = files.map(analyze);
console.log(JSON.stringify(res, null, 2));
