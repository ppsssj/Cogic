/**
 * P5 additional check: code edits during a paused debug session and the manual refresh paths.
 * Runs against a separate fixture copy (STUDY_WORKSPACE=fixture-edit). Edits stay unsaved and are
 * reverted with "File: Revert File"; the on-disk sources are hash-checked by the operator afterwards.
 * Verdicts are observations of rendered DOM + screenshots; nothing is injected into the webview.
 */
import { test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle, goToSymbol, waitCursorLine,
  toggleBreakpointAt, startDebuggingAndWaitPause, stopDebugging, runCommand, codeCliVersion, VSCodeSession,
} from "./lib/vscode";
import { openCogicPanel, waitGraphStable, fullSnapshot, readRuntimeFrame, humanClick } from "./lib/cogic";
import { Recorder } from "./lib/recorder";

const PROBE = "p5EditProbe";
interface Check { id: string; name: string; result: "pass" | "fail" | "observed"; detail: string; screenshot?: string }

test("P5 edit during debug + manual refresh", async () => {
  const rec = new Recorder("p5-edit-refresh");
  const checks: Check[] = [];
  const ev: Record<string, any> = {};
  const add = (c: Check) => { checks.push(c); rec.log(`CHECK ${c.id} ${c.name}: ${c.result} — ${c.detail}`); };
  const shot = () => rec.steps[rec.steps.length - 1]?.screenshot;
  const has = (s: unknown) => JSON.stringify(s).includes(PROBE);
  let s: VSCodeSession | undefined;
  try {
    s = (await rec.step("launch", () => launchVSCode({ profile: "p5-edit", extensions: ["cogic"] })))!;
    rec.attach(s.page);
    const { page } = s;
    rec.meta = { vscode: codeCliVersion(), extensions: s.extensionVersions };
    await rec.step("setup", async () => {
      await quickOpenFile(page, "src/receipt.ts");
      await waitTsReady(page); await waitTsServerIdle(page);
      await toggleBreakpointAt(page, 5);
      await quickOpenFile(page, "src/demo.ts");
      await goToSymbol(page, "runDemo"); await waitCursorLine(page, 26);
    });
    const f = await openCogicPanel(page);
    await rec.step("generate-depth1", async () => {
      await f.locator('select[aria-label="Graph depth"]').selectOption("1");
      await humanClick(f.locator("button", { hasText: /^\s*Generate\s*$/ }).first());
      await waitGraphStable(f, { minNodes: 3 });
      ev.s0 = await fullSnapshot(f);
    });
    await rec.step("F5-pause", async () => {
      await startDebuggingAndWaitPause(page); await page.waitForTimeout(3000);
      ev.rt0 = await readRuntimeFrame(f);
    });
    await rec.step("edit-demo-ts-while-paused", async () => {
      await page.keyboard.press("Control+1");
      await quickOpenFile(page, "src/demo.ts");
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type(`export function ${PROBE}(): string { return runDemo(); }`, { delay: 15 });
      await page.waitForTimeout(3000); // > 350 ms auto-analysis debounce
      ev.s1 = await fullSnapshot(f);
    });
    add({ id: "E1", name: "edit while paused does not auto-replace the graph (P4 policy)", result: !has(ev.s1) && ev.s1.nodes.length === ev.s0.nodes.length ? "pass" : "fail",
      detail: `probe in graph=${has(ev.s1)}; nodes ${ev.s0.nodes.length}->${ev.s1.nodes.length}`, screenshot: shot() });
    await rec.step("topbar-refresh", async () => {
      await humanClick(f.locator('button[title="Refresh (active file)"]').first());
      await page.waitForTimeout(3000);
      ev.s2 = await fullSnapshot(f);
      ev.snapshotPanel = (await f.locator("text=" + PROBE).count()) > 0;
    });
    add({ id: "E2", name: "topbar Refresh (active file) effect on graph", result: "observed",
      detail: `probe in graph after Refresh=${has(ev.s2)}; probe text anywhere in webview=${ev.snapshotPanel}`, screenshot: shot() });
    await rec.step("generate-while-paused", async () => {
      await humanClick(f.locator("button", { hasText: /^\s*Generate\s*$/ }).first());
      await page.waitForTimeout(1500);
      await waitGraphStable(f, { minNodes: 3 });
      ev.s3 = await fullSnapshot(f);
      ev.rt3 = await readRuntimeFrame(f);
    });
    add({ id: "E3", name: "manual Generate while paused reflects the unsaved edit", result: has(ev.s3) ? "pass" : "fail",
      detail: `probe in graph=${has(ev.s3)}; nodes=${ev.s3.nodes.length}; runtime mode after="${ev.rt3.mode}" frame=${ev.rt3.frame}`, screenshot: shot() });
    add({ id: "E4", name: "runtime frame still mapped after manual Generate", result: /Matched by/.test(ev.rt3.mode) ? "pass" : "fail",
      detail: `before="${ev.rt0.mode}" ${ev.rt0.frame}; after="${ev.rt3.mode}" ${ev.rt3.frame}` });
    await rec.step("stop-debugging", async () => {
      await stopDebugging(page); await page.waitForTimeout(4000);
      ev.s4 = await fullSnapshot(f);
    });
    add({ id: "E5", name: "graph after stopping debugging", result: "observed", detail: `probe in graph=${has(ev.s4)}; nodes=${ev.s4.nodes.length}`, screenshot: shot() });
    await rec.step("revert-edit", async () => {
      await page.keyboard.press("Control+1");
      await quickOpenFile(page, "src/demo.ts");
      await runCommand(page, "File: Revert File");
      await page.waitForTimeout(1000);
    });
  } finally {
    fs.writeFileSync(path.join(rec.dir, "evidence.json"), JSON.stringify(ev, null, 2));
    fs.writeFileSync(path.join(rec.dir, "checks.json"), JSON.stringify({ checks }, null, 2));
    rec.flush();
    await closeVSCode(s);
  }
});
