// P14-D: the decorator fixture in a real VS Code: the built-in Call Hierarchy ("Calls: Show Incoming
// Calls" / "Show Outgoing Calls") and Trace Function Flow 1.1.1, read from the UI.
//
//   set VSCODE_EXE=<Code.exe>  set PLAYWRIGHT_CORE=<playwright-core>  set TFF_DIR=<unpacked TFF 1.1.1 extension>
//   node docs/thesis-experiments/p14d-semantic-contract/decorator-probe/vscode-ui.mjs <new output folder>
//
// The fixture is copied to the output folder; nothing in the repository is written.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "p14d-ui-")));
if (fs.existsSync(path.join(OUT, "workspace"))) throw new Error("use a new output folder");
const EXE = process.env.VSCODE_EXE;
if (!EXE) throw new Error("Set VSCODE_EXE");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXTURE = process.env.P14D_FIXTURE ?? "legacy";
const workspace = path.join(OUT, "workspace");
fs.cpSync(path.join(HERE, "fixtures", FIXTURE), workspace, { recursive: true });
const userData = path.join(OUT, "user-data");
const extDir = path.join(OUT, "extensions");
fs.mkdirSync(path.join(userData, "User"), { recursive: true });
fs.mkdirSync(extDir, { recursive: true });
if (process.env.TFF_DIR) fs.cpSync(process.env.TFF_DIR, path.join(extDir, path.basename(process.env.TFF_DIR)), { recursive: true });
fs.writeFileSync(path.join(userData, "User", "settings.json"), JSON.stringify({
  "workbench.startupEditor": "none", "telemetry.telemetryLevel": "off", "update.mode": "none", "extensions.autoUpdate": false,
  "window.restoreWindows": "none", "git.enabled": false, "chat.disableAIFeatures": true, "workbench.secondarySideBar.defaultVisibility": "hidden",
}));
const source = fs.readFileSync(path.join(workspace, "main.ts"), "utf8").split("\n");
const lineOf = (re) => source.findIndex((l) => re.test(l)) + 1;
const result = { fixture: FIXTURE, vscode: null, tff: process.env.TFF_DIR ? path.basename(process.env.TFF_DIR) : null, callHierarchy: {}, tff: {}, errors: [] };

