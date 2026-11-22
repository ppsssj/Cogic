/**
 * P8-F: graph interaction performance in the real VS Code webview (measured AFTER analysis + Generate are done).
 * Operations (fixed paths/speeds/counts, real mouse input): idle, pan, zoom, node-drag attempt, group expand/collapse,
 * node selection; in the default (collapsed) state and after expanding up to MAX_EXPAND groups.
 * Light measurement: rAF timestamps in the webview (frame intervals) + input-event → next rAF latency;
 * Electron app.getAppMetrics() CPU/memory around each operation. One short contentTracing window per run
 * (idle 2 s + one pan) for Paint/compositor evidence. Correctness is checked per operation.
 * No product code changes. Env: P8_ACTIVE, P8_LABEL, P8_TRACE (1/0), P8_MAX_EXPAND.
 */
import { test } from "@playwright/test";
import type { Frame, Page, ElectronApplication } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle, codeCliVersion, VSCodeSession } from "./lib/vscode";
import { openCogicPanel, humanClick, waitGraphStable, fitGraph } from "./lib/cogic";
import { Recorder } from "./lib/recorder";

const ACTIVE = process.env.P8_ACTIVE ?? "entry.ts";
const LABEL = process.env.P8_LABEL ?? "synthetic";
const TRACE = (process.env.P8_TRACE ?? "1") === "1";
const MAX_EXPAND = Number(process.env.P8_MAX_EXPAND ?? 10);
// Diagnostic only: trace these ops ("state:name" list). Runs using it are diagnostic and must not be pooled with baseline stats.
const TRACE_OPS = (process.env.P8_TRACE_OPS ?? "").split(",").filter(Boolean);
const CATEGORIES = ["blink.user_timing", "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "toplevel", "benchmark", "cc", "viz", "v8.execute"];

async function installFrameProbe(f: Frame) {
  await f.evaluate(() => {
    const w = window as any;
    const F = (w.__fr = { on: false, raf: [] as number[], inputs: [] as any[], pendingInputs: [] as any[] });
    const tick = () => {
      const now = performance.now();
      if (F.on) { F.raf.push(now); for (const i of F.pendingInputs) F.inputs.push({ type: i.type, latency: now - i.t }); }
      F.pendingInputs = [];
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    for (const type of ["pointermove", "wheel", "pointerdown"]) {
      document.addEventListener(type, (e) => { if (F.on) F.pendingInputs.push({ type, t: e.timeStamp }); }, { capture: true, passive: true });
    }
  });
}
const start = (f: Frame) => f.evaluate(() => { const F = (window as any).__fr; F.raf = []; F.inputs = []; F.pendingInputs = []; F.on = true; performance.mark("p8f:start"); });
const stop = (f: Frame) => f.evaluate(() => { const F = (window as any).__fr; F.on = false; performance.mark("p8f:stop"); return { raf: F.raf as number[], inputs: F.inputs as any[] }; });

function frameStats(raf: number[], inputs: any[]) {
  const d = raf.slice(1).map((t, i) => t - raf[i]).sort((a, b) => a - b);
  const n = d.length;
  const q = (p: number) => (n ? d[Math.min(n - 1, Math.ceil(p * n) - 1)] : NaN);
  const med = n ? (n % 2 ? d[(n - 1) / 2] : (d[n / 2 - 1] + d[n / 2]) / 2) : NaN;
  const dur = raf.length > 1 ? raf[raf.length - 1] - raf[0] : NaN;
  const lat = inputs.map((x) => x.latency).sort((a, b) => a - b);
  const lq = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.ceil(p * lat.length) - 1)] : NaN);
  return {
    frames: raf.length, durationMs: +dur.toFixed(1), fps: +(n / (dur / 1000)).toFixed(1), frameMedianMs: +med.toFixed(2), frameP95Ms: +q(0.95).toFixed(2), frameP99Ms: +q(0.99).toFixed(2), frameMaxMs: +(d[n - 1] ?? NaN).toFixed(2),
    over33Pct: n ? +(100 * d.filter((x) => x > 33.3).length / n).toFixed(1) : NaN, over50Pct: n ? +(100 * d.filter((x) => x >= 50).length / n).toFixed(1) : NaN,
    inputEvents: lat.length, inputLatencyMedianMs: +lq(0.5).toFixed(2), inputLatencyP95Ms: +lq(0.95).toFixed(2),
  };
}

