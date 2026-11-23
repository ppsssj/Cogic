/**
 * P1: Cogic E2E through the real VS Code UI.
 *  Generate (All + Depth 1) -> Depth 2 -> expand file groups -> select node -> open source
 *  (double-click) -> root-lock persistence while another file is active -> return -> Runtime Debug.
 *
 * Evidence level "ui+dom": every action is a real UI input (keyboard/mouse into the workbench or
 * the webview); results are read from the rendered DOM (React Flow nodes/edges, Inspector text,
 * Monaco active line) and screenshots. No Cogic internal API or message injection is used.
 */
import { test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Frame } from "@playwright/test";
import {
  launchVSCode, closeVSCode, VSCodeSession, quickOpenFile, waitTsReady, waitTsServerIdle,
  codeCliVersion, sourceEditorState, waitSourceEditor, goToSymbol, waitCursorLine,
  toggleBreakpointAt, startDebuggingAndWaitPause, stopDebugging, callStackRows,
} from "./lib/vscode";
import { Recorder } from "./lib/recorder";
import {
  openCogicPanel, cogicFrame, snapshot, waitGraphStable, inspectorText, fitGraph, resolveSymbol,
  expandFileGroup, fullSnapshot, GraphSnapshot, humanClick, humanDblclick, clearRoot,
} from "./lib/cogic";

const TOOL = "Cogic";

