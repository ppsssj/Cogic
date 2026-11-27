// P15-R2: release checks for the focused dataflow motion policy. See README.md.
//   R2_PHASE=long     one highlighted dataflow edge, short to screen-crossing: running vs paused
//   R2_PHASE=trace    trace steps under focused: only the current dataflow relation moves
//   R2_PHASE=runtime  a paused debug session under focused and legacy
// The harness may add a style to the page (to pause an animation) and reads the DOM and the
// product's own debug log; it adds nothing to the product.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { makeFixture } from "./make-fixture.mjs";

const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const PHASE = process.env.R2_PHASE ?? "long";
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), `cogic-r2-${PHASE}-`)));
const REPS = Number(process.env.R2_REPS ?? 5);
const PAN_MS = 5000;
const EXE = process.env.VSCODE_EXE;
if (!EXE) throw new Error("Set VSCODE_EXE");
const freeMiB = () => Math.round(os.freemem() / 1048576);
if (freeMiB() < 2200) throw new Error(`preflight memory ${freeMiB()} MiB`);

const userData = path.join(OUT, "user-data");
const workspace = path.join(OUT, "workspace");
if (fs.existsSync(userData) || fs.existsSync(workspace)) throw new Error("Use a new output folder");
fs.mkdirSync(path.join(userData, "User"), { recursive: true });
let entry = "src/main.ts";
if (PHASE === "long") {
  makeFixture(workspace);
} else if (PHASE === "trace") {
  fs.cpSync(path.join(REPO, "e2e", "aggregate-inspector", "fixture"), workspace, { recursive: true });
  entry = "src/app/a.ts";
} else {
  // A tiny program with dataflow between functions and a debugger statement in compute().
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.mkdirSync(path.join(workspace, ".vscode"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "server.js"), [
    "function add(left, right) { return left + right; }",
    "function scale(value, factor) { return value * factor; }",
    "function compute(input) {",
    "  const sum = add(input, 1);",
    "  const r2Local = scale(sum, 2);",
    "  debugger;",
    "  return r2Local;",
    "}",
    "function main() { const out = compute(20); return add(out, 0); }",
    "main();",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(workspace, ".vscode", "launch.json"), JSON.stringify({
    version: "0.2.0",
    configurations: [{ type: "node", request: "launch", name: "run server", program: "${workspaceFolder}/src/server.js" }],
  }, null, 2));
  entry = "src/server.js";
}
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
  "debug.openDebug": "neverOpen",
  "debug.internalConsoleOptions": "neverOpen",
};
const writePolicy = (policy) => fs.writeFileSync(settingsFile, JSON.stringify({ ...baseSettings, "cogic.experimental.dataflowMotion": policy }));
writePolicy("focused");

