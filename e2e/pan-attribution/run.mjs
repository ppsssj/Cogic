// P15-P0: where the time of a real pan goes, in a real VS Code. Research harness; no product change
// except the build-time VITE_COGIC_EXPERIMENT_RENDER_ALL switch used by the F builds.
//
//   node e2e/pan-attribution/run.mjs <new output folder>
//   PA_SHAPE=large|small   fixture (large: 650 nodes at depth 3, every group expanded)
//   PA_REPS=3              repetitions, condition order rotated
//   PA_CONDS=A,B,C,...     subset of conditions
//   PA_TRACE=1             one Chromium trace per traced condition after the repetitions
//
// Every pan must pass the gates below; a pan that cannot start on empty pane fails, it is never
// replaced by another coordinate.
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
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "cogic-pa-")));
const SHAPE_NAME = process.env.PA_SHAPE ?? "large";
const REPS = Number(process.env.PA_REPS ?? 3);
const TRACE = process.env.PA_TRACE === "1";
const PAN_MS = 5000;
const EXE = process.env.VSCODE_EXE;
if (!EXE) throw new Error("VSCODE_EXE is not set");
const freeMiB = () => Math.round(os.freemem() / 1048576);
if (freeMiB() < 2200) throw new Error(`preflight memory ${freeMiB()} MiB`);

// Conditions. All at zoom 0.6 with dash animation stopped by a harness style.
const CONDITIONS = {
  A: { input: "none", view: "V0", doc: "static graph, no input" },
  B: { input: "move", view: "V0", doc: "the pan path with no button pressed" },
  C: { input: "pan", view: "V0", doc: "real pan, default virtualization" },
  D: { input: "pan", view: "Vlow", doc: "real pan where few nodes enter or leave" },
  E: { input: "pan", view: "Vhigh", doc: "real pan where many nodes enter or leave" },
  C0: { input: "pan", view: "V0", bare: true, doc: "as C, no commit counter and no MutationObserver" },
  Gedges: { input: "pan", view: "V0", css: ".canvasFlow .react-flow__edges { visibility: hidden !important; }", doc: "as C, edges not painted" },
  Gnodes: { input: "pan", view: "V0", css: ".canvasFlow .react-flow__nodes { visibility: hidden !important; }", doc: "as C, nodes not painted" },
  Gdash: { input: "pan", view: "V0", css: ".canvasFlow .react-flow__edge-path { stroke-dasharray: none !important; }", doc: "as C, edges solid instead of dashed" },
  Garrows: { input: "pan", view: "V0", css: ".canvasFlow .react-flow__edge-path { marker-end: none !important; }", doc: "as C, no arrow markers" },
  Gbadges: { input: "pan", view: "V0", css: ".canvasFlow .cgAggregateBadge { visibility: hidden !important; }", doc: "as C, aggregate badges not painted" },
  Gbg: { input: "pan", view: "V0", css: ".canvasFlow .react-flow__background { visibility: hidden !important; }", doc: "as C, the dot background not painted" },
  // Removing the transforms of .react-flow and its renderer made the same mouse path move the view
  // about 2x further (large2: excursion 481 x 697 for 256 x 280); the gate rejects it. Kept for the
  // record only.
  GlayersAll: {
    input: "pan",
    view: "V0",
    css: [
      ".canvasFlow .react-flow, .canvasFlow .react-flow__renderer, .canvasFlow .react-flow__edges, .canvasFlow .react-flow__nodes { transform: none !important; backface-visibility: visible !important; will-change: auto !important; }",
      ".canvasFlow .react-flow__viewport { backface-visibility: visible !important; will-change: auto !important; }",
    ].join(" "),
    doc: "as C, every Cogic layer hint removed (moves the view differently: invalid)",
  },
  Glayers: {
    input: "pan",
    view: "V0",
    css: ".canvasFlow .react-flow__edges, .canvasFlow .react-flow__nodes { transform: none !important; backface-visibility: visible !important; }",
    doc: "as C, the edges and nodes layers without translateZ(0) and backface-visibility",
  },
  Gbackface: {
    input: "pan",
    view: "V0",
    css: ".canvasFlow .react-flow, .canvasFlow .react-flow__renderer, .canvasFlow .react-flow__viewport, .canvasFlow .react-flow__edges, .canvasFlow .react-flow__nodes { backface-visibility: visible !important; }",
    doc: "as C, translateZ(0) kept, backface-visibility visible",
  },
  W: { input: "pan", view: "V0", walk: true, timing: false, doc: "as C, with a fiber walk per commit (counts only, timing not used)" },
};
const SMALL = { folders: 4, leaves: 4, functions: 4 };
const defaultConds = SHAPE_NAME === "small" ? ["A", "B", "C", "C0", "W"] : ["A", "B", "C", "D", "E", "C0", "Gedges", "Gnodes", "Gbg", "Glayers", "Gbackface", "W"];
const CONDS = (process.env.PA_CONDS ? process.env.PA_CONDS.split(",") : defaultConds).filter((c) => CONDITIONS[c]);
const TRACED = (process.env.PA_TRACED ? process.env.PA_TRACED.split(",") : ["C", "Gedges", "Glayers", "Gbg"]).filter((c) => CONDS.includes(c));