async function metrics(app: ElectronApplication) {
  return app.evaluate(({ app: a }) => a.getAppMetrics().map((m: any) => ({ pid: m.pid, type: m.type, cpu: m.cpu.percentCPUUsage, wsKB: m.memory.workingSetSize })));
}
function metricsDelta(after: any[]) {
  const renderers = after.filter((m) => m.type === "Tab" || m.type === "Utility" || m.type === "GPU" || m.type === "Browser");
  return { cpuPctByType: Object.fromEntries(["Browser", "Tab", "GPU"].map((t) => [t, +after.filter((m) => m.type === t).reduce((s, m) => s + m.cpu, 0).toFixed(1)])),
    workingSetMB: +(after.reduce((s, m) => s + m.wsKB, 0) / 1024).toFixed(0), processes: renderers.length };
}

async function graphState(f: Frame) {
  return f.evaluate(() => {
    const vp = document.querySelector(".react-flow__viewport") as HTMLElement | null;
    const m = /matrix\(([^)]+)\)/.exec(vp ? getComputedStyle(vp).transform : "");
    const v = m ? m[1].split(",").map(Number) : [1, 0, 0, 1, 0, 0];
    const groups = [...document.querySelectorAll(".react-flow__node-fileGroup")];
    return { scale: v[0], tx: v[4], ty: v[5], domNodes: document.querySelectorAll(".react-flow__node").length, domEdges: document.querySelectorAll(".react-flow__edge").length,
      animatedEdgesInDom: document.querySelectorAll(".react-flow__edge.animated").length, groupsInDom: groups.length, collapsedInDom: groups.filter((g) => g.querySelector(".cgGroup--collapsed")).length,
      selectedText: ((document.body.innerText.match(/SELECTED NODE[\s\S]{0,120}/) ?? [""])[0]).replace(/\s+/g, " ") };
  });
}

/** data-id of the first candidate whose click target centre is inside the canvas AND hit-testable (not covered). */
async function hittableId(f: Frame, kind: "collapsedGroup" | "expandedGroup" | "anyGroup" | "runEntry"): Promise<string | null> {
  return f.evaluate((k) => {
    const flow = document.querySelector(".react-flow")?.getBoundingClientRect(); if (!flow) return null;
    const groups = [...document.querySelectorAll(".react-flow__node-fileGroup")] as HTMLElement[];
    const cands: [HTMLElement, HTMLElement][] =
      k === "runEntry" ? ([...document.querySelectorAll(".react-flow__node:not(.react-flow__node-fileGroup)")] as HTMLElement[]).filter((n) => [...n.querySelectorAll(".cgNodeTitle")].some((t) => /^\s*runEntry\(\)\s*$/.test(t.textContent ?? ""))).map((n) => [n, n])
      : groups.filter((g) => k === "anyGroup" || (k === "collapsedGroup") === !!g.querySelector(".cgGroup--collapsed")).map((g) => [g, g.querySelector("button.cgGroupHeader") as HTMLElement]).filter((x) => !!x[1]) as any;
    for (const [node, target] of cands) {
      const r = target.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (r.width < 2 || r.height < 2 || x <= flow.left + 2 || x >= flow.right - 2 || y <= flow.top + 2 || y >= flow.bottom - 2) continue;
      const hit = document.elementFromPoint(x, y); if (hit && target.contains(hit)) return node.getAttribute("data-id");
    }
    return null;
  }, kind);
}
const byId = (f: Frame, id: string) => f.locator(`.react-flow__node[data-id="${id.replace(/"/g, '\\"')}"]`).first();