function visible(s: GraphSnapshot, label: string) {
  return s.nodes.some((n) => n.title.includes(label)) || s.childNodes.some((n) => n.title.includes(label));
}
function edgesOf(s: GraphSnapshot, type: string) {
  return s.edges.filter((e) => e.type === type).map((e) => e.id.replace(/WS\/src\//g, ""));
}

test("P1 Cogic E2E", async () => {
  const rec = new Recorder("p1-cogic");
  let s: VSCodeSession | undefined;
  const ev: Record<string, any> = {};
  try {
    s = (await rec.step("launch-vscode+cogic", () => launchVSCode({ profile: "cogic", extensions: ["cogic"] })))!;
    rec.attach(s.page);
    const { page } = s;
    rec.meta = { vscode: codeCliVersion(), electron: await s.app.evaluate(() => process.versions.electron), extensions: s.extensionVersions };
    let f: Frame;
    const F = async () => (f = await cogicFrame(page));

    await rec.step("open-demo.ts", async () => {
      // Common start state for every tool: demo.ts open, cursor on runDemo (not counted).
      await quickOpenFile(page, "src/demo.ts");
      await waitTsReady(page);
      await waitTsServerIdle(page);
      await goToSymbol(page, "runDemo");
      await waitCursorLine(page, 26);
    });
    await rec.trackTab();
    rec.resetCounters();

    // ================================================================== T1
    const t1Start = Date.now();
    await rec.step("open-cogic-editor-panel", async () => {
      rec.op("command palette: Cogic: Open Editor Panel");
      f = await openCogicPanel(page);
    });
    ev.depthDefault = (await snapshot(f!)).depth;

    await rec.step("filter-All+depth-1", async () => {
      const all = f.locator("button", { hasText: /^\s*All\s*$/ }).first();
      ev.filterAllWasDefault = ((await all.getAttribute("class")) ?? "").includes("active");
      if (!ev.filterAllWasDefault) {
        rec.op("click filter All");
        await all.click();
      }
      const sel = f.locator('select[aria-label="Graph depth"]');
      if ((await sel.inputValue()) !== "1") {
        rec.op("select Depth 1");
        await sel.selectOption("1");
      }
    }, { screenshot: false });

    ev.depth1 = await rec.step("generate-depth-1", async () => {
      rec.op("click Generate");
      await f.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click();
      const snap = await waitGraphStable(f, { minNodes: 3 });
      await fitGraph(f);
      return snap;
    });

    ev.depth2 = await rec.step("change-depth-2", async () => {
      const before = await snapshot(f);
      rec.op("select Depth 2");
      await f.locator('select[aria-label="Graph depth"]').selectOption("2");
      try {
        const snap = await waitGraphStable(f, { minNodes: before.nodes.length + 1, timeout: 15_000 });
        ev.depth2AutoRegenerated = true;
        return snap;
      } catch {
        ev.depth2AutoRegenerated = false;
        rec.op("click Generate (depth change did not refresh by itself)");
        await f.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click();
        return waitGraphStable(f, { minNodes: 3 });
      }
    });
    await fitGraph(f!);

    const g2 = (await rec.step("expand-receipt+money-groups", async () => {
      for (const file of ["receipt.ts", "money.ts"]) {
        if (await expandFileGroup(f, file)) rec.op(`click expand file group ${file}`);
      }
      await waitGraphStable(f, { minNodes: 3 });
      return fullSnapshot(f);
    }))!;
    ev.depth2Expanded = g2;
    const chain = ["runDemo", "process", "formatReceipt", "formatMoney"];
    const shown = Object.fromEntries(chain.map((c) => [c, visible(g2, c)]));
    const calls = edgesOf(g2, "calls");
    const callPairs = {
      "runDemo->CheckoutDemo.process": calls.some((c) => /function:demo\.ts:714->method:demo\.ts:415/.test(c)),
      "process->formatReceipt": calls.some((c) => /method:demo\.ts:415->[a-z]+:receipt\.ts/.test(c)),
      "formatReceipt->formatMoney": calls.some((c) => /receipt\.ts:\d+->[a-z]+:money\.ts/.test(c)),
    };
    ev.t1 = { shown, callPairs, calls, depth1Calls: edgesOf(ev.depth1, "calls") };
    rec.log(`T1 shown=${JSON.stringify(shown)} callPairs=${JSON.stringify(callPairs)}`);
    const c1 = rec.resetCounters();
    const allPairs = Object.values(callPairs).every(Boolean);
    const allShown = Object.values(shown).every(Boolean);
    rec.task({
      tool: TOOL, task: "T1", status: allPairs && allShown ? "pass" : allPairs || allShown ? "partial" : "fail", evidence: "ui+dom",
      userOperations: c1.ops, fileSwitches: c1.switches, returnOperations: null,
      graphPanelPersists: "", startingFocusPersists: "", selectionPersists: "",
      staticCallsShown: JSON.stringify(callPairs), dataflowShown: "", debugFrameMapped: "",
      automationMs: Date.now() - t1Start,
      screenshots: rec.steps.filter((x) => /generate|depth-2|expand/.test(x.name)).map((x) => x.screenshot ?? ""),
      notes: `default depth=${ev.depthDefault}; Depth1 calls=${ev.t1.depth1Calls.length}; Depth change auto-regenerates=${ev.depth2AutoRegenerated}; receipt.ts/money.ts appear as collapsed file groups at Depth 2 and must be expanded to see function names; symbols visible=${JSON.stringify(shown)}`,
    });

    // ================================================================== T2
    const t2Start = Date.now();
    await rec.step("select-runDemo-node", async () => {
      await fitGraph(f);
      const n = await resolveSymbol(f, "runDemo()");
      if (!n) throw new Error("runDemo node not rendered");
      rec.op("click runDemo node");
      await humanClick(n);
      await page.waitForTimeout(800);
    });
    ev.t2 = {
      selectedRunDemo: await inspectorText(f!, "panel--selected"),
      paramFlowRunDemo: await inspectorText(f!, "panel--flow"),
    };
    await rec.step("select-formatReceipt-node", async () => {
      await fitGraph(f);
      const n = await resolveSymbol(f, "formatReceipt()");
      if (!n) throw new Error("formatReceipt node not rendered");
      rec.op("click formatReceipt node");
      await humanClick(n);
      await page.waitForTimeout(800);
    }, { soft: true });
    ev.t2.selectedFormatReceipt = await inspectorText(f!, "panel--selected");
    ev.t2.paramFlowFormatReceipt = await inspectorText(f!, "panel--flow");
    const df = edgesOf(g2, "dataflow");
    ev.t2.dataflowEdges = df;
    rec.log(`T2 dataflow edges: ${JSON.stringify(df)}`);
    rec.log(`T2 PARAM FLOW (runDemo): ${ev.t2.paramFlowRunDemo}`);
    rec.log(`T2 PARAM FLOW (formatReceipt): ${ev.t2.paramFlowFormatReceipt}`);
    const dfj = df.join(" | ");
    const hops = {
      "runDemo->process total<-120": /demo\.ts:714->method:demo\.ts:415@@total <- 120/.test(dfj),
      "process->formatReceipt total<-total": /demo\.ts:415->[a-z]+:receipt\.ts:\d+@@total <- total/.test(dfj),
      "formatReceipt->formatMoney amount<-total": /receipt\.ts:\d+->[a-z]+:money\.ts:\d+@@amount <- total/.test(dfj),
    };
    const nh = Object.values(hops).filter(Boolean).length;
    const c2 = rec.resetCounters();
    rec.task({
      tool: TOOL, task: "T2", status: nh === 3 ? "pass" : nh > 0 ? "partial" : "fail", evidence: "ui+dom",
      userOperations: c2.ops, fileSwitches: c2.switches, returnOperations: null,
      graphPanelPersists: "", startingFocusPersists: "", selectionPersists: "",
      staticCallsShown: "", dataflowShown: JSON.stringify(hops), debugFrameMapped: "",
      automationMs: Date.now() - t2Start,
      screenshots: rec.steps.filter((x) => /select-/.test(x.name)).map((x) => x.screenshot ?? ""),
      notes: `dataflow edges (Depth 2): ${dfj}. Inspector PARAM FLOW (runDemo): "${ev.t2.paramFlowRunDemo}". toFixed(2) step is inside formatMoney body (not an inter-procedural edge).`,
    });

    // ================================================================== T3
    const t3Start = Date.now();
    const beforeNav = await fullSnapshot(f!);
    await rec.step("dblclick-formatReceipt-open-source", async () => {
      await fitGraph(f);
      const n = await resolveSymbol(f, "formatReceipt()");
      if (!n) throw new Error("formatReceipt node not rendered");
      rec.op("double-click formatReceipt node");
      await humanDblclick(n);
      ev.t3Source = await waitSourceEditor(page, "receipt.ts");
      await page.waitForTimeout(1000);
      ev.t3Source = await sourceEditorState(page);
    }, { soft: true });
    await rec.trackTab();
    rec.log(`T3 after source nav: ${JSON.stringify(ev.t3Source)}`);

    await page.waitForTimeout(3000); // give any auto-refresh on active-editor change time to happen
    await F();
    const afterNav = await fullSnapshot(f!);
    ev.t3 = {
      rootBannerBefore: beforeNav.rootBanner, rootBannerAfter: afterNav.rootBanner,
      rootPanelAfter: await inspectorText(f!, "panel--root"),
      selectedAfter: (await inspectorText(f!, "panel--selected")).slice(0, 200),
      nodesBefore: beforeNav.nodes.map((n) => n.id).sort(), nodesAfter: afterNav.nodes.map((n) => n.id).sort(),
    };
    ev.t3.sameNodes = JSON.stringify(ev.t3.nodesBefore) === JSON.stringify(ev.t3.nodesAfter);
    await rec.step("graph-state-after-source-nav", async () => {});

    let returnOps = 0;
    await rec.step("return-to-runDemo-via-graph", async () => {
      await fitGraph(f);
      const n = await resolveSymbol(f, "runDemo()");
      if (!n) throw new Error("runDemo node not rendered after navigation");
      rec.op("double-click runDemo node");
      returnOps++;
      await humanDblclick(n);
      ev.t3Return = await waitSourceEditor(page, "demo.ts");
      await page.waitForTimeout(800);
    }, { soft: true });
    await rec.trackTab();
    ev.t3Return = await sourceEditorState(page);
    rec.log(`T3 returned: ${JSON.stringify(ev.t3Return)}`);
    const c3 = rec.resetCounters();
    const opened = ev.t3Source?.file === "receipt.ts" && ev.t3Source?.line >= 4 && ev.t3Source?.line <= 7; // formatReceipt range 4:1-7:2
    const back = ev.t3Return?.file === "demo.ts" && ev.t3Return?.line >= 26 && ev.t3Return?.line <= 29; // runDemo range 26:1-29:2 is selected
    const rootKept = /demo\.ts/.test(ev.t3.rootBannerAfter);
    rec.task({
      tool: TOOL, task: "T3",
      status: opened && back && ev.t3.sameNodes ? "pass" : opened || back ? "partial" : "fail",
      evidence: "ui+dom",
      userOperations: c3.ops, fileSwitches: c3.switches, returnOperations: returnOps,
      graphPanelPersists: String(ev.t3.sameNodes), startingFocusPersists: String(rootKept),
      selectionPersists: String(/formatReceipt/.test(ev.t3.selectedAfter)),
      staticCallsShown: "", dataflowShown: "", debugFrameMapped: "",
      automationMs: Date.now() - t3Start,
      screenshots: rec.steps.filter((x) => /dblclick|after-source|return-to/.test(x.name)).map((x) => x.screenshot ?? ""),
      notes: `source opened=${JSON.stringify(ev.t3Source)}; root banner after nav="${ev.t3.rootBannerAfter}"; same node set after nav=${ev.t3.sameNodes}; returned=${JSON.stringify(ev.t3Return)}`,
    });

    // ================================================================== T4
    const t4Start = Date.now();
    await rec.step("set-breakpoint-receipt.ts:5", async () => {
      rec.op("focus source editor group (Ctrl+1)");
      await page.keyboard.press("Control+1");
      rec.op("Ctrl+P receipt.ts");
      await quickOpenFile(page, "src/receipt.ts");
      rec.op("Ctrl+G 5 + F9", 2);
      await toggleBreakpointAt(page, 5);
    });
    await rec.trackTab();
    await F();
    const graphBeforeDebug = await fullSnapshot(f!);
    const paused = await rec.step("F5-debug-paused", async () => {
      rec.op("F5");
      await startDebuggingAndWaitPause(page);
      await page.waitForTimeout(3000);
      return true;
    }, { soft: true });
    await rec.trackTab();
    ev.callStack = await callStackRows(page);
    rec.log(`call stack: ${JSON.stringify(ev.callStack)}`);
    await F();
    await rec.step("cogic-runtime-frame", async () => {
      const exp = f.locator('button[aria-label="Expand RUNTIME FRAME"]');
      if ((await exp.count()) > 0) {
        rec.op("expand RUNTIME FRAME in Inspector");
        await exp.first().click();
        await page.waitForTimeout(1000);
      }
      const p = f.locator(".panel--runtime").first();
      if ((await p.count()) > 0) await p.scrollIntoViewIfNeeded();
    }, { soft: true });
    // (a) default state after Generate: File Root = demo.ts
    const runtimeFileRoot = await inspectorText(f!, "panel--runtime");
    const graphDuringDebug = await snapshot(f!);
    rec.log(`RUNTIME FRAME (file root demo.ts): ${runtimeFileRoot}`);
    const matchRe = /Matched by (exact range|frame name fallback|nearest in-file node)/;
    const mappedFileRoot = matchRe.test(runtimeFileRoot);

    // (b) the panel says the frame is outside the root -> user presses "Clear root" while paused
    let runtimeAfterClearRoot = "";
    let clearRootSnap: GraphSnapshot | undefined;
    if (paused && !mappedFileRoot) {
      await rec.step("cogic-clear-root-while-paused", async () => {
        rec.op("click Clear root");
        await clearRoot(f);
        await page.waitForTimeout(2500);
        await F();
        runtimeAfterClearRoot = await inspectorText(f, "panel--runtime");
        ev.runtimeFocusedView = await snapshot(f); // Cogic's own runtime focus (viewport as Cogic left it)
      }, { soft: true });
      await rec.step("cogic-graph-after-clear-root-fitted", async () => {
        clearRootSnap = await fullSnapshot(f);
      }, { soft: true });
      rec.log(`RUNTIME FRAME (after Clear root): ${runtimeAfterClearRoot}`);
      if (clearRootSnap) rec.log(`graph after Clear root: nodes=${clearRootSnap.nodes.map((n) => n.title).join(", ")} root="${clearRootSnap.rootBanner}"`);
    }
    const mappedAfterClearRoot = matchRe.test(runtimeAfterClearRoot);
    const runtimeActive = (clearRootSnap ?? graphDuringDebug).nodes.filter((n) => /cgNode--selected|cgNode--connected/.test(n.classes)).map((n) => n.title);
    ev.t4 = {
      runtimeFileRoot, mappedFileRoot, runtimeAfterClearRoot, mappedAfterClearRoot, runtimeActive,
      nodesBefore: graphBeforeDebug.nodes.length, nodesDuring: graphDuringDebug.nodes.length,
      rootDuring: graphDuringDebug.rootBanner, rootAfterClear: clearRootSnap?.rootBanner,
    };
    await rec.step("stop-debugging", () => stopDebugging(page), { soft: true, screenshot: false });
    const c4 = rec.resetCounters();
    const modeOf = (t: string) => (/(Matched by [a-z ]+|Frame file is outside the current root|Frame file is not in the current graph|No nearby node matched this frame)/.exec(t)?.[1] ?? "no runtime info");
    rec.task({
      tool: TOOL, task: "T4",
      status: !paused ? "fail" : mappedFileRoot || mappedAfterClearRoot ? "pass" : "fail",
      evidence: "ui+dom",
      userOperations: c4.ops, fileSwitches: c4.switches, returnOperations: null,
      graphPanelPersists: String(graphDuringDebug.nodes.length > 0),
      startingFocusPersists: String(/demo\.ts/.test(graphDuringDebug.rootBanner)),
      selectionPersists: "", staticCallsShown: "", dataflowShown: "",
      debugFrameMapped: `file-root(demo.ts): ${modeOf(runtimeFileRoot)}; after Clear root: ${runtimeAfterClearRoot ? modeOf(runtimeAfterClearRoot) : "not tried"}`,
      automationMs: Date.now() - t4Start,
      screenshots: rec.steps.filter((x) => /F5|runtime|clear-root/.test(x.name)).map((x) => x.screenshot ?? ""),
      notes: `VS Code call stack=${JSON.stringify(ev.callStack).slice(0, 220)}; Cogic RUNTIME FRAME (file root)="${runtimeFileRoot.slice(0, 260)}"; (after Clear root)="${runtimeAfterClearRoot.slice(0, 260)}"; graph after Clear root still has runDemo=${!!clearRootSnap?.nodes.some((n) => n.title.includes("runDemo"))}`,
    });
  } finally {
    rec.flush();
    fs.writeFileSync(path.join(rec.dir, "evidence.json"), JSON.stringify(ev, null, 2));
    await closeVSCode(s);
  }
});
