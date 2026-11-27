// Where a traced pan's time goes (from P15-P0, with a split at the mouse up): busy time (union of event intervals) per thread of the webview
// renderer and the GPU process, inside the pan window (performance marks pa-start / pa-end), and
// the GPU main thread's time inside Present.
//   node e2e/pan-attribution/analyze-trace.mjs <trace-*.json> [...]
import fs from "node:fs";

const analyze = (file) => {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const ev = Array.isArray(raw) ? raw : raw.traceEvents;
  const pname = {};
  const tname = {};
  for (const e of ev) {
    if (e.ph !== "M") continue;
    if (e.name === "process_name") pname[e.pid] = e.args.name;
    if (e.name === "thread_name") tname[`${e.pid}/${e.tid}`] = e.args.name;
  }
  const mark = (n) => ev.find((e) => e.name === n && /user_timing/.test(e.cat ?? ""));
  const s = mark("pa-start");
  const f = mark("pa-end");
  if (!s || !f) throw new Error(`${file}: pan marks missing`);
  const A = s.ts;
  const B = f.ts;
  // complete intervals per thread (X events, and B/E pairs)
  const byThread = new Map();
  const open = new Map();
  for (const e of ev) {
    if (e.ts == null) continue;
    const k = `${e.pid}/${e.tid}`;
    if (e.ph === "X") {
      if (!byThread.has(k)) byThread.set(k, []);
      byThread.get(k).push({ name: e.name, ts: e.ts, dur: e.dur ?? 0 });
    } else if (e.ph === "B") {
      if (!open.has(k)) open.set(k, []);
      open.get(k).push(e);
    } else if (e.ph === "E") {
      const b = open.get(k)?.pop();
      if (b) {
        if (!byThread.has(k)) byThread.set(k, []);
        byThread.get(k).push({ name: b.name, ts: b.ts, dur: e.ts - b.ts });
      }
    }
  }
  const union = (list, a = A, b = B) => {
    const iv = list.map((x) => [Math.max(a, x.ts), Math.min(b, x.ts + x.dur)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
    let total = 0;
    let end = -Infinity;
    for (const [a, b] of iv) {
      if (b <= end) continue;
      total += b - Math.max(a, end);
      end = b;
    }
    return Math.round(total / 100) / 10; // ms
  };
  const threads = (pid, re) => Object.entries(tname).filter(([k, n]) => k.startsWith(`${pid}/`) && re.test(n)).map(([k]) => byThread.get(k) ?? []);
  const gpuPid = Number(Object.keys(pname).find((p) => pname[p] === "GPU Process"));
  const rpid = s.pid;
  const rMain = byThread.get(`${s.pid}/${s.tid}`) ?? [];
  const comp = threads(rpid, /^Compositor$/).flat();
  const raster = threads(rpid, /CompositorTileWorker/);
  const gpuMain = threads(gpuPid, /^CrGpuMain$/).flat();
  const viz = threads(gpuPid, /^VizCompositorThread$/).flat();
  const named = (list, re) => list.filter((x) => re.test(x.name));
  return {
    file,
    windowMs: Math.round((B - A) / 100) / 10,
    rendererMainBusy: union(rMain),
    rendererMain: {
      paint: union(named(rMain, /^(Paint|PaintImage|Layerize|UpdateLayer|PrePaint)$/)),
      layout: union(named(rMain, /^(Layout|UpdateLayoutTree|RecalculateStyles)$/)),
      script: union(named(rMain, /^(FunctionCall|EvaluateScript|FireAnimationFrame|EventDispatch|TimerFire|v8\.callFunction)$/)),
      commit: union(named(rMain, /^(Commit|ProxyMain::BeginMainFrame::commit)$/)),
    },
    compositorBusy: union(comp),
    rasterBusy: raster.map((t) => union(t)),
    rasterTasks: raster.flat().filter((x) => x.name === "RasterTask" && x.ts < B && x.ts + x.dur > A).length,
    gpuMainBusy: union(gpuMain),
    gpuPresent: union(named(gpuMain, /Present/)),
    gpuRaster: union(named(gpuMain, /DoRasterCHROMIUM$|DoEndRasterCHROMIUM$/)),
    vizBusy: union(viz),
    // split at the mouse up (mark pa-up): the drag, and the restoration after it
    ...(() => {
      const u = mark("pa-up");
      if (!u) return {};
      const U = u.ts;
      const raster = named(gpuMain, /DoRasterCHROMIUM$|DoEndRasterCHROMIUM$/);
      return {
        dragMs: Math.round((U - A) / 100) / 10,
        afterMs: Math.round((B - U) / 100) / 10,
        gpuRasterDrag: union(raster, A, U),
        gpuRasterAfter: union(raster, U, B),
        gpuMainAfter: union(gpuMain, U, B),
        rendererMainAfter: union(rMain, U, B),
      };
    })(),
  };
};

const rows = process.argv.slice(2).map(analyze);
for (const r of rows) console.log(JSON.stringify(r));
