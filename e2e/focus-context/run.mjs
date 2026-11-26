// Focus + Context (1-hop), end to end. See README.md.
// Reads only the rendered DOM. The expected 1-hop sets come from the drawn relation IDs and the
// Inspector member lists, not from the product's focus code.
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
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "cogic-focus-")));
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

  // ---- graph, everything expanded
  await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
  await until("graph", async () => (await snap()).edges.length > 3, 60_000);
  await sleep(4000);
  await fit();
  for (let pass = 0; pass < 8; pass++) {
    const next = (await groups()).find((g) => g.collapsed);
    if (!next) break;
    await toggle(next.id.replace(/:0$/, ""), false);
  }
  check("all groups expanded", (await groups()).every((g) => !g.collapsed), await groups());
  await fit();

  /** Every relation drawn or behind a badge; opening a badge clears the selection. */
  const relationsNow = async () => {
    const s = await snap();
    const plain = s.edges.map((e) => e.id).filter((id) => !id.startsWith("aggregate:"));
    const byBadge = new Map();
    for (let i = 0; i < (await badges().count()); i++) {
      const key = (await snap()).badges[i].key;
      await badges().nth(i).focus();
      await page.keyboard.press("Enter");
      await sleep(350);
      while (await more().count()) await more().click();
      byBadge.set(key, (await panel()).ids);
      await closePanel();
    }
    return { plain, byBadge, all: [...plain, ...[...byBadge.values()].flat()] };
  };
  const rel = await relationsNow();
  const aggregateIds = (await snap()).edges.filter((e) => e.id.startsWith("aggregate:"));
  // Expanded: the only aggregate is the same-label pair. Its edge ID names its endpoints.
  const memberOfExpanded = (edgeId) => {
    const [kind, source, target] = JSON.parse(edgeId.slice(10));
    const found = [...rel.byBadge.values()].filter((ids) => ids.every((id) => id.startsWith(`${kind}:${source}->${target}@@`)));
    return found.length === 1 ? found[0] : null;
  };
  result.relations = { plain: rel.plain.length, badges: [...rel.byBadge].map(([k, v]) => [k, v.length]), aggregates: aggregateIds.length };
  await fit();

  mark("start");
  const s0 = await snap();
  result.codeNodes = s0.nodes.filter((n) => n.type === "code").map((n) => n.id);
  check("off: no selection, button disabled and not pressed", s0.state === "off" && s0.pressed === "false" && s0.disabled === true, s0.state);
  check("off: no focus class anywhere", s0.focusClasses === 0);

  // ---- select one node, Focus still off
  await select("process");
  const processId = await idOf("process");
  const s1 = await snap();
  check("off + selection: button enabled, nothing dimmed", s1.state === "off" && s1.disabled === false && s1.focusClasses === 0, s1.state);
  check("off + selection: layout as before", sameLayout(layoutOf(s1), layoutOf(s0)), diff(layoutOf(s1), layoutOf(s0)));

  // ---- Focus on
  await toggleFocus();
  const s2 = await snap();
  check("on: state active and pressed", s2.state === "active" && s2.pressed === "true", [s2.state, s2.pressed]);
  check("on: same nodes, edges, positions, paths and viewport", sameLayout(layoutOf(s2), layoutOf(s1)), diff(layoutOf(s2), layoutOf(s1)));
  check("on: same badge counts", same(s2.badges.map((b) => `${b.key}`), s1.badges.map((b) => `${b.key}`)));
  const e2 = expectFor(processId, s2, rel.all, memberOfExpanded);
  result.process = e2.counts;
  check("on: center, 1-hop and context match the relation IDs", e2.problems.length === 0, e2.problems);
  check("on: there is context and there are 1-hop relations", e2.counts.context > 0 && e2.counts.contextEdges > 0 && e2.counts.relatedEdges > 0, e2.counts);
  check("on: related edges keep color, dash, marker and path", unchangedRelated(s1, s2).length === 0, unchangedRelated(s1, s2).slice(0, 2).map((id) => [s1.edges.find((e) => e.id === id), s2.edges.find((e) => e.id === id)]));
  check("on: a dimmed row inside a kept class card", s2.nodes.some((n) => n.focus !== "cgFocus--context" && n.rows.some((r) => r.context && Number(r.opacity) === 0.35)), s2.nodes.filter((n) => n.rows.length).map((n) => [n.id, n.focus, n.rows]));

  // ---- off and on again
  await toggleFocus();
  const s3 = await snap();
  check("off again: styles return exactly", s3.state === "off" && s3.focusClasses === 0 && styleOf(s3) === styleOf(s1) && sameLayout(layoutOf(s3), layoutOf(s1)), [diff(styleOf(s3), styleOf(s1)), diff(layoutOf(s3), layoutOf(s1))]);
  const timings = [];
  for (let i = 0; i < 10; i++) {
    timings.push(await timeToggle());
    await sleep(300);
  }
  result.toggleTimings = timings;
  check("toggle: every on frame has classes, every off frame has none", timings.every((t, i) => (i % 2 === 0 ? t.state === "active" && t.classes > 0 : t.state === "off" && t.classes === 0)), timings);
  check("toggle: still off after an even number of clicks", (await snap()).state === "off");
  await toggleFocus();

  // ---- another center
  await select("log");
  const logId = await idOf("log");
  const s4 = await snap();
  const e4 = expectFor(logId, s4, rel.all, memberOfExpanded);
  check("new center: follows the selection", s4.state === "active" && s4.nodes.find((n) => n.id === logId)?.focus === "cgFocus--center" && e4.problems.length === 0, e4.problems);
  check("new center: layout unchanged", sameLayout(layoutOf(s4), layoutOf(s1)));

  // ---- a context node can still be selected
  const contextTitle = await frame.evaluate((center) => {
    const n = [...document.querySelectorAll(".react-flow__node-code.cgFocus--context")].find((x) => x.dataset.id !== center);
    return n?.querySelector(".cgNodeTitle")?.textContent ?? null;
  }, logId);
  result.contextPick = contextTitle;
  await select(contextTitle.split(/[(\s]/)[0]);
  const pickedId = await idOf(contextTitle.split(/[(\s]/)[0]);
  const s5 = await snap();
  const e5 = expectFor(pickedId, s5, rel.all, memberOfExpanded);
  check("context node: selectable, becomes the center", s5.state === "active" && s5.nodes.find((n) => n.id === pickedId)?.focus === "cgFocus--center" && e5.problems.length === 0, [contextTitle, e5.problems]);

  // ---- multi-selection turns the style off, single selection brings it back
  await select("log", ["Control"]);
  const s6 = await snap();
  check("multi-selection: focus idle, nothing dimmed", s6.state === "idle" && s6.focusClasses === 0, s6.state);
  await select("process");
  check("single selection again: active", (await snap()).state === "active");

  // ---- clearing the selection
  await paneClick();
  const s7 = await snap();
  check("selection cleared: normal view", s7.state === "idle" && s7.focusClasses === 0 && styleOf(s7) === styleOf(s0), s7.state);

  // ---- pan, zoom and low zoom while focused
  await select("process");
  const before = await snap();
  const pt = await paneClick().catch(() => null);
  await select("process");
  const pane = await frame.locator(".react-flow__pane").boundingBox();
  const v0 = await viewport();
  await page.mouse.move(pane.x + pt.x, pane.y + pt.y);
  await page.mouse.down();
  await page.mouse.move(pane.x + pt.x + 60, pane.y + pt.y + 20, { steps: 8 });
  await page.mouse.move(pane.x + pt.x + 40, pane.y + pt.y + 10, { steps: 8 });
  await page.mouse.up();
  await sleep(600);
  const v1 = await viewport();
  const sp = await snap();
  check("pan: view moves", Math.abs(v1.x - v0.x - 40) < 3 && Math.abs(v1.y - v0.y - 10) < 3, [v0, v1]);
  check("pan: classes and edges unchanged", sp.state === "active" && same(sp.edges.map((e) => `${e.id}|${e.focus}`), before.edges.map((e) => `${e.id}|${e.focus}`)));
  const z0 = (await viewport()).zoom;
  await page.mouse.move(pane.x + pt.x, pane.y + pt.y);
  await page.mouse.wheel(0, -200);
  await sleep(700);
  check("wheel: zooms in", (await viewport()).zoom > z0);
  for (let i = 0; i < 60 && (await viewport()).zoom > 0.1001; i++) {
    await page.mouse.wheel(0, 300);
    await sleep(60);
  }
  await sleep(900);
  const low = await frame.evaluate(() => ({
    lowClass: Boolean(document.querySelector(".canvasFlow--lowDetailEdges")),
    dash: [...document.querySelectorAll(".react-flow__edges .react-flow__edge-path")].map((e) => getComputedStyle(e).strokeDasharray),
    context: [...document.querySelectorAll(".react-flow__edge.cgFocus--context .react-flow__edge-path")].map((e) => getComputedStyle(e).opacity),
  }));
  check("zoom 0.1: solid strokes with Focus on", (await viewport()).zoom <= 0.1001 && low.lowClass && low.dash.length > 0 && low.dash.every((d) => d === "none"), low.dash.slice(0, 5));
  check("zoom 0.1: context edges still dimmed", low.context.length > 0 && low.context.every((o) => Number(o) === 0.12), low.context.slice(0, 5));
  await fit();
  const e8 = expectFor(processId, await snap(), rel.all, memberOfExpanded);
  check("after zoom: classes still exact", e8.problems.length === 0, e8.problems);

  // ---- Param Flow takes precedence
  const flowRow = frame.locator(".inspectorFlowRow").first();
  if (await flowRow.count()) {
    await flowRow.click();
    await sleep(1200);
    const sf = await snap();
    check("Param Flow: focus paused, nothing dimmed", sf.state === "paused" && sf.focusClasses === 0, sf.state);
    check("Param Flow: its highlight is shown", (await frame.locator(".inspectorFlowRow--active").count()) === 1);
    await select("log");
    const after = await snap();
    result.afterParamFlow = after.state;
    check("Param Flow: selecting another node resumes or keeps the flow", ["active", "paused"].includes(after.state) && (after.state === "paused") === ((await frame.locator(".inspectorFlowRow--active").count()) > 0), after.state);
  } else {
    check("Param Flow: a flow row exists for process", false);
  }

  // ---- collapsed groups
  // A group header selects the group (existing behaviour), and a group is not a Focus center.
  mark("collapse");
  await toggle("/src/app", true);
  const sg = await snap();
  check("group header selects the group: Focus stays on but idle", sg.state === "idle" && sg.pressed === "true" && sg.focusClasses === 0, sg.state);
  await select("main");
  const mainId = await idOf("main");
  const sm = await snap();
  const em = expectFor(mainId, sm, rel.all, () => null);
  const folderState = (suffix) => sm.nodes.find((n) => n.id.endsWith(suffix))?.focus;
  check("collapsed folder: main is the center, its folder of callees is kept", sm.state === "active" && em.problems.length === 0 && folderState("/src/app") === "cgFocus--connected", [em.problems, folderState("/src/app")]);
  check("collapsed folder: an unrelated folder is context", folderState("/src/svc") === "cgFocus--context", folderState("/src/svc"));
  const badgeCheck = async (center, recorded) => {
    // Opening a badge selects the aggregate and clears the node selection.
    const opened = [];
    for (let i = 0; i < recorded.length; i++) {
      const key = (await snap()).badges[i].key;
      await badges().nth(i).focus();
      await page.keyboard.press("Enter");
      await sleep(400);
      while (await more().count()) await more().click();
      const p = await panel();
      const want = recorded.find((b) => b.key === key);
      opened.push({ key, members: p.ids.length, touching: p.ids.filter((id) => ends(id)?.includes(center)).length, count: want?.count, related: want?.related, text: want?.text, opacity: want?.opacity, covered: want?.covered });
      await closePanel();
    }
    return opened;
  };
  const om = await badgeCheck(mainId, sm.badges);
  result.collapsedFolderBadges = om;
  check("collapsed folder: each badge counts its members touching the center", om.length > 0 && om.every((o) => o.members === o.count && o.touching === o.related), om);
  // A badge hidden by the declutter rule has opacity 0 and is left out.
  check("collapsed folder: unrelated badges are dimmed, related ones are not", om.filter((o) => !o.covered).every((o) => (o.related === 0) === (Number(o.opacity) === 0.3)), om);
  await toggle("/src/app", false);

  // A member opened from the Inspector selects a node inside a collapsed file.
  mark("partial");
  for (const f of ["/svc/d.ts", "/app/many.ts"]) await toggle(f, true);
  const callBadge = frame.locator('.cgAggregateBadge--calls[data-count="25"]');
  await callBadge.click({ delay: 50 });
  await sleep(600);
  await frame.locator(".aggregateItem").first().locator(".aggregateEndBtn").first().click();
  await sleep(1500);
  await fit();
  const firstMember = (await panel())?.ids[0];
  const hiddenCenter = ends(firstMember)?.[0];
  const sh = await snap();
  result.partial = { hiddenCenter, badges: sh.badges, state: sh.state, groups: sh.nodes.filter((n) => n.type !== "code").map((n) => [n.id, n.focus, n.collapsed]) };
  check("partial: a hidden member is the center, its collapsed file is drawn as the center", sh.state === "active" && sh.nodes.find((n) => n.id.replace(/:0$/, "").endsWith("/many.ts"))?.focus === "cgFocus--center" && sh.nodes.find((n) => n.id.replace(/:0$/, "").endsWith("/d.ts"))?.focus === "cgFocus--connected", [hiddenCenter, sh.state]);
  check("partial: the aggregate stays selected in the Inspector", (await panel())?.ids.length > 0 && (await frame.locator('.cgAggregateBadge[aria-pressed="true"]').count()) === 1);
  while (await more().count()) await more().click();
  check("partial: the Inspector still lists all 25 members", (await panel())?.ids.length === 25, (await panel())?.ids.length);
  const big = sh.badges.filter((b) => b.count === 25);
  check("partial: ×25 stays ×25 and 5 are marked as in focus", big.length === 2 && big.every((b) => b.related === 5 && /×25/.test(b.text) && /5 in focus/.test(b.text)), big);
  check("partial: aggregate edges marked related = badges with related members",
    sh.edges.filter((e) => e.id.startsWith("aggregate:") && e.focus === "cgFocus--related").length === sh.badges.filter((b) => b.related > 0).length);
  await closePanel();
  const oh = await badgeCheck(hiddenCenter, sh.badges);
  result.partialOpened = oh;
  check("partial: related count equals the members touching the center, for every badge", oh.every((o) => o.members === o.count && o.touching === o.related), oh);
  check("partial: no empty canvas", notEmpty(await snap()));
  for (const f of ["/app/many.ts", "/svc/d.ts"]) await toggle(f, false);
  await select("w1");
  const w1Id = await idOf("w1");
  const e9 = expectFor(w1Id, await snap(), rel.all, memberOfExpanded);
  check("expanded again: classes exact", (await snap()).state === "active" && e9.problems.length === 0, e9.problems);

  // ---- export draws the original styles and Focus comes back
  // Export sizes the canvas to the whole graph; collapsed folders keep that small.
  await toggle("/src/svc", true);
  await toggle("/src/app", true);
  await select("main");
  const beforeExport = await snap();
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
  mark("export");
  const svgFile = path.join(OUT, "focus-export.svg");
  await exportTo("SVG snapshot", svgFile);
  const svg = fs.readFileSync(svgFile, "utf8");
  const svgOpacities = [...svg.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  result.export = { svgBytes: svg.length, low: svgOpacities.filter((o) => o === 0.12 || o === 0.25).length };
  check("export SVG: no focus classes in the file", !/cgFocus--|focusContext/.test(svg));
  check("export SVG: no context opacity in the file", result.export.low === 0, result.export);
  // Nodes and edges only: export leaves its own viewport transform behind (see below).
  const graphLayout = (x) => JSON.stringify(JSON.parse(layoutOf(x)).slice(0, 2));
  const afterSvg = await snap();
  check("export SVG: Focus restored as before", afterSvg.state === "active" && styleOf(afterSvg) === styleOf(beforeExport) && sameLayout(graphLayout(afterSvg), graphLayout(beforeExport)), afterSvg.state);
  const viewportAfter = (x) => ({ before: beforeExport.viewport, after: x.viewport });
  result.exportViewport = { focusOn: viewportAfter(afterSvg) };
  await fit();
  const jpgFile = path.join(OUT, "focus-export.jpg");
  await exportTo("JPG snapshot", jpgFile);
  const afterJpg = await snap();
  check("export JPG: file written and Focus restored", fs.statSync(jpgFile).size > 1000 && afterJpg.state === "active" && styleOf(afterJpg) === styleOf(beforeExport) && sameLayout(graphLayout(afterJpg), graphLayout(beforeExport)));
  // Same export with Focus off, to tell whether the viewport behaviour depends on Focus.
  await fit();
  await toggleFocus();
  const offBefore = await snap();
  await exportTo("SVG snapshot", path.join(OUT, "off-export.svg"));
  const offAfter = await snap();
  result.exportViewport.focusOff = { before: offBefore.viewport, after: offAfter.viewport };
  check("export with Focus off: no focus class, styles unchanged", offAfter.state === "off" && offAfter.focusClasses === 0 && styleOf(offAfter) === styleOf(offBefore));
  await fit();
  await toggleFocus();
  check("Focus on again after exports", (await snap()).state === "active");

  mark("trace");
  for (const f of ["/src/app", "/src/svc"]) await toggle(f, false);

  // ---- root change, then a trace (from main.ts the trace view is empty before this change too)
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
  const sr = await snap();
  check("root change: Focus stays on, the old center is gone", sr.pressed === "true" && sr.focusClasses === (sr.state === "active" ? sr.focusClasses : 0) && notEmpty(sr), sr.state);
  await select("calculate");
  const calcId = await idOf("calculate");
  const sc2 = await snap();
  check("root change: a new center works", sc2.state === "active" && sc2.nodes.find((n) => n.id === calcId)?.focus === "cgFocus--center" && sc2.nodes.some((n) => n.focus === "cgFocus--context"), sc2.state);

  const trace = frame.locator('button[title^="Trace mode"]');
  await trace.click();
  await sleep(6000);
  const step = frame.locator("button").filter({ hasText: /^->$/ }).first();
  await step.waitFor({ timeout: 20_000 });
  // Early steps can show an empty canvas, also before this change; walk to a step with code.
  let steps = 0;
  for (; steps < 40 && (await step.isEnabled()); steps++) {
    await step.click();
    await sleep(500);
    if ((await frame.locator(".react-flow__node-code").count()) > 0) break;
  }
  await sleep(800);
  await fit();
  result.traceSteps = steps;
  const traced = frame.locator(".react-flow__node-code .cgNodeTitle").first();
  const tracedTitle = await traced.textContent();
  await traced.click({ delay: 40 });
  await sleep(900);
  const st = await snap();
  result.trace = { state: st.state, selected: tracedTitle, nodes: st.nodes.length };
  check("trace: a node selected during the trace is not dimmed around", st.state === "paused" && st.focusClasses === 0, st.state);
  check("trace: the trace highlight is kept", (await frame.locator(".cgNode--selected").count()) > 0);
  check("trace: canvas not empty", st.nodes.length > 0, st.nodes.length);
  await trace.click();
  await sleep(2500);
  await fit();
  await until("graph after the trace", async () => (await (await codeNode("calculate")).count()) > 0, 60_000);
  await select("calculate");
  const se = await snap();
  check("after trace: Focus works again", se.state === "active" && se.nodes.find((n) => n.id === calcId)?.focus === "cgFocus--center", se.state);
  await toggleFocus();
  check("Focus off at the end: no focus class", (await snap()).focusClasses === 0);
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
