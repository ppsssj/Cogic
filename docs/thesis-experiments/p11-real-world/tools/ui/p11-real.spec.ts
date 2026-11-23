/**
 * P11 real-world UI check (derived from p8c-large.spec.ts; P8-C file unchanged). Same passive timing definition as
 * P6/P8/P10: input (pointerdown / last keydown) -> last graph DOM mutation -> second rAF ("frame callback").
 * Changes for real projects:
 *  - edit settle = quiet AND the last analysisResult payload contains the probe ("data updated"); visibility of the
 *    probe (DOM / viewport / hit-test) is judged separately afterwards, so off-screen/virtualised nodes are not
 *    counted as missing data (P8-A).
 *  - every analysisResult gets a graph identity hash (FNV-1a over node id|kind|file|range and edge id|kind|source|target,
 *    sorted) so results can be compared across conditions.
 *  - file switch: the Root set by Generate is cleared once (untimed), then each Quick Open of another project file
 *    triggers the automatic analysis; timed from the Quick Open Enter keydown.
 *  - navigation check (after the edits, so it cannot move the viewport before them): double-click a visible, hit-testable function
 *    node -> editor cursor/tab change.
 * Env: P11_ACTIVE, P11_SWITCH (comma list, workspace-relative), P6_CACHE=on|off, P6_REPEATS, P6_EDITS, P6_DEPTH, P6_LABEL.
 */
import { test } from "@playwright/test";
import type { Frame, Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle, runCommand, codeCliVersion, activeTabName, cursorPosition, VSCodeSession } from "./lib/vscode";
import { openCogicPanel, humanDblclick } from "./lib/cogic";
import { Recorder } from "./lib/recorder";

const ACTIVE = process.env.P11_ACTIVE ?? "src/demo.ts";
const SWITCH = (process.env.P11_SWITCH ?? "").split(",").filter(Boolean);
const CACHE = (process.env.P6_CACHE ?? "off") === "on";
const REPEATS = Number(process.env.P6_REPEATS ?? 5);
const EDITS = Number(process.env.P6_EDITS ?? 5);
const DEPTH = process.env.P6_DEPTH ?? "1";
const LABEL = process.env.P6_LABEL ?? path.basename(ACTIVE);
const ACTIVE_ABS = path.join(process.env.STUDY_WORKSPACE ?? "", ACTIVE);
const ORIGINAL = fs.existsSync(ACTIVE_ABS) ? fs.readFileSync(ACTIVE_ABS) : null;

