/**
 * Cogic webview driver. Interacts only through the rendered webview UI (clicks, selects,
 * double-clicks). Graph state is read from the rendered DOM (React Flow nodes/edges and
 * Inspector text) — i.e. what is visible to the user — never from Cogic internals.
 */
import type { Frame, Locator, Page } from "@playwright/test";
import { findWebviewFrame, runCommand, PROJECT_ROOT } from "./vscode";

const WS = PROJECT_ROOT.replace(/\\/g, "/").toLowerCase();

export interface GraphSnapshot {
  nodes: { id: string; kind: string; title: string; classes: string }[];
  childNodes: { title: string; classes: string }[];
  edges: { id: string; type: string; classes: string }[];
  rootBanner: string;
  depth: string;
}

export function shortId(id: string): string {
  return id.split(WS).join("WS").replace(new RegExp(WS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "WS");
}

export async function openCogicPanel(page: Page): Promise<Frame> {
  await runCommand(page, "Cogic: Open Editor Panel");
  return cogicFrame(page);
}

export async function cogicFrame(page: Page): Promise<Frame> {
  return findWebviewFrame(page, async (f) => (await f.locator('select[aria-label="Graph depth"]').count()) > 0, 30_000);
}

export async function snapshot(f: Frame): Promise<GraphSnapshot> {
  const raw = await f.evaluate(() => {
    const nodes = [...document.querySelectorAll(".react-flow__node")].map((n) => ({
      id: n.getAttribute("data-id") ?? "",
      kind: [...n.classList].find((c) => c.startsWith("react-flow__node-"))?.replace("react-flow__node-", "") ?? "",
      title: (n.querySelector(".cgNodeTitle")?.textContent ?? n.textContent ?? "").trim().slice(0, 80),
      classes: (n.querySelector(".cgNode, .cgFolder, .cgFile, div")?.className ?? "").toString(),
    }));
    const childNodes = [...document.querySelectorAll(".cgChildNode")].map((n) => ({
      title: (n.textContent ?? "").trim().slice(0, 80),
      classes: n.className.toString(),
    }));
    const edges = [...document.querySelectorAll(".react-flow__edge")].map((e) => {
      const id = (e.getAttribute("data-testid") ?? "").replace(/^rf__edge-/, "");
      return { id, type: id.split(":")[0], classes: e.getAttribute("class") ?? "" };
    });
    const rootBanner = (document.querySelector(".rootBanner")?.textContent ?? "").trim();
    const sel = document.querySelector('select[aria-label="Graph depth"]') as HTMLSelectElement | null;
    return { nodes, childNodes, edges, rootBanner, depth: sel?.value ?? "" };
  });
  raw.nodes = raw.nodes.map((n) => ({ ...n, id: shortId(n.id) }));
  raw.edges = raw.edges.map((e) => ({ ...e, id: shortId(e.id) }));
  return raw;
}

/** Waits until the node/edge count is unchanged for `quietMs`. */
export async function waitGraphStable(f: Frame, opts: { minNodes?: number; quietMs?: number; timeout?: number } = {}): Promise<GraphSnapshot> {
  const { minNodes = 1, quietMs = 2000, timeout = 60_000 } = opts;
  const start = Date.now();
  let last = "";
  let lastChange = Date.now();
  let snap = await snapshot(f);
  while (Date.now() - start < timeout) {
    snap = await snapshot(f);
    const sig = `${snap.nodes.length}/${snap.childNodes.length}/${snap.edges.length}`;
    if (sig !== last) {
      last = sig;
      lastChange = Date.now();
    } else if (snap.nodes.length >= minNodes && Date.now() - lastChange >= quietMs) {
      return snap;
    }
    await f.page().waitForTimeout(250);
  }
  throw new Error(`graph not stable / below ${minNodes} nodes: ${last}`);
}

export async function inspectorText(f: Frame, panelClass: string): Promise<string> {
  const p = f.locator(`.${panelClass}`).first();
  if ((await p.count()) === 0) return "";
  return (await p.innerText()).replace(/\s+/g, " ").trim();
}

export async function fitGraph(f: Frame): Promise<void> {
  await f.locator('button[title="Fit Graph"]').first().click({ delay: 80 });
  await f.page().waitForTimeout(600);
}

/**
 * Fit Graph, then read the DOM. React Flow drops off-screen nodes from the DOM, so a
 * snapshot is only complete after fitting. (Fit Graph is a viewport action, not counted
 * as a task operation; it is applied identically everywhere a snapshot is compared.)
 */
export async function fullSnapshot(f: Frame): Promise<GraphSnapshot> {
  await fitGraph(f);
  return snapshot(f);
}

/**
 * Human-like mouse input. Playwright's default click()/dblclick() release the button after 0 ms;
 * React Flow in the Cogic webview ignores such zero-duration presses (verified: 0/4 dblclicks opened
 * the source vs 4/4 with an 80 ms press — see e2e/explore/cogic-dblclick-diagnose.spec.ts).
 * A real user's press lasts ~50-150 ms, so 80 ms is used for every graph click.
 */
export const PRESS_MS = 80;
export const humanClick = (l: Locator) => l.click({ delay: PRESS_MS });
export const humanDblclick = (l: Locator) => l.click({ clickCount: 2, delay: PRESS_MS });

/**
 * Locates a rendered symbol by its exact visible title, e.g. "runDemo()", "formatReceipt()".
 * Exact match matters: Cogic also renders EXTERNAL stub nodes such as "formatReceipt (receipt.ts)".
 */
export function symbolLocator(f: Frame, label: string) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exact = new RegExp(`^\\s*${esc}\\s*$`);
  const top = f.locator(".react-flow__node .cgNode", { has: f.locator(".cgNodeTitle", { hasText: exact }) });
  const child = f.locator(".cgChildNode", { hasText: label });
  return { child, top };
}

