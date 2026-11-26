// Trace steps on the canvas, end to end. See README.md. Reads the rendered DOM and the
// webview debug log the product already keeps (window.__CODEGRAPH_WEBVIEW_DEBUG__).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const FIXTURE = path.join(REPO, "e2e", "aggregate-inspector", "fixture");
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "cogic-trace-")));
const EXE = process.env.VSCODE_EXE;
if (!EXE) throw new Error("Set VSCODE_EXE");
const freeMiB = () => Math.round(os.freemem() / 1048576);
if (freeMiB() < 2200) throw new Error(`preflight memory ${freeMiB()} MiB`);

const userData = path.join(OUT, "user-data");
const workspace = path.join(OUT, "workspace");
if (fs.existsSync(userData) || fs.existsSync(workspace)) throw new Error("Use a new output folder");
fs.mkdirSync(path.join(userData, "User"), { recursive: true });
fs.cpSync(FIXTURE, workspace, { recursive: true });
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
  // The save dialog becomes a quick input, so export can be driven without a native window.
  "files.simpleDialog.enable": true,
}));

const result = { checks: [], memory: { before: freeMiB(), minimum: freeMiB(), aborted: false } };
const check = (name, pass, detail) => {
  result.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` ${JSON.stringify(detail)?.slice(0, 600)}`}`);
};
const mark = (label) => (result.memory.timeline ??= []).push([label, freeMiB()]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

let app;
const monitor = setInterval(() => {
  result.memory.minimum = Math.min(result.memory.minimum, freeMiB());
  if (freeMiB() < 800 && !result.memory.aborted) {
    result.memory.aborted = true;
    void app?.close();
  }
}, 250);

// ---- independent rules, from IDs only
/** `kind:source->target@@...`: the analyzer's relation ID. */
const ends = (id) => {
  const m = /^\w+:(.*?)->(.*?)(?:@@|$)/.exec(id);
  return m ? [m[1], m[2]] : null;
};
/** `function:c:/x/a.ts:120` -> `c:/x/a.ts`. */
const fileOf = (id) => id.replace(/^\w+:/, "").replace(/:\d+$/, "");

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

  // ---- helpers
  const until = async (name, read, timeout = 20_000) => {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await read();
      if (value) return value;
      if (Date.now() > end) throw new Error(`timeout: ${name}`);
      await sleep(200);
    }
  };
  const viewport = () => frame.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector(".react-flow__viewport")).transform);
    return { x: m.e, y: m.f, zoom: m.a };
  });
  const fit = async () => {
    await frame.locator('button[title="Fit Graph"]').click({ delay: 60 });
    await sleep(1500);
    if ((await viewport()).zoom <= 0.1001) throw new Error("fixture does not fit in the view");
  };
  const groups = () => frame.evaluate(() => [...document.querySelectorAll(".react-flow__node")]
    .filter((n) => n.querySelector(".cgGroup, .cgFolder"))
    .map((n) => ({ id: n.dataset.id, collapsed: Boolean(n.querySelector(".cgGroup--collapsed, .cgFolder--collapsed")) })));
  const group = async (suffix) => (await groups()).find((g) => g.id.replace(/:0$/, "").endsWith(suffix));
  const toggle = async (suffix, collapsed) => {
    const found = await group(suffix);
    if (!found) throw new Error(`no group ${suffix}`);
    if (found.collapsed === collapsed) return;
    await fit();
    await frame.locator(`.react-flow__node[data-id="${found.id}"] .cgGroupHeader, .react-flow__node[data-id="${found.id}"] .cgFolderHeader`).first().click();
    await until(`${suffix} collapsed=${collapsed}`, async () => (await group(suffix))?.collapsed === collapsed);
    await sleep(1500);
    await fit();
  };
  const panel = () => frame.evaluate(() => {
    const p = document.querySelector(".panel--aggregate");
    if (!p) return null;
    return {
      relation: p.querySelector(".kvRow .kvVal").textContent,
      ids: [...p.querySelectorAll(".aggregateItem")].map((e) => e.dataset.edgeId),
    };
  });
  const closePanel = async () => {
    const button = frame.locator(".panel--aggregate .panelHeader .smallBtn");
    if (await button.count()) await button.click();
    await sleep(300);
  };
  const more = () => frame.locator(".panel--aggregate .panelBody > .smallBtn");
  const badges = () => frame.locator(".cgAggregateBadge");
  const focusButton = () => frame.locator("button[data-focus-state]");
  // Prefers a declaration; names imported from beyond the depth are drawn as external nodes.
  const codeNode = async (title) => {
    const titled = { has: frame.locator(".cgNodeTitle", { hasText: new RegExp(`^${title}\\b`) }) };
    const own = frame.locator('.react-flow__node-code:not([data-id^="external:"])').filter(titled).first();
    return (await own.count()) ? own : frame.locator(".react-flow__node-code").filter(titled).first();
  };
  // Selecting moves the view to the node, and nodes outside the view leave the DOM.
  const select = async (title, modifiers) => {
    await fit();
    await (await codeNode(title)).locator(".cgNodeTitle").click({ delay: 40, modifiers });
    await sleep(900);
    await fit();
  };
  const idOf = async (title) => (await codeNode(title)).getAttribute("data-id");
  const paneClick = async () => {
    const pt = await frame.evaluate(() => {
      const r = document.querySelector(".react-flow__pane").getBoundingClientRect();
      for (let y = 90; y < r.height - 60; y += 8)
        for (let x = 20; x < r.width - 120; x += 8)
          if (document.elementFromPoint(r.left + x, r.top + y)?.classList.contains("react-flow__pane")) return { x, y };
      return null;
    });
    const pane = await frame.locator(".react-flow__pane").boundingBox();
    await page.mouse.click(pane.x + pt.x, pane.y + pt.y);
    await sleep(800);
    return pt;
  };
  const snap = () => frame.evaluate(() => {
    const focusClass = (el) => [...el.classList].find((c) => c.startsWith("cgFocus--")) ?? null;
    const nodes = [...document.querySelectorAll(".react-flow__node")].map((n) => ({
      id: n.dataset.id,
      type: [...n.classList].find((c) => c.startsWith("react-flow__node-"))?.slice(17),
      focus: focusClass(n),
      opacity: getComputedStyle(n).opacity,
      transform: n.style.transform,
      collapsed: Boolean(n.querySelector(".cgGroup--collapsed, .cgFolder--collapsed")),
      rows: [...n.querySelectorAll(".cgChildNode")].map((c) => ({
        id: c.querySelector('[data-handleid^="in-child-"]')?.dataset.handleid.slice(9),
        context: c.classList.contains("cgChildNode--focusContext"),
        opacity: getComputedStyle(c).opacity,
      })),
    }));
    const edges = [...document.querySelectorAll(".react-flow__edge")].map((e) => {
      const p = e.querySelector(".react-flow__edge-path");
      const cs = getComputedStyle(p);
      return {
        id: e.getAttribute("data-testid").replace(/^rf__edge-/, ""),
        focus: focusClass(e),
        opacity: cs.opacity,
        stroke: cs.stroke,
        dash: cs.strokeDasharray,
        d: p.getAttribute("d"),
        marker: p.getAttribute("marker-end"),
      };
    });
    const badges = [...document.querySelectorAll(".cgAggregateBadge")].map((b) => ({
      key: `${[...b.classList].find((c) => /^cgAggregateBadge--(calls|dataflow|constructs|references|updates)$/.test(c))}|${b.dataset.count}|${b.title.split("\n")[0]}`,
      count: Number(b.dataset.count),
      related: b.dataset.focusRelated === undefined ? null : Number(b.dataset.focusRelated),
      text: b.textContent,
      covered: b.hasAttribute("data-covered"),
      opacity: getComputedStyle(b).opacity,
    }));
    const vp = document.querySelector(".react-flow__viewport");
    const m = vp ? new DOMMatrix(getComputedStyle(vp).transform) : { e: 0, f: 0, a: 0 };
    const btn = document.querySelector("button[data-focus-state]");
    return {
      nodes,
      edges,
      badges,
      viewport: [m.e, m.f, m.a],
      state: btn?.dataset.focusState,
      pressed: btn?.getAttribute("aria-pressed"),
      disabled: btn?.disabled,
      focusClasses: document.querySelectorAll('[class*="cgFocus--"], .cgChildNode--focusContext, .cgAggregateBadge--focusContext, .cgAggregateBadge--focusRelated').length,
    };
  });
  const layoutOf = (s) => JSON.stringify([
    s.nodes.map((n) => [n.id, n.transform]).sort(),
    s.edges.map((e) => [e.id, e.d]).sort(),
    s.viewport,
  ]);
  const styleOf = (s) => JSON.stringify([
    s.nodes.map((n) => [n.id, n.opacity, n.rows]).sort(),
    s.edges.map((e) => [e.id, e.opacity, e.stroke, e.dash, e.marker]).sort(),
    s.badges.map((b) => [b.key, b.text, b.opacity]).sort(),
  ]);
  /** Same IDs, and every coordinate within 0.05 px (handle measurement leaves float noise). */
  const sameLayout = (a, b) => {
    const nums = (t) => (t.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
    const x = JSON.parse(a), y = JSON.parse(b);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      const left = Array.isArray(x[i]) ? x[i] : [x[i]];
      const right = Array.isArray(y[i]) ? y[i] : [y[i]];
      if (left.length !== right.length) return false;
      for (let j = 0; j < left.length; j++) {
        const [l, r] = [JSON.stringify(left[j]), JSON.stringify(right[j])];
        if (l.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, "#") !== r.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, "#")) return false;
        const [p, q] = [nums(l), nums(r)];
        if (p.length !== q.length || p.some((v, k) => Math.abs(v - q[k]) > 0.05)) return false;
      }
    }
    return true;
  };
  const diff = (a, b) => {
    const x = JSON.parse(a), y = JSON.parse(b);
    const out = [];
    x.forEach((part, i) => {
      const left = (Array.isArray(part) ? part : [part]).map((v) => JSON.stringify(v));
      const right = new Set((Array.isArray(y[i]) ? y[i] : [y[i]]).map((v) => JSON.stringify(v)));
      out.push(...left.filter((v) => !right.has(v)).slice(0, 3));
    });
    return out;
  };
  const notEmpty = (s) => s.nodes.length > 0 && s.edges.length > 0;

  /**
   * Expected classes for center C from the relation list: drawn plain edges by ID, aggregates by
   * their members, rows by their handle IDs, groups by path prefix.
   */
  const expectFor = (center, s, relations, memberOf) => {
    const touching = relations.filter((id) => ends(id)?.includes(center));
    const neighbors = new Set([center, ...touching.flatMap((id) => ends(id))]);
    const collapsed = s.nodes.filter((n) => n.collapsed).map((n) => n.id);
    const rendered = new Set(s.nodes.map((n) => n.id));
    const rowOwner = new Map(s.nodes.flatMap((n) => n.rows.map((r) => [r.id, n.id])));
    const visible = (id) => {
      const file = fileOf(id);
      const folder = collapsed
        .filter((g) => g.startsWith("folder:") && file.startsWith(`${g.slice(7)}/`))
        .sort((a, b) => a.length - b.length)[0];
      if (folder) return folder;
      // A file without a file node has a group ID without the ":0".
      const fileGroup = collapsed.find((g) => g.replace(/:0$/, "") === `file:${file}`);
      if (fileGroup) return fileGroup;
      if (rendered.has(id)) return id;
      return rowOwner.get(id) ?? null;
    };
    const keptFiles = [...neighbors].map(fileOf);
    const expected = new Map();
    for (const n of s.nodes) {
      let state;
      if (n.type === "code") {
        const own = [...neighbors].some((id) => visible(id) === n.id);
        state = visible(center) === n.id ? "center" : own ? "connected" : "context";
      } else {
        const p = n.id.startsWith("folder:") ? n.id.slice(7) : fileOf(n.id);
        const kept = keptFiles.some((f) => f === p || f.startsWith(`${p}/`));
        state = visible(center) === n.id ? "center" : kept ? "connected" : "context";
      }
      expected.set(n.id, state);
    }
    const edgeState = (e) => {
      const ids = e.id.startsWith("aggregate:") ? memberOf(e.id) : [e.id];
      if (!ids) return "unknown";
      return ids.some((id) => ends(id)?.includes(center)) ? "related" : "context";
    };
    const rowState = (n, r) => n.id !== center && !neighbors.has(r.id);
    const problems = [];
    for (const n of s.nodes) {
      const want = expected.get(n.id);
      if (n.focus !== `cgFocus--${want}`) problems.push(["node", n.id, n.focus, want]);
      if (Number(n.opacity) !== (want === "context" ? 0.25 : 1)) problems.push(["node opacity", n.id, n.opacity]);
      if (n.type === "code" && want !== "context")
        for (const r of n.rows) if (r.context !== rowState(n, r)) problems.push(["row", r.id, r.context]);
    }
    for (const e of s.edges) {
      const want = edgeState(e);
      if (want !== "unknown" && e.focus !== `cgFocus--${want}`) problems.push(["edge", e.id, e.focus, want]);
      if (e.focus === "cgFocus--context" && Number(e.opacity) !== 0.12) problems.push(["edge opacity", e.id, e.opacity]);
    }
    return {
      problems,
      counts: {
        center: [...expected.values()].filter((v) => v === "center").length,
        connected: [...expected.values()].filter((v) => v === "connected").length,
        context: [...expected.values()].filter((v) => v === "context").length,
        relatedEdges: s.edges.filter((e) => e.focus === "cgFocus--related").length,
        contextEdges: s.edges.filter((e) => e.focus === "cgFocus--context").length,
      },
    };
  };
  /** Related edges keep the stroke, dash, marker and path they had without Focus. */
  const unchangedRelated = (off, on) => {
    const before = new Map(off.edges.map((e) => [e.id, e]));
    return on.edges
      .filter((e) => e.focus === "cgFocus--related")
      .filter((e) => {
        const b = before.get(e.id);
        return !b || b.opacity !== e.opacity || b.stroke !== e.stroke || b.dash !== e.dash || b.marker !== e.marker || !sameLayout(JSON.stringify([b.d]), JSON.stringify([e.d]));
      })
      .map((e) => e.id);
  };
  const toggleFocus = async () => {
    await focusButton().click({ delay: 40 });
    await sleep(700);
  };
  /** Click to committed frame, measured inside the webview. */
  const timeToggle = () => frame.evaluate(async () => {
    const btn = document.querySelector("button[data-focus-state]");
    const t0 = performance.now();
    btn.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { ms: performance.now() - t0, state: btn.dataset.focusState, classes: document.querySelectorAll('[class*="cgFocus--"]').length };
  });


  // ---- one record per trace step
  const label = () => frame.locator(".mono").filter({ hasText: /^\d+ \/ \d+$/ }).first();
  const step = (dir) => frame.locator("button").filter({ hasText: dir === 1 ? /^->$/ : /^<-$/ }).first();
  const traceButton = frame.locator('button[title^="Trace mode"]');
  const record = () => frame.evaluate(() => {
    const vp = document.querySelector(".react-flow__viewport");
    const m = vp ? new DOMMatrix(getComputedStyle(vp).transform) : null;
    const pane = document.querySelector(".react-flow__pane")?.getBoundingClientRect();
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return pane && r.right > pane.left && r.left < pane.right && r.bottom > pane.top && r.top < pane.bottom && r.width > 0;
    };
    const nodes = [...document.querySelectorAll(".react-flow__node")];
    const log = window.__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? [];
    const topo = [...log].reverse().find((e) => e.event === "canvas.reactflow.topology-changed")?.detail ?? null;
    const traceStep = [...log].reverse().find((e) => e.event === "trace.step")?.detail ?? null;
    return {
      label: [...document.querySelectorAll(".mono")].map((e) => e.textContent).find((t) => /^\d+ \/ \d+$/.test(t)) ?? null,
      domNodes: nodes.length,
      domCode: nodes.filter((n) => n.classList.contains("react-flow__node-code")).length,
      domEdges: document.querySelectorAll(".react-flow__edge").length,
      inView: nodes.filter(inView).length,
      ids: nodes.map((n) => n.dataset.id).sort(),
      edgeIds: [...document.querySelectorAll(".react-flow__edge")].map((e) => e.getAttribute("data-testid")).sort(),
      selected: nodes.filter((n) => n.querySelector(".cgNode--selected, .cgChildNode--selected")).map((n) => n.dataset.id),
      empty: document.querySelector(".emptyTitle")?.textContent ?? null,
      emptySub: document.querySelector(".emptySub")?.textContent ?? null,
      emptyState: document.querySelector("[data-trace-state]")?.getAttribute("data-trace-state") ?? null,
      generateButton: Boolean([...document.querySelectorAll(".emptyState button")].find((b) => /Generate/.test(b.textContent))),
      viewport: m ? [Math.round(m.e * 100) / 100, Math.round(m.f * 100) / 100, Math.round(m.a * 1e4) / 1e4] : null,
      rf: topo ? [topo.renderedNodes, topo.renderedEdges] : null,
      traceStep,
      loading: Boolean(document.querySelector(".canvasLoading, .loadingState")),
    };
  });
  const sig = (x) => JSON.stringify([x.ids, x.edgeIds]);
  // The trace moves the view to the step with an animation; sample once it has settled.
  const settled = async () => {
    let last = null;
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      const now = await record();
      if (last && JSON.stringify(now.viewport) === JSON.stringify(last.viewport) && sig(now) === sig(last)) return now;
      last = now;
    }
    return last;
  };
  const walk = async (name) => {
    await traceButton.click();
    await until("trace ready", async () => (await label().count()) > 0, 60_000);
    await sleep(2500);
    const steps = [];
    steps.push(await settled());
    const total = Number(steps[0].label.split(" / ")[1]);
    for (let i = 0; i < total; i++) {
      await step(1).click();
      steps.push(await settled());
    }
    // back to 0 and forward again: each cursor must show the same graph
    const back = [];
    for (let i = total; i > 0; i--) {
      await step(-1).click();
      back.unshift(await settled());
    }
    const again = [];
    for (let i = 0; i < Math.min(total, 6); i++) {
      await step(1).click();
      again.push(await settled());
    }
    result[name] = { total, steps, back, again };
    return result[name];
  };

  const judge = (name, w) => {
    const steps = w.steps;
    const cursors = steps.map((x) => Number(x.label.split(" / ")[0]));
    check(`${name}: cursor 0..${w.total} in order, one per Next`, cursors.every((c, i) => c === i), cursors);
    const s0 = steps[0];
    check(`${name}: cursor 0 says the trace is ready, not an error`, s0.emptyState === "ready" && !s0.generateButton && s0.domNodes === 0, [s0.emptyState, s0.empty, s0.generateButton]);
    const s1 = steps[1];
    check(`${name}: cursor 1 (the file node only) is explained, not "No visible nodes"`, s1.emptyState === "file-only" && s1.domNodes === 0 && !s1.generateButton, [s1.emptyState, s1.empty]);
    const blank = steps.slice(2).map((x, i) => [i + 2, x]).filter(([, x]) => x.domCode === 0 || x.inView === 0);
    check(`${name}: every step from cursor 2 draws code nodes in view`, blank.length === 0, blank.map(([i, x]) => [i, x.domNodes, x.inView, x.empty]));
    check(`${name}: no error empty state at any step`, steps.every((x) => x.empty !== "No visible nodes" && x.empty !== "No graph yet"), steps.map((x) => x.empty));
    const logged = steps.slice(1).map((x) => x.traceStep);
    check(`${name}: the step log matches the cursor`, logged.every((t, i) => t?.cursor === i + 1 && t.total === w.total), logged.slice(0, 3));
    // An edge event never adds a node; a node event adds at most one.
    const growth = steps.slice(2).map((x, i) => ({ c: i + 2, type: x.traceStep?.eventType, before: steps[i + 1].traceStep?.nodes, after: x.traceStep?.nodes }));
    check(`${name}: edge steps add no node, node steps add one`, growth.every((g) => (g.type === "edge" ? g.after === g.before : g.after === g.before + 1)), growth.filter((g) => (g.type === "edge" ? g.after !== g.before : g.after !== g.before + 1)));
    check(`${name}: Prev back to 0 shows the same graph at each cursor`, w.back.every((b, i) => sig(b) === sig(steps[i])), w.back.map((b, i) => sig(b) === sig(steps[i])));
    check(`${name}: Next again shows the same graph`, w.again.every((b, i) => sig(b) === sig(steps[i + 1])));
  };

  await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
  await until("graph", async () => (await snap()).edges.length > 3, 60_000);
  await sleep(4000);
  await fit();
  const normal = await record();
  result.normal = normal;
  mark("start");
  judge("main.ts", await walk("main"));
  // Ending a trace keeps the last step's graph and starts no new analysis (existing behaviour,
  // also before this change); the normal graph returns with the next analysis.
  await traceButton.click();
  await sleep(3000);
  await fit();
  const back = await record();
  result.afterMain = back;
  check("trace end: the canvas keeps a drawn graph, no trace or error empty state", back.domNodes > 0 && !back.emptyState && !back.empty && back.label === null, [back.domNodes, back.domEdges, back.empty, back.label]);
  result.afterMainVsNormal = { after: [back.domNodes, back.domEdges], normal: [normal.domNodes, normal.domEdges] };

  // a.ts: a longer trace with classes and members
  const pick = async (file) => {
    await frame.locator(".projectPicker").click();
    await frame.locator(".projectMenuSearchInput").fill(file);
    await frame.locator(".projectMenuItem").first().click();
    await frame.locator(".rootBanner").waitFor({ timeout: 20_000 });
    await until("graph after root change", async () => (await snap()).edges.length > 3, 60_000);
    await sleep(4000);
    await fit();
  };
  await pick("app/a.ts");
  judge("a.ts", await walk("a"));
  // restart: end and start again, same total and the ready state
  await traceButton.click();
  await sleep(3000);
  await traceButton.click();
  await until("trace ready again", async () => (await label().count()) > 0, 60_000);
  await sleep(2500);
  const restart = await record();
  check("trace restart: ready at 0 with the same total", restart.label === `0 / ${result.a.total}` && restart.emptyState === "ready", [restart.label, restart.emptyState]);
  await traceButton.click();
  await sleep(2000);
  mark("end");
} catch (error) {
  check("no exception", false, String(error?.stack ?? error).slice(0, 800));
  await app?.windows()[0]?.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
} finally {
  clearInterval(monitor);
  await app?.close().catch(() => {});
  if (result.memory.aborted) check("memory guard", false, result.memory);
  const failed = result.checks.filter((c) => !c.pass);
  fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 1));
  console.log(`${result.checks.length - failed.length}/${result.checks.length} checks passed; min free ${result.memory.minimum} MiB; ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
}
