// P15-Z0A: is the dataflow edge animation the cost of A0 in P15-Z0? See README.md.
// Uses the experiment switch of this branch (window.__cgSemanticZoomExperiment).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { makeFixture, SHAPE } from "../semantic-zoom/make-fixture.mjs";

const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "cogic-z0a-")));
const REPS = Number(process.env.Z0_REPS ?? 5);
const PAN_MS = 5000;
const ZOOMS = [0.6, 0.15];
/** Repetitions per zoom: the 0.6 question, and a smaller recheck at 0.15 (low-detail solid strokes). */
const REPS_AT = { 0.6: Number(process.env.Z0A_REPS ?? 5), 0.15: Number(process.env.Z0A_REPS_LOW ?? 3) };
const EXE = process.env.VSCODE_EXE;
if (!EXE) throw new Error("Set VSCODE_EXE");
const freeMiB = () => Math.round(os.freemem() / 1048576);
if (freeMiB() < 2200) throw new Error(`preflight memory ${freeMiB()} MiB`);

const userData = path.join(OUT, "user-data");
const workspace = path.join(OUT, "workspace");
if (fs.existsSync(userData) || fs.existsSync(workspace)) throw new Error("Use a new output folder");
fs.mkdirSync(path.join(userData, "User"), { recursive: true });
makeFixture(workspace);
fs.writeFileSync(path.join(userData, "User", "settings.json"), JSON.stringify({
  "workbench.startupEditor": "none",
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "window.restoreWindows": "none",
  "window.commandCenter": false,
  "git.enabled": false,
  "chat.disableAIFeatures": true,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
}));

