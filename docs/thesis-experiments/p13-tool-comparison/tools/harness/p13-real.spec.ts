/**
 * P13 Stage B: real-project tasks (hono, vite) per tool, as pre-registered in
 * docs/thesis-experiments/p13-tool-comparison/preregistration-stage-b.md (answer key: stage-b-answer-key.json).
 * New file; the P0-P11 specs are unchanged. One test per tool; the task is chosen with P13_TASK (H1, H2, V1, V2).
 * Every verdict is read from the rendered UI (sidebar tree, React Flow DOM, editor tab/line, notifications).
 * Env: P13_TASK, P13_ANSWER_KEY (path to the JSON), STUDY_WORKSPACE (project work copy).
 */
import { test, Page, Frame } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  launchVSCode, closeVSCode, VSCodeSession, quickOpenFile, waitTsReady, waitTsServerIdle, codeCliVersion, goToLine,
  sourceEditorState, waitSourceEditor, clickCodeLensAbove, sidebarTreeRows, notificationsText, reactFlowSnapshot,
  findWebviewFrame, runCommand, PROJECT_ROOT,
} from "./lib/vscode";
import { openCogicPanel, fitGraph, humanClick, humanDblclick, inspectorText, waitGraphStable, panCanvas } from "./lib/cogic";
import { Recorder } from "./lib/recorder";

