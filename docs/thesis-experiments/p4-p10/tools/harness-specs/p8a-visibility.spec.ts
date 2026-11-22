/**
 * P8-A diagnostic (not a performance test): where does a newly added function go in a large graph?
 * Distinguishes A (in analysisResult payload) / B (in graph DOM) / C (inside the visible viewport).
 * Passive observation only: window "message" listener, DOM reads, real clicks/keys/wheel. No product changes.
 * Env: P8_ACTIVE (default entry.ts), P8_DEPTH (default 1), P8_LABEL.
 */
import { test } from "@playwright/test";
import type { Frame } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle, runCommand, codeCliVersion, VSCodeSession } from "./lib/vscode";
import { openCogicPanel, humanClick, fitGraph, waitGraphStable } from "./lib/cogic";
import { Recorder } from "./lib/recorder";

const ACTIVE = process.env.P8_ACTIVE ?? "entry.ts";
const DEPTH = process.env.P8_DEPTH ?? "1";
const LABEL = process.env.P8_LABEL ?? "synthetic";
const ACTIVE_ABS = path.join(process.env.STUDY_WORKSPACE ?? "", ACTIVE);
const ORIGINAL = fs.existsSync(ACTIVE_ABS) ? fs.readFileSync(ACTIVE_ABS) : null;

async function installListener(f: Frame) {
  await f.evaluate(() => {
    const w = window as any;
    w.__p8 = { results: [] as any[] };
    window.addEventListener("message", (e) => {
      const d: any = e.data;
      const m = d && typeof d === "object" ? (d.type ? d : d.data && d.data.type ? d.data : null) : null;
      if (!m || m.type !== "analysisResult") return;
      const nodes = m.payload?.graph?.nodes ?? [];
      w.__p8.results.push({ t: performance.timeOrigin + performance.now(), reason: m.request?.reason, nodes: nodes.length, edges: m.payload?.graph?.edges?.length ?? 0,
        names: nodes.map((n: any) => `${n.name ?? n.label ?? ""}|${n.kind ?? ""}|${n.file ?? ""}|${n.parentId ?? ""}`) });
    }, { capture: true });
  });
}

/** Facts about the probe in the rendered graph (B and C) plus viewport/group state. */
async function domState(f: Frame, probe: string) {
  return f.evaluate((p) => {
    const flow = document.querySelector(".react-flow") as HTMLElement | null;
    const vp = document.querySelector(".react-flow__viewport") as HTMLElement | null;
    const fr = flow?.getBoundingClientRect();
    const m = /matrix\(([^)]+)\)/.exec(vp ? getComputedStyle(vp).transform : "");
    const scale = m ? Number(m[1].split(",")[0]) : null;
    const all = [...document.querySelectorAll(".react-flow__node, .cgChildNode")] as HTMLElement[];
    const hits = all.filter((el) => (el.textContent ?? "").includes(p) && !el.classList.contains("react-flow__node-fileGroup"));
    const el = hits.sort((a, b) => (a.textContent!.length - b.textContent!.length))[0];
    let inViewport = false, hitTest = false, rect: any = null, visibleStyle = false;
    if (el && fr) {
      const r = el.getBoundingClientRect(); rect = { x: r.x, y: r.y, w: r.width, h: r.height };
      inViewport = r.right > fr.left && r.left < fr.right && r.bottom > fr.top && r.top < fr.bottom && r.width > 0 && r.height > 0;
      const cs = getComputedStyle(el); visibleStyle = cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0;
      const cx = Math.min(Math.max(r.x + r.width / 2, fr.left + 1), fr.right - 1), cy = Math.min(Math.max(r.y + r.height / 2, fr.top + 1), fr.bottom - 1);
      const top = document.elementFromPoint(cx, cy); hitTest = !!top && (el.contains(top) || top.contains(el));
    }
    const groups = [...document.querySelectorAll(".react-flow__node-fileGroup")].map((g) => ({
      title: (g.querySelector(".cgGroupTitle")?.textContent ?? "").trim().slice(0, 40),
      collapsed: !!g.querySelector(".cgGroup--collapsed"),
    }));
    const activeGroup = groups.filter((g) => /^entry\.ts|^demo\.ts/.test(g.title));
    const searchHits = document.querySelectorAll(".cgNode--searchHit").length;
    return {
      scale, flowRect: fr ? { w: fr.width, h: fr.height } : null,
      domNodes: document.querySelectorAll(".react-flow__node").length, domChildNodes: document.querySelectorAll(".cgChildNode").length,
      domEdges: document.querySelectorAll(".react-flow__edge").length,
      fileGroupsInDom: groups.length, collapsedGroupsInDom: groups.filter((g) => g.collapsed).length, activeGroup,
      probeInDom: !!el, probeRect: rect, probeInViewport: inViewport, probeHitTest: hitTest, probeVisibleStyle: visibleStyle,
      searchHits, visibility: document.visibilityState,
    };
  }, probe);
}

