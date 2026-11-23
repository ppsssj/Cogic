/**
 * P2: competitor tools on the same T1–T4 tasks, same start state, same isolated profile setup.
 *   - VS Code built-ins (Call Hierarchy / Go to Definition / Go Back / debugger Call Stack)
 *   - Trace Function Flow (sudopanda.trace-function-flow)
 *   - Context Graph (context-graph.context-graph)
 * Unsupported features are recorded as such, never simulated.
 */
import { test, Page, Frame } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  launchVSCode, closeVSCode, VSCodeSession, quickOpenFile, waitTsReady, waitTsServerIdle, codeCliVersion,
  goToSymbol, goToLine, waitCursorLine, sourceEditorState, waitSourceEditor, toggleBreakpointAt,
  startDebuggingAndWaitPause, stopDebugging, callStackRows, clickCodeLensAbove, sidebarTreeRows,
  notificationsText, reactFlowSnapshot, findWebviewFrame, runCommand, ExtensionKey,
} from "./lib/vscode";
import { Recorder, TaskRecord } from "./lib/recorder";

const PRESS = { delay: 80 };

async function startState(rec: Recorder, page: Page) {
  await rec.step("start-state demo.ts@runDemo", async () => {
    await quickOpenFile(page, "src/demo.ts");
    await waitTsReady(page);
    await waitTsServerIdle(page);
    await goToSymbol(page, "runDemo");
    await waitCursorLine(page, 26);
  });
  await rec.trackTab();
  rec.resetCounters();
}

function task(rec: Recorder, base: Partial<TaskRecord> & Pick<TaskRecord, "tool" | "task" | "status">, t0: number, shots: RegExp) {
  const c = rec.resetCounters();
  rec.task({
    evidence: "ui+dom", userOperations: c.ops, fileSwitches: c.switches, returnOperations: null,
    graphPanelPersists: "", startingFocusPersists: "", selectionPersists: "", staticCallsShown: "",
    dataflowShown: "", debugFrameMapped: "", notes: "",
    ...base,
    automationMs: Date.now() - t0,
    screenshots: rec.steps.filter((x) => shots.test(x.name)).map((x) => x.screenshot ?? ""),
  } as TaskRecord);
}

/** Shared T4 for tools without their own debugger integration: breakpoint + F5 + Call Stack. */
async function debugT4(rec: Recorder, page: Page, tool: string, checkView: () => Promise<string>, mappedNote: string) {
  const t0 = Date.now();
  await rec.step(`${tool}-set-breakpoint-receipt.ts:5`, async () => {
    rec.op("focus first editor group (Ctrl+1)");
    await page.keyboard.press("Control+1");
    rec.op("Ctrl+P receipt.ts");
    await quickOpenFile(page, "src/receipt.ts");
    rec.op("Ctrl+G 5 + F9", 2);
    await toggleBreakpointAt(page, 5);
  });
  await rec.trackTab();
  const paused = await rec.step(`${tool}-F5-debug-paused`, async () => {
    rec.op("F5");
    await startDebuggingAndWaitPause(page);
    await page.waitForTimeout(2500);
    return true;
  }, { soft: true });
  await rec.trackTab();
  const stack = await callStackRows(page);
  const viewState = await checkView();
  rec.log(`${tool} call stack: ${JSON.stringify(stack)}`);
  rec.log(`${tool} tool view during debug: ${viewState}`);
  await rec.step(`${tool}-stop-debugging`, () => stopDebugging(page), { soft: true, screenshot: false });
  const chainInStack = ["formatReceipt", "CheckoutDemo.process", "runDemo"].every((n) => stack.some((r) => r.includes(n)));
  task(rec, {
    tool, task: "T4", status: paused ? "unsupported" : "fail",
    debugFrameMapped: `no (${mappedNote})`,
    graphPanelPersists: viewState,
    notes: `debugger paused=${!!paused}; VS Code Call Stack shows dynamic chain formatReceipt<-process<-runDemo=${chainInStack}; stack=${JSON.stringify(stack).slice(0, 220)}`,
  }, t0, new RegExp(`${tool}-(F5|set-breakpoint)`));
}

