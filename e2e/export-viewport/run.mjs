// Export keeps the view, end to end. See README.md. Reads only the rendered DOM.
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
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "cogic-export-")));
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

  const exportTo = async (item, file) => {
    // Answers a native save dialog, in case the simple dialog setting is not used.
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, file);
    await frame.locator('button[title="Export graph"]').click();
    await frame.locator(".exportMenuItemTitle", { hasText: item }).click();
    const input = page.locator(".quick-input-widget input.input").first();
    const how = await until("save dialog or file", async () =>
      fs.existsSync(file) ? "native" : (await input.isVisible().catch(() => false)) ? "simple" : null, 30_000);
    result.exportDialog = how;
    if (how === "simple") {
      await input.fill(file);
      await sleep(300);
      await page.keyboard.press("Enter");
    }
    await until(`${file} written`, async () => fs.existsSync(file) && fs.statSync(file).size > 0, 30_000);
    await sleep(1500);
  };

  // ---- state that export must not change
  const view = () => frame.evaluate(() => {
    const vp = document.querySelector(".react-flow__viewport");
    const m = new DOMMatrix(getComputedStyle(vp).transform);
    return {
      x: m.e,
      y: m.f,
      zoom: m.a,
      inline: vp.style.transform,
      low: Boolean(document.querySelector(".canvasFlow--lowDetailEdges")),
      dashes: [...new Set([...document.querySelectorAll(".react-flow__edges .react-flow__edge-path")].map((e) => getComputedStyle(e).strokeDasharray))].sort(),
      selected: [...document.querySelectorAll(".react-flow__node")].filter((n) => n.querySelector(".cgNode--selected, .cgChildNode--selected") || n.classList.contains("selected")).map((n) => n.dataset.id).sort(),
      pressedBadge: [...document.querySelectorAll('.cgAggregateBadge[aria-pressed="true"]')].map((b) => b.dataset.count),
      panel: document.querySelector(".panel--aggregate .kvRow .kvVal")?.textContent ?? null,
      canvasStyles: [...document.querySelectorAll(".react-flow, .react-flow__renderer, .react-flow__pane, .react-flow__edges, .react-flow__edgelabel-renderer, .react-flow__nodes")].map((e) => e.getAttribute("style") ?? ""),
    };
  });
  /** One invariant record: viewport, DOM transform, graph IDs, groups, selection, Focus. */
  const invariant = async () => {
    const s = await snap();
    const v = await view();
    return {
      viewport: { x: v.x, y: v.y, zoom: v.zoom },
      domTransform: v.inline,
      graphNodeIds: s.nodes.map((n) => n.id).sort(),
      graphEdgeIds: s.edges.map((e) => e.id).sort(),
      collapsedGroups: s.nodes.filter((n) => n.collapsed).map((n) => n.id).sort(),
      selection: { nodes: v.selected, aggregate: v.pressedBadge, panel: v.panel },
      focusMode: { pressed: s.pressed, state: s.state, classes: s.focusClasses },
      lowDetail: v.low,
      dashes: v.dashes,
      badges: s.badges.map((b) => b.text).sort(),
      canvasStyles: v.canvasStyles,
    };
  };
  const near = (a, b) => Math.abs(a - b) < 0.01;
  const compare = (before, after) => {
    const out = [];
    for (const k of ["x", "y"]) if (!near(before.viewport[k], after.viewport[k])) out.push([k, before.viewport[k], after.viewport[k]]);
    if (Math.abs(before.viewport.zoom - after.viewport.zoom) > 1e-6) out.push(["zoom", before.viewport.zoom, after.viewport.zoom]);
    for (const k of ["domTransform", "graphNodeIds", "graphEdgeIds", "collapsedGroups", "selection", "focusMode", "lowDetail", "dashes", "badges", "canvasStyles"])
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push([k, JSON.stringify(before[k]).slice(0, 200), JSON.stringify(after[k]).slice(0, 200)]);
    return out;
  };
  /** React Flow moves the view from its store; a drag by (40, 10) lands exactly there only if the DOM matches it. */
  const storeMatchesDom = async () => {
    const pt = await frame.evaluate(() => {
      const r = document.querySelector(".react-flow__pane").getBoundingClientRect();
      for (let y = 90; y < r.height - 60; y += 8)
        for (let x = 20; x < r.width - 160; x += 8)
          if (document.elementFromPoint(r.left + x, r.top + y)?.classList.contains("react-flow__pane")) return { x, y };
      return null;
    });
    const pane = await frame.locator(".react-flow__pane").boundingBox();
    const v0 = await view();
    await page.mouse.move(pane.x + pt.x, pane.y + pt.y);
    await page.mouse.down();
    await page.mouse.move(pane.x + pt.x + 20, pane.y + pt.y + 5, { steps: 6 });
    await page.mouse.move(pane.x + pt.x + 40, pane.y + pt.y + 10, { steps: 6 });
    await page.mouse.up();
    await sleep(600);
    const v1 = await view();
    const ok = Math.abs(v1.x - v0.x - 40) < 1.5 && Math.abs(v1.y - v0.y - 10) < 1.5 && Math.abs(v1.zoom - v0.zoom) < 1e-6;
    return { ok, v0: [v0.x, v0.y, v0.zoom], v1: [v1.x, v1.y, v1.zoom] };
  };
  const wheelAt = async (dy, times = 1) => {
    const pane = await frame.locator(".react-flow__pane").boundingBox();
    await page.mouse.move(pane.x + pane.width * 0.4, pane.y + pane.height * 0.5);
    for (let i = 0; i < times; i++) {
      await page.mouse.wheel(0, dy);
      await sleep(80);
    }
    await sleep(700);
  };
  const svgStats = (file) => {
    const svg = fs.readFileSync(file, "utf8");
    const dashes = [...svg.matchAll(/stroke-dasharray:\s*([^;"]+)/g)].map((m) => m[1].trim());
    return {
      bytes: svg.length,
      paths: (svg.match(/react-flow__edge-path/g) ?? []).length,
      dashed: dashes.filter((d) => d !== "none").length,
      badges: [...svg.matchAll(/×(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b),
      focus: /cgFocus--|focusContext/.test(svg),
    };
  };
  const jpgOk = (file) => {
    const b = fs.readFileSync(file);
    return b.length > 1000 && b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
  };
  let n = 0;
  /** Export, then compare the invariant and check the store against the DOM. */
  const exportAndCompare = async (name, item) => {
    const before = await invariant();
    const file = path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.${item.startsWith("SVG") ? "svg" : "jpg"}`);
    const t0 = Date.now();
    await exportTo(item, file);
    const after = await invariant();
    const diffs = compare(before, after);
    const record = { name, file: path.basename(file), ms: Date.now() - t0, before: before.viewport, after: after.viewport, transform: [before.domTransform, after.domTransform], diffs };
    if (item.startsWith("SVG")) record.svg = svgStats(file);
    else record.jpg = jpgOk(file);
    (result.exports ??= []).push(record);
    check(`${name}: viewport, transform, IDs, groups, selection and Focus unchanged`, diffs.length === 0, diffs);
    return record;
  };

  // ---- setup: collapsed files give aggregate badges
  await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
  await until("graph", async () => (await snap()).edges.length > 3, 60_000);
  await sleep(4000);
  await fit();
  for (let pass = 0; pass < 8; pass++) {
    const next = (await groups()).find((g) => g.collapsed);
    if (!next) break;
    await toggle(next.id.replace(/:0$/, ""), false);
  }
  // Export sizes the canvas to the whole graph (JPG at pixel ratio 2); collapsed folders keep
  // that within the memory guard.
  for (const f of ["/src/svc", "/src/app"]) await toggle(f, true);
  mark("start");
  result.total = { nodes: (await snap()).nodes.length, edges: (await snap()).edges.length };

  // ---- 1. pan and zoom to a user position, then SVG
  await fit();
  await storeMatchesDom();
  // Out of the 0.2-0.25 low-detail hysteresis band, which export resets (see README).
  await wheelAt(-120, 2);
  for (let i = 0; i < 6 && (await view()).zoom <= 0.26; i++) await wheelAt(-120);
  const screenBadges = (await snap()).badges.map((b) => b.count);
  const s1 = await exportAndCompare("user-view-svg", "SVG snapshot");
  check("user view: not the fit view and not zoom 1", Math.abs(s1.before.zoom - 1) > 0.01, s1.before);
  check("user view: SVG has the whole graph, dashed strokes and every badge count", s1.svg.paths >= result.total.edges && s1.svg.dashed > 0 && screenBadges.every((c) => s1.svg.badges.includes(c)), [s1.svg, screenBadges]);
  const p1 = await storeMatchesDom();
  check("user view: after export the store and the DOM agree (drag lands exactly)", p1.ok, p1);
  const z0 = (await view()).zoom;
  await wheelAt(-120);
  check("user view: wheel zoom still works after export", (await view()).zoom > z0);

  // ---- 2. zoom 0.1, SVG and JPG
  await wheelAt(300, 60);
  const lowBefore = await view();
  check("low zoom: at 0.1 with solid strokes", lowBefore.zoom <= 0.1001 && lowBefore.low && lowBefore.dashes.join() === "none", lowBefore);
  const l1 = await exportAndCompare("low-svg", "SVG snapshot");
  check("low zoom SVG: original dashed strokes and every badge count in the file", l1.svg.dashed > 0 && screenBadges.every((c) => l1.svg.badges.includes(c)), l1.svg);
  const l2 = await exportAndCompare("low-jpg", "JPG snapshot");
  check("low zoom JPG: valid file", l2.jpg === true);
  const lowAfter = await view();
  check("low zoom: back to solid strokes on screen", lowAfter.low && lowAfter.dashes.join() === "none", lowAfter.dashes);
  const p2 = await storeMatchesDom();
  check("low zoom: store and DOM agree after export", p2.ok, p2);

  // ---- 3. Focus on
  await fit();
  await select("main");
  await focusButton().click({ delay: 40 });
  await sleep(700);
  await storeMatchesDom();
  await wheelAt(-120);
  const fBefore = await snap();
  check("focus: active with dimmed context before export", fBefore.state === "active" && fBefore.focusClasses > 0, fBefore.state);
  const f1 = await exportAndCompare("focus-svg", "SVG snapshot");
  check("focus SVG: no Focus dimming in the file", f1.svg.focus === false && f1.svg.dashed > 0, f1.svg);
  const p3 = await storeMatchesDom();
  check("focus: store and DOM agree after export", p3.ok, p3);
  await focusButton().click({ delay: 40 });
  await sleep(700);

  // ---- an aggregate selected in the Inspector
  await fit();
  const firstBadge = frame.locator(".cgAggregateBadge").first();
  const badgeTitle = await firstBadge.textContent();
  await firstBadge.click({ delay: 50 });
  await sleep(700);
  const a1 = await exportAndCompare("aggregate-selected-jpg", "JPG snapshot");
  check("aggregate: still selected with its panel after export", a1.diffs.length === 0 && (await view()).panel !== null && badgeTitle.includes((await view()).panel.split(" ")[1]), [(await view()).panel, badgeTitle]);
  await frame.locator(".panel--aggregate .panelHeader .smallBtn").click();
  await sleep(300);

  // ---- 5. SVG -> JPG -> SVG
  await fit();
  await storeMatchesDom();
  await wheelAt(-120);
  const c = [];
  for (const item of ["SVG snapshot", "JPG snapshot", "SVG snapshot"]) c.push(await exportAndCompare(`series-${c.length + 1}`, item));
  check("series: every export returns to the same viewport", c.every((r) => r.diffs.length === 0) && c.every((r) => near(r.after.x, c[0].before.x) && near(r.after.y, c[0].before.y) && r.after.zoom === c[0].before.zoom), c.map((r) => r.after));
  check("series: both SVG files hold the whole graph, the JPG is valid", c[0].svg.paths === c[2].svg.paths && c[0].svg.paths >= result.total.edges && c[1].jpg === true, [c[0].svg, c[2].svg, c[1].jpg]);
  const p5 = await storeMatchesDom();
  check("series: store and DOM agree at the end", p5.ok, p5);
  // ---- the low-detail hysteresis band (0.20-0.25): export must not reset the mode
  const lowState = async () => {
    const v = await view();
    return { zoom: Math.round(v.zoom * 10000) / 10000, low: v.low, dashes: v.dashes.join("|") };
  };
  /** Small wheel steps (about 3 % each) until the zoom meets the condition. */
  const zoomUntil = async (name, done, dy) => {
    const pane = await frame.locator(".react-flow__pane").boundingBox();
    await page.mouse.move(pane.x + pane.width * 0.4, pane.y + pane.height * 0.5);
    for (let i = 0; i < 300 && !done((await view()).zoom); i++) {
      await page.mouse.wheel(0, dy);
      await sleep(50);
    }
    await sleep(800);
    const s = await lowState();
    if (!done(s.zoom)) throw new Error(`zoom not reached: ${name} ${s.zoom}`);
    return s;
  };
  const band = [];
  const step = async (name, done, dy, wantLow) => {
    const s = await zoomUntil(name, done, dy);
    band.push({ name, ...s });
    check(`band: ${name} -> ${wantLow ? "low detail" : "normal detail"}`, s.low === wantLow && (wantLow ? s.dashes === "none" : s.dashes !== "none"), s);
    return s;
  };
  const exportBand = async (name, item, wantLow) => {
    const r = await exportAndCompare(name, item);
    const after = await lowState();
    band.push({ name, export: item, before: r.before.zoom, ...after });
    check(`band: ${name}: mode kept after export (${wantLow ? "low" : "normal"})`, after.low === wantLow && r.diffs.length === 0, [after, r.diffs]);
    if (item.startsWith("SVG")) check(`band: ${name}: the file has the original dashed strokes`, r.svg.dashed > 0, r.svg);
    else check(`band: ${name}: valid JPG`, r.jpg === true);
  };
  await fit();
  await step("zoom <= 0.19", (z) => z <= 0.19, 40, true);
  await step("0.19 -> 0.22 (band)", (z) => z > 0.205 && z < 0.245, -20, true);
  await exportBand("band-low-svg", "SVG snapshot", true);
  await exportBand("band-low-jpg", "JPG snapshot", true);
  for (const [i, item] of ["SVG snapshot", "JPG snapshot", "SVG snapshot"].entries()) await exportBand(`band-low-series-${i + 1}`, item, true);
  const p6 = await storeMatchesDom();
  check("band: after the exports a drag lands exactly (store and DOM agree)", p6.ok, p6);
  check("band: the drag did not change the mode", (await lowState()).low === true, await lowState());
  await step("0.22 -> 0.26", (z) => z > 0.255, -20, false);
  await step("0.26 -> 0.22 (band)", (z) => z > 0.205 && z < 0.245, 20, false);
  await exportBand("band-normal-svg", "SVG snapshot", false);
  await exportBand("band-normal-jpg", "JPG snapshot", false);
  await step("0.22 -> 0.19", (z) => z <= 0.2, 20, true);
  result.band = band;

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