/** Clicks a collapsed file group's header ("Select and expand file group"). Returns false if already expanded. */
export async function expandFileGroup(f: Frame, fileName: string): Promise<boolean> {
  await fitGraph(f); // React Flow only renders on-screen nodes; fit first so the group is in the DOM
  const group = f.locator(".react-flow__node-fileGroup", { has: f.locator(".cgGroupTitle", { hasText: fileName }) }).first();
  await group.waitFor({ state: "attached", timeout: 10_000 });
  const collapsed = (await group.locator(".cgGroup--collapsed").count()) > 0;
  if (!collapsed) return false;
  await humanClick(group.locator('button.cgGroupHeader[title*="expand"]').first());
  await f.page().waitForTimeout(1000);
  return true;
}

/** Selects the folder group (header click) and presses "Use selected folder as root". Returns ops used. */
export async function useFolderAsRoot(f: Frame, folder: string): Promise<number> {
  await fitGraph(f);
  const header = f.locator(".react-flow__node-folderGroup button", { has: f.locator(".cgFolderTitle", { hasText: folder }) }).first();
  await humanClick(header);
  const btn = f.locator("button", { hasText: "Use selected folder as root" }).first();
  await btn.waitFor({ state: "visible", timeout: 10_000 });
  await humanClick(btn);
  await f.page().waitForTimeout(1500);
  return 2;
}

/** Presses the "Clear root" button in the canvas root banner. */
export async function clearRoot(f: Frame): Promise<void> {
  await humanClick(f.locator(".rootBanner button", { hasText: /Clear root/i }).first());
  await f.page().waitForTimeout(1500);
}

export async function resolveSymbol(f: Frame, label: string) {
  const { child, top } = symbolLocator(f, label);
  if ((await top.count()) > 0) return top.first();
  if ((await child.count()) > 0) return child.first();
  return undefined;
}

// ------------------------------------------------------------------ P3 helpers

/** Read-only hit test: is the centre of `l` the topmost element there (i.e. not covered by an overlay)? */
export async function hitTestInfo(l: Locator): Promise<{ clickable: boolean; coveredBy: string }> {
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const ok = !!top && (top === el || el.contains(top));
    return { clickable: ok, coveredBy: ok || !top ? "" : `${top.tagName.toLowerCase()}.${String(top.className).split(" ").slice(0, 3).join(".")}` };
  });
}

/**
 * Pans the canvas with a real mouse drag starting on an empty pane point (what a user does to move
 * an element out from under an overlay). Returns false if no empty pane point is found.
 */
export async function panCanvas(f: Frame, dx: number, dy: number): Promise<boolean> {
  const local = await f.evaluate(() => {
    const rf = document.querySelector(".react-flow");
    if (!rf) return null;
    const r = rf.getBoundingClientRect();
    for (let y = r.y + r.height - 30; y > r.y + 30; y -= 20) {
      for (let x = r.x + 30; x < r.x + r.width - 80; x += 20) {
        const t = document.elementFromPoint(x, y);
        if (t && t.classList.contains("react-flow__pane")) return { x, y };
      }
    }
    return null;
  });
  if (!local) return false;
  const frameEl = await f.frameElement();
  const fb = (await frameEl.boundingBox())!;
  const x = fb.x + local.x, y = fb.y + local.y;
  const page = f.page();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  return true;
}