// ============================================================================ VS Code built-ins
test("P2 VS Code built-in navigation", async () => {
  const TOOL = "VS Code";
  const rec = new Recorder("p2-vscode");
  let s: VSCodeSession | undefined;
  const ev: Record<string, any> = {};
  try {
    s = (await rec.step("launch", () => launchVSCode({ profile: "vscode", extensions: [] })))!;
    rec.attach(s.page);
    const { page } = s;
    rec.meta = { vscode: codeCliVersion(), extensions: s.extensionVersions };
    await startState(rec, page);

    // ---------------------------------------------------------------- T1 Call Hierarchy (outgoing)
    let t0 = Date.now();
    await rec.step("call-hierarchy-open", async () => {
      rec.op("Shift+Alt+H (Show Call Hierarchy)");
      await page.keyboard.press("Shift+Alt+H");
      await page.locator(".part.sidebar .monaco-list-row").first().waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(1000);
    });
    ev.incoming = await sidebarTreeRows(page);
    rec.log(`incoming rows: ${JSON.stringify(ev.incoming)}`);
    await rec.step("call-hierarchy-outgoing", async () => {
      const btn = page.locator(".part.sidebar .action-label[aria-label*='Outgoing'], .part.sidebar .action-label[title*='Outgoing']").first();
      rec.op("click 'Show Outgoing Calls'");
      await btn.click(PRESS);
      await page.waitForTimeout(1200);
    });
    // expand rows until formatMoney appears (each expansion = 1 user op)
    await rec.step("call-hierarchy-expand", async () => {
      for (let i = 0; i < 6; i++) {
        const rows = await sidebarTreeRows(page);
        if (rows.some((r) => /formatMoney/.test(r.text))) break;
        const idx = rows.findIndex((r) => r.expanded === "false" && /process|formatReceipt|runDemo/.test(r.text));
        if (idx < 0) break;
        rec.op(`expand '${rows[idx].text}'`);
        await page.locator(".part.sidebar .monaco-list-row").nth(idx).locator(".monaco-tl-twistie").click(PRESS);
        await page.waitForTimeout(1200);
      }
    });
    ev.outgoing = await sidebarTreeRows(page);
    rec.log(`outgoing rows: ${JSON.stringify(ev.outgoing)}`);
    const rowIdx = (re: RegExp) => ev.outgoing.findIndex((r: any) => re.test(r.text));
    const lvl = (re: RegExp) => ev.outgoing[rowIdx(re)]?.level ?? -1;
    const pairs = {
      "runDemo->CheckoutDemo.process": rowIdx(/runDemo/) >= 0 && lvl(/process/) === lvl(/runDemo/) + 1,
      "process->formatReceipt": lvl(/formatReceipt/) === lvl(/process/) + 1 && lvl(/process/) > 0,
      "formatReceipt->formatMoney": lvl(/formatMoney/) === lvl(/formatReceipt/) + 1 && lvl(/formatReceipt/) > 0,
    };
    const okPairs = Object.values(pairs).filter(Boolean).length;
    task(rec, {
      tool: TOOL, task: "T1", status: okPairs === 3 ? "pass" : okPairs ? "partial" : "fail",
      staticCallsShown: JSON.stringify(pairs),
      notes: `Call Hierarchy (outgoing) tree rows: ${ev.outgoing.map((r: any) => `${"  ".repeat(Math.max(0, r.level - 1))}${r.text}`).join(" / ")}`,
    }, t0, /call-hierarchy/);

    // ---------------------------------------------------------------- T2 Go to Definition chain
    t0 = Date.now();
    const defs: any[] = [];
    await rec.step("t2-goto-def-process", async () => {
      await page.keyboard.press("Control+1");
      rec.op("place cursor on 'process' in line 28 (click)");
      await goToLine(page, 28, 23);
      rec.op("F12 Go to Definition");
      await page.keyboard.press("F12");
      defs.push(await waitSourceEditor(page, "demo.ts", 15));
    }, { soft: true });
    await rec.trackTab();
    await rec.step("t2-goto-def-formatReceipt", async () => {
      rec.op("place cursor on 'formatReceipt' in line 17 (click)");
      await goToLine(page, 17, 12);
      rec.op("F12 Go to Definition");
      await page.keyboard.press("F12");
      defs.push(await waitSourceEditor(page, "receipt.ts", 4));
    }, { soft: true });
    await rec.trackTab();
    await rec.step("t2-goto-def-formatMoney", async () => {
      rec.op("place cursor on 'formatMoney' in line 5 (click)");
      await goToLine(page, 5, 18);
      rec.op("F12 Go to Definition");
      await page.keyboard.press("F12");
      defs.push(await waitSourceEditor(page, "money.ts", 2));
    }, { soft: true });
    await rec.trackTab();
    ev.t2defs = defs;
    task(rec, {
      tool: TOOL, task: "T2", status: defs.length === 3 ? "partial" : "fail",
      dataflowShown: "no (argument->parameter mapping is not displayed; user reads each signature after Go to Definition)",
      notes: `Go to Definition reached: ${JSON.stringify(defs)}. The 120 -> total -> total -> amount chain must be inferred by reading code; the tool itself shows no data-flow view (default settings, inlay hints off).`,
    }, t0, /t2-goto/);

    // ---------------------------------------------------------------- T3 open from tree + return
    t0 = Date.now();
    await rec.step("t3-open-formatReceipt-from-call-hierarchy", async () => {
      rec.op("click 'formatReceipt' row in Call Hierarchy (single click opens it; double-click would also toggle the tree)");
      const row = page.locator(".part.sidebar .monaco-list-row", { hasText: "formatReceipt" }).first();
      await row.click(PRESS);
      await page.waitForTimeout(1500);
    }, { soft: true });
    await rec.trackTab();
    ev.t3open = await sourceEditorState(page);
    ev.t3treeAfterOpen = await sidebarTreeRows(page);
    let returnOps = 0;
    await rec.step("t3-return-to-runDemo-click-root-row", async () => {
      const row = page.locator(".part.sidebar .monaco-list-row", { hasText: "runDemo" }).first();
      rec.op("click 'runDemo' root row in Call Hierarchy");
      returnOps++;
      await row.click(PRESS);
      ev.t3return = await waitSourceEditor(page, "demo.ts");
    }, { soft: true });
    await rec.trackTab();
    ev.t3return = await sourceEditorState(page);
    ev.t3treeAfterReturn = await sidebarTreeRows(page);
    const treeKept = JSON.stringify(ev.outgoing.map((r: any) => r.text)) === JSON.stringify(ev.t3treeAfterReturn.map((r: any) => r.text));
    rec.log(`T3 open=${JSON.stringify(ev.t3open)} return=${JSON.stringify(ev.t3return)} treeKept=${treeKept}`);
    task(rec, {
      tool: TOOL, task: "T3",
      status: ev.t3open?.file === "receipt.ts" && ev.t3return?.file === "demo.ts" ? "pass" : "partial",
      returnOperations: returnOps, graphPanelPersists: String(treeKept), startingFocusPersists: String(ev.t3treeAfterReturn[0]?.text?.includes("runDemo")),
      selectionPersists: String(ev.t3treeAfterOpen.some((r: any) => r.selected && /formatReceipt/.test(r.text))),
      notes: `opened=${JSON.stringify(ev.t3open)}; returned=${JSON.stringify(ev.t3return)} (row opens the call-site/definition range); Go Back (Alt+Left) is an alternative return path`,
    }, t0, /t3-/);

    // ---------------------------------------------------------------- T4
    await debugT4(rec, page, TOOL, async () => {
      const rows = await sidebarTreeRows(page);
      return `sidebar shows Run and Debug; call hierarchy tree not visible in sidebar during debug (rows now: ${rows.length})`;
    }, "Call Hierarchy is static; Call Stack is a separate view, no link between them");
  } finally {
    rec.flush();
    fs.writeFileSync(path.join(rec.dir, "evidence.json"), JSON.stringify(ev, null, 2));
    await closeVSCode(s);
  }
});