const result = { phase: PHASE, reps: REPS, checks: [], runs: [], memory: { before: freeMiB(), minimum: freeMiB(), aborted: false, timeline: [] } };
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
  await quick("Control+P", entry, path.basename(entry));
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
  await frame.locator(".projectPicker", { hasText: path.basename(entry) }).waitFor({ timeout: 60_000 });
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

  // ---- shared reads
  const motion = () => exp(() => {
    const edges = [...document.querySelectorAll(".react-flow__edge")];
    const runningEdges = edges.filter((e) => {
      const p = e.querySelector(".react-flow__edge-path");
      return p && e.classList.contains("animated") && p.getAnimations().some((a) => a.playState === "running");
    });
    const log = window.__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? [];
    return {
      edges: edges.length,
      nodes: document.querySelectorAll(".react-flow__node").length,
      dom: document.querySelector(".canvasFlow")?.querySelectorAll("*").length ?? 0,
      animated: edges.filter((e) => e.classList.contains("animated")).length,
      running: runningEdges.length,
      runningIds: runningEdges.map((e) => e.getAttribute("data-testid").replace(/^rf__edge-/, "")),
      runningNotDataflow: runningEdges.filter((e) => !e.classList.contains("react-flow__edge-dataflow")).length,
      // The drawn node at each end of a running edge: a plain relation ID or an aggregate key, and
      // a class member resolved to the card that draws it.
      runningOwners: runningEdges.map((e) => {
        const id = e.getAttribute("data-testid").replace(/^rf__edge-/, "");
        let pair = null;
        if (id.startsWith("aggregate:")) pair = JSON.parse(id.slice(10)).slice(1, 3);
        else pair = /^dataflow:(.*?)->(.*?)@@/.exec(id)?.slice(1) ?? null;
        if (!pair) return null;
        return pair.map((end) => {
          const own = [...document.querySelectorAll(".react-flow__node")].find((n) => n.dataset.id === end);
          if (own) return own.dataset.id;
          const handle = [...document.querySelectorAll("[data-handleid]")].find((h) => h.getAttribute("data-handleid") === `in-child-${end}` || h.getAttribute("data-handleid") === `out-child-${end}`);
          return handle?.closest(".react-flow__node")?.dataset.id ?? null;
        });
      }),
      connected: [...document.querySelectorAll(".react-flow__node")].filter((n) => n.querySelector(".cgNode--connected")).map((n) => n.dataset.id),
      childConnected: [...document.querySelectorAll(".cgChildNode")].length,
      dataflowEdges: document.querySelectorAll(".react-flow__edge-dataflow").length,
      selectedNodes: [...document.querySelectorAll(".react-flow__node")].filter((n) => n.querySelector(".cgNode--selected")).map((n) => n.dataset.id),
      selection: [...log].reverse().find((e) => e.event === "app.selectedNode.changed")?.detail?.selectedNodeIds ?? [],
      activeFlow: document.querySelectorAll(".inspectorFlowRow--active").length,
      traceStep: [...log].reverse().find((e) => e.event === "trace.step")?.detail ?? null,
    };
  });
  const viewport = () => exp(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector(".react-flow__viewport")).transform);
    return { x: m.e, y: m.f, zoom: m.a };
  });
  const paneBox = () => frame.locator(".react-flow__pane").boundingBox();
  const fit = async () => {
    await frame.locator('button[title="Fit Graph"]').click({ delay: 40 });
    await sleep(1200);
  };
  const goTo = async (target) => {
    const pane = await paneBox();
    const cx = pane.x + pane.width * 0.5;
    const cy = pane.y + pane.height * 0.5;
    for (let i = 0; i < 300; i++) {
      const z = (await viewport()).zoom;
      const ratio = Math.log(z / target.zoom);
      if (Math.abs(ratio) < 0.004) break;
      const step = Math.max(2, Math.min(120, Math.round(Math.abs(ratio) * 250)));
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, ratio > 0 ? step : -step);
      await sleep(50);
    }
    await sleep(400);
    for (let i = 0; i < 40; i++) {
      const v = await viewport();
      const dx = Math.max(-500, Math.min(500, target.x - v.x));
      const dy = Math.max(-500, Math.min(500, target.y - v.y));
      if (Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) break;
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
  const measure = async (act) => {
    await exp(() => {
      const rec = { gaps: [], long: [], last: performance.now(), on: true };
      window.__r2rec = rec;
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
      const rec = window.__r2rec;
      rec.on = false;
      rec.observer?.disconnect();
      return { gaps: rec.gaps.slice(1), long: rec.long };
    });
    const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, ws: m.memory.workingSetSize })));
    const pctl = (arr, p) => {
      const s = [...arr].sort((a, b) => a - b);
      return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
    };
    return {
      frames: stats.gaps.length,
      p50: Math.round(pctl(stats.gaps, 50) * 10) / 10,
      p95: Math.round(pctl(stats.gaps, 95) * 10) / 10,
      max: Math.round(Math.max(...stats.gaps) * 10) / 10,
      over50: stats.gaps.filter((g) => g > 50).length,
      over100: stats.gaps.filter((g) => g > 100).length,
      longTasks: stats.long.length,
      rendererMB: Math.round(metrics.filter((m) => m.type === "Tab" || m.type === "Renderer").reduce((s, m) => s + m.ws, 0) / 1024),
      gaps: stats.gaps.map((g) => Math.round(g * 10) / 10),
    };
  };
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
  const setPause = (on) => exp((enable) => {
    let style = document.getElementById("r2-pause");
    if (enable && !style) {
      style = document.createElement("style");
      style.id = "r2-pause";
      // Harness-only: stops the running dash animation without touching classes or the edge.
      style.textContent = ".react-flow__edge.animated .react-flow__edge-path { animation-play-state: paused !important; }";
      document.head.appendChild(style);
    }
    if (!enable && style) style.remove();
  }, on);

  if (PHASE === "long") {
    // ---- graph: depth 3, all expanded, focused policy, nothing selected
    await frame.locator('select[aria-label="Graph depth"]').selectOption("3");
    await until("graph", async () => (await exp(() => {
      const g = [...(window.__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? [])].reverse().find((e) => e.event === "app.graphState.changed")?.detail;
      return g ? g.nodes : 0;
    })) > 600, 120_000);
    await sleep(6000);
    for (let pass = 0; pass < 200; pass++) {
      await fit();
      const next = await exp(() => [...document.querySelectorAll(".react-flow__node")].find((n) => n.querySelector(".cgGroup--collapsed, .cgFolder--collapsed"))?.dataset.id ?? null);
      if (!next) break;
      await frame.locator(`.react-flow__node[data-id="${next}"] .cgGroupHeader, .react-flow__node[data-id="${next}"] .cgFolderHeader`).first().click({ delay: 30 });
      await sleep(700);
    }
    await fit();
    await clearAll();
    check("every group expanded, nothing selected", (await exp(() => document.querySelectorAll(".cgGroup--collapsed, .cgFolder--collapsed").length)) === 0 && (await motion()).selection.length === 0, null);
    mark("graph");

    // ---- candidate edges: dataflow paths drawn in a few overviews, with their length
    const candidates = new Map();
    const bridges = new Set();
    const pane0 = await paneBox();
    const fitted = await viewport();
    const fx = (pane0.width / 2 - fitted.x) / fitted.zoom;
    const fy = (pane0.height / 2 - fitted.y) / fitted.zoom;
    for (const view of [fitted, { x: 40, y: 40, zoom: 0.1 }, { x: pane0.width / 2 - fx * 0.1, y: pane0.height / 2 - fy * 0.1, zoom: 0.1 }]) {
      await goTo(view);
      await sleep(800);
      const found = await exp(() => [...document.querySelectorAll(".react-flow__edge-dataflow")].map((e) => {
        const p = e.querySelector(".react-flow__edge-path");
        const len = p.getTotalLength();
        const mid = p.getPointAtLength(len / 2);
        // 0.92 is a normal dataflow edge with nothing selected; 0.26 is a collapsed bridge, which
        // never animates under either policy.
        return { id: e.getAttribute("data-testid").replace(/^rf__edge-/, ""), length: Math.round(len), mx: mid.x, my: mid.y, opacity: p.style.opacity };
      }).filter((e) => !e.id.startsWith("aggregate:")));
      for (const e of found) if (!candidates.has(e.id)) candidates.set(e.id, e);
      for (const e of found) if (e.opacity !== "0.92") bridges.add(e.id);
    }
    const sorted = [...candidates.values()].filter((e) => !bridges.has(e.id)).sort((a, b) => a.length - b.length);
    result.candidates = { count: sorted.length, bridgesSkipped: bridges.size, all: candidates.size, lengths: sorted.map((e) => e.length) };
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
    const picks = [["short", at(0.05)], ["medium", at(0.5)], ["long", at(0.9)], ["crossing", sorted[sorted.length - 1]]];
    console.log(`candidates ${sorted.length} (bridges skipped ${bridges.size} of ${candidates.size}); picks ${picks.map(([k, e]) => `${k} ${e.length}`).join(", ")}`);
    check("candidate dataflow edges found", sorted.length >= 8, result.candidates);

    // ---- for each pick: find the Param Flow row of its source node that highlights it
    const ends = (id) => {
      const m = /^dataflow:(.*?)->(.*?)@@/.exec(id);
      return m ? [m[1], m[2]] : null;
    };
    const selectNode = async (nodeId) => {
      // The node's box in flow coordinates, from an overview where it is drawn.
      for (const view of [{ x: 40, y: 40, zoom: 0.1 }, { x: pane0.width / 2 - fx * 0.1, y: pane0.height / 2 - fy * 0.1, zoom: 0.1 }, fitted]) {
        if (await exp((id) => Boolean(document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)), nodeId)) break;
        await goTo(view);
        await sleep(700);
      }
      const flow = await exp((id) => {
        const node = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
        if (!node) return null;
        const pane = document.querySelector(".react-flow__pane").getBoundingClientRect();
        const m = new DOMMatrix(getComputedStyle(document.querySelector(".react-flow__viewport")).transform);
        const r = node.getBoundingClientRect();
        return { x: (r.left + r.width / 2 - pane.left - m.e) / m.a, y: (r.top + r.height / 2 - pane.top - m.f) / m.a, w: pane.width, h: pane.height };
      }, nodeId);
      if (!flow) return false;
      await goTo({ x: flow.w / 2 - flow.x * 0.6, y: flow.h / 2 - flow.y * 0.6, zoom: 0.6 });
      await frame.locator(`.react-flow__node[data-id="${nodeId}"] .cgNodeTitle`).first().click({ delay: 40 });
      await sleep(1200);
      return true;
    };
    const targets = [];
    for (const [kind, edge] of picks) {
      const [source] = ends(edge.id) ?? [];
      if (!source || !(await selectNode(source))) {
        targets.push({ kind, edge, skipped: "source node not found" });
        continue;
      }
      const rows = await frame.locator(".inspectorFlowRow").count();
      let rowIndex = -1;
      for (let i = 0; i < rows && rowIndex < 0; i++) {
        await frame.locator(".inspectorFlowRow").nth(i).click();
        await sleep(900);
        // the highlighted relation is the edge to measure when it is the one running
        const view = { x: pane0.width / 2 - edge.mx * 0.6, y: pane0.height / 2 - edge.my * 0.6, zoom: 0.6 };
        await goTo(view);
        await sleep(500);
        const m = await motion();
        (result.targetSearch ??= []).push({ kind, row: i, rows, selection: m.selection, activeFlow: m.activeFlow, animated: m.animated, running: m.runningIds, edgeInDom: await exp((id) => Boolean(document.querySelector(`[data-testid="rf__edge-${CSS.escape(id)}"]`)), edge.id),
          rowEdge: await exp(() => {
            // the edge the active row highlights: the one whose stroke is the highlight colour
            const all = [...document.querySelectorAll(".react-flow__edge-dataflow")];
            return all.map((e) => {
              const p = e.querySelector(".react-flow__edge-path");
              return { id: e.getAttribute("data-testid").replace(/^rf__edge-/, "").slice(0, 160), cls: e.getAttribute("class"), stroke: p?.style.stroke, opacity: p?.style.opacity, width: p?.style.strokeWidth };
            }).filter((x) => x.stroke === "rgb(56, 189, 248)" || x.stroke === "#38bdf8");
          }), rowText: (await frame.locator(".inspectorFlowRow").nth(i).textContent())?.slice(0, 80) });
        if (m.runningIds.length === 1 && m.runningIds[0] === edge.id) rowIndex = i;
      }
      targets.push({ kind, edge, source, rowIndex, skipped: rowIndex < 0 ? "no Param Flow row highlights it" : null });
      await clearAll();
    }
    result.targets = targets.map((t) => ({ kind: t.kind, length: t.edge.length, id: t.edge.id, rowIndex: t.rowIndex, skipped: t.skipped }));
    check("every picked edge can be highlighted from the Inspector", targets.every((t) => !t.skipped), result.targets);
    if (process.env.R2_TARGETS_ONLY) throw new Error("stopped after the target search (R2_TARGETS_ONLY)");
    mark("targets");

    // ---- conditions: A nothing highlighted, B highlighted (running), C highlighted, paused
    const viewFor = (edge) => ({ x: pane0.width / 2 - edge.mx * 0.6, y: pane0.height / 2 - edge.my * 0.6, zoom: 0.6 });
    const highlight = async (t) => {
      await selectNode(t.source);
      await frame.locator(".inspectorFlowRow").nth(t.rowIndex).click();
      await sleep(900);
    };
    for (const t of targets.filter((x) => !x.skipped)) {
      let highlighted = false;
      for (let rep = 0; rep < REPS; rep++) {
        const order = ["A", "B", "C"].map((_, i, a) => a[(i + rep) % 3]);
        for (const cond of order) {
          if (cond === "A") {
            await setPause(false);
            if (highlighted) await clearAll();
            highlighted = false;
          } else {
            if (!highlighted) await highlight(t);
            highlighted = true;
            await setPause(cond === "C");
          }
          await goTo(viewFor(t.edge));
          await sleep(800);
          const m = await motion();
          const ok = cond === "A" ? m.running === 0 && m.selection.length === 0 : cond === "B" ? m.running === 1 && m.runningIds[0] === t.edge.id : m.running === 0 && m.animated === 1;
          if (!ok) throw new Error(`state wrong for ${t.kind} ${cond}: ${JSON.stringify({ running: m.running, animated: m.animated, ids: m.runningIds, sel: m.selection })}`);
          const idle = await measure(() => sleep(2000));
          const p = await measure(pan);
          const drawn = { nodes: m.nodes, edges: m.edges, dom: m.dom, running: m.running, animated: m.animated };
          result.runs.push({ edge: t.kind, length: t.edge.length, rep, cond, kind: "idle", drawn, ...idle }, { edge: t.kind, length: t.edge.length, rep, cond, kind: "pan", drawn, ...p });
          console.log(`${t.kind} (${t.edge.length} px) rep ${rep} ${cond} (running ${m.running}, animated ${m.animated}): idle ${idle.p50}/${idle.p95} max ${idle.max} | pan ${p.p50}/${p.p95} max ${p.max} >100 ${p.over100} | free ${freeMiB()} MiB`);
        }
      }
      await setPause(false);
      if (highlighted) await clearAll();
      mark(t.kind);
    }
  }

  if (PHASE === "trace") {
    // ---- trace on a.ts under focused: only the current dataflow relation moves
    await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
    await until("graph", async () => (await motion()).edges > 3, 60_000);
    await sleep(3000);
    const traceButton = frame.locator('button[title^="Trace mode"]');
    const label = () => exp(() => [...document.querySelectorAll(".mono")].map((e) => e.textContent).find((t) => /^\d+ \/ \d+$/.test(t)) ?? null);
    const next = frame.locator("button").filter({ hasText: /^->$/ }).first();
    const before = await motion();
    await traceButton.click();
    await until("trace ready", async () => /^0 \/ \d+$/.test((await label()) ?? ""), 60_000);
    await sleep(1500);
    const total = Number((await label()).split(" / ")[1]);
    const steps = [];
    let previousRunning = [];
    for (let i = 0; i < total; i++) {
      await next.click();
      await sleep(900);
      await fit();
      const m = await motion();
      const kind = m.traceStep?.eventType === "edge" ? m.traceStep.edgeKind : m.traceStep?.eventType;
      steps.push({ cursor: i + 1, kind, running: m.running, runningIds: m.runningIds, owners: m.runningOwners, connected: m.connected, dataflowEdges: m.dataflowEdges });
      if (kind === "dataflow") {
        // drawn: one dataflow edge runs, and its ends are the highlighted (connected) nodes
        // Both ends of the running edge are drawn nodes highlighted for the trace flow.
        const endsHighlighted =
          m.runningOwners.length > 0 &&
          m.runningOwners.every((pair) => Array.isArray(pair) && pair.every((n) => n && m.connected.includes(n)));
        check(`trace step ${i + 1} (dataflow): exactly the current relation moves`, m.running === 1 && m.runningNotDataflow === 0 && endsHighlighted, steps.at(-1));
        check(`trace step ${i + 1}: the previous relation stopped`, previousRunning.every((id) => !m.runningIds.includes(id) || m.runningIds.length === 1), { previousRunning, now: m.runningIds });
      } else {
        check(`trace step ${i + 1} (${kind}): nothing moves`, m.running === 0, steps.at(-1));
      }
      previousRunning = m.runningIds;
    }
    result.trace = { total, steps };
    await traceButton.click();
    await until("trace gone", async () => (await label()) === null, 20_000);
    await sleep(3000);
    await fit();
    const after = await motion();
    result.trace.before = { nodes: before.nodes, edges: before.edges };
    result.trace.after = { nodes: after.nodes, edges: after.edges, running: after.running };
    check("trace exit: the graph is back and nothing moves (focused, nothing selected)", after.running === 0 && after.nodes === before.nodes && after.edges === before.edges, result.trace);
  }

  if (PHASE === "runtime") {
    // ---- a paused debug session: runtime marks a node, never a relation
    await frame.locator('select[aria-label="Graph depth"]').selectOption("0");
    await sleep(1500);
    const generate = frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first();
    if (await generate.count()) await generate.click({ delay: 60 });
    await until("graph", async () => (await motion()).dataflowEdges > 0, 60_000);
    await sleep(2000);
    await fit();
    await exp(() => {
      window.__r2runtime = [];
      window.addEventListener("message", (e) => {
        if (e.data?.type === "runtimeDebug") window.__r2runtime.push(e.data.payload);
      });
    });
    const runtimeStates = () => exp(() => window.__r2runtime.map((p) => p.state));
    const runSession = async (policy) => {
      writePolicy(policy);
      await sleep(2500);
      await fit();
      const idle = await motion();
      await page.locator(".monaco-editor .view-lines").first().click();
      await page.keyboard.press("F5");
      await until("paused", async () => (await runtimeStates()).includes("paused"), 90_000);
      await sleep(2500);
      await fit();
      const paused = await motion();
      const payload = await exp(() => [...window.__r2runtime].reverse().find((p) => p.state === "paused"));
      await page.keyboard.press("Shift+F5");
      await until("inactive", async () => (await runtimeStates()).at(-1) === "inactive", 60_000);
      await sleep(2000);
      await fit();
      const ended = await motion();
      await exp(() => {
        window.__r2runtime = [];
      });
      return { idle, paused, ended, frame: payload?.frame ? { file: path.basename(payload.frame.filePath ?? ""), line: payload.frame.line, name: payload.frame.name } : null };
    };
    const f = await runSession("focused");
    result.focused = { frame: f.frame, idle: f.idle.running, paused: { running: f.paused.running, selected: f.paused.selectedNodes, selection: f.paused.selection, dataflowEdges: f.paused.dataflowEdges }, ended: f.ended.running };
    check("runtime (focused): the paused frame marks a graph node", f.frame && f.paused.selectedNodes.length > 0 && f.paused.selection.length === 0, result.focused);
    check("runtime (focused): no relation moves while paused; dataflow edges are drawn", f.paused.running === 0 && f.paused.dataflowEdges > 0, result.focused);
    check("runtime (focused): nothing moves after the session ends", f.ended.running === 0 && f.ended.nodes === f.idle.nodes && f.ended.edges === f.idle.edges, result.focused);
    const l = await runSession("legacy");
    result.legacy = { idle: l.idle.running, paused: l.paused.running, ended: l.ended.running };
    check("runtime (legacy, for comparison): flows move as before, also while paused", l.idle.running > 0 && l.paused.running > 0 && l.ended.running > 0, result.legacy);
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