export interface FolderRootAttempt { ok: boolean; ops: number; method: string; log: string[]; bannerAfter: string }

/**
 * Sets a Folder Root via the real UI: select folder group header -> "Use selected folder as root".
 * If the header is covered by the root banner, pans the canvas (real drag) and retries.
 * Never forces a click through an overlay.
 */
export async function setFolderRootViaUI(f: Frame, folder: string): Promise<FolderRootAttempt> {
  const log: string[] = [];
  let ops = 0;
  await fitGraph(f);
  const header = f.locator(".react-flow__node-folderGroup button", { has: f.locator(".cgFolderTitle", { hasText: folder }) }).first();
  if ((await header.count()) === 0) return { ok: false, ops, method: "none", log: ["folder header not rendered"], bannerAfter: "" };
  let hit = await hitTestInfo(header);
  log.push(`header hit-test after fit: clickable=${hit.clickable} coveredBy=${hit.coveredBy}`);
  let method = "direct-click";
  for (let i = 0; i < 3 && !hit.clickable; i++) {
    const panned = await panCanvas(f, 60, 140);
    ops++;
    method = "pan-then-click";
    hit = await hitTestInfo(header);
    log.push(`pan #${i + 1} (${panned ? "dragged" : "no empty pane"}): clickable=${hit.clickable} coveredBy=${hit.coveredBy}`);
  }
  if (!hit.clickable) return { ok: false, ops, method: "blocked", log, bannerAfter: "" };
  await humanClick(header);
  ops++;
  const btn = f.locator("button", { hasText: "Use selected folder as root" }).first();
  try {
    await btn.waitFor({ state: "visible", timeout: 8_000 });
  } catch {
    log.push("'Use selected folder as root' did not appear after selecting the folder header");
    return { ok: false, ops, method, log, bannerAfter: "" };
  }
  const bh = await hitTestInfo(btn);
  log.push(`'Use selected folder as root' hit-test: clickable=${bh.clickable} coveredBy=${bh.coveredBy}`);
  if (!bh.clickable) return { ok: false, ops, method, log, bannerAfter: "" };
  await humanClick(btn);
  ops++;
  await f.page().waitForTimeout(1500);
  const banner = f.locator(".rootBanner").first();
  const bannerAfter = (await banner.count()) ? ((await banner.textContent()) ?? "").trim() : "(no root banner)";
  log.push(`root banner after: "${bannerAfter}"`);
  return { ok: /Root folder:\s*src/i.test(bannerAfter), ops, method, log, bannerAfter };
}

export interface RuntimeState { text: string; mode: string; frame: string; mappedNodeButton: string }

/** Reads the Inspector RUNTIME FRAME panel (expanding it with a click if collapsed). */
export async function readRuntimeFrame(f: Frame): Promise<RuntimeState & { expandedByClick: boolean }> {
  let expandedByClick = false;
  const exp = f.locator('button[aria-label="Expand RUNTIME FRAME"]');
  if ((await exp.count()) > 0) {
    await humanClick(exp.first());
    expandedByClick = true;
    await f.page().waitForTimeout(800);
  }
  const p = f.locator(".panel--runtime").first();
  const text = (await p.count()) ? ((await p.innerText()) ?? "").replace(/\s+/g, " ").trim() : "";
  const mode = /(Matched by (?:exact range|frame name fallback|nearest in-file node)|Frame file is outside the current root|Frame file is not in the current graph|No nearby node matched this frame|No active[a-z ]*)/.exec(text)?.[1] ?? (text ? "unknown" : "panel not found");
  const frame = /([A-Za-z0-9_.]+\.ts:\d+:\d+)/.exec(text)?.[1] ?? "";
  const btn = p.locator("button.smallBtn").first();
  const mappedNodeButton = (await btn.count()) ? ((await btn.textContent()) ?? "").trim() : "";
  return { text, mode, frame, mappedNodeButton, expandedByClick };
}

/** Titles of graph nodes currently rendered with the "selected" state (user selection or runtime focus). */
export async function selectedTitles(f: Frame): Promise<string[]> {
  return f.evaluate(() =>
    [...document.querySelectorAll(".cgNode.cgNode--selected .cgNodeTitle, .cgChildNode--selected, .cgChildNode.isSelected")].map((e) =>
      (e.textContent ?? "").trim().slice(0, 60),
    ),
  );
}
