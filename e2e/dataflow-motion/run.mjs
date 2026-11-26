// P15-R1: the dataflow motion policy (legacy / focused), end to end and benchmarked. See README.md.
// No experiment hooks: the policy is the hidden setting cogic.experimental.dataflowMotion, written
// to settings.json; everything else goes through the UI and the rendered DOM.
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
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "cogic-r1-")));
const REPS = Number(process.env.R1_REPS ?? 5);
const REPS_LOW = Number(process.env.R1_REPS_LOW ?? 3);
const PAN_MS = 5000;
const EXE = process.env.VSCODE_EXE;
if (!EXE) throw new Error("Set VSCODE_EXE");
const freeMiB = () => Math.round(os.freemem() / 1048576);
if (freeMiB() < 2200) throw new Error(`preflight memory ${freeMiB()} MiB`);

const userData = path.join(OUT, "user-data");
const workspace = path.join(OUT, "workspace");
if (fs.existsSync(userData) || fs.existsSync(workspace)) throw new Error("Use a new output folder");
fs.mkdirSync(path.join(userData, "User"), { recursive: true });
makeFixture(workspace);
const settingsFile = path.join(userData, "User", "settings.json");
const baseSettings = {
  "workbench.startupEditor": "none",
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "window.restoreWindows": "none",
  "window.commandCenter": false,
  "git.enabled": false,
  "chat.disableAIFeatures": true,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "files.simpleDialog.enable": true,
};
const writePolicy = (policy) =>
  fs.writeFileSync(settingsFile, JSON.stringify({ ...baseSettings, ...(policy ? { "cogic.experimental.dataflowMotion": policy } : {}) }));
writePolicy(null); // nothing set: the default must be legacy

