// Aggregated edge drill-down, end to end. See README.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "cogic-e2e-")));
const EXE = process.env.VSCODE_EXE;
if (!EXE) throw new Error("Set VSCODE_EXE");
const freeMiB = () => Math.round(os.freemem() / 1048576);
if (freeMiB() < 2200) throw new Error(`preflight memory ${freeMiB()} MiB`);

const userData = path.join(OUT, "user-data");
const workspace = path.join(OUT, "workspace");
if (fs.existsSync(userData) || fs.existsSync(workspace)) throw new Error("Use a new output folder");
fs.mkdirSync(path.join(userData, "User"), { recursive: true });
fs.cpSync(path.join(HERE, "fixture"), workspace, { recursive: true });
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

const result = { checks: [], memory: { before: freeMiB(), minimum: freeMiB(), aborted: false } };
const check = (name, pass, detail) => {
  result.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` ${JSON.stringify(detail)?.slice(0, 400)}`}`);
};
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
  await page.keyboard.press("Control+B"); // close the side bar; the canvas needs the room
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

  // ---- helpers: rendered DOM only
  const until = async (name, read, timeout = 20_000) => {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await read();
      if (value) return value;
      if (Date.now() > end) throw new Error(`timeout: ${name}`);
      await sleep(200);
    }
  };
  const fit = async () => {
    await frame.locator('button[title="Fit Graph"]').click({ delay: 60 });
    await sleep(1500);
    // At the zoom floor the graph may not fit, and off-screen nodes are not in the DOM.
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
    const items = [...p.querySelectorAll(".aggregateItem")];
    return {
      relation: p.querySelector(".kvRow .kvVal").textContent,
      ids: items.map((e) => e.dataset.edgeId),
      labels: items.map((e) => e.querySelector(".aggregateLabel")?.textContent ?? null),
      active: items.filter((e) => e.classList.contains("aggregateItem--active")).map((e) => e.dataset.edgeId),
    };
  });
  const closePanel = async () => {
    const button = frame.locator(".panel--aggregate .panelHeader .smallBtn");
    if (await button.count()) await button.click();
    await sleep(300);
  };
  const more = () => frame.locator(".panel--aggregate .panelBody > .smallBtn");
  const badges = () => frame.locator(".cgAggregateBadge");
  const badge = (kind, count) => frame.locator(`.cgAggregateBadge--${kind}[data-count="${count}"]`);
  const viewport = () => frame.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector(".react-flow__viewport")).transform);
    return { x: m.e, y: m.f, zoom: m.a };
  });
  const drawnIds = () => frame.evaluate(() => [...document.querySelectorAll(".react-flow__edge")]
    .map((e) => e.getAttribute("data-testid").replace(/^rf__edge-/, "")));
  /** Every original relation that can be reached: plain edges plus all members of all badges. */
  const reachable = async () => {
    const drawn = await drawnIds();
    const ids = drawn.filter((id) => !id.startsWith("aggregate:"));
    const aggregates = [];
    for (let i = 0; i < (await badges().count()); i++) {
      await badges().nth(i).focus();
      await page.keyboard.press("Enter");
      await sleep(350);
      while (await more().count()) await more().click();
      const p = await panel();
      aggregates.push({ relation: p.relation, ids: p.ids, labels: p.labels });
      ids.push(...p.ids);
      await closePanel();
      await fit();
    }
    return { drawn, ids, aggregates };
  };
  const signature = (r) => JSON.stringify([[...r.drawn].sort(), r.aggregates.map((a) => [...a.ids].sort()).sort()]);
  const counts = (list) => list.filter((id, i) => list.indexOf(id) !== i);

  await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
  await until("graph", async () => (await drawnIds()).length > 3, 60_000);
  await sleep(4000);
  await fit();
  result.initialGroups = await groups();

  // ---- everything expanded
  for (let pass = 0; pass < 8; pass++) {
    const next = (await groups()).find((g) => g.collapsed);
    if (!next) break;
    await toggle(next.id.replace(/:0$/, ""), false);
  }
  check("all groups expanded", (await groups()).every((g) => !g.collapsed), await groups());
  await fit();
  const expanded = await reachable();
  result.expanded = { drawn: expanded.drawn.length, reachable: expanded.ids.length, aggregates: expanded.aggregates };
  const twins = expanded.ids.filter((id) => id.startsWith("dataflow:") && id.includes("@@value <- word@@arg#"));
  check("expanded: both same-label relations are reachable", twins.length === 2 && new Set(twins).size === 2, { twins, aggregates: expanded.aggregates });
  check("expanded: the same-label pair is one edge with a badge", expanded.aggregates.length === 1 && expanded.aggregates[0].ids.length === 2, expanded.aggregates);
  check("expanded: no relation appears twice", counts(expanded.ids).length === 0, counts(expanded.ids));
  check("expanded: 25 calls out of many.ts", expanded.ids.filter((id) => id.startsWith("calls:") && /many\.ts:\d+->.*\/d\.ts/.test(id)).length === 25);

  // Param Flow highlight on the expanded pair.
  await badge("dataflow", 2).focus();
  await page.keyboard.press("Enter");
  await sleep(500);
  await frame.locator(".aggregateItem").nth(1).locator(".aggregateEndBtn").first().click();
  await sleep(2000);
  const flow = await panel();
  check("expanded: Param Flow focuses the chosen original", flow?.active.length === 1 && flow.active[0] === flow.ids[1], flow);
  check("expanded: label and count are both visible", /word.*×2/.test(await badge("dataflow", 2).innerText()), await badge("dataflow", 2).innerText());
  await closePanel();
  await fit();

  // ---- collapse a folder that was expanded, then restore it
  for (const folder of ["/src/svc", "/src/app"]) {
    check(`${folder}: starts expanded`, (await group(folder))?.collapsed === false);
    await fit();
    const before = await reachable();
    await toggle(folder, true);
    const collapsed = await reachable();
    const inside = (id) => {
      const ends = /^\w+:(.*?)->(.*?)@@/.exec(id);
      return Boolean(ends) && ends.slice(1).every((end) => end.includes(`${folder}/`));
    };
    const expectedIds = before.ids.filter((id) => !inside(id));
    result[`collapse ${folder}`] = {
      before: [before.drawn.length, before.ids.length],
      collapsed: [collapsed.drawn.length, collapsed.ids.length],
      internal: before.ids.length - expectedIds.length,
      aggregates: collapsed.aggregates.map((a) => a.relation),
    };
    check(`${folder}: collapse really changed the drawing`, collapsed.drawn.length < before.drawn.length, result[`collapse ${folder}`]);
    check(`${folder}: every crossing relation kept exactly once`, same(collapsed.ids, expectedIds), {
      missing: expectedIds.filter((id) => !collapsed.ids.includes(id)),
      extra: collapsed.ids.filter((id) => !expectedIds.includes(id)),
    });
    await toggle(folder, false);
    const after = await reachable();
    check(`${folder}: expanding restores edges and relations`, signature(after) === signature(before), {
      lost: before.drawn.filter((id) => !after.drawn.includes(id)),
      added: after.drawn.filter((id) => !before.drawn.includes(id)),
    });
  }

  // ---- drill-down on collapsed files
  for (const f of ["/svc/d.ts", "/app/many.ts"]) await toggle(f, true);
  await fit();
  check("calls ×25 badge", (await badge("calls", 25).count()) === 1);
  await badge("calls", 25).focus();
  await page.keyboard.press("Enter");
  await sleep(600);
  const first = await panel();
  const moreText = await more().innerText();
  await more().click();
  await sleep(300);
  const all = await panel();
  check("Show more: 20 then 25", first.ids.length === 20 && /Show 5 more \(5 left\)/.test(moreText) && all.ids.length === 25 && new Set(all.ids).size === 25 && (await more().count()) === 0, { first: first.ids.length, moreText, all: all.ids.length });
  check("Show more: the members are the 25 graph relations", same(all.ids, expanded.ids.filter((id) => id.startsWith("calls:") && /many\.ts:\d+->.*\/d\.ts/.test(id))));
  await closePanel();

  await badge("dataflow", 25).click({ delay: 50 });
  await sleep(600);
  check("mouse click opens the panel", (await panel())?.relation === "dataflow ×25", await panel());
  check("paging restarts for another aggregate", (await panel())?.ids.length === 20);
  const row = frame.locator(".aggregateItem").first();
  const tab = () => page.locator(".tabs-container .tab.active .label-name").allInnerTexts();
  await row.locator(".aggregateEndBtn").first().click();
  await until("many.ts opened", async () => (await tab()).some((t) => /many\.ts/.test(t)));
  await sleep(1500);
  check("source end opens its file", true);
  check("the aggregate stays open and focuses the member", (await panel())?.active[0] === (await panel())?.ids[0], await panel());
  await fit();
  check("groups stay collapsed", (await group("/app/many.ts")).collapsed && (await group("/svc/d.ts")).collapsed);
  await row.locator(".aggregateEndBtn").nth(1).click();
  await until("d.ts opened", async () => (await tab()).some((t) => /d[.]ts/.test(t)));
  check("target end opens its file", true);

  // ---- stale state
  const open = async () => {
    await fit();
    await badge("calls", 25).click({ delay: 50 });
    await sleep(600);
    if (!(await panel())) throw new Error("panel did not open");
  };
  await open();
  check("another aggregate replaces it", (await panel()).relation === "calls ×25" && (await frame.locator('.cgAggregateBadge[aria-pressed="true"]').count()) === 1);
  await closePanel();
  check("Close clears", (await panel()) === null);
  await open();
  await frame.locator("button").filter({ hasText: /^Classes$/ }).first().click();
  await sleep(1000);
  check("filter clears", (await panel()) === null);
  await frame.locator("button").filter({ hasText: /^All$/ }).first().click();
  await sleep(1200);
  check("filter: not resurrected", (await panel()) === null);
  await open();
  await toggle("/svc/d.ts", false);
  check("expanding a group clears", (await panel()) === null);
  await toggle("/svc/d.ts", true);
  check("expanding: not resurrected", (await panel()) === null);

  // ---- root
  const pick = async (file) => {
    await frame.locator(".projectPicker").click();
    await frame.locator(".projectMenuSearchInput").fill(file);
    await frame.locator(".projectMenuItem").first().click();
    await frame.locator(".rootBanner").waitFor({ timeout: 20_000 });
    await until("graph after root change", async () => (await drawnIds()).length > 3, 60_000);
    await sleep(4000);
    await fit();
  };
  await pick("src/main.ts");
  for (const f of ["/svc/d.ts", "/app/many.ts"]) await toggle(f, true);
  await open();
  await frame.locator(".rootBanner .btnGhost").click();
  await sleep(1000);
  check("clearing the root clears the selection", (await panel()) === null && (await frame.locator(".rootBanner").count()) === 0, await panel());
  check("root: no badge stays pressed", (await frame.locator('.cgAggregateBadge[aria-pressed="true"]').count()) === 0);
  await open();
  await pick("app/many.ts");
  check("changing the root clears the selection", (await panel()) === null);
  await pick("src/main.ts");
  for (const f of ["/svc/d.ts", "/app/many.ts"]) await toggle(f, true);
  check("root: not resurrected", (await panel()) === null);

  // ---- pan, zoom, low zoom
  await fit();
  const z0 = await viewport();
  const box = await badge("calls", 25).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await sleep(700);
  check("wheel over a badge zooms", (await viewport()).zoom > z0.zoom);
  await fit();
  const pt = await frame.evaluate(() => {
    const r = document.querySelector(".react-flow__pane").getBoundingClientRect();
    for (let y = 90; y < r.height - 60; y += 8)
      for (let x = 20; x < r.width - 120; x += 8)
        if (document.elementFromPoint(r.left + x, r.top + y)?.classList.contains("react-flow__pane")) return { x, y };
    return null;
  });
  const pane = await frame.locator(".react-flow__pane").boundingBox();
  const v0 = await viewport();
  const edgesBefore = await drawnIds();
  await page.mouse.move(pane.x + pt.x, pane.y + pt.y);
  await page.mouse.down();
  await page.mouse.move(pane.x + pt.x + 60, pane.y + pt.y + 20, { steps: 8 });
  await page.mouse.move(pane.x + pt.x, pane.y + pt.y, { steps: 8 });
  await page.mouse.move(pane.x + pt.x + 40, pane.y + pt.y + 10, { steps: 8 });
  await page.mouse.up();
  await sleep(600);
  const v1 = await viewport();
  check("pan moves the view", Math.abs(v1.x - v0.x - 40) < 3 && Math.abs(v1.y - v0.y - 10) < 3, [v0, v1]);
  check("pan keeps the edges", same(edgesBefore, await drawnIds()));
  check("edges never take pointer events", (await frame.evaluate(() => [...document.querySelectorAll(".react-flow__edge, .react-flow__edge *")].filter((e) => getComputedStyle(e).pointerEvents !== "none").length)) === 0);
  await page.mouse.move(pane.x + pt.x, pane.y + pt.y);
  for (let i = 0; i < 60 && (await viewport()).zoom > 0.1001; i++) {
    await page.mouse.wheel(0, 300);
    await sleep(60);
  }
  await sleep(900);
  const low = await frame.evaluate(() => ({
    lowClass: Boolean(document.querySelector(".canvasFlow--lowDetailEdges")),
    dash: [...document.querySelectorAll(".react-flow__edges .react-flow__edge-path")].map((e) => getComputedStyle(e).strokeDasharray),
  }));
  check("zoom 0.1: edges are solid", (await viewport()).zoom <= 0.1001 && low.lowClass && low.dash.length > 0 && low.dash.every((d) => d === "none"), [await viewport(), low]);
  for (const [index, text] of (await badges().allTextContents()).entries()) {
    await badges().nth(index).focus();
    await page.keyboard.press("Enter");
    await sleep(350);
    check(`zoom 0.1: ${text} opens`, text.includes((await panel())?.relation.split(" ")[1] ?? "?"), await panel());
  }
  await closePanel();
  await fit();

  // ---- trace and manual selection
  await open();
  const trace = frame.locator('button[title^="Trace mode"]');
  await trace.click();
  await sleep(6000);
  check("starting a trace clears the selection", (await panel()) === null);
  const step = frame.locator("button").filter({ hasText: /^->$/ }).first();
  // a.ts has an expanded same-label pair, so its trace contains both a flow and an aggregate.
  await trace.click();
  await sleep(2500);
  await pick("app/a.ts");
  await trace.click();
  await sleep(5000);
  await step.waitFor({ timeout: 20_000 });
  result.trace = { total: await frame.locator(".mono").filter({ hasText: /^\d+ \/ \d+$/ }).first().innerText() };
  const activeRow = () => frame.locator(".inspectorFlowRow--active").allTextContents();
  let traceFlow = [];
  let traceBadge = false;
  // Walk to a dataflow step while at least one aggregate is on the canvas.
  for (let i = 0; i < 200 && (await step.count()) && (await step.isEnabled()); i++) {
    await step.click();
    await sleep(250);
    traceFlow = await activeRow();
    traceBadge = (await badges().count()) > 0;
    if (traceFlow.length && traceBadge) break;
  }
  result.trace.flow = traceFlow;
  result.trace.badge = traceBadge;
  if (traceFlow.length && traceBadge) {
    await badges().first().focus();
    await page.keyboard.press("Enter");
    await sleep(700);
    check("trace: an aggregate can be opened", (await panel()) !== null);
    await frame.locator(".aggregateItem").first().locator(".aggregateEndBtn").first().click();
    await sleep(1500);
    const during = { flow: await activeRow(), panel: await panel() };
    check("trace: the trace flow keeps precedence over the manual one", same(during.flow, traceFlow), { traceFlow, during });
    // The trace stands on arg#1 and the click was on arg#0; only the IDs tell them apart.
    check("trace: the highlighted original is the traced one", during.flow.length === 1 && during.panel?.active.length === 1 && during.panel.active[0].endsWith("@@arg#1") && during.panel.ids[0].endsWith("@@arg#0"), during);
    await trace.click();
    await sleep(2500);
    check("ending the trace clears the selection", (await panel()) === null && (await frame.locator('.cgAggregateBadge[aria-pressed="true"]').count()) === 0);
    // Param Flow behaviour from before aggregates: a flow chosen during a trace shows after it.
    result.trace.flowAfterEnd = await activeRow();
  } else {
    check("trace: reached a dataflow step with an aggregate", false, result.trace);
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
  console.log(`${result.checks.length - failed.length}/${result.checks.length} checks passed; min free ${result.memory.minimum} MiB; ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
}