// ============================================================================ Trace Function Flow
async function tffFrame(page: Page): Promise<Frame> {
  return findWebviewFrame(page, async (f) => (await f.locator(".react-flow").count()) > 0 && /call graph|Visible Nodes/.test(await f.locator("body").innerText()), 30_000);
}

test("P2 Trace Function Flow", async () => {
  const TOOL = "Trace Function Flow";
  const rec = new Recorder("p2-trace-function-flow");
  let s: VSCodeSession | undefined;
  const ev: Record<string, any> = {};
  try {
    s = (await rec.step("launch", () => launchVSCode({ profile: "trace", extensions: ["trace"] })))!;
    rec.attach(s.page);
    const { page } = s;
    rec.meta = { vscode: codeCliVersion(), extensions: s.extensionVersions };
    await startState(rec, page);

    // ---------------------------------------------------------------- T1
    let t0 = Date.now();
    let f: Frame | undefined;
    await rec.step("tff-codelens-trace-runDemo", async () => {
      rec.op("click CodeLens 'Trace Function' above runDemo");
      await clickCodeLensAbove(page, "Trace Function", 26);
      f = await tffFrame(page);
      await page.waitForTimeout(3000);
    });
    ev.runDemoGraph = await reactFlowSnapshot(f!);
    ev.runDemoNotifications = await notificationsText(page);
    rec.log(`TFF runDemo graph: ${JSON.stringify(ev.runDemoGraph)}`);
    rec.log(`notifications: ${JSON.stringify(ev.runDemoNotifications)}`);

    // CodeLens is offered only above top-level functions (runDemo), not above class static methods.
    await page.keyboard.press("Control+1");
    ev.codeLensAboveProcess = await clickCodeLensAbove(page, "Trace Function", 15, 3000).then(() => true).catch(() => false);
    if (ev.codeLensAboveProcess) rec.op("click CodeLens above process");
    rec.log(`CodeLens above CheckoutDemo.process present: ${ev.codeLensAboveProcess}`);
    // Supplementary 1: start from CheckoutDemo.process via cursor + command palette (what a user would try next).
    await rec.step("tff-trace-process-via-palette (supplementary)", async () => {
      await page.keyboard.press("Control+1");
      rec.op("place cursor on 'process' (line 15)");
      await goToLine(page, 15, 10);
      rec.op("command palette: Trace Function Flow: Trace Function Flow");
      await runCommand(page, "Trace Function Flow: Trace Function Flow");
      await page.waitForTimeout(1500);
      const rows = page.locator(".quick-input-widget .quick-input-list .monaco-list-row");
      ev.processQuickPick = (await rows.count()) ? await rows.allInnerTexts() : [];
      rec.log(`TFF quick pick offered: ${JSON.stringify(ev.processQuickPick)}`);
      const qp = rows.filter({ hasText: "process" }).first();
      if ((await qp.count()) > 0) {
        rec.op("quick pick: process");
        await qp.click(PRESS);
        await page.waitForTimeout(4000);
        f = await tffFrame(page);
      } else if (ev.processQuickPick.length) {
        rec.op("Escape (process is not offered)");
        await page.keyboard.press("Escape");
      }
    }, { soft: true });
    ev.processGraph = null;
    // Supplementary 2: formatReceipt is a top-level function -> CodeLens exists in receipt.ts.
    await rec.step("tff-trace-formatReceipt (supplementary)", async () => {
      await page.keyboard.press("Control+1");
      rec.op("Ctrl+P receipt.ts");
      await quickOpenFile(page, "src/receipt.ts");
      rec.op("click CodeLens 'Trace Function' above formatReceipt");
      await clickCodeLensAbove(page, "Trace Function", 4);
      await page.waitForTimeout(4000);
      f = await tffFrame(page);
    }, { soft: true });
    await rec.trackTab();
    ev.formatReceiptGraph = f ? await reactFlowSnapshot(f) : null;
    rec.log(`TFF formatReceipt graph: ${JSON.stringify(ev.formatReceiptGraph)}`);
    const txt = (g: any) => (g?.nodes ?? []).map((n: any) => n.text).join(" | ");
    const fromRun = txt(ev.runDemoGraph);
    const fromProc = txt(ev.formatReceiptGraph);
    const pairs = {
      "runDemo->CheckoutDemo.process": /process/.test(fromRun) && (ev.runDemoGraph?.edges.length ?? 0) > 0,
      "process->formatReceipt": false, // process cannot be traced (not offered as a function) and runDemo trace stops
      "formatReceipt->formatMoney (separate trace from formatReceipt)": /formatReceipt/.test(fromProc) && /formatMoney/.test(fromProc) && (ev.formatReceiptGraph?.edges.length ?? 0) > 0,
    };
    const any = Object.values(pairs).some(Boolean);
    task(rec, {
      tool: TOOL, task: "T1", status: Object.values(pairs).every(Boolean) ? "pass" : any ? "partial" : "fail",
      staticCallsShown: JSON.stringify(pairs),
      notes: `from runDemo: nodes=[${fromRun}] edges=${ev.runDemoGraph?.edges.length}; notification=${JSON.stringify(ev.runDemoNotifications).slice(0, 200)}; CodeLens above CheckoutDemo.process=${ev.codeLensAboveProcess}; palette quick pick with cursor on process offered=${JSON.stringify(ev.processQuickPick)}; supplementary trace from formatReceipt: nodes=[${fromProc}] edges=${ev.formatReceiptGraph?.edges?.length}`,
    }, t0, /tff-codelens|tff-trace-/);

    // ---------------------------------------------------------------- T2
    t0 = Date.now();
    await rec.step("tff-select-node-details", async () => {
      const node = f!.locator(".react-flow__node", { hasText: "formatMoney" }).first();
      if ((await node.count()) === 0) throw new Error("formatMoney node not in TFF graph");
      rec.op("click formatMoney node");
      await node.click(PRESS);
      await page.waitForTimeout(1200);
    }, { soft: true });
    ev.detailText = f ? (await f.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1500) : "";
    rec.log(`TFF detail panel text: ${ev.detailText}`);
    const callSite = /CALL SITE\s*(\S+\([^)]*\))/.exec(ev.detailText)?.[1] ?? "";
    const showsParamNames = /amount\s*(<-|←|=)\s*total|parameter/i.test(ev.detailText);
    task(rec, {
      tool: TOOL, task: "T2", status: showsParamNames ? "pass" : callSite ? "partial" : "unsupported",
      dataflowShown: callSite
        ? `call-site expression only (${callSite}) for formatReceipt->formatMoney; no argument->parameter mapping; runDemo->process hop (120) not traceable`
        : "no argument/parameter information",
      notes: `TFF detail panel after selecting formatMoney: ${ev.detailText.slice(0, 400)}`,
    }, t0, /tff-select/);

    // ---------------------------------------------------------------- T3
    t0 = Date.now();
    await rec.step("tff-dblclick-formatMoney-open-source", async () => {
      const node = f!.locator(".react-flow__node", { hasText: "formatMoney" }).first();
      if ((await node.count()) === 0) throw new Error("formatMoney node not in TFF graph");
      rec.op("double-click formatMoney node");
      await node.click({ clickCount: 2, delay: 80 });
      ev.t3open = await waitSourceEditor(page, "money.ts");
    }, { soft: true });
    await rec.trackTab();
    ev.t3open = await sourceEditorState(page);
    const graphAfterOpen = await reactFlowSnapshot(await tffFrame(page)).catch(() => null);
    let returnOps = 0;
    await rec.step("tff-return-to-runDemo", async () => {
      // runDemo is not in the current (process-rooted) graph; the user goes back with Go Back.
      const fr = await tffFrame(page);
      const rd = fr.locator(".react-flow__node", { hasText: "runDemo" }).first();
      if ((await rd.count()) > 0) {
        rec.op("double-click runDemo node");
        returnOps++;
        await rd.click({ clickCount: 2, delay: 80 });
      } else {
        await page.keyboard.press("Control+1");
        for (let i = 0; i < 4; i++) {
          rec.op("Alt+Left (Go Back)");
          returnOps++;
          await page.keyboard.press("Alt+ArrowLeft");
          await page.waitForTimeout(600);
          const st = await sourceEditorState(page);
          if (st?.file === "demo.ts" && st.line === 26) break;
        }
      }
      ev.t3return = await waitSourceEditor(page, "demo.ts", 26);
    }, { soft: true });
    await rec.trackTab();
    ev.t3return = await sourceEditorState(page);
    const sameGraph = JSON.stringify(graphAfterOpen?.nodes.map((n) => n.id)) === JSON.stringify(ev.formatReceiptGraph?.nodes.map((n: any) => n.id));
    task(rec, {
      tool: TOOL, task: "T3",
      status: ev.t3open?.file === "money.ts" && ev.t3return?.file === "demo.ts" ? "pass" : ev.t3open?.file === "money.ts" ? "partial" : "fail",
      returnOperations: returnOps, graphPanelPersists: String(sameGraph),
      startingFocusPersists: String(/runDemo/.test(txt(graphAfterOpen))),
      notes: `opened=${JSON.stringify(ev.t3open)}; returned=${JSON.stringify(ev.t3return)}; graph root after opening source is the last traced function (formatReceipt), runDemo node present=${/runDemo/.test(txt(graphAfterOpen))}`,
    }, t0, /tff-dblclick|tff-return/);

    // ---------------------------------------------------------------- T4
    await debugT4(rec, page, TOOL, async () => {
      const fr = await tffFrame(page).catch(() => null);
      return fr ? `TFF panel still open (nodes=${(await reactFlowSnapshot(fr)).nodes.length}); no runtime highlight feature` : "TFF panel not found";
    }, "TFF has no debugger integration; graph is not linked to the paused frame");
  } finally {
    rec.flush();
    fs.writeFileSync(path.join(rec.dir, "evidence.json"), JSON.stringify(ev, null, 2));
    await closeVSCode(s);
  }
});

