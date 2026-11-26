// P15-Z0: semantic zoom rendering feasibility (A baseline / B overview / C local detail).
// See README.md. Uses the experiment switch of this branch (window.__cgSemanticZoomExperiment).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { makeFixture, SHAPE } from "./make-fixture.mjs";

const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "cogic-z0-")));
const REPS = Number(process.env.Z0_REPS ?? 5);
const PAN_MS = 5000;
const ZOOMS = [0.6, 0.15];
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

const result = { shape: SHAPE, reps: REPS, panMs: PAN_MS, zooms: ZOOMS, checks: [], runs: [], transitions: [], memory: { before: freeMiB(), minimum: freeMiB(), aborted: false, timeline: [] } };
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

  // ---- correctness
  await setViewport({ x: 40, y: 40, zoom: 0.15 });
  await sleep(1200);
  const aLayout = await layout();
  const aCounts = await counts();
  const toB = await switchMode("overview");
  result.transitions.push({ phase: "correctness", ...toB });
  await sleep(1500);
  await setViewport({ x: 40, y: 40, zoom: 0.15 });
  await sleep(1500);
  const bCounts = await counts();
  result.correctness = { aCounts, bCounts };
  check("B draws fewer nodes and edges than A", bCounts.rfNodes < aCounts.rfNodes && bCounts.rfEdges < aCounts.rfEdges, { aCounts, bCounts });
  // B, independently: from the folder and file groups of A, the leaf folders and all files are collapsed.
  const bGroups = await exp(() => [...document.querySelectorAll(".react-flow__node")].filter((n) => n.querySelector(".cgGroup, .cgFolder")).map((n) => ({ id: n.dataset.id, collapsed: Boolean(n.querySelector(".cgGroup--collapsed, .cgFolder--collapsed")) })));
  const folderIds = bGroups.filter((g) => g.id.startsWith("folder:")).map((g) => g.id.slice(7));
  const isLeaf = (f) => !folderIds.some((o) => o !== f && o.startsWith(`${f}/`));
  const wrongGroups = bGroups.filter((g) => (g.id.startsWith("folder:") ? g.collapsed !== isLeaf(g.id.slice(7)) : !g.collapsed));
  check("B: exactly the leaf folders and the files outside them are collapsed", wrongGroups.length === 0 && bGroups.length > 0, { bGroups, wrongGroups });
  // Every aggregate of B traces back to original relations of the right kind, direction and groups.
  const badgeCount = await frame.locator(".cgAggregateBadge").count();
  // Every 6th badge: opening all of them in a row takes the webview past the memory guard.
  const traced = [];
  for (let i = 0; i < badgeCount; i += 6) {
    const badge = frame.locator(".cgAggregateBadge").nth(i);
    const info = await badge.evaluate((b) => ({ count: Number(b.dataset.count), kind: [...b.classList].find((c) => /^cgAggregateBadge--(calls|dataflow)$/.test(c))?.slice(18) }));
    await badge.focus();
    await page.keyboard.press("Enter");
    await sleep(250);
    for (let k = 0; k < 20 && (await frame.locator(".panel--aggregate .panelBody > .smallBtn").count()); k++) {
      await frame.locator(".panel--aggregate .panelBody > .smallBtn").click();
      await sleep(80);
    }
    const ids = await exp(() => [...document.querySelectorAll(".panel--aggregate .aggregateItem")].map((e) => e.dataset.edgeId));
    traced.push({ index: i, ...info, members: ids.length, ok: ids.length === info.count && ids.every((id) => id.startsWith(`${info.kind}:`)) });
    const close = frame.locator(".panel--aggregate .panelHeader .smallBtn");
    if (await close.count()) await close.click();
    await sleep(150);
  }
  result.correctness.traced = { badges: badgeCount, opened: traced.length, members: traced.reduce((a, t) => a + t.members, 0), bad: traced.filter((t) => !t.ok) };
  check("B: sampled aggregates (every 6th) open their original relations, of their own kind, all of them", badgeCount > 0 && traced.length > 0 && traced.every((t) => t.ok), result.correctness.traced);
  // Original IDs: every relation ID behind B's aggregates is a relation of the analysed graph.
  const backToA = await switchMode("baseline");
  result.transitions.push({ phase: "correctness", ...backToA });
  await sleep(1500);
  await setViewport({ x: 40, y: 40, zoom: 0.15 });
  await sleep(1500);
  check("A again: same nodes and positions as before B", (await layout()) === aLayout, null);
  // Opening an aggregate selects it and clears the node selection (existing behaviour): select the
  // same function again, so that A, B and C all run with it and only the overlay differs.
  await selectTarget();
  // C
  await setViewport({ x: 40, y: 40, zoom: 0.6 });
  await sleep(1200);
  const beforeC = await layout();
  const toC = await switchMode("local");
  result.transitions.push({ phase: "correctness", ...toC });
  await sleep(800);
  const overlay = await exp(() => {
    const o = document.querySelector(".cgExpDetail");
    return o ? { id: o.dataset.nodeId, text: o.textContent, code: Boolean(o.querySelector(".cgExpDetailCode")) } : null;
  });
  result.correctness.overlay = overlay;
  check("C: one overlay, for the selected function", overlay?.id === result.selected, overlay);
  check("C: no other node moves or changes", (await layout()) === beforeC, null);
  const visibleCode = (await counts()).codeNodes;
  result.correctness.overlayRenders = { ...toC.renders, visibleCodeNodes: visibleCode };
  check("C: opening the overlay renders each visible code node at most once (no layout or graph work)", toC.renders.codeNode <= visibleCode && toC.renders.customEdge === 0, result.correctness.overlayRenders);
  check("C: the code preview is the real source of main.ts", overlay?.code === true && /export function main/.test(overlay?.text ?? ""), overlay);
  const offC = await switchMode("baseline");
  result.transitions.push({ phase: "correctness", ...offC });
  check("C off: overlay gone, layout unchanged", (await counts()) && (await layout()) === beforeC && (await exp(() => document.querySelectorAll(".cgExpDetail").length)) === 0, null);
  mark("correctness");

  // ---- benchmark: warm-up, then REPS rounds. Conditions: A, B without a selection (A0, B0),
  // and A, B, C with main() selected (A1, B1, C1). Each round runs them in a rotated order.
  const conditions = {
    A0: ["baseline", false],
    B0: ["overview", false],
    A1: ["baseline", true],
    B1: ["overview", true],
    C1: ["local", true],
  };
  /** 2 s without input: what the canvas costs when nothing moves (animated edges, for example). */
  const idle = () => sleep(2000);
  const prepare = async (cond, zoom) => {
    const [mode, selected] = conditions[cond];
    await switchMode("baseline");
    await sleep(500);
    if (selected && !(await hasSelection())) await selectTarget();
    if (!selected && (await hasSelection())) await clearSelection();
    const t = await switchMode(mode);
    result.transitions.push({ phase: "bench", cond, zoom, ...t });
    await sleep(600);
    await setViewport({ x: 40, y: 40, zoom });
    await sleep(1200);
  };
  for (const cond of Object.keys(conditions)) {
    await prepare(cond, 0.6);
    await pan();
    await sleep(500);
  }
  mark("warm-up");
  const names = Object.keys(conditions);
  for (let rep = 0; rep < REPS; rep++) {
    for (const zoom of ZOOMS) {
      const order = names.map((_, i) => names[(i + rep) % names.length]);
      for (const cond of order) {
        await prepare(cond, zoom);
        const drawn = { ...(await counts()), selection: await hasSelection() };
        if (drawn.selection !== conditions[cond][1]) throw new Error(`selection state wrong for ${cond}`);
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
        console.log(`rep ${rep} zoom ${zoom} ${cond} (nodes ${drawn.rfNodes}, edges ${drawn.rfEdges}, overlay ${drawn.overlay}, animated ${drawn.animatedEdges}): idle p50 ${r[0].p50} | pan p50 ${r[1].p50} p95 ${r[1].p95} | zoom p50 ${r[2].p50} p95 ${r[2].p95} | free ${freeMiB()} MiB`);
      }
    }
    mark(`rep ${rep}`);
  }
  await switchMode("baseline");
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