const userData = path.join(OUT, "user-data");
const workspace = path.join(OUT, "workspace");
if (fs.existsSync(userData) || fs.existsSync(workspace)) throw new Error("Use a new output folder");
fs.mkdirSync(path.join(userData, "User"), { recursive: true });
makeFixture(workspace, SHAPE_NAME === "small" ? SMALL : SHAPE);
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

const result = {
  shape: SHAPE_NAME,
  reps: REPS,
  conditions: Object.fromEntries(CONDS.map((c) => [c, CONDITIONS[c].doc])),
  env: { node: process.version, platform: `${os.platform()} ${os.release()}`, cpus: os.cpus()[0]?.model, memMiB: Math.round(os.totalmem() / 1048576) },
  checks: [],
  runs: [],
  memory: { before: freeMiB(), minimum: freeMiB(), aborted: false },
};
const check = (name, pass, detail) => {
  result.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` ${JSON.stringify(detail)?.slice(0, 500)}`}`);
  return Boolean(pass);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const save = () => fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 1));

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
  try {
    Object.assign(result.env, await app.evaluate(({ app: a }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, gpu: a.getGPUFeatureStatus() })));
  } catch (error) {
    result.env.versionsError = String(error).slice(0, 200);
  }
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
      if (await f.locator('select[aria-label="Graph depth"]').count().catch(() => 0)) frame = f;
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
  const viewport = () => exp(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector(".react-flow__viewport")).transform);
    return { x: m.e, y: m.f, zoom: m.a };
  });
  const paneBox = () => frame.locator(".react-flow__pane").boundingBox();
  const fit = async () => {
    await frame.locator('button[title="Fit Graph"]').click({ delay: 40 });
    await sleep(1200);
  };
  // Navigation between runs (not measured): React Flow's own d3-zoom, from its store, so the store,
  // the DOM and the virtualization follow as for input. The measured pans are real mouse input.
  const goTo = async (target) => {
    const ok = await exp((t) => {
      const el = document.querySelector(".react-flow__viewport");
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
      let store = null;
      for (let f = el[key]; f && !store; f = f.return) {
        const v = f.memoizedProps?.value;
        if (v && typeof v.getState === "function" && Array.isArray(v.getState().transform)) store = v;
      }
      const st = store?.getState();
      if (!st?.d3Zoom || !st?.d3Selection) return false;
      st.d3Zoom.scaleTo(st.d3Selection, t.zoom, [0, 0]);
      const [x, y, k] = store.getState().transform;
      st.d3Zoom.translateBy(st.d3Selection, (t.x - x) / k, (t.y - y) / k);
      return true;
    }, target);
    if (!ok) throw new Error("goTo: React Flow store not found");
    await sleep(500);
    const v = await viewport();
    if (Math.abs(v.x - target.x) > 1 || Math.abs(v.y - target.y) > 1 || Math.abs(v.zoom - target.zoom) > 1e-3) throw new Error(`goTo missed: ${JSON.stringify(v)} vs ${JSON.stringify(target)}`);
    return v;
  };

  // ---- graph: depth 3, every group expanded, nothing selected, dash animation stopped
  await frame.locator('select[aria-label="Graph depth"]').selectOption("3");
  const minNodes = SHAPE_NAME === "small" ? 40 : 600;
  await until("graph", async () => (await exp(() => [...(window.__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? [])].reverse().find((e) => e.event === "app.graphState.changed")?.detail?.nodes ?? 0)) > minNodes, 120_000);
  await sleep(5000);
  for (let pass = 0; pass < 200; pass++) {
    await fit();
    const next = await exp(() => [...document.querySelectorAll(".react-flow__node")].find((n) => n.querySelector(".cgGroup--collapsed, .cgFolder--collapsed"))?.dataset.id ?? null);
    if (!next) break;
    await frame.locator(`.react-flow__node[data-id="${next}"] .cgGroupHeader, .react-flow__node[data-id="${next}"] .cgFolderHeader`).first().dispatchEvent("click");
    await sleep(700);
  }
  await fit();
  await exp(() => {
    // Harness-only: no dash animation in any condition.
    const style = document.createElement("style");
    style.id = "pa-still";
    style.textContent = ".react-flow__edge .react-flow__edge-path, .react-flow__edge.animated path { animation: none !important; }";
    document.head.appendChild(style);
  });
  const empty = async () => {
    const pane = await paneBox();
    const spot = await exp(() => {
      const r = document.querySelector(".react-flow__pane").getBoundingClientRect();
      for (let y = 40; y < r.height - 40; y += 8)
        for (let x = 40; x < r.width - 40; x += 8)
          if (document.elementFromPoint(r.left + x, r.top + y)?.classList.contains("react-flow__pane")) return { x, y };
      return null;
    });
    if (spot) await page.mouse.click(pane.x + spot.x, pane.y + spot.y);
    await sleep(600);
  };
  await empty();
  const graphState = await exp(() => ({
    graphNodes: [...(window.__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? [])].reverse().find((e) => e.event === "app.graphState.changed")?.detail ?? null,
    collapsed: document.querySelectorAll(".cgGroup--collapsed, .cgFolder--collapsed").length,
    running: document.getAnimations().filter((a) => a.playState === "running").length,
    layerStyles: Object.fromEntries([".react-flow", ".react-flow__renderer", ".react-flow__viewport", ".react-flow__edges", ".react-flow__nodes"].map((sel) => {
      const el = document.querySelector(`.canvasFlow ${sel}`);
      const cs = el && getComputedStyle(el);
      return [sel, cs ? { transform: cs.transform, willChange: cs.willChange, backface: cs.backfaceVisibility } : null];
    })),
  }));
  result.graph = graphState;
  check("every group expanded; no animation runs", graphState.collapsed === 0 && graphState.running === 0, graphState);

  // ---- instrumentation (in the page). Installed per run, removed after it.
  await exp(() => {
    const pa = (window.__pa = {});
    const vp = () => document.querySelector(".react-flow__viewport");
    // React Flow's store, from the provider above the viewport element.
    pa.store = () => {
      if (pa._store) return pa._store;
      const el = vp();
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
      for (let f = el[key]; f; f = f.return) {
        const v = f.memoizedProps?.value;
        if (v && typeof v.getState === "function" && Array.isArray(v.getState().transform)) return (pa._store = v);
      }
      return null;
    };
    pa.domTransform = () => {
      const m = /translate\((-?[\d.e-]+)px,\s*(-?[\d.e-]+)px\)\s*scale\((-?[\d.e-]+)\)/.exec(vp().style.transform);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    pa.drawn = () => ({
      nodes: document.querySelectorAll(".react-flow__node").length,
      edges: document.querySelectorAll(".react-flow__edge").length,
      dom: document.querySelector(".canvasFlow")?.querySelectorAll("*").length ?? 0,
      storeNodes: pa.store()?.getState().nodeInternals?.size ?? null,
      storeEdges: pa.store()?.getState().edges?.length ?? null,
    });
    // React root commits: React assigns FiberRoot.current once per commit.
    pa.fiberRoot = () => {
      const host = document.getElementById("root");
      const key = Object.keys(host).find((k) => k.startsWith("__reactContainer$"));
      return host[key]?.stateNode ?? null;
    };
    pa.commits = 0;
    pa.installCounter = (walk) => {
      const root = pa.fiberRoot();
      let current = root.current;
      const labels = new Map();
      // A component's label: its (minified) name and the first class of its first host element.
      const labelOf = (f) => {
        if (labels.has(f.type)) return labels.get(f.type);
        let cls = "";
        for (let c = f.child, n = 0; c && n < 40; n++) {
          if (typeof c.type === "string") {
            const cn = c.stateNode?.className;
            cls = (typeof cn === "string" ? cn : cn?.baseVal ?? "").split(/\s+/)[0] || c.type;
            break;
          }
          c = c.child;
        }
        const name = (typeof f.type === "function" ? f.type.name : f.type?.displayName ?? f.type?.render?.name ?? "") || "?";
        const label = `${name}:${cls}`;
        labels.set(f.type, label);
        return label;
      };
      let prev = new Set();
      pa.walk = { commits: 0, rendered: {}, mounted: {}, fibers: 0 };
      const doWalk = (top) => {
        const seen = new Set();
        const stack = [top];
        while (stack.length) {
          const f = stack.pop();
          seen.add(f);
          if (f.type && typeof f.type !== "string") {
            // newly created this commit / rendered this commit (a new object whose alternate was
            // in the last tree, with PerformedWork set). Fibers of untouched subtrees are the same
            // objects as last time and are not counted.
            if (!f.alternate && !prev.has(f)) pa.walk.mounted[labelOf(f)] = (pa.walk.mounted[labelOf(f)] ?? 0) + 1;
            else if (!prev.has(f) && prev.has(f.alternate) && f.flags & 1) pa.walk.rendered[labelOf(f)] = (pa.walk.rendered[labelOf(f)] ?? 0) + 1;
          }
          if (f.sibling) stack.push(f.sibling);
          if (f.child) stack.push(f.child);
        }
        pa.walk.fibers = seen.size;
        prev = seen;
      };
      if (walk) doWalk(current);
      Object.defineProperty(root, "current", {
        configurable: true,
        get: () => current,
        set: (value) => {
          current = value;
          pa.commits += 1;
          if (walk) {
            pa.walk.commits += 1;
            doWalk(value);
          }
        },
      });
    };
    pa.removeCounter = () => {
      const root = pa.fiberRoot();
      const value = root.current;
      delete root.current;
      root.current = value;
    };
    // DOM changes under the renderer: React Flow node and edge elements added and removed.
    pa.mut = { nodeAdds: 0, nodeRemoves: 0, edgeAdds: 0, edgeRemoves: 0, domAdds: 0, domRemoves: 0, records: 0 };
    const tally = (list, kind) => {
      for (const n of list) {
        if (n.nodeType !== 1) continue;
        pa.mut[`dom${kind}`] += 1 + n.querySelectorAll("*").length;
        const nodes = (n.matches(".react-flow__node") ? 1 : 0) + n.querySelectorAll(".react-flow__node").length;
        const edges = (n.matches(".react-flow__edge") ? 1 : 0) + n.querySelectorAll(".react-flow__edge").length;
        pa.mut[`node${kind}`] += nodes;
        pa.mut[`edge${kind}`] += edges;
      }
    };
    pa.observer = new MutationObserver((records) => {
      pa.mut.records += records.length;
      for (const r of records) {
        tally(r.addedNodes, "Adds");
        tally(r.removedNodes, "Removes");
      }
    });
    // Per frame: gap, viewport, and what changed since the previous frame.
    pa.start = (opts) => {
      pa.commits = 0;
      for (const k of Object.keys(pa.mut)) pa.mut[k] = 0;
      if (opts.counter) pa.installCounter(opts.walk);
      if (opts.observer) pa.observer.observe(document.querySelector(".react-flow__renderer"), { childList: true, subtree: true });
      const store = pa.store();
      const rec = (pa.rec = { frames: [], long: [], on: true, storeSamples: 0, storeMismatch: 0, views: new Set() });
      let last = performance.now();
      let lastMut = { ...pa.mut };
      let lastCommits = 0;
      let n = 0;
      const el = vp();
      const tick = (t) => {
        if (!rec.on) return;
        const tf = el.style.transform;
        rec.views.add(tf);
        const fr = { t: Math.round(t * 10) / 10, gap: Math.round((t - last) * 10) / 10, tf };
        if (opts.observer) {
          fr.nodes = pa.mut.nodeAdds - lastMut.nodeAdds + pa.mut.nodeRemoves - lastMut.nodeRemoves;
          fr.edges = pa.mut.edgeAdds - lastMut.edgeAdds + pa.mut.edgeRemoves - lastMut.edgeRemoves;
          fr.dom = pa.mut.domAdds - lastMut.domAdds + pa.mut.domRemoves - lastMut.domRemoves;
          lastMut = { ...pa.mut };
        }
        if (opts.counter) {
          fr.commits = pa.commits - lastCommits;
          lastCommits = pa.commits;
        }
        // the store against the DOM, every 10th frame (the DOM may trail the store by a commit)
        if (store && ++n % 10 === 0) {
          const s = store.getState().transform;
          const d = pa.domTransform();
          rec.storeSamples += 1;
          if (!d || Math.abs(s[0] - d[0]) > 0.5 || Math.abs(s[1] - d[1]) > 0.5 || Math.abs(s[2] - d[2]) > 1e-4) rec.storeMismatch += 1;
        }
        rec.frames.push(fr);
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame((t) => {
        last = t;
        requestAnimationFrame(tick);
      });
      try {
        rec.lo = new PerformanceObserver((list) => list.getEntries().forEach((e) => rec.long.push([Math.round(e.startTime), Math.round(e.duration)])));
        rec.lo.observe({ type: "longtask", buffered: false });
      } catch {
        rec.lo = null;
      }
    };
    pa.stop = (opts) => {
      const rec = pa.rec;
      rec.on = false;
      rec.lo?.disconnect();
      if (opts.observer) {
        pa.observer.takeRecords();
        pa.observer.disconnect();
      }
      if (opts.counter) pa.removeCounter();
      const s = pa.store()?.getState().transform ?? null;
      const d = pa.domTransform();
      return {
        frames: rec.frames.slice(1),
        long: rec.long,
        views: rec.views.size,
        storeSamples: rec.storeSamples,
        storeMismatch: rec.storeMismatch,
        endStore: s,
        endDom: d,
        mut: { ...pa.mut },
        commits: pa.commits,
        walk: opts.walk ? pa.walk : null,
      };
    };
  });

  // ---- the pan: an ellipse sized to the pane (at most 240 x 140, at most a quarter of the pane),
  // pressed on empty pane. No empty pane: the run fails.
  const findStart = () => exp(() => {
    const r = document.querySelector(".react-flow__pane").getBoundingClientRect();
    const under = (x, y) => document.elementFromPoint(r.left + x, r.top + y);
    const rx = Math.min(240, Math.floor(r.width / 4));
    const ry = Math.min(140, Math.floor(r.height / 4));
    let best = null;
    for (let y = ry + 20; y <= r.height - ry - 20; y += 6)
      for (let x = 2 * rx + 20; x <= r.width - 20; x += 6) {
        if (!under(x, y)?.classList.contains("react-flow__pane")) continue;
        const d = Math.hypot(x - rx - r.width / 2, y - r.height / 2);
        if (!best || d < best.d) best = { x, y, d };
      }
    return best ? { x: best.x, y: best.y, rx, ry, pane: [r.width, r.height], under: under(best.x, best.y)?.className } : { rx, ry, pane: [r.width, r.height], none: true };
  });
  const ellipse = async (start, press) => {
    const pane = await paneBox();
    const c = { x: pane.x + start.x - start.rx, y: pane.y + start.y };
    await page.mouse.move(c.x + start.rx, c.y);
    if (press) await page.mouse.down();
    const steps = Math.round(PAN_MS / 16);
    const t0 = Date.now();
    for (let i = 1; i <= steps; i++) {
      const a = (2 * Math.PI * i) / steps;
      await page.mouse.move(c.x + start.rx * Math.cos(a), c.y + start.ry * Math.sin(a));
      const wait = t0 + i * 16 - Date.now();
      if (wait > 0) await sleep(wait);
    }
    if (press) await page.mouse.up();
  };

  // ---- views at zoom 0.6: V0 the fitted centre; Vlow / Vhigh from a probe grid by node churn
  await fit();
  const pane0 = await paneBox();
  const fitted = await viewport();
  const flowAt = (sx, sy) => ({ x: (sx - fitted.x) / fitted.zoom, y: (sy - fitted.y) / fitted.zoom });
  const viewFor = (p) => ({ x: pane0.width / 2 - p.x * 0.6, y: pane0.height / 2 - p.y * 0.6, zoom: 0.6 });
  const centre = flowAt(pane0.width / 2, pane0.height / 2);
  const views = {};
  // V0: the view nearest the graph centre with an empty-pane start for the pan (5 x 5 candidates)
  {
    const cands = [];
    for (let gy = 0; gy < 5; gy++)
      for (let gx = 0; gx < 5; gx++) cands.push(flowAt(((gx + 0.5) / 5) * pane0.width, ((gy + 0.5) / 5) * pane0.height));
    cands.sort((p, q) => Math.hypot(p.x - centre.x, p.y - centre.y) - Math.hypot(q.x - centre.x, q.y - centre.y));
    for (const p of cands) {
      await goTo(viewFor(p));
      await sleep(500);
      if (!(await findStart()).none) {
        views.V0 = viewFor(p);
        result.v0 = { flow: p, offCentre: Math.round(Math.hypot(p.x - centre.x, p.y - centre.y)) };
        break;
      }
    }
    if (!views.V0) throw new Error("no view near the centre has empty pane to start a pan");
  }

  // ---- one straight drag: the view moves by exactly the mouse delta
  {
    await goTo(views.V0);
    await sleep(600);
    const start = await findStart();
    if (start.none) throw new Error("no empty pane for the straight-drag check");
    const pane = await paneBox();
    const v0 = await viewport();
    await page.mouse.move(pane.x + start.x, pane.y + start.y);
    await page.mouse.down();
    await page.mouse.move(pane.x + start.x - 120, pane.y + start.y + 60, { steps: 20 });
    await page.mouse.up();
    await sleep(500);
    const v1 = await viewport();
    result.straightDrag = { from: v0, to: v1, expected: [-120, 60] };
    check("a straight drag moves the view by the mouse delta (within 1 px)", Math.abs(v1.x - v0.x + 120) <= 1 && Math.abs(v1.y - v0.y - 60) <= 1 && Math.abs(v1.zoom - v0.zoom) < 1e-6, result.straightDrag);
  }

  const runPan = async (cond, viewName, label) => {
    const spec = CONDITIONS[cond];
    await goTo(views[viewName]);
    await sleep(700);
    if (spec.css) await exp((css) => {
      const st = document.createElement("style");
      st.id = "pa-cond";
      st.textContent = css;
      document.head.appendChild(st);
    }, spec.css);
    await sleep(spec.css ? 1200 : 300);
    const start = spec.input === "none" ? null : await findStart();
    if (start?.none) throw new Error(`${label}: no empty pane to start the ${spec.input} on`);
    const opts = { counter: !spec.bare, observer: !spec.bare, walk: Boolean(spec.walk) };
    const before = await exp(() => window.__pa.drawn());
    const vBefore = await viewport();
    await exp((o) => window.__pa.start(o), opts);
    await sleep(100);
    if (spec.input === "none") await sleep(PAN_MS);
    else await ellipse(start, spec.input === "pan");
    await sleep(150);
    const raw = await exp((o) => window.__pa.stop(o), opts);
    const vAfter = await viewport();
    const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, ws: m.memory.workingSetSize })));
    if (spec.css) await exp(() => document.getElementById("pa-cond")?.remove());
    const gaps = raw.frames.map((f) => f.gap);
    const pct = (p) => {
      const s = [...gaps].sort((a, b) => a - b);
      return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
    };
    // the view's excursion during the pan, from the per-frame transforms
    const tx = raw.frames.map((f) => /translate\((-?[\d.e-]+)px,\s*(-?[\d.e-]+)px/.exec(f.tf)).filter(Boolean).map((m) => [Number(m[1]), Number(m[2])]);
    const range = tx.length ? [Math.max(...tx.map((p) => p[0])) - Math.min(...tx.map((p) => p[0])), Math.max(...tx.map((p) => p[1])) - Math.min(...tx.map((p) => p[1]))] : [0, 0];
    const long50 = raw.frames.filter((f) => f.gap > 50);
    const withMut = raw.frames.filter((f) => (f.nodes ?? 0) + (f.edges ?? 0) > 0);
    const run = {
      cond, view: viewName, label,
      start: start ? { x: start.x, y: start.y, rx: start.rx, ry: start.ry, under: start.under } : null,
      frames: gaps.length,
      p50: pct(50), p95: pct(95), max: Math.max(...gaps),
      over50: long50.length, over100: gaps.filter((g) => g > 100).length,
      views: raw.views, range: range.map((v) => Math.round(v * 10) / 10),
      net: [Math.round((vAfter.x - vBefore.x) * 10) / 10, Math.round((vAfter.y - vBefore.y) * 10) / 10],
      store: { samples: raw.storeSamples, mismatch: raw.storeMismatch, end: raw.endStore, dom: raw.endDom },
      commits: opts.counter ? raw.commits : null,
      mut: opts.observer ? raw.mut : null,
      // time association: long frames with node/edge mount changes in the same frame
      association: opts.observer ? {
        framesWithMut: withMut.length,
        long50WithMut: long50.filter((f) => (f.nodes ?? 0) + (f.edges ?? 0) > 0).length,
        pLong50GivenMut: withMut.length ? Math.round((withMut.filter((f) => f.gap > 50).length / withMut.length) * 1000) / 1000 : null,
        pLong50GivenNone: raw.frames.length - withMut.length ? Math.round((raw.frames.filter((f) => f.gap > 50 && (f.nodes ?? 0) + (f.edges ?? 0) === 0).length / (raw.frames.length - withMut.length)) * 1000) / 1000 : null,
        long50Commits: long50.map((f) => f.commits ?? null),
      } : null,
      walk: raw.walk,
      longTasks: raw.long.length,
      drawn: before,
      rendererMB: Math.round(metrics.filter((m) => m.type === "Tab" || m.type === "Renderer").reduce((s, m) => s + m.ws, 0) / 1024),
      gpuMB: Math.round(metrics.filter((m) => m.type === "GPU").reduce((s, m) => s + m.ws, 0) / 1024),
      frameLog: raw.frames.map((f) => [f.t, f.gap, f.nodes ?? null, f.edges ?? null, f.dom ?? null, f.commits ?? null]),
    };
    // gates
    const gates = [];
    if (spec.input === "pan") {
      if (!String(start.under ?? "").includes("react-flow__pane")) gates.push("press not on the pane");
      if (!(raw.views > 100)) gates.push(`view did not move (${raw.views} transforms)`);
      if (Math.abs(range[0] - 2 * start.rx) > 0.1 * 2 * start.rx || Math.abs(range[1] - 2 * start.ry) > 0.1 * 2 * start.ry) gates.push(`excursion ${range} vs ${2 * start.rx}x${2 * start.ry}`);
      if (Math.abs(run.net[0]) > 3 || Math.abs(run.net[1]) > 3) gates.push(`did not return (${run.net})`);
    } else if (raw.views !== 1) gates.push(`view moved without a pan (${raw.views} transforms)`);
    if (raw.endStore && raw.endDom && (Math.abs(raw.endStore[0] - raw.endDom[0]) > 0.5 || Math.abs(raw.endStore[1] - raw.endDom[1]) > 0.5)) gates.push("store and DOM transform differ at the end");
    run.gates = gates;
    run.valid = gates.length === 0;
    result.runs.push(run);
    const a = run.association;
    console.log(`${label} ${cond}@${viewName}${run.valid ? "" : ` INVALID ${gates.join("; ")}`}: p50 ${run.p50} p95 ${run.p95} max ${run.max} >50 ${run.over50} >100 ${run.over100} | views ${run.views} range ${run.range} | commits ${run.commits ?? "-"} | node+edge mounts ${run.mut ? run.mut.nodeAdds + run.mut.nodeRemoves + run.mut.edgeAdds + run.mut.edgeRemoves : "-"}${a ? ` | P(>50|mut) ${a.pLong50GivenMut} P(>50|none) ${a.pLong50GivenNone}` : ""} | drawn ${before.nodes}/${before.storeNodes} | free ${freeMiB()} MiB`);
    save();
    return run;
  };

  if (SHAPE_NAME === "large" && (CONDS.includes("D") || CONDS.includes("E"))) {
    // probe grid: 4 x 3 centres across the fitted graph
    const probes = [];
    for (let gy = 0; gy < 3; gy++)
      for (let gx = 0; gx < 4; gx++) {
        const p = flowAt(((gx + 0.5) / 4) * pane0.width, ((gy + 0.5) / 3) * pane0.height);
        views[`P${gy}${gx}`] = viewFor(p);
        let r;
        try {
          r = await runPan("C", `P${gy}${gx}`, "probe");
        } catch (error) {
          // no empty pane to start on: this view cannot be measured, and is not used
          probes.push({ view: `P${gy}${gx}`, unusable: String(error.message).slice(0, 120) });
          console.log(`probe P${gy}${gx}: unusable (${String(error.message).slice(0, 80)})`);
          continue;
        }
        probes.push({ view: `P${gy}${gx}`, churn: r.mut.nodeAdds + r.mut.nodeRemoves + r.mut.edgeAdds + r.mut.edgeRemoves, nodes: r.drawn.nodes, valid: r.valid, p95: r.p95, over50: r.over50 });
      }
    result.probes = probes;
    const usable = probes.filter((p) => !p.unusable && p.valid && p.nodes >= 10);
    const lo = usable.reduce((a, b) => (b.churn < a.churn ? b : a));
    const hi = usable.reduce((a, b) => (b.churn > a.churn ? b : a));
    views.Vlow = views[lo.view];
    views.Vhigh = views[hi.view];
    result.views = { V0: views.V0, Vlow: { ...views.Vlow, from: lo }, Vhigh: { ...views.Vhigh, from: hi } };
    check("probe views: a low-churn and a high-churn view exist", usable.length >= 2 && hi.churn > lo.churn, { lo, hi });
  } else {
    result.views = { V0: views.V0 };
  }

  for (let rep = 0; rep < REPS; rep++) {
    const order = CONDS.map((_, i, a) => a[(i + rep) % a.length]);
    for (const cond of order) await runPan(cond, CONDITIONS[cond].view, `rep ${rep}`);
  }

  if (TRACE) {
    const categories = ["toplevel", "blink", "blink.user_timing", "cc", "viz", "gpu", "benchmark", "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "disabled-by-default-gpu.service"];
    result.traces = [];
    for (const cond of TRACED) {
      const spec = CONDITIONS[cond];
      await goTo(views[spec.view]);
      await sleep(700);
      if (spec.css) await exp((css) => {
        const st = document.createElement("style");
        st.id = "pa-cond";
        st.textContent = css;
        document.head.appendChild(st);
      }, spec.css);
      await sleep(1200);
      const start = await findStart();
      if (start.none) throw new Error(`trace ${cond}: no empty pane`);
      const file = path.join(OUT, `trace-${cond}.json`);
      await app.evaluate(async ({ contentTracing }, cats) => {
        await contentTracing.startRecording({ recording_mode: "record-until-full", trace_buffer_size_in_kb: 120 * 1024, included_categories: cats, excluded_categories: ["*"] });
      }, categories);
      await sleep(1000);
      await exp(() => {
        window.__pa.start({ counter: false, observer: false });
        performance.mark("pa-start");
      });
      await ellipse(start, true);
      const raw = await exp(() => {
        performance.mark("pa-end");
        return window.__pa.stop({ counter: false, observer: false });
      });
      await sleep(500);
      const usage = await app.evaluate(({ contentTracing }) => contentTracing.getTraceBufferUsage());
      await app.evaluate(async ({ contentTracing }, f) => contentTracing.stopRecording(f), file);
      if (spec.css) await exp(() => document.getElementById("pa-cond")?.remove());
      const gaps = raw.frames.map((f) => f.gap);
      result.traces.push({ cond, file: path.basename(file), bytes: fs.statSync(file).size, usage, views: raw.views, over50: gaps.filter((g) => g > 50).length, over100: gaps.filter((g) => g > 100).length, max: Math.max(...gaps) });
      console.log(`trace ${cond}: views ${raw.views} >50 ${gaps.filter((g) => g > 50).length} max ${Math.max(...gaps)} | ${Math.round(fs.statSync(file).size / 1048576)} MiB | buffer ${JSON.stringify(usage)}`);
      save();
    }
  }

  const invalid = result.runs.filter((r) => !r.valid && r.label !== "probe");
  check("every measured run passed its gates", invalid.length === 0, invalid.map((r) => [r.label, r.cond, r.gates]));
} catch (error) {
  check("no exception", false, String(error?.stack ?? error).slice(0, 800));
  await app?.windows()[0]?.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
} finally {
  clearInterval(monitor);
  await app?.close().catch(() => {});
  if (result.memory.aborted) check("memory guard", false, result.memory);
  const failed = result.checks.filter((c) => !c.pass);
  save();
  console.log(`${result.checks.length - failed.length}/${result.checks.length} checks passed; ${result.runs.length} runs; min free ${result.memory.minimum} MiB; ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
}