const result = { shape: SHAPE, reps: REPS, repsLow: REPS_LOW, panMs: PAN_MS, checks: [], runs: [], memory: { before: freeMiB(), minimum: freeMiB(), aborted: false, timeline: [] } };
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
  const exp = (fn, arg) => frame.evaluate(fn, arg);
  /** The measured views, filled in once the graph is expanded. */
  const VIEW = {};

  // ---- what the canvas draws and what really moves
  const state = () => exp(() => {
    const vp = document.querySelector(".react-flow__viewport");
    const m = vp ? new DOMMatrix(getComputedStyle(vp).transform) : null;
    const edges = [...document.querySelectorAll(".react-flow__edge")];
    const animated = edges.filter((e) => e.classList.contains("animated"));
    const running = animated.filter((e) => {
      const p = e.querySelector(".react-flow__edge-path");
      return p && getComputedStyle(p).animationName !== "none";
    });
    const dataflow = [...document.querySelectorAll(".react-flow__edge-dataflow .react-flow__edge-path")];
    const log = window.__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? [];
    return {
      viewport: m ? { x: m.e, y: m.f, zoom: m.a } : null,
      nodes: document.querySelectorAll(".react-flow__node").length,
      edges: edges.length,
      dom: document.querySelector(".canvasFlow")?.querySelectorAll("*").length ?? 0,
      animated: animated.length,
      running: running.length,
      runningIds: running.map((e) => e.getAttribute("data-testid")),
      runningNotDataflow: running.filter((e) => !e.classList.contains("react-flow__edge-dataflow")).length,
      runningContext: running.filter((e) => e.classList.contains("cgFocus--context")).length,
      documentAnimations: document.getAnimations().filter((a) => a.playState === "running").length,
      dataflowEdges: dataflow.length,
      dataflowDashed: dataflow.filter((p) => getComputedStyle(p).strokeDasharray !== "none").length,
      dataflowWithArrow: dataflow.filter((p) => p.getAttribute("marker-end")).length,
      low: Boolean(document.querySelector(".canvasFlow--lowDetailEdges")),
      activeFlow: document.querySelectorAll(".inspectorFlowRow--active").length,
      // From the product's own log: a selected file or folder group is not a graph node, so the
      // Inspector does not show it, but it still mutes dataflow edges.
      selectedIds: [...log].reverse().find((e) => e.event === "app.selectedNode.changed")?.detail?.selectedNodeIds ?? [],
      selection: ([...log].reverse().find((e) => e.event === "app.selectedNode.changed")?.detail?.selectedNodeIds ?? []).length > 0,
      analyses: log.filter((e) => e.event === "analysisResult.received").length,
    };
  });
  /** Light read for the positioning loops (the full state() reads every edge's styles). */
  const viewport = () => exp(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector(".react-flow__viewport")).transform);
    return { x: m.e, y: m.f, zoom: m.a };
  });
  const layout = () => exp(() => JSON.stringify([
    [...document.querySelectorAll(".react-flow__node")].map((n) => [n.dataset.id, n.style.transform]).sort(),
    [...document.querySelectorAll(".react-flow__edge")].map((e) => e.getAttribute("data-testid")).sort(),
  ]));
  const paneBox = () => frame.locator(".react-flow__pane").boundingBox();
  /** Wheel in small steps to the zoom, then drag to the exact x and y. */
  const goTo = async (target) => {
    const pane = await paneBox();
    const cx = pane.x + pane.width * 0.5;
    const cy = pane.y + pane.height * 0.5;
    for (let i = 0; i < 300; i++) {
      const z = (await viewport()).zoom;
      const ratio = Math.log(z / target.zoom);
      if (Math.abs(ratio) < 0.004) break;
      // Larger steps while far, small ones near the target.
      const step = Math.max(2, Math.min(120, Math.round(Math.abs(ratio) * 250)));
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, ratio > 0 ? step : -step);
      await sleep(50);
    }
    await sleep(400);
    for (let i = 0; i < 40; i++) {
      const v = await viewport();
      // At most 500 px per drag, so that the pointer stays inside the window.
      const dx = Math.max(-500, Math.min(500, target.x - v.x));
      const dy = Math.max(-500, Math.min(500, target.y - v.y));
      if (Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) break;
      // An empty spot from which the whole drag stays inside the pane.
      const pt = await exp(([ddx, ddy]) => {
        const r = document.querySelector(".react-flow__pane").getBoundingClientRect();
        const x0 = Math.max(60, 60 - ddx);
        const x1 = Math.min(r.width - 160, r.width - 160 - ddx);
        const y0 = Math.max(60, 60 - ddy);
        const y1 = Math.min(r.height - 60, r.height - 60 - ddy);
        for (let y = y0; y < y1; y += 6)
          for (let x = x0; x < x1; x += 6)
            if (document.elementFromPoint(r.left + x, r.top + y)?.classList.contains("react-flow__pane")) return { x, y };
        return { x: r.width / 2 - ddx / 2, y: r.height / 2 - ddy / 2 };
      }, [dx, dy]);
      await page.mouse.move(pane.x + pt.x, pane.y + pt.y);
      await page.mouse.down();
      await page.mouse.move(pane.x + pt.x + dx / 2, pane.y + pt.y + dy / 2, { steps: 6 });
      await page.mouse.move(pane.x + pt.x + dx, pane.y + pt.y + dy, { steps: 6 });
      await page.mouse.up();
      await sleep(400);
    }
    return viewport();
  };
  const emptySpot = () => exp(() => {
    const r = document.querySelector(".react-flow__pane").getBoundingClientRect();
    for (let y = 60; y < r.height - 60; y += 10)
      for (let x = 60; x < r.width - 160; x += 10)
        if (document.elementFromPoint(r.left + x, r.top + y)?.classList.contains("react-flow__pane")) return { x, y };
    return null;
  });
  const clearAll = async () => {
    // A pane click clears the selection and the highlighted flow. Use an empty spot of the
    // current view, or move away from the graph if there is none.
    let spot = await emptySpot();
    if (!spot) {
      const v = await viewport();
      await goTo({ x: v.x + 1500, y: v.y + 1500, zoom: v.zoom });
      spot = (await emptySpot()) ?? { x: 100, y: 100 };
    }
    const pane = await paneBox();
    await page.mouse.click(pane.x + spot.x, pane.y + spot.y);
    await sleep(800);
  };
  const setPolicy = async (policy) => {
    const before = (await state()).analyses;
    writePolicy(policy);
    // With nothing selected, legacy animates every eligible dataflow edge and focused none. Read
    // at the measured view, where dataflow edges are drawn (away from it, 0 proves nothing).
    await clearAll();
    await goTo(VIEW[0.6]);
    await until(`policy ${policy}`, async () => {
      const s = await state();
      return s.dataflowEdges > 0 && (policy === "focused" ? s.animated === 0 : s.animated > 0);
    }, 20_000);
    await sleep(500);
    return (await state()).analyses - before;
  };
  const mainNodeSelector = '.react-flow__node-code[data-id^="function:"][data-id*="/src/main.ts:"]';
  const selectMain = async () => {
    // Off-view nodes are not in the DOM; the whole graph is, at zoom 0.1.
    // main.ts is laid out near the top left; try that overview first.
    for (const view of [{ x: 40, y: 40, zoom: 0.1 }, VIEW[0.1], { x: 40, y: -400, zoom: 0.1 }].filter(Boolean)) {
      if (await exp((q) => Boolean(document.querySelector(q)), mainNodeSelector)) break;
      await goTo(view);
      await sleep(800);
    }
    const flow = await exp((q) => {
      const node = document.querySelector(q);
      const pane = document.querySelector(".react-flow__pane").getBoundingClientRect();
      const m = new DOMMatrix(getComputedStyle(document.querySelector(".react-flow__viewport")).transform);
      const r = node.getBoundingClientRect();
      return { id: node.dataset.id, x: (r.left + r.width / 2 - pane.left - m.e) / m.a, y: (r.top + r.height / 2 - pane.top - m.f) / m.a, w: pane.width, h: pane.height };
    }, mainNodeSelector);
    const around = { x: flow.w / 2 - flow.x * 0.6, y: flow.h / 2 - flow.y * 0.6, zoom: 0.6 };
    // The view around main() at 0.6, where its highlighted flow is on screen.
    if (VIEW[0.6] && !VIEW.main) VIEW.main = around;
    await goTo(around);
    await frame.locator(`.react-flow__node[data-id="${flow.id}"] .cgNodeTitle`).first().click({ delay: 40 });
    await sleep(1500);
    return flow.id;
  };
  /** The first Param Flow of main(), from the Inspector, as a user highlights a relation. */
  const highlightFlow = async () => {
    const row = frame.locator(".inspectorFlowRow").first();
    await row.click();
    await sleep(1500);
    return exp(() => document.querySelector(".inspectorFlowRow--active")?.textContent ?? null);
  };

  // ---- measurement, inside the webview
  const measure = async (act) => {
    await exp(() => {
      const rec = { gaps: [], long: [], last: performance.now(), on: true };
      window.__r1rec = rec;
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
        rec.observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => rec.long.push(e.duration)));
        rec.observer.observe({ type: "longtask", buffered: false });
      } catch {
        rec.observer = null;
      }
    });
    await sleep(100);
    await act();
    await sleep(150);
    const stats = await exp(() => {
      const rec = window.__r1rec;
      rec.on = false;
      rec.observer?.disconnect();
      return { gaps: rec.gaps.slice(1), long: rec.long, heap: performance.memory?.usedJSHeapSize ?? null };
    });
    const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, ws: m.memory.workingSetSize })));
    return { ...stats, rendererMB: Math.round(metrics.filter((m) => m.type === "Tab" || m.type === "Renderer").reduce((s, m) => s + m.ws, 0) / 1024) };
  };
  const pctl = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
  };
  const summarize = (m) => ({
    frames: m.gaps.length,
    p50: Math.round(pctl(m.gaps, 50) * 10) / 10,
    p95: Math.round(pctl(m.gaps, 95) * 10) / 10,
    over50: m.gaps.filter((g) => g > 50).length,
    longTasks: m.long.length,
    longTaskMs: Math.round(m.long.reduce((a, b) => a + b, 0)),
    heapMB: m.heap == null ? null : Math.round(m.heap / 1048576),
    rendererMB: m.rendererMB,
    gaps: m.gaps.map((g) => Math.round(g * 10) / 10),
  });
  const pan = async () => {
    const pane = await paneBox();
    const c = { x: pane.x + pane.width * 0.55, y: pane.y + pane.height * 0.5 };
    await page.mouse.move(c.x + 240, c.y);
    await page.mouse.down();
    const steps = Math.round(PAN_MS / 16);
    const start = Date.now();
    for (let i = 1; i <= steps; i++) {
      const a = (2 * Math.PI * i) / steps;
      await page.mouse.move(c.x + 240 * Math.cos(a), c.y + 140 * Math.sin(a));
      const wait = start + i * 16 - Date.now();
      if (wait > 0) await sleep(wait);
    }
    await page.mouse.up();
  };
  const zoomSweep = async () => {
    const pane = await paneBox();
    await page.mouse.move(pane.x + pane.width * 0.55, pane.y + pane.height * 0.5);
    for (const dy of [...Array(12).fill(120), ...Array(12).fill(-120)]) {
      await page.mouse.wheel(0, dy);
      await sleep(60);
    }
  };

  // ---- graph: depth 3, every group expanded through its header, then nothing selected
  await frame.locator('select[aria-label="Graph depth"]').selectOption("3");
  await until("graph", async () => (await state()).nodes > 0 && (await exp(() => {
    const g = [...(window.__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? [])].reverse().find((e) => e.event === "app.graphState.changed")?.detail;
    return g ? g.nodes : 0;
  })) > 600, 120_000);
  await sleep(6000);
  const fit = async () => {
    await frame.locator('button[title="Fit Graph"]').click({ delay: 40 });
    await sleep(1200);
  };
  // ---- export, in the default collapsed state (exporting the fully expanded graph exceeds the
  // memory guard; that cost is the export's own, see P15-S1). Focused policy, a relation
  // highlighted: the file must keep dashed strokes and arrows.
  writePolicy("focused");
  await sleep(2500);
  await fit();
  await selectMain();
  await highlightFlow();
  const exportState = await state();
  const svgFile = path.join(OUT, "focused-export.svg");
  await frame.locator('button[title="Export graph"]').click();
  await frame.locator(".exportMenuItemTitle", { hasText: "SVG snapshot" }).click();
  const input = page.locator(".quick-input-widget input.input").first();
  await until("save dialog", async () => (await input.isVisible().catch(() => false)) || fs.existsSync(svgFile), 30_000);
  if (!fs.existsSync(svgFile)) {
    await input.fill(svgFile);
    await sleep(300);
    await page.keyboard.press("Enter");
  }
  await until("svg written", async () => fs.existsSync(svgFile) && fs.statSync(svgFile).size > 0, 60_000);
  await sleep(1500);
  const svg = fs.readFileSync(svgFile, "utf8");
  const dashes = [...svg.matchAll(/stroke-dasharray:\s*([^;"]+)/g)].map((m) => m[1].trim()).filter((d) => d !== "none");
  result.export = { bytes: svg.length, dashed: dashes.length, markers: (svg.match(/marker-end/g) ?? []).length, nodes: exportState.nodes, edges: exportState.edges };
  check("export (focused, a relation highlighted): the SVG keeps dashed dataflow strokes and arrow markers", dashes.length > 0 && result.export.markers > 0, result.export);
  await clearAll();
  writePolicy(null);
  await sleep(2500);
  mark("export");

  for (let pass = 0; pass < 200; pass++) {
    await fit();
    const next = await exp(() => {
      const g = [...document.querySelectorAll(".react-flow__node")].find((n) => n.querySelector(".cgGroup--collapsed, .cgFolder--collapsed"));
      return g?.dataset.id ?? null;
    });
    if (!next) break;
    await frame.locator(`.react-flow__node[data-id="${next}"] .cgGroupHeader, .react-flow__node[data-id="${next}"] .cgFolderHeader`).first().click({ delay: 30 });
    await sleep(700);
  }
  await fit();
  const collapsedLeft = await exp(() => document.querySelectorAll(".cgGroup--collapsed, .cgFolder--collapsed").length);
  check("every group expanded (the heavy everyday state)", collapsedLeft === 0, collapsedLeft);
  await clearAll();
  await fit();
  // The measured view: zoom 0.6 at the fitted centre.
  const fitted = (await state()).viewport;
  const pane0 = await paneBox();
  const fx = (pane0.width / 2 - fitted.x) / fitted.zoom;
  const fy = (pane0.height / 2 - fitted.y) / fitted.zoom;
  Object.assign(VIEW, {
    0.6: { x: pane0.width / 2 - fx * 0.6, y: pane0.height / 2 - fy * 0.6, zoom: 0.6 },
    0.15: { x: pane0.width / 2 - fx * 0.15, y: pane0.height / 2 - fy * 0.15, zoom: 0.15 },
    0.1: { x: pane0.width / 2 - fx * 0.1, y: pane0.height / 2 - fy * 0.1, zoom: 0.1 },
  });
  result.views = VIEW;
  mark("graph");

  // ---- correctness, in a real VS Code
  await goTo(VIEW[0.6]);
  const legacyDefault = await state();
  check("nothing set: legacy (every eligible dataflow edge runs)", legacyDefault.running > 0 && legacyDefault.running === legacyDefault.animated, legacyDefault);
  const legacyLayout = await layout();
  const reanalysis = await setPolicy("focused");
  await goTo(VIEW[0.6]);
  const f0 = await state();
  result.focusedNone = f0;
  check("switching the policy needs no new analysis", reanalysis === 0, reanalysis);
  check("focused, nothing highlighted: no edge animation runs", f0.animated === 0 && f0.running === 0, f0);
  check("focused: dataflow edges keep their dashes and arrows", f0.dataflowEdges > 0 && f0.dataflowDashed === f0.dataflowEdges && f0.dataflowWithArrow === f0.dataflowEdges, f0);
  check("focused: same nodes, positions and edge IDs as legacy", (await layout()) === legacyLayout, null);
  result.mainId = await selectMain();
  await goTo(VIEW[0.6]);
  const fNode = await state();
  check("focused, a node selected only: no edge animation runs", fNode.selection && fNode.running === 0, fNode);
  const flowText = await highlightFlow();
  const fFlow = await state();
  result.focusedFlow = { text: flowText, running: fFlow.runningIds };
  check("focused, one relation highlighted: exactly that relation moves, and it is a dataflow edge", flowText && fFlow.activeFlow === 1 && fFlow.running === 1 && fFlow.runningNotDataflow === 0, fFlow);
  await clearAll();
  await goTo(VIEW[0.6]);
  const fCleared = await state();
  check("focused, highlight cleared: no edge animation runs again", fCleared.running === 0 && fCleared.activeFlow === 0, fCleared);
  // Focus + Context: dimmed edges never move
  await selectMain();
  await frame.locator("button[data-focus-state]").click({ delay: 40 });
  await sleep(800);
  await highlightFlow();
  const fFocus = await state();
  check("Focus + Context: no dimmed edge moves (focused policy)", fFocus.runningContext === 0, fFocus);
  await frame.locator("button[data-focus-state]").click({ delay: 40 });
  await sleep(600);
  // Legacy, same steps
  await setPolicy("legacy");
  await selectMain();
  await goTo(VIEW[0.6]);
  const lNode = await state();
  check("legacy, a node selected: its dataflow edges move, as before", lNode.running > 0 && lNode.runningNotDataflow === 0, lNode);
  await highlightFlow();
  const lFlow = await state();
  check("legacy, one relation highlighted: only that relation moves, as before", lFlow.running === 1 && lFlow.activeFlow === 1, lFlow);
  check("the highlighted relation is the same edge in both policies", JSON.stringify(lFlow.runningIds) === JSON.stringify(result.focusedFlow.running), [lFlow.runningIds, result.focusedFlow.running]);
  await clearAll();
  mark("correctness");

  // ---- benchmark. Conditions: policy x (nothing / main() selected / its first flow highlighted)
  const conditions = {
    A: { policy: "legacy", select: "none" },
    B: { policy: "focused", select: "none" },
    C: { policy: "focused", select: "flow" },
    D: { policy: "legacy", select: "flow" },
    E: { policy: "legacy", select: "node" },
    F: { policy: "focused", select: "node" },
  };
  let currentPolicy = "legacy";
  const prepare = async (cond, zoom) => {
    const c = conditions[cond];
    if (c.policy !== currentPolicy) {
      await setPolicy(c.policy);
      currentPolicy = c.policy;
    } else {
      await clearAll();
    }
    if (c.select !== "none") await selectMain();
    if (c.select === "flow") await highlightFlow();
    await goTo(VIEW[zoom]);
    await sleep(800);
    const s = await state();
    const want = { none: [false, 0], node: [true, 0], flow: [true, 1] }[c.select];
    if (s.selection !== want[0] || s.activeFlow !== want[1]) throw new Error(`state wrong for ${cond}: ${JSON.stringify(s)}`);
    return s;
  };
  const names = Object.keys(conditions);
  for (const cond of names) {
    await prepare(cond, 0.6);
    await pan();
  }
  mark("warm-up");
  // "main": zoom 0.6 around main(), where the highlighted relation is in view.
  const plan = [[0.6, REPS, names], [0.15, REPS_LOW, ["A", "B", "D", "C"]], ["main", REPS_LOW, ["A", "B", "C", "D"]]];
  for (const [zoom, reps, conds] of plan) {
    for (let rep = 0; rep < reps; rep++) {
      const order = conds.map((_, i) => conds[(i + rep) % conds.length]);
      for (const cond of order) {
        const s = await prepare(cond, zoom);
        const drawn = { nodes: s.nodes, edges: s.edges, dom: s.dom, animated: s.animated, running: s.running, documentAnimations: s.documentAnimations, dataflowDashed: s.dataflowDashed, dataflowEdges: s.dataflowEdges, low: s.low, viewport: s.viewport };
        const i0 = summarize(await measure(() => sleep(2000)));
        const p = summarize(await measure(pan));
        await goTo(VIEW[zoom]);
        const z = summarize(await measure(zoomSweep));
        result.runs.push({ zoom, rep, cond, kind: "idle", drawn, ...i0 }, { zoom, rep, cond, kind: "pan", drawn, ...p }, { zoom, rep, cond, kind: "zoom", drawn, ...z });
        console.log(`zoom ${zoom} rep ${rep} ${cond} (${conditions[cond].policy}/${conditions[cond].select}; running ${s.running}, nodes ${s.nodes}, edges ${s.edges}, dom ${s.dom}): idle ${i0.p50}/${i0.p95} | pan ${p.p50}/${p.p95} | zoom ${z.p50}/${z.p95} >50 ${z.over50} | free ${freeMiB()} MiB`);
      }
    }
    mark(`zoom ${zoom}`);
  }
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
