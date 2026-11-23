// Run in a disposable copy of the P13 Playwright harness; see reproduction.md.
import { test, expect, _electron as electron, Frame } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { quickOpenFile, waitTsReady, waitTsServerIdle, waitSourceEditor, sourceEditorState } from "./lib/vscode";
import { openCogicPanel, fitGraph, waitGraphStable } from "./lib/cogic";

test("P14-B VS Code UI calls and navigation", async () => {
  const workspace = process.env.STUDY_WORKSPACE!, code = process.env.VSCODE_EXE!, extension = process.env.P14_EXTENSION_ROOT!, profile = process.env.P14_UI_PROFILE!;
  if (!workspace || !code || !extension || !profile) throw Error("Missing isolated smoke environment");
  if (fs.existsSync(profile)) throw Error("P14_UI_PROFILE must be a new, unused directory");
  fs.mkdirSync(path.join(profile, "user", "User"), { recursive: true });
  fs.mkdirSync(path.join(profile, "extensions"), { recursive: true });
  fs.writeFileSync(path.join(profile, "user", "User", "settings.json"), JSON.stringify({ "workbench.startupEditor": "none", "security.workspace.trust.enabled": false, "update.mode": "none", "telemetry.telemetryLevel": "off" }));
  const app = await electron.launch({ executablePath: code, args: [workspace, `--extensionDevelopmentPath=${extension}`, `--user-data-dir=${path.join(profile, "user")}`, `--extensions-dir=${path.join(profile, "extensions")}`, "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry", "--new-window"], timeout: 60_000 });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".monaco-workbench", { timeout: 60_000 });
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); w.setBounds({ x: 0, y: 0, width: 1600, height: 960 }); });
    await quickOpenFile(page, "src/main.ts"); await waitTsReady(page); await waitTsServerIdle(page);
    const f: Frame = await openCogicPanel(page);
    await f.locator('select[aria-label="Graph depth"]').selectOption("2");
    await f.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
    await waitGraphStable(f, { minNodes: 2, quietMs: 3000, timeout: 120_000 });
    for (let i = 0; i < 5; i++) {
      await fitGraph(f);
      const folder = f.locator('.react-flow__node-folderGroup button[title="Expand folder group"]').first();
      if (!(await folder.count())) break;
      await folder.click({ delay: 80 }); await page.waitForTimeout(700);
    }
    for (const file of ["main.ts", "target.ts"]) {
      await fitGraph(f);
      const group = f.locator(".react-flow__node-fileGroup", { has: f.locator(".cgGroupTitle", { hasText: file }) }).first();
      if (await group.count()) {
        const button = group.locator('button[title="Select and expand file group"]').first();
        if (await button.count()) { await button.click({ delay: 80 }); await page.waitForTimeout(700); }
      }
    }
    await fitGraph(f); await page.waitForTimeout(1000);
    const visible = await f.evaluate(() => ({
      members: [...document.querySelectorAll(".cgChildNode")].map(n => ({ text: (n.textContent ?? "").replace(/\s+/g, " ").trim(), parent: n.closest(".react-flow__node")?.getAttribute("data-id") ?? "" })),
      nodes: [...document.querySelectorAll(".react-flow__node")].map(n => ({ id: n.getAttribute("data-id") ?? "", text: (n.querySelector(".cgNodeTitle")?.textContent ?? "").trim() })),
      edges: [...document.querySelectorAll(".react-flow__edge")].map(n => {
        const p = n.querySelector(".react-flow__edge-path")?.getBoundingClientRect();
        return { id: (n.getAttribute("data-testid") ?? "").replace(/^rf__edge-/, ""), width: p?.width ?? 0, height: p?.height ?? 0 };
      }),
    }));
    const row = (name: string) => visible.members.find(x => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(x.text));
    expect(row("request"), "request member visible").toBeTruthy();
    expect(row("fetch"), "typed fetch member visible").toBeTruthy();
    expect(row("#dispatch"), "private member visible").toBeTruthy();
    const source = fs.readFileSync(path.join(workspace, "src", "main.ts"), "utf8");
    const offsets = { request: source.indexOf("(value: number) => this.fetch"), fetch: source.indexOf("(value) => this.#dispatch"), dispatch: source.indexOf("#dispatch(value: number)") };
    const edge = (kind: string, from: number, to: number) => visible.edges.some(e => e.id.startsWith(`${kind}:`) && e.id.includes(`:${from}->method:`) && e.id.includes(`:${to}@@`) && e.width > 1 && e.height > 1);
    expect(edge("calls", offsets.request, offsets.fetch), "visible request -> fetch calls edge").toBeTruthy();
    expect(edge("calls", offsets.fetch, offsets.dispatch), "visible fetch -> #dispatch calls edge").toBeTruthy();
    expect(edge("dataflow", offsets.request, offsets.fetch), "visible request -> fetch dataflow").toBeTruthy();
    expect(edge("dataflow", offsets.fetch, offsets.dispatch), "visible fetch -> #dispatch dataflow").toBeTruthy();
    expect(visible.edges.some(e => e.id.startsWith("calls:") && e.id.includes(`:${offsets.dispatch}->external:`) && e.id.includes("/target.ts:0@@") && e.width > 1 && e.height > 1), "visible #dispatch -> finish calls edge").toBeTruthy();
    const recursive = source.indexOf("recursive(value: number)");
    expect(edge("calls", recursive, recursive), "true self-loop remains hidden").toBeFalsy();
    await page.screenshot({ path: path.join(profile, "graph.png") });
    const mainGroup = f.locator(".react-flow__node-fileGroup", { has: f.locator(".cgGroupTitle", { hasText: "main.ts" }) }).first();
    await mainGroup.locator('button[title="Select and collapse file group"]').click({ delay: 80 }); await page.waitForTimeout(800);
    expect(await f.locator(".cgChildNode").filter({ hasText: /^\s*request\b/ }).count(), "collapsed group hides member rows").toBe(0);
    await mainGroup.locator('button[title="Select and expand file group"]').click({ delay: 80 }); await page.waitForTimeout(800); await fitGraph(f);
    const target = f.locator(".react-flow__node .cgNode, .cgChildNode").filter({ hasText: /^\s*finish\b/ }).first();
    await expect(target).toBeVisible(); await target.click({ clickCount: 2, delay: 80 }); await waitSourceEditor(page, "target.ts", undefined, 20_000);
    const opened = await sourceEditorState(page); await fitGraph(f);
    const request = f.locator(".cgChildNode").filter({ hasText: /^\s*request\b/ }).first();
    await expect(request).toBeVisible(); await request.click({ clickCount: 2, delay: 80 }); await waitSourceEditor(page, "main.ts", undefined, 20_000);
    const returned = await sourceEditorState(page);
    expect(opened?.file).toBe("target.ts"); expect(returned?.file).toBe("main.ts");
    console.log(JSON.stringify({ nodesVisible: ["request", "fetch", "#dispatch"], callsVisible: ["request->fetch", "fetch->#dispatch", "#dispatch->finish"], opened: opened?.file, returned: returned?.file }));
  } finally { await app.close(); }
});