async function installProbe(f: Frame) {
  await f.evaluate(() => {
    const w = window as any;
    const now = () => performance.timeOrigin + performance.now();
    w.__p6 = { events: [] as any[], mut: { last: 0, lastFrame: 0, count: 0 }, probe: null as string | null };
    const P = w.__p6;
    const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
    const gHash = (g: any) => {
      if (!g) return null;
      const n = (g.nodes ?? []).map((x: any) => `${x.id}|${x.kind}|${x.file}|${JSON.stringify(x.range ?? null)}`).sort();
      const e = (g.edges ?? []).map((x: any) => `${x.id}|${x.kind}|${x.source}|${x.target}`).sort();
      return fnv(n.join("\n") + "\n#\n" + e.join("\n"));
    };
    document.addEventListener("pointerdown", (e) => {
      const el = (e.target as HTMLElement | null)?.closest("button");
      P.events.push({ k: "pointerdown", t: performance.timeOrigin + e.timeStamp, label: (el?.textContent ?? "").trim().slice(0, 40) });
    }, { capture: true, passive: true });
    window.addEventListener("message", (e) => {
      const d: any = e.data;
      const m = d && typeof d === "object" ? (d.type ? d : d.data && d.data.type ? d.data : null) : null;
      if (!m || (m.type !== "analysisResult" && m.type !== "activeFile")) return;
      const g = m.payload?.graph;
      const isRes = m.type === "analysisResult";
      const text = isRes ? JSON.stringify(g ?? null) : "";
      P.events.push({ k: m.type, t: now(), reason: m.request?.reason, lane: m.request?.lane, nodes: g?.nodes?.length ?? null, edges: g?.edges?.length ?? null,
        bytes: isRes ? JSON.stringify(m.payload ?? null).length : null, meta: isRes ? JSON.stringify(m.payload?.meta ?? null).slice(0, 300) : null,
        gHash: isRes ? gHash(g) : null, hasProbe: isRes && P.probe ? text.includes(P.probe) : null,
        file: m.type === "activeFile" ? (m.payload?.fileName ?? m.payload?.filePath ?? null) : null });
    }, { capture: true });
    const isGraph = (n: Node) => n instanceof Element && !!(n.closest(".react-flow__nodes, .react-flow__edges, .react-flow__node, .react-flow__edge") || n.querySelector?.(".react-flow__node, .react-flow__edge"));
    const loading = () => !!document.querySelector(".canvasLoading");
    let wasLoading = loading();
    new MutationObserver((recs) => {
      const t = now();
      const l = loading();
      if (l !== wasLoading) { P.events.push({ k: l ? "loadingShown" : "loadingHidden", t }); wasLoading = l; }
      if (recs.some((r) => isGraph(r.target) || [...r.addedNodes, ...r.removedNodes].some(isGraph))) {
        P.mut.last = t; P.mut.count++;
        const c = P.mut.count;
        requestAnimationFrame(() => requestAnimationFrame(() => { if (P.mut.count === c) P.mut.lastFrame = now(); }));
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-id", "d"] });
  });
}

async function viewState(f: Frame, needle: string, groupTitle: string) {
  return f.evaluate(([p, gt]) => {
    const flow = document.querySelector(".react-flow") as HTMLElement | null; const fr = flow?.getBoundingClientRect();
    const inView = (el: Element | null | undefined) => { if (!el || !fr) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.right > fr.left && r.left < fr.right && r.bottom > fr.top && r.top < fr.bottom; };
    const cands = ([...document.querySelectorAll(".react-flow__node:not(.react-flow__node-fileGroup), .cgChildNode")] as HTMLElement[]).filter((el) => (el.textContent ?? "").includes(p));
    const el = cands.sort((a, b) => a.textContent!.length - b.textContent!.length)[0];
    let hit = false;
    if (el && fr && inView(el)) { const r = el.getBoundingClientRect(); const x = Math.min(Math.max(r.x + r.width / 2, fr.left + 1), fr.right - 1), y = Math.min(Math.max(r.y + r.height / 2, fr.top + 1), fr.bottom - 1); const t = document.elementFromPoint(x, y); hit = !!t && (el.contains(t) || t.contains(el)); }
    const g = [...document.querySelectorAll(".react-flow__node-fileGroup")].find((x) => (x.querySelector(".cgGroupTitle")?.textContent ?? "").trim().startsWith(gt));
    return { inDom: !!el, inViewport: inView(el), hitTest: hit, groupInDom: !!g, groupInViewport: inView(g), groupCollapsed: g ? !!g.querySelector(".cgGroup--collapsed") : null };
  }, [needle, groupTitle] as const);
}

async function revealActiveGroup(f: Frame, page: Page, groupTitle: string): Promise<number> {
  const box = (await f.locator(".react-flow").first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const moves = [...Array(12).fill(300), ...Array(24).fill(-300)];
  let n = 0;
  for (const dy of moves) {
    if ((await viewState(f, "__p8_no_match__", groupTitle)).groupInViewport) return n;
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy + dy, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(400); n++;
  }
  return -1;
}

async function resetProbe(f: Frame, probe: string | null = null) {
  await f.evaluate((p) => { const P = (window as any).__p6; P.events = []; P.mut = { last: 0, lastFrame: 0, count: 0 }; P.probe = p; }, probe);
}

/** quiet for 1500 ms after the later of (last mutation, last result); with needProbe, the last result must carry the probe. */
async function waitSettled(f: Frame, needProbe = false, timeout = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const st = await f.evaluate((np) => {
      const P = (window as any).__p6;
      const nowT = performance.timeOrigin + performance.now();
      const res = P.events.filter((e: any) => e.k === "analysisResult");
      const last = res[res.length - 1];
      const ref = Math.max(P.mut.last, last ? last.t : 0);
      return { ok: !!last && ref > 0 && nowT - ref >= 1500 && !document.querySelector(".canvasLoading") && (!np || last.hasProbe === true) };
    }, needProbe);
    if (st.ok) return true;
    await f.page().waitForTimeout(200);
  }
  return false;
}

async function collect(f: Frame) {
  return f.evaluate(() => {
    const P = (window as any).__p6;
    return { events: P.events, lastGraphMutation: P.mut.last, frameAfterLastMutation: P.mut.lastFrame, mutations: P.mut.count,
      visibility: document.visibilityState, hasFocus: document.hasFocus(),
      domNodes: document.querySelectorAll(".react-flow__node").length, domChildNodes: document.querySelectorAll(".cgChildNode").length, domEdges: document.querySelectorAll(".react-flow__edge").length };
  });
}

function phases(raw: any, t0: number | null) {
  const first = (k: string) => raw.events.find((e: any) => e.k === k);
  const results = raw.events.filter((e: any) => e.k === "analysisResult");
  const lastRes = results[results.length - 1];
  const d = (a?: number | null, b?: number | null) => (a && b ? +(b - a).toFixed(2) : null);
  return {
    t0, inputToActiveFileMsgMs: d(t0, first("activeFile")?.t), inputToResultMs: d(t0, lastRes?.t),
    domChangedAfterResult: !!(lastRes && raw.lastGraphMutation > lastRes.t), resultToDomSettledMs: d(lastRes?.t, raw.lastGraphMutation),
    domSettledToFrameMs: d(raw.lastGraphMutation, raw.frameAfterLastMutation || null), inputToDomSettledMs: d(t0, raw.lastGraphMutation),
    inputToFrameMs: d(t0, raw.frameAfterLastMutation || null), analysisResults: results.length, resultReason: lastRes?.reason ?? null,
    payloadNodes: lastRes?.nodes ?? null, payloadEdges: lastRes?.edges ?? null, payloadChars: lastRes?.bytes ?? null, gHash: lastRes?.gHash ?? null, probeInPayload: lastRes?.hasProbe ?? null,
    domNodes: raw.domNodes, domChildNodes: raw.domChildNodes, domEdges: raw.domEdges, mutations: raw.mutations, visibility: raw.visibility, hasFocus: raw.hasFocus, rafObserved: !!raw.frameAfterLastMutation,
  };
}

test("P11 real-world UI", async () => {
  test.setTimeout(40 * 60 * 1000);
  const rec = new Recorder(`p11-ui-${LABEL}-cache-${CACHE ? "on" : "off"}`);
  const rows: any[] = [];
  const save = () => fs.writeFileSync(path.join(rec.dir, "samples.json"), JSON.stringify({ meta: { active: ACTIVE, switchFiles: SWITCH, cache: CACHE, depth: DEPTH, label: LABEL, repeats: REPEATS, edits: EDITS, vscode: codeCliVersion() }, rows }, null, 2));
  let s: VSCodeSession | undefined;
  try {
    s = (await rec.step("launch", () => launchVSCode({ profile: "p11-ui", extensions: ["cogic"], freshProfile: true, extraSettings: { "cogic.analysisCache.enabled": CACHE } })))!;
    const page: Page = s.page;
    rec.attach(page);
    await rec.step("prepare", async () => { await quickOpenFile(page, ACTIVE); await waitTsReady(page); await waitTsServerIdle(page); });
    const f = await openCogicPanel(page);
    await f.locator('select[aria-label="Graph depth"]').selectOption(DEPTH);
    await installProbe(f);
    const gen = f.locator("button", { hasText: /^\s*Generate\s*$/ }).first();
    for (let i = 0; i <= REPEATS; i++) {
      await resetProbe(f);
      await rec.step(`generate-${i}`, async () => {
        await gen.click({ delay: 80 });
        const ok = await waitSettled(f);
        const raw = await collect(f);
        const t0 = raw.events.find((e: any) => e.k === "pointerdown")?.t ?? null;
        rows.push({ scenario: i === 0 ? "first-generate" : "repeated-generate", iter: i, settled: ok, ...phases(raw, t0) });
        save();
      }, { soft: true });
    }
    if (EDITS > 0) {
      await page.evaluate(() => { const w = window as any; w.__p6k = { last: 0 }; document.addEventListener("keydown", (e) => { w.__p6k.last = performance.timeOrigin + e.timeStamp; }, { capture: true, passive: true }); });
      for (let e = 0; e < EDITS; e++) {
        const probe = `p11Probe${e}`;
        await rec.step(`edit-${e}`, async () => {
          const group = path.basename(ACTIVE);
          const pans = (await viewState(f, "__p8_no_match__", group)).groupInViewport ? 0 : await revealActiveGroup(f, page, group);
          await resetProbe(f, probe);
          await page.keyboard.press("Control+1"); await page.keyboard.press("Control+End"); await page.keyboard.press("Enter");
          await page.keyboard.type(`export function ${probe}(): number { return ${e}; }`, { delay: 5 });
          const tKey = await page.evaluate(() => (window as any).__p6k.last as number);
          const ok = await waitSettled(f, true, 120_000);
          const raw = await collect(f);
          const vs = await viewState(f, probe, group);
          rows.push({ scenario: "active-edit", iter: e, settled: ok, probe, pansBeforeEdit: pans, probeInDom: vs.inDom, probeInViewport: vs.inViewport, probeHitTest: vs.hitTest, groupInDom: vs.groupInDom, groupInViewport: vs.groupInViewport, groupCollapsed: vs.groupCollapsed, ...phases(raw, tKey) });
          save();
        }, { soft: true });
      }
      await page.keyboard.press("Control+1");
      await runCommand(page, "File: Revert File");
      await page.waitForTimeout(1500);
    }
    await rec.step("navigate-source", async () => {
      const target = await f.evaluate(() => {
        const flow = document.querySelector(".react-flow")!.getBoundingClientRect();
        const els = [...document.querySelectorAll(".react-flow__node:not(.react-flow__node-fileGroup):not(.react-flow__node-folderGroup) .cgNode, .cgChildNode")] as HTMLElement[];
        for (const el of els) {
          const title = (el.querySelector(".cgNodeTitle")?.textContent ?? el.textContent ?? "").trim();
          if (!/\(\)$/.test(title)) continue;
          const r = el.getBoundingClientRect(); if (r.width === 0 || r.left < flow.left || r.right > flow.right || r.top < flow.top || r.bottom > flow.bottom) continue;
          const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); if (!t || !(el.contains(t) || t.contains(el))) continue;
          el.setAttribute("data-p11-nav", "1"); return title;
        }
        return null;
      });
      const before = { tab: await activeTabName(page), cursor: await cursorPosition(page) };
      if (target) { await humanDblclick(f.locator('[data-p11-nav="1"]').first()); await page.waitForTimeout(2500); }
      const after = { tab: await activeTabName(page), cursor: await cursorPosition(page) };
      rows.push({ scenario: "navigate-source", node: target, before, after, moved: !!target && (before.tab !== after.tab || JSON.stringify(before.cursor) !== JSON.stringify(after.cursor)) });
      save();
    }, { soft: true });
    // Generate sets a file Root; while a Root is set, opening another file does not re-analyse (P4 policy) and Generate
    // re-analyses the Root. A user who wants the graph of another file clears the Root once (outside the timed interval);
    // after that, opening a file triggers the automatic analysis. Timed from the Quick Open Enter keydown.
    await rec.step("clear-root-before-switch", async () => {
      // the canvas banner button can be covered by the diagnostics popup; use whichever "Clear root" button (canvas banner or
      // Inspector ROOT panel) passes a hit test, as a user would.
      const all = f.locator("button", { hasText: /^\s*Clear root\s*$/i });
      let clicked = "";
      for (let i = 0; i < (await all.count()) && !clicked; i++) {
        const b = all.nth(i);
        const st = await b.evaluate((el) => { const r = el.getBoundingClientRect(); if (!r.width) return null; const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { ok: !!t && (el === t || el.contains(t)), where: el.closest(".rootBanner") ? "canvas banner" : "inspector" }; });
        // the button disappears once the Root is cleared, so where it was is read before the click
        if (st && st.ok) { clicked = st.where; await resetProbe(f); await b.click({ delay: 80 }); await waitSettled(f, false, 120_000); }
      }
      rows.push({ scenario: "clear-root-click", via: clicked || "none hit-testable" });
      rows.push({ scenario: "clear-root", rootBanner: await f.evaluate(() => (document.querySelector(".rootBanner")?.textContent ?? "").trim()) });
      save();
    }, { soft: true });
    for (let k = 0; k < SWITCH.length; k++) {
      await rec.step(`switch-${k}`, async () => {
        await page.keyboard.press("Control+1");
        // probe = switched file path: settle only on a result whose graph payload contains that file
        await resetProbe(f, SWITCH[k].split("/").pop()!);
        await quickOpenFile(page, SWITCH[k]);
        const tKey = await page.evaluate(() => (window as any).__p6k?.last as number);
        const ok = await waitSettled(f, true, 120_000);
        const raw = await collect(f);
        const banner = await f.evaluate(() => (document.querySelector(".rootBanner")?.textContent ?? "").trim());
        const target = SWITCH[k].split("/").pop()!;
        const graphForFile = await f.evaluate((t) => [...document.querySelectorAll(".cgGroupTitle")].some((x) => (x.textContent ?? "").includes(t)), target);
        rows.push({ scenario: "file-switch", iter: k, file: SWITCH[k], settled: ok, rootBanner: banner, groupForSwitchedFileInDom: graphForFile, ...phases(raw, tKey) });
        save();
      }, { soft: true });
    }
  } finally {
    save();
    await closeVSCode(s);
    if (ORIGINAL && !fs.readFileSync(ACTIVE_ABS).equals(ORIGINAL)) {
      fs.writeFileSync(ACTIVE_ABS, ORIGINAL);
      rows.push({ scenario: "restore-warning", note: "active file was modified on disk and has been restored" });
      save();
    }
    rec.flush();
  }
});