test("P8-A large-graph edit visibility diagnosis", async () => {
  const rec = new Recorder(`p8a-visibility-${LABEL}`);
  const probe = `p8probe_${crypto.randomBytes(4).toString("hex")}`;
  const ev: Record<string, any> = { probe, active: ACTIVE, depth: DEPTH, label: LABEL };
  const save = () => fs.writeFileSync(path.join(rec.dir, "diagnosis.json"), JSON.stringify(ev, null, 2));
  let s: VSCodeSession | undefined;
  try {
    s = (await rec.step("launch", () => launchVSCode({ profile: "p8a", extensions: ["cogic"], extraSettings: { "cogic.analysisCache.enabled": false } })))!;
    const page = s.page; rec.attach(page);
    ev.vscode = codeCliVersion();
    await rec.step("prepare", async () => { await quickOpenFile(page, ACTIVE); await waitTsReady(page); await waitTsServerIdle(page); });
    const f = await openCogicPanel(page);
    await installListener(f);
    await rec.step("generate", async () => {
      await f.locator('select[aria-label="Graph depth"]').selectOption(DEPTH);
      await humanClick(f.locator("button", { hasText: /^\s*Generate\s*$/ }).first());
      await waitGraphStable(f, { minNodes: 1, timeout: 180_000 });
      ev.s0_afterGenerate = await domState(f, "runEntry");
    });
    await rec.step("edit", async () => {
      await page.keyboard.press("Control+1");
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type(`export function ${probe}(): number { return 1; }`, { delay: 5 });
      ev.editDoneAt = await f.evaluate(() => performance.timeOrigin + performance.now());
      // A: wait for an analysisResult whose payload contains the probe (max 60 s)
      const t0 = Date.now();
      while (Date.now() - t0 < 60_000) {
        const r = await f.evaluate((p) => (window as any).__p8.results.filter((x: any) => x.names.some((n: string) => n.includes(p))), probe);
        if (r.length) { ev.A = { inPayload: true, at: r[0].t, msAfterEdit: +(r[0].t - ev.editDoneAt).toFixed(1), nodes: r[0].nodes, edges: r[0].edges, entry: r[0].names.find((n: string) => n.includes(probe)) }; break; }
        await page.waitForTimeout(250);
      }
      ev.A ??= { inPayload: false };
      await page.waitForTimeout(3000);
      ev.s1_noInteraction = await domState(f, probe);
    });
    await rec.step("fit-graph", async () => { await fitGraph(f); await page.waitForTimeout(1500); ev.s2_afterFit = await domState(f, probe); });
    // Pan scan with real mouse drags on the canvas (fixed steps) until the probe is rendered and inside the viewport.
    await rec.step("pan-scan", async () => {
      const flow = f.locator(".react-flow").first();
      const box = (await flow.boundingBox())!;
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const scan: any[] = [];
      const moves = [...Array(12).fill([0, 300]), ...Array(24).fill([0, -300])]; // down first (content moves down = view up), then up
      for (const [dx, dy] of moves) {
        const st = await domState(f, probe);
        scan.push({ probeInDom: st.probeInDom, probeInViewport: st.probeInViewport, groups: st.fileGroupsInDom, activeGroup: st.activeGroup.length });
        if (st.probeInViewport) break;
        await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + dx, cy + dy, { steps: 10 }); await page.mouse.up();
        await page.waitForTimeout(400);
      }
      ev.panScan = scan;
      ev.s3_afterPan = await domState(f, probe);
    });
    await rec.step("zoom-on-probe", async () => {
      const st = ev.s3_afterPan;
      if (st.probeInViewport) {
        const el = f.locator(".cgChildNode, .react-flow__node:not(.react-flow__node-fileGroup)", { hasText: probe }).last();
        const pb = await el.boundingBox();
        if (pb) {
          await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
          for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(200); }
          await page.waitForTimeout(1200);
        }
      }
      ev.s4_afterZoom = await domState(f, probe);
    });
    await rec.step("revert", async () => { await page.keyboard.press("Control+1"); await runCommand(page, "File: Revert File"); await page.waitForTimeout(1500); });
  } catch (e) { ev.error = String(e); throw e; } finally {
    try { if (s) { await s.page.keyboard.press("Escape"); await s.page.keyboard.press("Control+1"); await runCommand(s.page, "File: Revert File"); await s.page.waitForTimeout(1000); } } catch { ev.revertFailed = true; }
    save();
    rec.flush();
    await closeVSCode(s);
    if (ORIGINAL && !fs.readFileSync(ACTIVE_ABS).equals(ORIGINAL)) { fs.writeFileSync(ACTIVE_ABS, ORIGINAL); ev.restoreWarning = true; save(); }
  }
});
