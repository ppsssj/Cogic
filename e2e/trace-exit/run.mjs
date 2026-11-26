// Leaving a trace restores the normal graph, end to end. See README.md. Reads the rendered DOM
// and the webview debug log the product already keeps (window.__CODEGRAPH_WEBVIEW_DEBUG__).
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
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "cogic-trace-exit-")));
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


  // ---- what must come back after a trace
  const traceButton = frame.locator('button[title^="Trace mode"]');
  const label = () => frame.evaluate(() => [...document.querySelectorAll(".mono")].map((e) => e.textContent).find((t) => /^\d+ \/ \d+$/.test(t)) ?? null);
  const next = frame.locator("button").filter({ hasText: /^->$/ }).first();
  const state = () => frame.evaluate(() => {
    const vp = document.querySelector(".react-flow__viewport");
    const m = vp ? new DOMMatrix(getComputedStyle(vp).transform) : null;
    const nodes = [...document.querySelectorAll(".react-flow__node")];
    const log = window.__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? [];
    return {
      nodeIds: nodes.map((n) => n.dataset.id).sort(),
      edgeIds: [...document.querySelectorAll(".react-flow__edge")].map((e) => e.getAttribute("data-testid")).sort(),
      collapsed: nodes.filter((n) => n.querySelector(".cgGroup--collapsed, .cgFolder--collapsed")).map((n) => n.dataset.id).sort(),
      selected: nodes.filter((n) => n.querySelector(".cgNode--selected")).map((n) => n.dataset.id).sort(),
      focus: document.querySelector("button[data-focus-state]")?.dataset.focusState ?? null,
      viewport: m ? [m.e, m.f, m.a] : null,
      root: document.querySelector(".rootBanner .rootText")?.textContent ?? null,
      depth: document.querySelector('select[aria-label="Graph depth"]')?.value ?? null,
      trace: [...document.querySelectorAll(".mono")].map((e) => e.textContent).find((t) => /^\d+ \/ \d+$/.test(t)) ?? null,
      empty: document.querySelector(".emptyTitle")?.textContent ?? null,
      exits: log.filter((e) => e.event === "trace.exit").map((e) => e.detail.action),
      dropped: log.filter((e) => e.event === "analysisResult.dropped.trace.after-exit").length,
    };
  });
  const near = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 0.01);
  const diffs = (a, b, keys) => keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => [k, JSON.stringify(a[k]).slice(0, 160), JSON.stringify(b[k]).slice(0, 160)]);
  const GRAPH = ["nodeIds", "edgeIds", "collapsed", "root", "depth"];
  const CONTEXT = ["selected", "focus"];
  const startTrace = async () => {
    await traceButton.click();
    await until("trace ready", async () => /^0 \/ \d+$/.test((await label()) ?? ""), 60_000);
    await sleep(1500);
  };
  const steps = async (n) => {
    for (let i = 0; i < n; i++) {
      await next.click();
      await sleep(600);
    }
  };
  /** Leaves the trace and waits until no trace label is left and the canvas settled. */
  const exitTrace = async (how = "toggle") => {
    if (how === "finish") await frame.locator("button").filter({ hasText: /^끝$/ }).first().click();
    else await traceButton.click();
    await until("trace gone", async () => (await label()) === null, 20_000);
    await sleep(2500);
    exits.push(await lastExit());
  };
  const settleGraph = async (expect) =>
    until("graph settled", async () => {
      const s = await state();
      return s.nodeIds.length > 0 && (!expect || JSON.stringify(s.nodeIds) === JSON.stringify(expect.nodeIds)) ? s : null;
    }, 60_000).catch(async () => state());
  const lastExit = async () => (await state()).exits.at(-1);
  const exits = []; // the debug log keeps only its last 80 entries, so actions are kept here
  result.exits = exits;

  await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
  await until("graph", async () => (await snap()).edges.length > 3, 60_000);
  await sleep(4000);
  await fit();
  mark("start");

  const pick = async (file) => {
    await frame.locator(".projectPicker").click();
    await frame.locator(".projectMenuSearchInput").fill(file);
    await frame.locator(".projectMenuItem").first().click();
    await frame.locator(".rootBanner").waitFor({ timeout: 20_000 });
    await until("graph after root change", async () => (await snap()).edges.length > 3, 60_000);
    await sleep(4000);
    await fit();
  };
  // ---- A: a user's normal view before the trace
  await toggle("/src/svc", true); // collapse state; the header also selects the folder
  await select("main");
  await focusButton().click({ delay: 40 });
  await sleep(700);
  // a view of the user's own
  const pane = await frame.locator(".react-flow__pane").boundingBox();
  await page.mouse.move(pane.x + pane.width * 0.3, pane.y + pane.height * 0.6);
  await page.mouse.wheel(0, -120);
  await sleep(700);
  await page.mouse.down();
  await page.mouse.move(pane.x + pane.width * 0.3 + 70, pane.y + pane.height * 0.6 + 30, { steps: 8 });
  await page.mouse.up();
  await sleep(900);
  const before = await state();
  result.before = { nodes: before.nodeIds.length, edges: before.edgeIds.length, collapsed: before.collapsed, selected: before.selected, focus: before.focus, viewport: before.viewport };
  check("A: a normal graph with collapse, selection, Focus and a user view", before.nodeIds.length > 0 && before.collapsed.length > 0 && before.selected.length === 1 && before.focus === "active", result.before);

  await startTrace();
  await steps(3);
  const during = await state();
  result.during = { trace: during.trace, nodes: during.nodeIds.length, edges: during.edgeIds.length };
  check("A/B: the trace shows its own partial graph", during.trace === `3 / ${during.trace?.split(" / ")[1]}` && JSON.stringify(during.nodeIds) !== JSON.stringify(before.nodeIds), result.during);
  await exitTrace("toggle");
  const a1 = await settleGraph(before);
  result.afterA = { exit: await lastExit(), viewport: a1.viewport };
  check("A/B: leaving mid-trace restores the graph from before (IDs, collapse, root, depth)", diffs(a1, before, GRAPH).length === 0 && a1.trace === null, diffs(a1, before, GRAPH));
  check("A: selection and Focus come back", diffs(a1, before, CONTEXT).length === 0, diffs(a1, before, CONTEXT));
  check("A: the view comes back to where the user left it", near(a1.viewport, before.viewport), [before.viewport, a1.viewport]);
  check("A: the exit restored the snapshot", (await lastExit()) === "restore", (await state()).exits);

  // ---- C: leave at cursor 0 and at cursor 1 (the file node only)
  for (const at of [0, 1]) {
    await startTrace();
    await steps(at);
    await exitTrace("toggle");
    const c = await settleGraph(before);
    check(`C: leaving at cursor ${at} restores the graph from before`, diffs(c, before, GRAPH).length === 0 && c.trace === null && c.empty === null, diffs(c, before, GRAPH));
  }

  // ---- D: start, finish at the end, start again, leave
  await startTrace();
  const total = Number((await label()).split(" / ")[1]);
  await steps(total);
  await exitTrace("finish");
  const d1 = await settleGraph(before);
  check("D: Finish at the last step restores the graph from before", diffs(d1, before, GRAPH).length === 0 && d1.trace === null, diffs(d1, before, GRAPH));
  await startTrace();
  check("D: a new trace starts again at 0 with the same total", (await label()) === `0 / ${total}`, await label());
  await steps(2);
  await exitTrace("toggle");
  const d2 = await settleGraph(before);
  check("D: the second exit restores it again, nothing carried over", diffs(d2, before, [...GRAPH, ...CONTEXT]).length === 0 && d2.trace === null, diffs(d2, before, [...GRAPH, ...CONTEXT]));
  check("D: every exit so far restored", exits.length === 5 && exits.every((x) => x === "restore"), exits);

  // ---- F: leave right after starting. Whether the trace result arrives before or after the
  // exit depends on timing; both must end on the normal graph without the trace coming back.
  await traceButton.click();
  await traceButton.click();
  await sleep(8000);
  const f = await settleGraph(before);
  result.race = { exit: await lastExit(), droppedAfterExit: f.dropped, trace: f.trace };
  check("F: a trace result after leaving never brings the trace back", f.trace === null && (await label()) === null, result.race);
  check("F: the normal graph from before is shown (restored, or analyzed again if no result had arrived)", ["restore", "reanalyze"].includes(await lastExit()) && diffs(f, before, ["nodeIds", "root", "depth"]).length === 0, [await lastExit(), diffs(f, before, ["nodeIds", "root", "depth"])]);

  // ---- E: the target changes during the trace (another active editor; the project picker is
  // not available while a trace runs)
  // Without a root the graph follows the active editor; with one it would stay (and be restored).
  if (await frame.locator(".rootBanner .btnGhost").count()) {
    await frame.locator(".rootBanner .btnGhost").click();
    await until("no root", async () => (await state()).root === null, 20_000);
    await sleep(3000);
  }
  const beforeE = await settleGraph();
  result.beforeE = { nodes: beforeE.nodeIds.length, root: beforeE.root };
  await startTrace();
  await steps(2);
  // Focus the workbench editor first: keys pressed inside the webview go to the webview.
  await page.locator(".monaco-editor .view-lines").first().click();
  await quick("Control+P", "src/app/a.ts", "a.ts");
  await sleep(4000);
  result.windowsAfterOpen = app.windows().length;
  await page.screenshot({ path: path.join(OUT, "e-open.png") }).catch(() => {});
  await exitTrace("toggle");
  const e = await settleGraph();
  result.afterE = { exit: await lastExit(), nodes: e.nodeIds.length, edges: e.edgeIds.length, root: e.root };
  check("E: the old graph is not restored for another file; it is analyzed again", (await lastExit()) === "reanalyze" && e.trace === null && JSON.stringify(e.nodeIds) !== JSON.stringify(beforeE.nodeIds) && e.nodeIds.some((id) => /app\/a\.ts/.test(id)), result.afterE);
  // reference: a.ts analyzed without a trace (as a root; the graph is the same)
  await pick("app/a.ts");
  const refA = await settleGraph();
  result.refA = { nodes: refA.nodeIds.length, edges: refA.edgeIds.length };
  check("E: the graph shown is a.ts's normal graph", JSON.stringify(e.nodeIds) === JSON.stringify(refA.nodeIds) && JSON.stringify(e.edgeIds) === JSON.stringify(refA.edgeIds), [result.afterE, result.refA]);
  await frame.locator(".rootBanner .btnGhost").click();
  await sleep(3000);

  // ---- D (source): an edit during the trace
  const base = await state();
  await startTrace();
  await steps(2);
  const editor = page.locator(".monaco-editor .view-lines").first();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n// edited during the trace\n");
  await sleep(1500);
  await exitTrace("toggle");
  const ed = await settleGraph();
  result.afterEdit = { exit: await lastExit(), nodes: ed.nodeIds.length, trace: ed.trace };
  check("edit: the graph from before is not reused after an edit; it is analyzed again", (await lastExit()) === "reanalyze" && ed.trace === null && ed.nodeIds.length > 0 && ed.root === base.root, result.afterEdit);
  // put the file back
  await editor.click();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Control+Z");
  await sleep(1500);
  // ---- folder roots: an edit during the trace forces a new analysis, which must follow the
  // folder root rule (the active file directly in the folder, or nothing)
  const openInEditor = async (rel, name) => {
    await page.locator(".monaco-editor .view-lines").first().click();
    await quick("Control+P", rel, name);
    await sleep(2500);
  };
  const clearRoot = async () => {
    if (await frame.locator(".rootBanner .btnGhost").count()) {
      await frame.locator(".rootBanner .btnGhost").click();
      await until("no root", async () => (await state()).root === null, 20_000);
      await sleep(2500);
    }
  };
  const folderRoot = async (suffix) => {
    await fit();
    const id = (await groups()).find((g) => g.id.endsWith(suffix))?.id;
    if (!id) throw new Error(`no folder ${suffix}`);
    await frame.locator(`.react-flow__node[data-id="${id}"] .cgFolderHeader`).first().click();
    await sleep(1200);
    await frame.locator(".selectionBanner .btnGhost").click();
    await until("folder root", async () => /^Root folder:/.test((await state()).root ?? ""), 20_000);
    await sleep(4000);
  };
  // The root banner lives inside the canvas and is not drawn without a graph; the product's own
  // log has the root and the graph counts.
  const logged = () => frame.evaluate(() => {
    const log = [...(window.__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? [])].reverse();
    const root = log.find((e) => e.event === "canvas.visibleHasData.changed")?.detail?.rootTarget ?? null;
    const graph = log.find((e) => e.event === "app.graphState.changed")?.detail ?? null;
    return { root: root ? `${root.kind}:${root.path.split("/").pop()}` : null, graph: graph ? [graph.nodes, graph.edges] : null };
  });
  const editDuringTrace = async () => {
    await page.locator(".monaco-editor .view-lines").first().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n// edited during the trace\n");
    await sleep(1500);
  };
  const undoEdit = async () => {
    await page.locator(".monaco-editor .view-lines").first().click();
    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+Z");
    await sleep(1500);
  };

  await openInEditor("src/main.ts", "main.ts");
  await clearRoot();
  await settleGraph();
  // inside: root /src, the active main.ts is directly in it
  await folderRoot("/src");
  const fin = await settleGraph();
  const finLog = await logged();
  result.folderInsideBefore = { root: fin.root, nodes: fin.nodeIds.length, logged: finLog };
  await startTrace();
  await steps(2);
  await editDuringTrace();
  await exitTrace("toggle");
  const fi = await settleGraph(fin);
  const fiLog = await logged();
  result.folderInside = { exit: await lastExit(), root: fi.root, nodes: fi.nodeIds.length, trace: fi.trace, logged: fiLog };
  // Collapse state is not kept through a new analysis, so the graph is compared by its counts.
  check("folder root, active file inside: analyzed again under the same folder root, same graph", (await lastExit()) === "reanalyze" && fi.root === fin.root && JSON.stringify(fiLog) === JSON.stringify(finLog) && fi.trace === null, [result.folderInsideBefore, result.folderInside]);
  await undoEdit();
  await clearRoot();
  await settleGraph();
  // outside: root /src/app, the active main.ts is not in it, so nothing is analyzed
  await folderRoot("/src/app");
  const fout = await state();
  result.folderOutsideBefore = { root: fout.root, nodes: fout.nodeIds.length, logged: await logged() };
  await startTrace();
  await steps(2);
  await editDuringTrace();
  await exitTrace("toggle");
  await sleep(3000);
  const fo = await state();
  const foLog = await logged();
  result.folderOutside = { exit: await lastExit(), nodes: fo.nodeIds.length, empty: fo.empty, trace: fo.trace, logged: foLog };
  check("folder root, active file outside: no file is picked; the root stays and the normal empty state shows", (await lastExit()) === "empty" && foLog.root === "folder:app" && foLog.graph?.[0] === 0 && fo.nodeIds.length === 0 && fo.empty === "No graph yet" && fo.trace === null, [result.folderOutsideBefore, result.folderOutside]);
  await undoEdit();
  await clearRoot();

  // ---- generation after a restore: the extension confirms it, and expanding works
  const verifies = () => frame.evaluate(() => (window.__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? []).filter((e) => e.event === "trace.exit.verify").map((e) => e.detail));
  const expandLog = () => frame.evaluate(() => (window.__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? []).filter((e) => /^analysisResult\.(applied|dropped)\.expand/.test(e.event) || e.event === "expandNode.waiting.restore-check").map((e) => e.event));
  await openInEditor("src/main.ts", "main.ts");
  if ((await state()).nodeIds.length === 0) {
    await frame.locator("button", { hasText: "Generate from active file" }).first().click();
  }
  await until("graph for main.ts", async () => (await state()).nodeIds.length > 0, 60_000);
  await sleep(3000);
  for (let pass = 0; pass < 8; pass++) {
    const next = (await groups()).find((g) => g.collapsed);
    if (!next) break;
    await toggle(next.id.replace(/:0$/, ""), false);
  }
  await fit();
  const external = frame.locator('.react-flow__node-code[data-id^="external:"]').first();
  result.externalPicked = await external.getAttribute("data-id");
  await external.locator(".cgNodeTitle").click({ delay: 40 });
  await sleep(1200);
  await startTrace();
  await steps(2);
  await exitTrace("toggle");
  await until("restore confirmed", async () => (await verifies()).length > 0, 20_000).catch(() => {});
  const v = (await verifies()).at(-1) ?? null;
  result.generation = { exit: await lastExit(), verify: v };
  check("generation: the restore is confirmed by the extension (same generation)", (await lastExit()) === "restore" && v?.outcome === "confirmed" && v.restoredGeneration === v.extensionGeneration, result.generation);
  const expand = frame.locator("button", { hasText: "Expand External" }).first();
  await expand.waitFor({ timeout: 20_000 });
  const expandSeen = (await expandLog()).length;
  await expand.click();
  await until("expand answered", async () => (await expandLog()).length > expandSeen, 30_000).catch(() => {});
  result.generation.expand = (await expandLog()).slice(expandSeen);
  check("generation: expanding a file on the restored graph is accepted, not dropped as stale", result.generation.expand.includes("analysisResult.applied.expand.merge") && !result.generation.expand.some((e) => /dropped/.test(e)), result.generation);

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