const PRESS = { delay: 80 };
const KEY = JSON.parse(fs.readFileSync(process.env.P13_ANSWER_KEY ?? "", "utf8"));
const T = KEY.tasks.find((x: any) => x.id === process.env.P13_TASK);
if (!T) throw new Error(`unknown P13_TASK ${process.env.P13_TASK}`);
const base = (f: string) => path.basename(f);
const fnRe = (fn: string) => new RegExp(`(^|[^A-Za-z0-9_$#])#?${fn.replace(/^#/, "").replace(/[$]/g, "\\$")}([^A-Za-z0-9_$]|$)`);
/** column (1-based) of `name` on a source line of the workspace file (answer-key positions are line-based) */
function colOf(file: string, line: number, name: string): number {
  const text = fs.readFileSync(path.join(PROJECT_ROOT, file), "utf8").split(/\r?\n/)[line - 1] ?? "";
  const i = text.search(fnRe(name));
  if (i < 0) return 1;
  return i + 1 + (/[^A-Za-z0-9_$#]/.test(text[i]) ? 1 : 0);
}

type Status = "SUPPORTED_AND_VERIFIED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED_BY_DESIGN" | "EXECUTION_FAILED" | "ENVIRONMENT_BLOCKED" | "NOT_TESTED";
function record(rec: Recorder, tool: string, kind: string, status: Status, extra: Record<string, unknown>, t0: number) {
  const c = rec.resetCounters();
  const row = { tool, task: `${T.id}-${kind}`, status, userOperations: c.ops, fileSwitches: c.switches, automationMs: Date.now() - t0, ...extra };
  rec.log(`P13 ${JSON.stringify(row)}`);
  (rec as any).p13 = [...((rec as any).p13 ?? []), row];
  fs.writeFileSync(path.join(rec.dir, "p13-tasks.json"), JSON.stringify((rec as any).p13, null, 2));
}

async function startState(rec: Recorder, page: Page) {
  await rec.step(`start-state ${T.startFile}@${T.startSymbol}`, async () => {
    await quickOpenFile(page, T.startFile);
    await waitTsReady(page, 120_000);
    await waitTsServerIdle(page, 180_000);
    await goToLine(page, T.startLine, colOf(T.startFile, T.startLine, T.startSymbol));
  });
  await rec.trackTab();
  rec.resetCounters();
}

/** consecutive path pairs verified in a tree of rows (level = nesting) */
function treePairs(rows: { text: string; level: number }[]) {
  const names = T.path.map((p: any) => p.fn);
  const out: Record<string, boolean> = {};
  for (let k = 0; k + 1 < names.length; k++) {
    const a = fnRe(names[k]), b = fnRe(names[k + 1]);
    let ok = false;
    rows.forEach((r, i) => {
      if (ok || !a.test(r.text.split(" ")[0])) return;
      for (let j = i + 1; j < rows.length && rows[j].level > r.level; j++) if (rows[j].level === r.level + 1 && b.test(rows[j].text.split(" ")[0])) { ok = true; break; }
    });
    out[`${names[k]}->${names[k + 1]}`] = ok;
  }
  return out;
}

// ============================================================================ VS Code built-ins
test("P13 VS Code", async () => {
  const TOOL = "VS Code"; const rec = new Recorder(`p13-vscode-${T.id}`); let s: VSCodeSession | undefined; const ev: Record<string, any> = {};
  try {
    s = (await rec.step("launch", () => launchVSCode({ profile: "p13-vscode", extensions: [] })))!;
    rec.attach(s.page); const { page } = s; rec.meta = { vscode: codeCliVersion(), extensions: s.extensionVersions, task: T.id };
    await startState(rec, page);
    // R1 Call Hierarchy (outgoing), expand only rows of path functions
    let t0 = Date.now();
    await rec.step("r1-call-hierarchy-open", async () => {
      rec.op("Shift+Alt+H (Show Call Hierarchy)");
      await page.keyboard.press("Shift+Alt+H");
      await page.locator(".part.sidebar .monaco-list-row").first().waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForTimeout(1500);
    }, { soft: true });
    ev.incoming = await sidebarTreeRows(page);
    await rec.step("r1-outgoing", async () => {
      const btn = page.locator(".part.sidebar .action-label[aria-label*='Outgoing'], .part.sidebar .action-label[title*='Outgoing']").first();
      rec.op("click 'Show Outgoing Calls'"); await btn.click(PRESS); await page.waitForTimeout(2000);
    }, { soft: true });
    await rec.step("r1-expand-path-rows", async () => {
      const names = T.path.map((p: any) => p.fn);
      for (let i = 0; i < 8; i++) {
        const rows = await sidebarTreeRows(page);
        if (Object.values(treePairs(rows)).every(Boolean)) break;
        const idx = rows.findIndex((r) => r.expanded === "false" && names.slice(0, -1).some((n: string) => fnRe(n).test(r.text.split(" ")[0])));
        if (idx < 0) break;
        rec.op(`expand '${rows[idx].text}'`);
        await page.locator(".part.sidebar .monaco-list-row").nth(idx).locator(".monaco-tl-twistie").click(PRESS);
        await page.waitForTimeout(2000);
      }
    }, { soft: true });
    ev.outgoing = await sidebarTreeRows(page);
    const pairs = treePairs(ev.outgoing); const n = Object.values(pairs).filter(Boolean).length;
    record(rec, TOOL, "R1", n === Object.keys(pairs).length ? "SUPPORTED_AND_VERIFIED" : n ? "PARTIALLY_SUPPORTED" : "EXECUTION_FAILED",
      { pairs, rows: ev.outgoing.map((r: any) => `${"  ".repeat(Math.max(0, r.level - 1))}${r.text}`).slice(0, 40), incomingRows: ev.incoming.length }, t0);
    // R2 Go to Definition along the path (no argument->parameter view by default -> partial at best)
    t0 = Date.now(); const reached: any[] = [];
    for (const c of T.calls) {
      const [file, lines] = c.at.split(":"); const line = Number(lines.split(",")[0]);
      const target = T.path.find((p: any) => p.fn === c.to);
      await rec.step(`r2-f12-${c.to}`, async () => {
        await page.keyboard.press("Control+1");
        if (base((await sourceEditorState(page))?.file ?? "") !== base(file)) { rec.op(`Ctrl+P ${base(file)}`); await quickOpenFile(page, file); }
        rec.op(`place cursor on '${c.to}' at ${base(file)}:${line}`); await goToLine(page, line, colOf(file, line, c.to));
        rec.op("F12 Go to Definition"); await page.keyboard.press("F12");
        reached.push({ to: c.to, ...(await waitSourceEditor(page, base(target.file), target.line, 20_000)) });
      }, { soft: true });
      await rec.trackTab();
    }
    ev.r2 = reached;
    record(rec, TOOL, "R2", reached.length === T.calls.length ? "PARTIALLY_SUPPORTED" : "EXECUTION_FAILED",
      { reached, note: "no argument->parameter mapping is displayed (default settings); each hop is followed with Go to Definition and read in code" }, t0);
    // R3 open target from the Call Hierarchy tree, return with the root row
    t0 = Date.now(); let returnOps = 0;
    await rec.step("r3-open-target-row", async () => {
      const row = page.locator(".part.sidebar .monaco-list-row").filter({ hasText: fnRe(T.targetSymbol) }).first();
      if ((await row.count()) === 0) throw new Error("target row not in the Call Hierarchy view");
      rec.op("click target row"); await row.click(PRESS); await page.waitForTimeout(1500);
    }, { soft: true });
    await rec.trackTab(); ev.r3open = await sourceEditorState(page); ev.treeAfterOpen = await sidebarTreeRows(page);
    await rec.step("r3-return-root-row", async () => {
      const row = page.locator(".part.sidebar .monaco-list-row").first();
      rec.op("click start (root) row"); returnOps++; await row.click(PRESS); await page.waitForTimeout(1500);
    }, { soft: true });
    await rec.trackTab(); ev.r3return = await sourceEditorState(page); ev.treeAfterReturn = await sidebarTreeRows(page);
    const opened = ev.r3open?.file === base(T.targetFile), back = ev.r3return?.file === base(T.startFile);
    record(rec, TOOL, "R3", opened && back ? "SUPPORTED_AND_VERIFIED" : opened ? "PARTIALLY_SUPPORTED" : "EXECUTION_FAILED",
      { opened: ev.r3open, returned: ev.r3return, returnOperations: returnOps, viewKept: JSON.stringify(ev.outgoing.map((r: any) => r.text)) === JSON.stringify(ev.treeAfterReturn.map((r: any) => r.text)), startKept: fnRe(T.startSymbol).test(ev.treeAfterReturn[0]?.text ?? "") }, t0);
  } finally { rec.flush(); fs.writeFileSync(path.join(rec.dir, "evidence.json"), JSON.stringify(ev, null, 2)); await closeVSCode(s); }
});

// ============================================================================ Trace Function Flow
/** TFF node text is "ƒFunction<name>()<path>" (and "↗ imported<name>()"): match the name followed by "(". */
const tffRe = (fn: string) => new RegExp(`(?:^|[^A-Za-z0-9_$#]|Function|Method|Property|Arrow|Constructor|imported)#?${fn.replace(/^#/, "")}\\(`);
async function tffFrame(page: Page): Promise<Frame> {
  return findWebviewFrame(page, async (f) => (await f.locator(".react-flow").count()) > 0 && /call graph|Visible Nodes/.test(await f.locator("body").innerText()), 60_000);
}
function graphPairs(g: { nodes: { id: string; text: string }[]; edges: string[] }) {
  const names = T.path.map((p: any) => p.fn); const out: Record<string, boolean> = {};
  const idsOf = (fn: string) => g.nodes.filter((n) => tffRe(fn).test(n.text)).map((n) => n.id);
  for (let k = 0; k + 1 < names.length; k++) {
    const A = idsOf(names[k]), B = idsOf(names[k + 1]);
    out[`${names[k]}->${names[k + 1]}`] = g.edges.some((e) => A.some((a) => B.some((b) => e.includes(a) && e.includes(b) && e.indexOf(a) < e.lastIndexOf(b))));
  }
  return out;
}

test("P13 Trace Function Flow", async () => {
  const TOOL = "Trace Function Flow"; const rec = new Recorder(`p13-tff-${T.id}`); let s: VSCodeSession | undefined; const ev: Record<string, any> = {};
  try {
    s = (await rec.step("launch", () => launchVSCode({ profile: "p13-trace", extensions: ["trace"] })))!;
    rec.attach(s.page); const { page } = s; rec.meta = { vscode: codeCliVersion(), extensions: s.extensionVersions, task: T.id };
    await startState(rec, page);
    let t0 = Date.now(); let f: Frame | undefined;
    ev.codeLens = await rec.step("r1-codelens-trace", async () => {
      await clickCodeLensAbove(page, "Trace Function", T.startLine, 20_000);
      rec.op("click CodeLens 'Trace Function' above start"); f = await tffFrame(page); await page.waitForTimeout(4000); return true;
    }, { soft: true });
    if (!f) {
      await rec.step("r1-palette-trace", async () => {
        await page.keyboard.press("Control+1"); await goToLine(page, T.startLine, colOf(T.startFile, T.startLine, T.startSymbol));
        rec.op("command palette: Trace Function Flow: Trace Function Flow"); await runCommand(page, "Trace Function Flow: Trace Function Flow");
        await page.waitForTimeout(2000);
        const rows = page.locator(".quick-input-widget .quick-input-list .monaco-list-row");
        ev.quickPick = (await rows.count()) ? await rows.allInnerTexts() : [];
        const qp = rows.filter({ hasText: tffRe(T.startSymbol) }).first();
        if ((await qp.count()) > 0) { rec.op("quick pick: start function"); await qp.click(PRESS); }
        else if (ev.quickPick.length) { rec.op("Escape (start not offered)"); await page.keyboard.press("Escape"); }
        f = await tffFrame(page); await page.waitForTimeout(4000);
      }, { soft: true });
    }
    ev.graph = f ? await reactFlowSnapshot(f) : null; ev.notifications = await notificationsText(page);
    const pairs = ev.graph ? graphPairs(ev.graph) : {}; const shown = T.path.map((p: any) => p.fn).filter((fn: string) => ev.graph?.nodes.some((n: any) => tffRe(fn).test(n.text)));
    const n = Object.values(pairs).filter(Boolean).length;
    record(rec, TOOL, "R1", !ev.graph ? "EXECUTION_FAILED" : n === T.path.length - 1 ? "SUPPORTED_AND_VERIFIED" : n || shown.length > 1 ? "PARTIALLY_SUPPORTED" : "EXECUTION_FAILED",
      { pairs, functionsShown: shown, codeLensAboveStart: !!ev.codeLens, quickPick: ev.quickPick ?? null, nodes: ev.graph?.nodes.map((x: any) => x.text).slice(0, 30), edges: ev.graph?.edges.length ?? 0, notifications: ev.notifications }, t0);
    // R2 details of the target node
    t0 = Date.now();
    await rec.step("r2-select-target", async () => {
      const node = f!.locator(".react-flow__node").filter({ hasText: tffRe(T.targetSymbol) }).first();
      if ((await node.count()) === 0) throw new Error("target node not in graph");
      rec.op("click target node"); await node.click(PRESS); await page.waitForTimeout(1500);
    }, { soft: true });
    ev.detail = f ? (await f.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 2000) : "";
    const callSite = /CALL SITE\s*(\S+\([^)]*\))/.exec(ev.detail)?.[1] ?? "";
    const mapping = T.flow.filter((fl: any) => new RegExp(`\\b${fl.param.split(" ")[0]}\\s*(<-|←|=)\\s*${fl.arg.replace(/[[\]]/g, "\\$&")}`).test(ev.detail)).map((fl: any) => fl.id);
    record(rec, TOOL, "R2", mapping.length === T.flow.length ? "SUPPORTED_AND_VERIFIED" : mapping.length || callSite ? "PARTIALLY_SUPPORTED" : f ? "UNSUPPORTED_BY_DESIGN" : "EXECUTION_FAILED",
      { segmentsShown: mapping, callSite, detail: ev.detail.slice(0, 500) }, t0);
    // R3 double-click target -> source; return
    t0 = Date.now(); let returnOps = 0;
    await rec.step("r3-dblclick-target", async () => {
      const node = f!.locator(".react-flow__node").filter({ hasText: tffRe(T.targetSymbol) }).first();
      if ((await node.count()) === 0) throw new Error("target node not in graph");
      rec.op("double-click target node"); await node.click({ clickCount: 2, delay: 80 }); await waitSourceEditor(page, base(T.targetFile), undefined, 20_000);
    }, { soft: true });
    await rec.trackTab(); ev.r3open = await sourceEditorState(page);
    const gAfter = await reactFlowSnapshot(await tffFrame(page)).catch(() => null);
    await rec.step("r3-return", async () => {
      const fr = await tffFrame(page); const start = fr.locator(".react-flow__node").filter({ hasText: tffRe(T.startSymbol) }).first();
      if ((await start.count()) > 0) { rec.op("double-click start node"); returnOps++; await start.click({ clickCount: 2, delay: 80 }); await page.waitForTimeout(1500); }
      if ((await sourceEditorState(page))?.file !== base(T.startFile)) {
        await page.keyboard.press("Control+1");
        for (let i = 0; i < 6; i++) { rec.op("Alt+Left (Go Back)"); returnOps++; await page.keyboard.press("Alt+ArrowLeft"); await page.waitForTimeout(700); if ((await sourceEditorState(page))?.file === base(T.startFile)) break; }
      }
    }, { soft: true });
    await rec.trackTab(); ev.r3return = await sourceEditorState(page);
    const opened = ev.r3open?.file === base(T.targetFile), back = ev.r3return?.file === base(T.startFile);
    record(rec, TOOL, "R3", opened && back ? "SUPPORTED_AND_VERIFIED" : opened ? "PARTIALLY_SUPPORTED" : f ? "EXECUTION_FAILED" : "EXECUTION_FAILED",
      { opened: ev.r3open, returned: ev.r3return, returnOperations: returnOps, viewKept: JSON.stringify(gAfter?.nodes.map((x) => x.id)) === JSON.stringify(ev.graph?.nodes.map((x: any) => x.id)), startNodeInGraph: !!gAfter?.nodes.some((x) => tffRe(T.startSymbol).test(x.text)) }, t0);
  } finally { rec.flush(); fs.writeFileSync(path.join(rec.dir, "evidence.json"), JSON.stringify(ev, null, 2)); await closeVSCode(s); }
});

// ============================================================================ Context Graph
test("P13 Context Graph", async () => {
  const TOOL = "Context Graph"; const rec = new Recorder(`p13-cg-${T.id}`); let s: VSCodeSession | undefined; const ev: Record<string, any> = {};
  try {
    s = (await rec.step("launch", () => launchVSCode({ profile: "p13-cg", extensions: ["contextGraph"] })))!;
    rec.attach(s.page); const { page } = s; rec.meta = { vscode: codeCliVersion(), extensions: s.extensionVersions, task: T.id };
    await startState(rec, page);
    const t0 = Date.now();
    await rec.step("cg-toggle-panel", async () => { rec.op("command palette: Context Graph: Toggle Context Graph"); await runCommand(page, "Context Graph: Toggle Context Graph"); await page.waitForTimeout(4000); }, { soft: true });
    await rec.step("cg-generate", async () => { rec.op("command palette: Context Graph: Generate Context Graph"); await runCommand(page, "Context Graph: Generate Context Graph"); await page.waitForTimeout(15000); }, { soft: true });
    ev.notifications = await notificationsText(page);
    ev.panelText = "";
    for (const fr of page.frames()) { try { const t = await fr.locator("body").innerText({ timeout: 2000 }); if (/context graph|worker|graph/i.test(t)) ev.panelText += t.replace(/\s+/g, " ").slice(0, 1500) + " || "; } catch { /* frame gone */ } }
    const blocked = /No usable worker runtime|worker compiled for this platform|Worker bundle is missing/i.test(ev.panelText + JSON.stringify(ev.notifications));
    for (const k of ["R1", "R2", "R3"]) record(rec, TOOL, k, blocked ? "ENVIRONMENT_BLOCKED" : "EXECUTION_FAILED", { blockedMessage: blocked, panelText: ev.panelText.slice(0, 600), notifications: ev.notifications }, t0);
  } finally { rec.flush(); fs.writeFileSync(path.join(rec.dir, "evidence.json"), JSON.stringify(ev, null, 2)); await closeVSCode(s); }
});

// ============================================================================ Cogic
// Stage B addendum (fixed after smoke runs, before the measured runs; docs/.../preregistration-stage-b-addendum.md):
//  A1 collapsed folder groups that contain a path file are expanded (1 op each), then the file group (1 op).
//  A2 Cogic runs with its product default cogic.analysisCache.enabled = true (fresh profile per run, so no cache carries
//     over between runs); the P3 harness default (false) made Depth 2 on vite exceed 5 minutes in the smoke run.
//  A3 the canvas diagnostics notice ("TypeScript reported N errors") has no close control and can cover nodes/headers;
//     when a click target fails a hit test, the canvas is dragged (1 op per drag, max 3) as a user would.
//  A4 graph edges are attributed to functions through the rendered DOM only: an edge endpoint id is kind:file:offset,
//     the offset is converted to a source line, and matched with the node title (top-level nodes, by id) or with the
//     "name() … file:line" text of class-member rows. Nothing is read from Cogic internals.

/** clicks (or double-clicks) a locator after making sure it is not covered (A3) */
async function safeClick(rec: Recorder, f: Frame, l: ReturnType<Frame["locator"]>, desc: string, dbl = false) {
  for (let i = 0; i < 4; i++) {
    const ok = await l.evaluate((el) => { const r = el.getBoundingClientRect(); if (!r.width) return false; const t = document.elementFromPoint(r.x + Math.min(r.width / 2, 40), r.y + r.height / 2); return !!t && (el === t || el.contains(t)); }).catch(() => false);
    if (ok) break;
    if (i === 3) throw new Error(`${desc}: covered after 3 drags`);
    rec.op(`drag canvas to uncover ${desc}`);
    if (!(await panCanvas(f, 0, 220))) throw new Error("no empty pane point to drag");
    await f.page().waitForTimeout(700);
  }
  rec.op(`${dbl ? "double-click" : "click"} ${desc}`);
  if (dbl) await humanDblclick(l); else await humanClick(l);
}

/** Reveals the file group of a workspace-relative file (A1). */
async function revealFile(rec: Recorder, f: Frame, relFile: string) {
  const norm = relFile.split(path.sep).join("/");
  const dir = path.posix.dirname(norm), name = path.posix.basename(norm);
  let clicks = 0;
  for (let i = 0; i < 8; i++) {
    await fitGraph(f);
    const target = await f.evaluate(([d]) => {
      document.querySelectorAll("[data-p13-reveal]").forEach((e) => e.removeAttribute("data-p13-reveal"));
      const btns = [...document.querySelectorAll(".react-flow__node-folderGroup button[title=\"Expand folder group\"]")] as HTMLElement[];
      const hit = btns.map((b) => ({ b, p: (b.querySelector(".cgFolderPath")?.textContent ?? "").trim() })).filter((x) => x.p && (d === x.p || d.startsWith(x.p + "/"))).sort((a, b) => a.p.length - b.p.length)[0];
      if (!hit) return null; hit.b.setAttribute("data-p13-reveal", "1"); return hit.p;
    }, [dir] as const);
    if (!target) break;
    await safeClick(rec, f, f.locator("[data-p13-reveal=\"1\"]").first(), `folder group ${target}`); clicks++;
    await f.page().waitForTimeout(1200);
  }
  await fitGraph(f);
  const state = await f.evaluate(([d, n]) => {
    document.querySelectorAll("[data-p13-reveal]").forEach((e) => e.removeAttribute("data-p13-reveal"));
    const g = [...document.querySelectorAll(".react-flow__node-fileGroup")].find((x) => (x.querySelector(".cgGroupTitle")?.textContent ?? "").trim() === n && (x.querySelector(".cgGroupPath")?.textContent ?? "").trim() === d);
    const b = g?.querySelector("button[title=\"Select and expand file group\"]") as HTMLElement | null;
    if (!b) return g ? "already-expanded" : "no-file-group"; b.setAttribute("data-p13-reveal", "1"); return "collapsed";
  }, [dir, name] as const);
  if (state === "collapsed") { await safeClick(rec, f, f.locator("[data-p13-reveal=\"1\"]").first(), `file group ${relFile}`); clicks++; await f.page().waitForTimeout(1200); }
  rec.log(`revealFile ${relFile}: clicks=${clicks} fileGroup=${state}`);
  return clicks;
}

/** rendered graph: nodes (id, title), class-member rows (parent id, text), edges (ids) — after Fit */
async function cogicGraph(f: Frame) {
  await fitGraph(f);
  return f.evaluate(() => {
    const title = (el: Element) => (el.querySelector(".cgNodeTitle")?.textContent ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    const nodes = [...document.querySelectorAll(".react-flow__node")].map((n) => ({ id: n.getAttribute("data-id") ?? "", title: title(n), cls: [...n.classList].find((c) => c.startsWith("react-flow__node-")) ?? "" }));
    const children = [...document.querySelectorAll(".cgChildNode")].map((n) => ({ parent: n.closest(".react-flow__node")?.getAttribute("data-id") ?? "", text: (n.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160) }));
    const edges = [...document.querySelectorAll(".react-flow__edge")].map((e) => (e.getAttribute("data-testid") ?? "").replace(/^rf__edge-/, ""));
    const banner = (document.querySelector(".rootBanner")?.textContent ?? "").trim();
    return { nodes, children, edges, banner };
  });
}
type CGraph = Awaited<ReturnType<typeof cogicGraph>>;
const srcCache = new Map<string, string>();
function lineOfOffset(file: string, offset: number) {
  if (!srcCache.has(file)) { try { srcCache.set(file, fs.readFileSync(file, "utf8")); } catch { srcCache.set(file, ""); } }
  const s = srcCache.get(file)!; if (!s || offset < 0) return -1;
  return s.slice(0, offset).split("\n").length;
}
const parseId = (id: string) => { const m = /^([a-z]+):(.+):(-?\d+)$/.exec(id); return m ? { kind: m[1], file: m[2], offset: Number(m[3]) } : null; };
const leadName = (t: string) => (/^(#?[A-Za-z_$][\w$]*)/.exec(t.trim())?.[1] ?? "");
/** name shown in the DOM for a graph endpoint id (A4) */
function endpointName(g: CGraph, id: string): string {
  const top = g.nodes.find((n) => n.id === id);
  if (top && top.title && !/react-flow__node-(file|folder)Group/.test(top.cls)) return leadName(top.title);
  const p = parseId(id); if (!p) return "";
  const line = lineOfOffset(p.file, p.offset);
  const rows = g.children.filter((c) => { const pp = parseId(c.parent); return pp && pp.file.toLowerCase() === p.file.toLowerCase(); });
  const row = rows.find((c) => new RegExp(`:${line}$`).test(c.text));
  return row ? leadName(row.text) : "";
}
const sameFn = (shown: string, fn: string) => shown.replace(/^#/, "") === fn.replace(/^#/, "");
function edgeTriples(g: CGraph, kind: string) {
  return g.edges.filter((e) => e.startsWith(kind + ":")).map((e) => {
    const body = e.slice(kind.length + 1); const [ends, label = ""] = body.split("@@");
    const k = ends.indexOf("->");
    const src = ends.slice(0, k), tgt = ends.slice(k + 2);
    return { src: endpointName(g, src), tgt: endpointName(g, tgt), label, raw: e };
  });
}
function shownFns(g: CGraph) {
  return new Set([...g.nodes.filter((n) => !/Group/.test(n.cls)).map((n) => leadName(n.title)), ...g.children.map((c) => leadName(c.text))].filter(Boolean));
}
function targetLocator(f: Frame, fn: string) {
  return f.locator(".react-flow__node .cgNode, .cgChildNode").filter({ hasText: fnRe(fn) });
}

test("P13 Cogic", async () => {
  const TOOL = "Cogic"; const rec = new Recorder(`p13-cogic-${T.id}`); let s: VSCodeSession | undefined; const ev: Record<string, any> = {};
  try {
    s = (await rec.step("launch", () => launchVSCode({ profile: "p13-cogic", extensions: ["cogic"], extraSettings: { "cogic.analysisCache.enabled": true } })))!;
    rec.attach(s.page); const { page } = s; rec.meta = { vscode: codeCliVersion(), extensions: s.extensionVersions, task: T.id, analysisCache: true };
    await startState(rec, page);
    let t0 = Date.now(); let f!: Frame;
    await rec.step("r1-open-panel", async () => { rec.op("command palette: Cogic: Open Editor Panel"); f = await openCogicPanel(page); });
    await rec.step("r1-depth-2", async () => { rec.op("select Depth 2"); await f.locator('select[aria-label="Graph depth"]').selectOption("2"); await page.waitForTimeout(1500); });
    ev.generateMs = await rec.step("r1-generate", async () => {
      const g0 = Date.now();
      rec.op("click Generate"); await f.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click(PRESS);
      await waitGraphStable(f, { minNodes: 2, quietMs: 3000, timeout: 600_000 });
      return Date.now() - g0;
    });
    await rec.step("r1-expand-path-groups", async () => {
      for (const file of [...new Set(T.path.map((p: any) => p.file))] as string[]) await revealFile(rec, f, file);
      await waitGraphStable(f, { minNodes: 2, quietMs: 2000, timeout: 120_000 });
    }, { soft: true });
    ev.graph = await cogicGraph(f);
    const calls = edgeTriples(ev.graph, "calls"); ev.callTriples = calls.filter((c) => c.src && c.tgt).map((c) => `${c.src}->${c.tgt}`);
    const names = T.path.map((p: any) => p.fn); const pairs: Record<string, boolean> = {};
    for (let k = 0; k + 1 < names.length; k++) pairs[`${names[k]}->${names[k + 1]}`] = calls.some((c) => sameFn(c.src, names[k]) && sameFn(c.tgt, names[k + 1]));
    const shownSet = shownFns(ev.graph); const shown = names.filter((n: string) => [...shownSet].some((x) => sameFn(x, n)));
    const nc = Object.values(pairs).filter(Boolean).length;
    record(rec, TOOL, "R1", nc === names.length - 1 ? "SUPPORTED_AND_VERIFIED" : nc || shown.length > 1 ? "PARTIALLY_SUPPORTED" : "EXECUTION_FAILED",
      { pairs, functionsShown: shown, generateMs: ev.generateMs, nodes: ev.graph.nodes.length, memberRows: ev.graph.children.length, edges: ev.graph.edges.length, callTriplesSample: [...new Set(ev.callTriples)].slice(0, 30), banner: ev.graph.banner }, t0);
    // R2 dataflow edges between path functions with the pre-registered param <- arg label; PARAM FLOW of the target
    t0 = Date.now();
    await rec.step("r2-select-target", async () => {
      await fitGraph(f); const l = targetLocator(f, T.targetSymbol);
      if ((await l.count()) === 0) throw new Error("target node not rendered");
      await safeClick(rec, f, l.first(), "target node"); await page.waitForTimeout(1200);
    }, { soft: true });
    ev.paramFlow = await inspectorText(f, "panel--flow").catch(() => "");
    // A6: the pre-registered R2 evidence includes the Inspector PARAM FLOW rows ("from -> to" + "param <- arg")
    ev.flowRows = await f.evaluate(() => [...document.querySelectorAll(".panel--flow .inspectorFlowRow")].map((r) => {
      const kids = [...r.children].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
      const [from = "", to = ""] = (kids[0] ?? "").split(" -> ");
      return { from, to, label: kids[1] ?? "" };
    })).catch(() => [] as { from: string; to: string; label: string }[]);
    const rowName = (t: string) => leadName(t.replace(/^[\w$#]+\./, ""));
    const df = edgeTriples(ev.graph, "dataflow");
    const segs = T.flow.map((fl: any) => {
      const p = fl.param.split(" ")[0], a = fl.arg.replace(/[[\]]/g, "\\$&");
      const re = new RegExp(`^${p}\\s*<-\\s*${a}$`);
      const hit = df.find((d) => sameFn(d.src, fl.fromFn) && sameFn(d.tgt, fl.toFn) && re.test(d.label.trim()));
      const row = ev.flowRows.find((r: any) => sameFn(rowName(r.from), fl.fromFn) && sameFn(rowName(r.to), fl.toFn) && re.test(r.label.trim()));
      return { id: fl.id, edge: !!hit || !!row, viaGraphEdge: !!hit, viaParamFlowRow: !!row, label: hit?.label ?? row?.label ?? null, candidates: df.filter((d) => sameFn(d.src, fl.fromFn) && sameFn(d.tgt, fl.toFn)).map((d) => d.label).slice(0, 6) };
    });
    const ns = segs.filter((x: any) => x.edge).length;
    record(rec, TOOL, "R2", ns === T.flow.length ? "SUPPORTED_AND_VERIFIED" : ns ? "PARTIALLY_SUPPORTED" : "EXECUTION_FAILED",
      { segments: segs, dataflowEdges: df.length, paramFlowRows: ev.flowRows.length, paramFlowRowsSample: ev.flowRows.slice(0, 12), paramFlowTarget: ev.paramFlow.slice(0, 400) }, t0);
    // R3 double-click target -> source; return via the start node
    t0 = Date.now(); let returnOps = 0; const before = await cogicGraph(f);
    await rec.step("r3-dblclick-target", async () => {
      await fitGraph(f); const l = targetLocator(f, T.targetSymbol);
      if ((await l.count()) === 0) throw new Error("target node not rendered");
      await safeClick(rec, f, l.first(), "target node", true); await waitSourceEditor(page, base(T.targetFile), undefined, 20_000);
    }, { soft: true });
    await rec.trackTab(); ev.r3open = await sourceEditorState(page); await page.waitForTimeout(3000);
    const after = await cogicGraph(f);
    await rec.step("r3-return-start-node", async () => {
      await fitGraph(f); const l = targetLocator(f, T.startSymbol);
      if ((await l.count()) === 0) throw new Error("start node not rendered");
      const opsBefore = (rec as any).ops ?? 0;
      await safeClick(rec, f, l.first(), "start node", true); returnOps++;
      await waitSourceEditor(page, base(T.startFile), undefined, 20_000);
      void opsBefore;
    }, { soft: true });
    await rec.trackTab(); ev.r3return = await sourceEditorState(page);
    const opened = ev.r3open?.file === base(T.targetFile), back = ev.r3return?.file === base(T.startFile);
    record(rec, TOOL, "R3", opened && back ? "SUPPORTED_AND_VERIFIED" : opened ? "PARTIALLY_SUPPORTED" : "EXECUTION_FAILED",
      { opened: ev.r3open, returned: ev.r3return, returnOperations: returnOps, viewKept: JSON.stringify(before.nodes.map((x) => x.id).sort()) === JSON.stringify(after.nodes.map((x) => x.id).sort()), bannerBefore: before.banner, bannerAfter: after.banner }, t0);
  } finally { rec.flush(); fs.writeFileSync(path.join(rec.dir, "evidence.json"), JSON.stringify(ev, null, 2)); await closeVSCode(s); }
});