test("P8-F graph interaction performance", async () => {
  const rec = new Recorder(`p8f-${LABEL}`);
  const ev: Record<string, any> = { label: LABEL, active: ACTIVE, maxExpand: MAX_EXPAND, ops: [] };
  const save = () => fs.writeFileSync(path.join(rec.dir, "interaction.json"), JSON.stringify(ev, null, 2));
  let s: VSCodeSession | undefined;
  try {
    s = (await rec.step("launch", () => launchVSCode({ profile: "p8f", extensions: ["cogic"], extraSettings: { "cogic.analysisCache.enabled": false } })))!;
    const { page, app } = s; rec.attach(page);
    ev.vscode = codeCliVersion();
    await rec.step("prepare", async () => { await quickOpenFile(page, ACTIVE); await waitTsReady(page); await waitTsServerIdle(page); });
    const f = await openCogicPanel(page);
    await f.locator('select[aria-label="Graph depth"]').selectOption("1");
    let payload: any = null;
    await f.evaluate(() => { (window as any).__p8last = null; window.addEventListener("message", (e) => { const d: any = e.data; const m = d?.type ? d : d?.data?.type ? d.data : null; if (m?.type === "analysisResult") (window as any).__p8last = { n: m.payload?.graph?.nodes?.length, e: m.payload?.graph?.edges?.length }; }, { capture: true }); });
    await rec.step("generate", async () => { await humanClick(f.locator("button", { hasText: /^\s*Generate\s*$/ }).first()); await waitGraphStable(f, { minNodes: 1, timeout: 180_000 }); });
    payload = await f.evaluate(() => (window as any).__p8last);
    ev.graphPayload = payload;
    await installFrameProbe(f);
    await page.waitForTimeout(2000); // analysis/render done; idle before measuring
    const flowBox = (await f.locator(".react-flow").first().boundingBox())!;
    const cx = flowBox.x + flowBox.width / 2, cy = flowBox.y + flowBox.height / 2;

    const prepView = async () => { await fitGraph(f); await page.mouse.move(5, 5); await page.waitForTimeout(800); };
    const op = async (state: string, name: string, act: () => Promise<any>, check: (before: any, after: any, extra: any) => { ok: boolean; detail: string }, prep: () => Promise<any> = prepView) => {
      await prep(); // standardized starting view (outside the measured window)
      await metrics(app); // reset CPU sampling window
      const before = await graphState(f);
      await start(f);
      let extra: any;
      const traced = TRACE_OPS.includes(`${state}:${name}`);
      const tfile = path.join(rec.dir, `trace-op-${state}-${name.replace(/[^a-z0-9]+/gi, "_")}.json`);
      if (traced) { await app.evaluate(async ({ contentTracing }, cats) => { await contentTracing.startRecording({ included_categories: cats, excluded_categories: ["*"] } as any); }, CATEGORIES); await f.evaluate(() => performance.mark("p8f:op-start")); }
      try { extra = await act(); } catch (e) { extra = { error: String(e).slice(0, 300) }; }
      if (traced) { await f.evaluate(() => performance.mark("p8f:op-end")); await app.evaluate(async ({ contentTracing }, p) => contentTracing.stopRecording(p), tfile); }
      const { raf, inputs } = await stop(f);
      const after = await graphState(f);
      const m = metricsDelta(await metrics(app));
      const c = extra?.error ? { ok: false, detail: `operation error: ${extra.error}` } : check(before, after, extra);
      ev.ops.push({ state, name, ...frameStats(raf, inputs), correct: c.ok, correctness: c.detail, before, after, ...m });
      save();
    };
    const pan = async () => { for (let k = 0; k < 3; k++) { for (const dy of [200, -200]) { await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + dy / 2, cy + dy, { steps: 30 }); await page.mouse.up(); } } };
    const zoom = async () => { await page.mouse.move(cx, cy); for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(60); } for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(60); } await page.waitForTimeout(300); };
    const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

    const runOps = async (state: string) => {
      await rec.step(`${state}-idle`, () => op(state, "idle", async () => { await page.waitForTimeout(2000); }, (b, a) => ({ ok: near(b.tx, a.tx, 0.5) && near(b.ty, a.ty, 0.5), detail: "viewport unchanged while idle" })));
      await rec.step(`${state}-pan`, () => op(state, "pan", pan, (b, a) => ({ ok: near(b.tx, a.tx, 3) && near(b.ty, a.ty, 3) && b.scale === a.scale, detail: `viewport returned to start after 3× (+200/−200 px) drags: Δtx=${(a.tx - b.tx).toFixed(1)}, Δty=${(a.ty - b.ty).toFixed(1)}` })));
      await rec.step(`${state}-zoom`, () => op(state, "zoom", async () => {
        await page.mouse.move(cx, cy);
        for (let k = 0; k < 3; k++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(80); }
        await page.waitForTimeout(300); const peak = (await graphState(f)).scale;
        for (let k = 0; k < 3; k++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(80); }
        await page.waitForTimeout(300); return { peakScale: peak };
      }, (b, a, x) => { const clamped = x.peakScale >= 2.19; return { ok: x.peakScale > b.scale * 1.2 && (clamped ? a.scale < x.peakScale : near(a.scale, b.scale, b.scale * 0.05)), detail: `scale ${b.scale.toFixed(3)} → peak ${x.peakScale.toFixed(3)}${clamped ? " (maxZoom clamp)" : ""} → ${a.scale.toFixed(3)}` }; }));
      // node drag: Cogic sets nodesDraggable={false}; verify the node does not move (drag pans the canvas instead)
      await rec.step(`${state}-node-drag`, () => op(state, "node-drag(attempt)", async () => {
        const hid = await hittableId(f, "anyGroup"); if (!hid) return { skipped: true };
        const node = byId(f, hid); const bb = await node.boundingBox(); if (!bb) return { skipped: true };
        const id = hid; const tr0 = await node.evaluate((el) => (el as HTMLElement).style.transform);
        await page.mouse.move(bb.x + bb.width / 2, bb.y + 4); await page.mouse.down(); await page.mouse.move(bb.x + bb.width / 2 + 80, bb.y + 4 + 60, { steps: 20 }); await page.mouse.up();
        const tr1 = await f.locator(`.react-flow__node[data-id="${id}"]`).first().evaluate((el) => (el as HTMLElement).style.transform).catch(() => "gone");
        return { tr0, tr1 };
      }, (_b, _a, x) => ({ ok: !x.skipped && x.tr0 === x.tr1, detail: x.skipped ? "no node" : `node position style unchanged=${x.tr0 === x.tr1} (drag unsupported by design: nodesDraggable=false)` })));
      await rec.step(`${state}-expand-collapse`, () => op(state, "group toggle (2 clicks)", async () => {
        // collapsed state: expand then collapse a collapsed group; expanded state: collapse then expand an expanded group
        const wantCollapsed = state === "collapsed";
        const id = await hittableId(f, wantCollapsed ? "collapsedGroup" : "expandedGroup");
        if (!id) return { skipped: true };
        const loc = () => f.locator(`.react-flow__node[data-id="${id}"]`).first();
        const isCollapsed = async () => (await loc().locator(".cgGroup--collapsed").count()) > 0;
        const s0 = await isCollapsed();
        await loc().locator("button.cgGroupHeader").click({ delay: 80, timeout: 5000 }); await page.waitForTimeout(800);
        const s1 = await isCollapsed();
        await loc().locator("button.cgGroupHeader").click({ delay: 80, timeout: 5000 }); await page.waitForTimeout(800);
        const s2 = await isCollapsed();
        return { s0, s1, s2 };
      }, (_b, _a, x) => ({ ok: !x.skipped && x.s0 !== x.s1 && x.s2 === x.s0, detail: x.skipped ? "no target group in DOM" : `collapsed: ${x.s0} → ${x.s1} → ${x.s2}` })));
      await rec.step(`${state}-select`, () => op(state, "node selection", async () => {
        // reveal the active group first (outside the measured op would be cleaner, but the pan is identical across runs)
        const hid = await hittableId(f, "runEntry"); if (!hid) return { skipped: true };
        await byId(f, hid).click({ delay: 80, timeout: 5000 }); await page.waitForTimeout(600);
        return {};
      }, (_b, a, x) => ({ ok: !x.skipped && /runEntry/.test(a.selectedText), detail: x.skipped ? "runEntry node not rendered in viewport" : `inspector: ${a.selectedText.slice(0, 80)}` }), async () => { await prepView(); ev[`revealPans_${state}`] = await revealSteps(); await page.mouse.move(5, 5); await page.waitForTimeout(500); }));
    };

    // reveal the active-file group (same fixed pan steps as P8-A/C) so that selection has a target
    const revealSteps = async () => { let n = 0; for (const dy of [...Array(12).fill(300), ...Array(24).fill(-300)]) {
      const vis = !!(await hittableId(f, "runEntry"));
      if (vis) return n; await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy + dy, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400); n++; } return -1; };
    ev.revealPansCollapsed = await revealSteps();
    ev.stateCollapsed = await graphState(f);

    if (TRACE) {
      const file = path.join(rec.dir, "trace-idle-pan.json");
      await rec.step("trace-idle-pan", async () => {
        await app.evaluate(async ({ contentTracing }, cats) => { await contentTracing.startRecording({ included_categories: cats, excluded_categories: ["*"] } as any); }, CATEGORIES);
        await f.evaluate(() => performance.mark("p8f:idle-start")); await page.waitForTimeout(2000);
        await f.evaluate(() => performance.mark("p8f:pan-start")); await pan(); await f.evaluate(() => performance.mark("p8f:pan-end"));
        await app.evaluate(async ({ contentTracing }, p) => contentTracing.stopRecording(p), file);
        ev.trace = { file: path.basename(file), sizeBytes: fs.statSync(file).size };
      });
    }
    await runOps("collapsed");
    if (TRACE) {
      const file = path.join(rec.dir, "trace-select.json");
      await rec.step("trace-select", async () => {
        await fitGraph(f); await page.waitForTimeout(800); ev.revealPans_traceSelect = await revealSteps(); await page.mouse.move(5, 5); await page.waitForTimeout(800);
        const hid = await hittableId(f, "runEntry");
        if (!hid) { ev.traceSelect = { skipped: true }; return; }
        const node = byId(f, hid);
        await app.evaluate(async ({ contentTracing }, cats) => { await contentTracing.startRecording({ included_categories: cats, excluded_categories: ["*"] } as any); }, CATEGORIES);
        await page.waitForTimeout(300);
        await f.evaluate(() => performance.mark("p8f:select-click"));
        await node.click({ delay: 80, timeout: 5000 }).catch((e) => { ev.traceSelectError = String(e).slice(0, 200); }); await page.waitForTimeout(1000);
        await app.evaluate(async ({ contentTracing }, p) => contentTracing.stopRecording(p), file);
        ev.traceSelect = { file: path.basename(file), sizeBytes: fs.statSync(file).size };
      });
    }

    // expanded state: expand up to MAX_EXPAND collapsed groups currently rendered
    await rec.step("expand-groups", async () => {
      let n = 0;
      for (let k = 0; k < MAX_EXPAND; k++) {
        await fitGraph(f); await page.waitForTimeout(500);
        const hid = await hittableId(f, "collapsedGroup");
        if (!hid) break;
        await byId(f, hid).locator("button.cgGroupHeader").click({ delay: 80, timeout: 5000 }).catch(() => {}); await page.waitForTimeout(600); n++;
      }
      await fitGraph(f); await page.waitForTimeout(1500);
      ev.expandedGroups = n;
      ev.stateExpanded = await graphState(f);
    });
    await runOps("expanded");
  } finally {
    save(); rec.flush(); await closeVSCode(s);
  }
});