const app = await electron.launch({
  executablePath: EXE,
  args: [workspace, `--user-data-dir=${userData}`, `--extensions-dir=${extDir}`, "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--new-window"],
  env: { ...process.env, VSCODE_SKIP_PRELAUNCH: "1" },
  timeout: 60_000,
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector(".monaco-workbench", { timeout: 60_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1700, height: 1000 }));
  result.vscode = await app.evaluate(({ app: a }) => a.getVersion());
  await sleep(2500);
  const palette = async (key, text, row) => {
    await page.keyboard.press(key);
    const input = page.locator(".quick-input-widget input.input");
    await input.waitFor({ state: "visible" });
    await input.fill(text);
    await page.locator(".quick-input-list .monaco-list-row", { hasText: row }).first().waitFor({ timeout: 20_000 });
    await sleep(300);
    await page.keyboard.press("Enter");
    await sleep(1000);
  };
  await palette("Control+P", "main.ts", "main.ts");
  await page.keyboard.press("Escape"); // notifications
  await sleep(6000); // TypeScript server start
  const goTo = async (line, word) => {
    const col = source[line - 1].indexOf(word) + 1;
    // Go to Line has no list rows: type the position and press Enter
    await page.keyboard.press("Control+G");
    const input = page.locator(".quick-input-widget input.input");
    await input.waitFor({ state: "visible" });
    await input.fill(`:${line}:${col}`);
    await sleep(300);
    await page.keyboard.press("Enter");
    await sleep(500);
    await page.locator(".monaco-editor .view-lines").first().waitFor();
  };
  const treeRows = async () => {
    // the References view (built-in references-view) holds the call hierarchy tree
    await sleep(2500);
    // only the visible side bar view (the References view after the command), with its title
    const title = (await page.locator(".sidebar .composite.title").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const headers = (await page.locator(".sidebar .pane-header:visible").allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, " ").trim());
    // expand the first level so each caller's call sites show
    const rows = page.locator(".sidebar .monaco-list-row:visible");
    const n = await rows.count();
    const out = [{ level: "title", text: `${title} | ${headers.join(" / ")}` }];
    for (let i = 0; i < n; i++) {
      const t = (await rows.nth(i).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const lvl = await rows.nth(i).getAttribute("aria-level").catch(() => null);
      if (t) out.push({ level: lvl, text: t });
    }
    return out;
  };
  const targets = [
    ["Method (method decorator factory)", lineOf(/^function Method\(/), "Method", "incoming"],
    ["ClassDeco (class decorator factory)", lineOf(/^function ClassDeco\(/), "ClassDeco", "incoming"],
    ["Param (parameter decorator factory)", lineOf(/^function Param\(/), "Param", "incoming"],
    ["Prop (property decorator factory)", lineOf(/^function Prop\(/), "Prop", "incoming"],
    ["PlainMethod (plain method decorator)", lineOf(/^function PlainMethod\(/), "PlainMethod", "incoming"],
    ["Sample.method", lineOf(/^\s+method\(/), "method", "outgoing"],
    ["class Sample", lineOf(/^export class Sample/), "Sample", "outgoing"],
  ];
  for (const [label, line, word, dir] of targets) {
    try {
      await goTo(line, word);
      // Shift+Alt+H: "Calls: Show Call Hierarchy" (references-view), which opens on incoming calls;
      // the view's toggle switches to outgoing calls.
      await page.locator(".monaco-editor .view-lines").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
      await goTo(line, word);
      await page.keyboard.press("Shift+Alt+H");
      await sleep(2500);
      if (dir === "outgoing") {
        const toggle = page.locator('.sidebar a.action-label[aria-label*="Outgoing"], .sidebar a.action-label[title*="Outgoing"]').first();
        if (await toggle.count()) await toggle.click();
        else result.errors.push({ label, error: "no outgoing toggle found" });
      }
      result.callHierarchy[`${dir} ${label}`] = await treeRows();
      await page.screenshot({ path: path.join(OUT, `ch-${dir}-${word}.png`) });
    } catch (e) {
      result.errors.push({ label, error: String(e).slice(0, 300) });
    }
  }
  await page.screenshot({ path: path.join(OUT, "call-hierarchy.png") });

  if (process.env.TFF_DIR) {
    for (const [label, line, word] of [["Sample.method", lineOf(/^\s+method\(/), "method"], ["Nested.run", lineOf(/^\s+run\(/), "run"]]) {
      try {
        await goTo(line, word);
        await palette("Control+Shift+P", ">Trace Function Flow: Trace Function Flow", "Trace Function Flow: Trace Function Flow");
        await sleep(1500);
        // a quick pick appears when the cursor is not on a function
        const qp = page.locator(".quick-input-widget:visible .quick-input-list .monaco-list-row", { hasText: new RegExp(`(^|[^A-Za-z])${word}\\(`) });
        if (await qp.count()) {
          await qp.first().click();
        }
        let graph = null;
        for (let i = 0; i < 40 && !graph; i++) {
          await sleep(500);
          for (const f of page.frames()) {
            const n = await f.locator(".react-flow__node").count().catch(() => 0);
            if (n) {
              graph = {
                nodes: await f.locator(".react-flow__node").allInnerTexts(),
                edges: await f.locator(".react-flow__edge").evaluateAll((es) => es.map((e) => e.getAttribute("data-testid") ?? e.getAttribute("aria-label") ?? "")),
              };
              break;
            }
          }
        }
        result.tff[label] = graph ? { nodes: graph.nodes.map((t) => t.replace(/\s+/g, " ").trim()), edges: graph.edges } : null;
        await page.screenshot({ path: path.join(OUT, `tff-${word}.png`) });
        await page.keyboard.press("Control+K");
        await page.keyboard.press("W"); // close editors (keeps the run independent)
        await sleep(800);
        await palette("Control+P", "main.ts", "main.ts");
        await sleep(1500);
      } catch (e) {
        result.errors.push({ label: `tff ${label}`, error: String(e).slice(0, 300) });
      }
    }
  }
} finally {
  fs.writeFileSync(path.join(OUT, "ui-result.json"), `${JSON.stringify(result, null, 1)}\n`);
  await app.close().catch(() => {});
}
console.log(JSON.stringify(result, null, 1));