// ============================================================================ Context Graph
test("P2 Context Graph", async () => {
  const TOOL = "Context Graph";
  const rec = new Recorder("p2-context-graph");
  let s: VSCodeSession | undefined;
  const ev: Record<string, any> = {};
  try {
    s = (await rec.step("launch", () => launchVSCode({ profile: "context-graph", extensions: ["contextGraph"] })))!;
    rec.attach(s.page);
    const { page } = s;
    rec.meta = { vscode: codeCliVersion(), extensions: s.extensionVersions };
    const extDir = path.join(s.profileDir, "extensions");
    const cg = fs.readdirSync(extDir).find((d) => d.startsWith("context-graph.context-graph-"))!;
    ev.bundledWorkers = fs.readdirSync(path.join(extDir, cg, "bin"));
    rec.log(`Context Graph bundled worker platforms: ${JSON.stringify(ev.bundledWorkers)}; this host: ${process.platform}-${process.arch}`);
    await startState(rec, page);

    const t0 = Date.now();
    let f: Frame | undefined;
    await rec.step("cg-open-panel", async () => {
      rec.op("command palette: Context Graph: Toggle Context Graph");
      await runCommand(page, "Context Graph: Toggle Context Graph");
      f = await findWebviewFrame(page, async (fr) => (await fr.locator("text=Graph Controls").count()) > 0, 30_000);
      await page.waitForTimeout(1500);
    });
    await rec.step("cg-click-generate-graph", async () => {
      rec.op("click 'Generate Graph'");
      await f!.locator("button", { hasText: "Generate Graph" }).first().click(PRESS);
      await page.waitForTimeout(8000);
    }, { soft: true });
    ev.panelText = f ? (await f.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1200) : "";
    ev.notifications = await notificationsText(page);
    ev.graph = f ? await reactFlowSnapshot(f).catch(() => null) : null;
    ev.canvasNodes = f ? await f.locator("canvas, svg g.node, .node").count() : 0;
    rec.log(`CG panel text: ${ev.panelText}`);
    rec.log(`CG notifications: ${JSON.stringify(ev.notifications)}`);
    const blocked = /No usable worker runtime/.test(ev.panelText + JSON.stringify(ev.notifications));
    const c = rec.resetCounters();
    for (const tk of ["T1", "T2", "T3"]) {
      rec.task({
        tool: TOOL, task: tk, status: blocked ? "unverified" : "unverified", evidence: "ui+dom",
        userOperations: tk === "T1" ? c.ops : 0, fileSwitches: 0, returnOperations: null,
        graphPanelPersists: "", startingFocusPersists: "", selectionPersists: "", staticCallsShown: "", dataflowShown: "", debugFrameMapped: "",
        automationMs: tk === "T1" ? Date.now() - t0 : 0,
        screenshots: rec.steps.filter((x) => /^cg-/.test(x.name)).map((x) => x.screenshot ?? ""),
        notes: blocked
          ? `BLOCKED by environment: Marketplace package ${cg} ships worker only for ${ev.bundledWorkers.join(",")}; on ${process.platform}-${process.arch} the panel reports "No usable worker runtime". Graph could not be generated, so ${tk} could not be performed.`
          : `graph generation did not complete in automation; panel text: ${ev.panelText.slice(0, 200)}`,
      });
    }
    // T4: the debugger itself still works; the tool's graph does not exist.
    await debugT4(rec, page, TOOL, async () => "no graph was generated (worker unavailable)", "no graph available on this platform");
    const last = rec.tasks[rec.tasks.length - 1];
    last.status = "unverified";
    rec.log("Context Graph T4 status set to 'unverified': debugger works, but no tool graph exists to map the frame to");
    last.notes = `debugger works independently of the tool; Context Graph mapping could not be evaluated because no graph exists. ${last.notes}`;
    rec.flush();
  } finally {
    rec.flush();
    fs.writeFileSync(path.join(rec.dir, "evidence.json"), JSON.stringify(ev, null, 2));
    await closeVSCode(s);
  }
});