const result = { shape: SHAPE, reps: REPS_AT, panMs: PAN_MS, zooms: ZOOMS, checks: [], runs: [], transitions: [], memory: { before: freeMiB(), minimum: freeMiB(), aborted: false, timeline: [] } };
const check = (name, pass, detail) => {
  result.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` ${JSON.stringify(detail)?.slice(0, 500)}`}`);
};
const mark = (label) => result.memory.timeline.push([label, freeMiB()]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let app;
const monitor = setInterval(() => {
  result.memory.minimum = Math.min(result.memory.minimum, freeMiB());
  if (freeMiB() < 800 && !result.memory.aborted) {
    result.memory.aborted = true;
    void app?.close();
  }
}, 250);

try {
  app = await electron.launch({
    executablePath: EXE,
    args: [
      workspace,
      `--extensionDevelopmentPath=${REPO}`,
      `--user-data-dir=${userData}`,
      `--extensions-dir=${path.join(OUT, "extensions")}`,
      "--disable-workspace-trust",
      "--disable-extension=vscode.typescript-language-features",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-updates",
      "--new-window",
    ],
    env: { ...process.env, VSCODE_SKIP_PRELAUNCH: "1" },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".monaco-workbench", { timeout: 60_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isMaximized()) w.unmaximize();
    w.setBounds({ x: 0, y: 0, width: 1900, height: 1040 });
  });
  await sleep(3000);
  const quick = async (key, text, rowText) => {
    await page.keyboard.press(key);
    const input = page.locator(".quick-input-widget input.input");
    await input.waitFor({ state: "visible" });
    await input.fill(text);
    await page.locator(".quick-input-list .monaco-list-row", { hasText: rowText }).first().waitFor({ timeout: 20_000 });
    await sleep(400);
    await page.keyboard.press("Enter");
    await sleep(1200);
  };
  await quick("Control+P", "src/main.ts", "main.ts");
  await page.keyboard.press("Control+B");
  await quick("Control+Shift+P", ">Cogic: Open Editor Panel", "Cogic: Open Editor Panel");
  let frame;
  for (let i = 0; i < 60 && !frame; i++) {
    for (const f of page.frames()) {
      if (!f.url().startsWith("vscode-webview://")) continue;
      const n = await f.locator('select[aria-label="Graph depth"]').count().catch(() => 0);
      if (n) frame = f;
    }
    await sleep(500);
  }
  await frame.locator(".projectPicker", { hasText: "main.ts" }).waitFor({ timeout: 60_000 });
  const until = async (name, read, timeout = 30_000) => {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await read();
      if (value) return value;
      if (Date.now() > end) throw new Error(`timeout: ${name}`);
      await sleep(250);
    }
  };

  // ---- helpers, all inside the webview
  const exp = (fn, arg) => frame.evaluate(fn, arg);
  const setMode = (mode) => exp((m) => window.__cgSemanticZoomExperiment.setMode(m), mode);
  const setViewport = (v) => exp((vp) => window.__cgSemanticZoomExperiment.setViewport(vp), v);
  const logged = () => exp(() => {
    const log = [...(window.__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? [])].reverse();
    const g = log.find((e) => e.event === "app.graphState.changed")?.detail;
    return g ? [g.nodes, g.edges] : null;
  });
  const counts = () => exp(() => {
    const canvas = document.querySelector(".canvasFlow");
    const nodes = [...document.querySelectorAll(".react-flow__node")];
    return {
      rfNodes: nodes.length,
      codeNodes: document.querySelectorAll(".react-flow__node-code").length,
      groups: document.querySelectorAll(".react-flow__node-fileGroup, .react-flow__node-folderGroup").length,
      collapsedGroups: document.querySelectorAll(".cgGroup--collapsed, .cgFolder--collapsed").length,
      rfEdges: document.querySelectorAll(".react-flow__edge").length,
      badges: document.querySelectorAll(".cgAggregateBadge").length,
      overlay: document.querySelectorAll(".cgExpDetail").length,
      animatedEdges: document.querySelectorAll(".react-flow__edge.animated").length,
      selected: document.querySelectorAll(".cgNode--selected").length,
      domInCanvas: canvas ? canvas.querySelectorAll("*").length : 0,
      domAll: document.querySelectorAll("*").length,
    };
  });
  const layout = () => exp(() => JSON.stringify([...document.querySelectorAll(".react-flow__node")].map((n) => [n.dataset.id, n.style.transform]).sort()));
  /** Runs `act` in Node while the webview records rAF gaps, long tasks and render calls. */
  const measure = async (act) => {
    await exp(() => {
      const x = window.__cgSemanticZoomExperiment;
      x.resetCounters();
      const rec = { gaps: [], long: [], last: performance.now(), on: true };
      window.__z0rec = rec;
      const tick = (t) => {
        if (!rec.on) return;
        rec.gaps.push(t - rec.last);
        rec.last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame((t) => {
        rec.last = t;
        requestAnimationFrame(tick);
      });
      try {
        rec.observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) rec.long.push(e.duration);
        });
        rec.observer.observe({ type: "longtask", buffered: false });
        rec.longSupported = true;
      } catch {
        rec.longSupported = false;
      }
      rec.heapStart = performance.memory?.usedJSHeapSize ?? null;
    });
    await sleep(100);
    const t0 = Date.now();
    await act();
    const wall = Date.now() - t0;
    await sleep(150);
    const stats = await exp(() => {
      const rec = window.__z0rec;
      rec.on = false;
      rec.observer?.disconnect();
      return {
        gaps: rec.gaps.slice(1),
        long: rec.long,
        longSupported: rec.longSupported,
        counters: { ...window.__cgSemanticZoomExperiment.counters },
        heapStart: rec.heapStart,
        heapEnd: performance.memory?.usedJSHeapSize ?? null,
      };
    });
    const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, ws: m.memory.workingSetSize })));
    return { wall, ...stats, rendererWorkingSetKB: metrics.filter((m) => m.type === "Tab" || m.type === "Renderer").reduce((s, m) => s + m.ws, 0) };
  };
  const pctl = (arr, p) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  };
  const summarize = (m) => ({
    frames: m.gaps.length,
    p50: Math.round(pctl(m.gaps, 50) * 10) / 10,
    p95: Math.round(pctl(m.gaps, 95) * 10) / 10,
    max: Math.round(Math.max(...m.gaps) * 10) / 10,
    over50: m.gaps.filter((g) => g > 50).length,
    longTasks: m.long.length,
    longTaskMs: Math.round(m.long.reduce((a, b) => a + b, 0)),
    longSupported: m.longSupported,
    renders: m.counters,
    heapMB: m.heapEnd == null ? null : Math.round(m.heapEnd / 1048576),
    rendererMB: Math.round(m.rendererWorkingSetKB / 1024),
    wall: m.wall,
  });
  const panePoint = async () => {
    const pane = await frame.locator(".react-flow__pane").boundingBox();
    return { x: pane.x + pane.width * 0.55, y: pane.y + pane.height * 0.5 };
  };
  /** The same 5 s path for every condition: an ellipse of 240 x 140 px, starting and ending at its start. */
  const pan = async () => {
    const c = await panePoint();
    await page.mouse.move(c.x + 240, c.y);
    await page.mouse.down();
    const steps = Math.round(PAN_MS / 16);
    const start = Date.now();
    for (let i = 1; i <= steps; i++) {
      const a = (2 * Math.PI * i) / steps;
      await page.mouse.move(c.x + 240 * Math.cos(a), c.y + 140 * Math.sin(a));
      const due = start + i * 16;
      const wait = due - Date.now();
      if (wait > 0) await sleep(wait);
    }
    await page.mouse.up();
  };
  /** 12 wheel steps out, then 12 in, 60 ms apart, at the pane centre. */
  const zoomSweep = async () => {
    const c = await panePoint();
    await page.mouse.move(c.x, c.y);
    for (const dy of [...Array(12).fill(120), ...Array(12).fill(-120)]) {
      await page.mouse.wheel(0, dy);
      await sleep(60);
    }
  };
  /** Mode switch cost: until the drawn node and edge counts hold for 5 frames. */
  const switchMode = (mode) => exp(async (m) => {
    const x = window.__cgSemanticZoomExperiment;
    x.resetCounters();
    const long = [];
    let obs = null;
    try {
      obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(e.duration)));
      obs.observe({ type: "longtask", buffered: false });
    } catch { /* not supported */ }
    const sig = () => `${document.querySelectorAll(".react-flow__node").length}/${document.querySelectorAll(".react-flow__edge").length}/${document.querySelectorAll(".cgExpDetail").length}`;
    const t0 = performance.now();
    x.setMode(m);
    let last = sig();
    let stable = 0;
    let settledAt = performance.now();
    for (let i = 0; i < 600 && stable < 5; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = sig();
      if (now === last) stable += 1;
      else {
        stable = 0;
        last = now;
        settledAt = performance.now();
      }
    }
    obs?.disconnect();
    return { mode: m, settleMs: Math.round((settledAt - t0) * 10) / 10, firstFrameMs: null, longTasks: long.length, longTaskMs: Math.round(long.reduce((a, b) => a + b, 0)), renders: { ...x.counters }, drawn: last };
  }, mode);

  // ---- graph at depth 3, default state recorded, then everything expanded (baseline A)
  await frame.locator('select[aria-label="Graph depth"]').selectOption("3");
  await until("graph", async () => ((await logged())?.[0] ?? 0) > 600, 120_000);
  await sleep(6000);
  result.graph = await logged();
  await setViewport({ x: 40, y: 40, zoom: 0.15 });
  await sleep(1500);
  result.defaultState = await counts();
  await exp(() => window.__cgSemanticZoomExperiment.expandAll());
  await sleep(4000);
  await setViewport({ x: 40, y: 40, zoom: 0.15 });
  await sleep(1500);
  result.expandedState = await counts();
  check("graph at depth 3 is the expected size", result.graph[0] === 650 && result.graph[1] === 1266, result.graph);
  check("baseline A: every group expanded", result.expandedState.collapsedGroups === 0, result.expandedState);
  mark("graph");

  // A selected function: C needs one, and A and B keep the same selection so that only the overlay differs.
  // main() lives in the active file, so C can show real source lines.
  const selectTarget = async () => {
    await setViewport({ x: 40, y: 40, zoom: 0.1 });
    await sleep(1500);
    const sel = '.react-flow__node-code[data-id^="function:"][data-id*="/src/main.ts:"]';
    // Centre the node at zoom 0.6, from its box and the viewport transform, then click it.
    const flow = await exp((q) => {
      const node = document.querySelector(q);
      const pane = document.querySelector(".react-flow__pane").getBoundingClientRect();
      const m = new DOMMatrix(getComputedStyle(document.querySelector(".react-flow__viewport")).transform);
      const r = node.getBoundingClientRect();
      return {
        id: node.dataset.id,
        x: (r.left + r.width / 2 - pane.left - m.e) / m.a,
        y: (r.top + r.height / 2 - pane.top - m.f) / m.a,
        w: pane.width,
        h: pane.height,
      };
    }, sel);
    result.selected ??= flow.id;
    await setViewport({ x: flow.w / 2 - flow.x * 0.6, y: flow.h / 2 - flow.y * 0.6, zoom: 0.6 });
    await sleep(1500);
    await frame.locator(`.react-flow__node[data-id="${flow.id}"] .cgNodeTitle`).first().click({ delay: 40 });
    await sleep(1500);
  };
  const clearSelection = async () => {
    // Somewhere without nodes, so that the click lands on the pane.
    await setViewport({ x: 6000, y: 6000, zoom: 0.6 });
    await sleep(800);
    const pt = await exp(() => {
      const r = document.querySelector(".react-flow__pane").getBoundingClientRect();
      for (let y = 90; y < r.height - 60; y += 8)
        for (let x = 20; x < r.width - 120; x += 8)
          if (document.elementFromPoint(r.left + x, r.top + y)?.classList.contains("react-flow__pane")) return { x, y };
      return null;
    });
    const pane = await frame.locator(".react-flow__pane").boundingBox();
    await page.mouse.click(pane.x + pt.x, pane.y + pt.y);
    await sleep(800);
  };
  // From the Inspector, not the canvas: a selected node outside the view is not in the DOM.
  const hasSelection = async () => !(await exp(() => document.body.textContent.includes("No node selected. Click a node in the graph.")));
  await selectTarget();

  // ---- P15-Z0A conditions. Same graph, nodes, edges, viewport and semantic mode (baseline);
  // only the edge style or the selection differs.
  const conditions = {
    A: { style: "default", selected: false },
    B: { style: "static-dash", selected: false },
    C: { style: "static-solid", selected: false },
    D: { style: "default", selected: true },
  };
  /** What the edges actually do now, read from the DOM and the computed styles. */
  const edgeState = () => exp(() => {
    const paths = [...document.querySelectorAll(".react-flow__edge.animated .react-flow__edge-path")];
    const dataflow = [...document.querySelectorAll(".react-flow__edge-dataflow .react-flow__edge-path")];
    return {
      animatedClass: document.querySelectorAll(".react-flow__edge.animated").length,
      animatedRunning: paths.filter((p) => getComputedStyle(p).animationName !== "none").length,
      documentAnimations: document.getAnimations().filter((a) => a.playState === "running").length,
      dataflowDashed: dataflow.filter((p) => getComputedStyle(p).strokeDasharray !== "none").length,
      dataflowEdges: dataflow.length,
      low: Boolean(document.querySelector(".canvasFlow--lowDetailEdges")),
      classes: document.querySelector(".canvasFlow")?.className ?? null,
    };
  });
  const setEdgeStyle = (style) => exp((st) => window.__cgSemanticZoomExperiment.setEdgeStyle(st), style);
  const idle = () => sleep(2000);
  const prepare = async (cond, zoom) => {
    const c = conditions[cond];
    await setEdgeStyle("default");
    if (c.selected && !(await hasSelection())) await selectTarget();
    if (!c.selected && (await hasSelection())) await clearSelection();
    await setViewport({ x: 40, y: 40, zoom });
    await sleep(1200);
    await setEdgeStyle(c.style);
    await sleep(300);
  };

  // ---- correctness: each condition draws the same graph; only the intended property changes
  const sigs = {};
  for (const cond of Object.keys(conditions)) {
    await prepare(cond, 0.6);
    sigs[cond] = { layout: await layout(), edges: await exp(() => [...document.querySelectorAll(".react-flow__edge")].map((e) => e.getAttribute("data-testid")).sort().join("|")), state: await edgeState(), counts: await counts() };
  }
  result.conditionsAt06 = Object.fromEntries(Object.entries(sigs).map(([k, v]) => [k, { state: v.state, counts: v.counts }]));
  check("A, B, C draw the same nodes at the same positions and the same edges", ["B", "C"].every((k) => sigs[k].layout === sigs.A.layout && sigs[k].edges === sigs.A.edges), null);
  check("D draws the same nodes and edges (only the selection differs)", sigs.D.layout === sigs.A.layout && sigs.D.edges === sigs.A.edges, null);
  check("A: no selection, animated dashed dataflow edges are running", sigs.A.state.animatedRunning > 0 && sigs.A.state.animatedRunning === sigs.A.state.animatedClass, sigs.A.state);
  check("B: same animated edges, none running, still dashed", sigs.B.state.animatedClass === sigs.A.state.animatedClass && sigs.B.state.animatedRunning === 0 && sigs.B.state.dataflowDashed === sigs.A.state.dataflowDashed, sigs.B.state);
  check("C: same animated edges, none running, no dashes", sigs.C.state.animatedClass === sigs.A.state.animatedClass && sigs.C.state.animatedRunning === 0 && sigs.C.state.dataflowDashed === 0, sigs.C.state);
  check("D: the selection leaves fewer edges animated", sigs.D.state.animatedRunning < sigs.A.state.animatedRunning, sigs.D.state);
  mark("correctness");

  // ---- warm-up, then repetitions in a rotated order
  for (const cond of Object.keys(conditions)) {
    await prepare(cond, 0.6);
    await pan();
    await sleep(500);
  }
  mark("warm-up");
  const names = Object.keys(conditions);
  for (const zoom of ZOOMS) {
    for (let rep = 0; rep < REPS_AT[zoom]; rep++) {
      const order = names.map((_, i) => names[(i + rep) % names.length]);
      for (const cond of order) {
        await prepare(cond, zoom);
        const drawn = { ...(await counts()), ...(await edgeState()), selection: await hasSelection() };
        if (drawn.selection !== conditions[cond].selected) throw new Error(`selection state wrong for ${cond}`);
        const i0 = await measure(idle);
        result.runs.push({ rep, zoom, cond, kind: "idle", drawn, ...summarize(i0), gaps: i0.gaps.map((g) => Math.round(g * 10) / 10) });
        const p = await measure(pan);
        result.runs.push({ rep, zoom, cond, kind: "pan", drawn, ...summarize(p), gaps: p.gaps.map((g) => Math.round(g * 10) / 10) });
        await sleep(400);
        await setViewport({ x: 40, y: 40, zoom });
        await sleep(800);
        const z = await measure(zoomSweep);
        result.runs.push({ rep, zoom, cond, kind: "zoom", drawn, ...summarize(z), gaps: z.gaps.map((g) => Math.round(g * 10) / 10) });
        await sleep(400);
        const r = result.runs.slice(-3);
        console.log(`zoom ${zoom} rep ${rep} ${cond} (animated ${drawn.animatedClass}, running ${drawn.animatedRunning}, dashed ${drawn.dataflowDashed}/${drawn.dataflowEdges}, low ${drawn.low}): idle p50 ${r[0].p50} p95 ${r[0].p95} | pan p50 ${r[1].p50} p95 ${r[1].p95} | zoom p50 ${r[2].p50} p95 ${r[2].p95} | free ${freeMiB()} MiB`);
      }
    }
    mark(`zoom ${zoom}`);
  }
  await setEdgeStyle("default");
} catch (error) {
  check("no exception", false, String(error?.stack ?? error).slice(0, 800));
  await app?.windows()[0]?.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
} finally {
  clearInterval(monitor);
  await app?.close().catch(() => {});
  if (result.memory.aborted) check("memory guard", false, result.memory);
  const failed = result.checks.filter((c) => !c.pass);
  fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 1));
  console.log(`${result.checks.length - failed.length}/${result.checks.length} checks passed; ${result.runs.length} runs; min free ${result.memory.minimum} MiB; ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
}
