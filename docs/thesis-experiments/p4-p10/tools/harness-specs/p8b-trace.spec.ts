/**
 * P8-B: Chromium trace of a graph update in the real VS Code webview.
 * - Tracing: Electron main-process `contentTracing` (browser-wide: browser, renderers, GPU), short windows only.
 * - Alignment: the passive webview observer writes performance.mark("p8:T0|T2|T3|T4"); user-timing marks are
 *   emitted into the SAME trace timeline as Paint / compositor / viz events, so no cross-process subtraction is needed.
 * - Targets: CDP Target.getTargets from the workbench page is recorded to document what is traceable.
 * No product code changes. Env: P8_ACTIVE, P8_DEPTH, P8_LABEL, P8_REPEATS, P8_CACHE.
 */
import { test } from "@playwright/test";
import type { Frame } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle, codeCliVersion, VSCodeSession } from "./lib/vscode";
import { openCogicPanel, humanClick, waitGraphStable } from "./lib/cogic";
import { Recorder } from "./lib/recorder";

const ACTIVE = process.env.P8_ACTIVE ?? "entry.ts";
const DEPTH = process.env.P8_DEPTH ?? "1";
const LABEL = process.env.P8_LABEL ?? "synthetic";
const REPEATS = Number(process.env.P8_REPEATS ?? 3);
const CACHE = (process.env.P8_CACHE ?? "off") === "on";
const CATEGORIES = [
  "blink.user_timing", "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame",
  "toplevel", "benchmark", "cc", "viz", "gpu", "disabled-by-default-viz.gpu_composite_time",
];

async function installMarks(f: Frame) {
  await f.evaluate(() => {
    const w = window as any;
    const now = () => performance.timeOrigin + performance.now();
    w.__p8b = { log: [] as any[], muts: 0, armed: false };
    const P = w.__p8b;
    const mark = (n: string) => { performance.mark(n); P.log.push({ n, t: now() }); };
    document.addEventListener("pointerdown", (e) => {
      if (!P.armed) return;
      const b = (e.target as HTMLElement | null)?.closest("button");
      if (b && /Generate/.test(b.textContent ?? "")) mark("p8:T0");
    }, { capture: true, passive: true });
    window.addEventListener("message", (e) => {
      const d: any = e.data; const m = d && typeof d === "object" ? (d.type ? d : d.data?.type ? d.data : null) : null;
      if (P.armed && m?.type === "analysisResult") mark("p8:T2");
    }, { capture: true });
    const isGraph = (n: Node) => n instanceof Element && !!(n.closest(".react-flow__nodes, .react-flow__edges, .react-flow__node, .react-flow__edge") || n.querySelector?.(".react-flow__node, .react-flow__edge"));
    new MutationObserver((recs) => {
      if (!P.armed) return;
      if (recs.some((r) => isGraph(r.target) || [...r.addedNodes, ...r.removedNodes].some(isGraph))) {
        P.muts++; const c = P.muts; mark(`p8:T3#${c}`);
        requestAnimationFrame(() => requestAnimationFrame(() => { if (P.muts === c) mark(`p8:T4#${c}`); }));
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-id", "d"] });
  });
}

test("P8-B trace graph update", async () => {
  const rec = new Recorder(`p8b-trace-${LABEL}-cache-${CACHE ? "on" : "off"}`);
  const ev: Record<string, any> = { active: ACTIVE, depth: DEPTH, label: LABEL, cache: CACHE, categories: CATEGORIES, traces: [] };
  const save = () => fs.writeFileSync(path.join(rec.dir, "trace-meta.json"), JSON.stringify(ev, null, 2));
  let s: VSCodeSession | undefined;
  try {
    s = (await rec.step("launch", () => launchVSCode({ profile: "p8b", extensions: ["cogic"], extraSettings: { "cogic.analysisCache.enabled": CACHE } })))!;
    const { page, app } = s; rec.attach(page);
    ev.vscode = codeCliVersion();
    ev.electron = await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome }));
    await rec.step("prepare", async () => { await quickOpenFile(page, ACTIVE); await waitTsReady(page); await waitTsServerIdle(page); });
    const f = await openCogicPanel(page);
    await f.locator('select[aria-label="Graph depth"]').selectOption(DEPTH);
    const gen = f.locator("button", { hasText: /^\s*Generate\s*$/ }).first();
    await rec.step("initial-generate", async () => { await humanClick(gen); await waitGraphStable(f, { minNodes: 1, timeout: 180_000 }); });
    // Which targets are visible to CDP from the workbench page?
    try {
      const cdp = await page.context().newCDPSession(page);
      const t = await cdp.send("Target.getTargets");
      ev.cdpTargets = t.targetInfos.map((x: any) => ({ type: x.type, url: String(x.url).slice(0, 120), attached: x.attached }));
      await cdp.detach();
    } catch (e) { ev.cdpTargetsError = String(e); }
    ev.playwrightFrames = page.frames().map((fr) => fr.url().slice(0, 120));
    await installMarks(f);
    for (let i = 0; i < REPEATS; i++) {
      const file = path.join(rec.dir, `trace-${i}.json`);
      await rec.step(`traced-generate-${i}`, async () => {
        await f.evaluate(() => { const P = (window as any).__p8b; P.log = []; P.muts = 0; P.armed = true; performance.clearMarks(); });
        await app.evaluate(async ({ contentTracing }, cats) => {
          await contentTracing.startRecording({ included_categories: cats, excluded_categories: ["*"] } as any);
        }, CATEGORIES);
        await page.waitForTimeout(300);
        await humanClick(gen);
        // settle: no graph mutation for 1.5 s after an analysisResult
        const t0 = Date.now();
        while (Date.now() - t0 < 120_000) {
          const st = await f.evaluate(() => { const P = (window as any).__p8b; const last = P.log[P.log.length - 1]; const got = P.log.some((x: any) => x.n === "p8:T2"); return { got, quiet: last ? performance.timeOrigin + performance.now() - last.t : 0 }; });
          if (st.got && st.quiet > 1500) break;
          await page.waitForTimeout(200);
        }
        const out = await app.evaluate(async ({ contentTracing }, p) => contentTracing.stopRecording(p), file);
        const log = await f.evaluate(() => { const P = (window as any).__p8b; P.armed = false; return P.log; });
        ev.traces.push({ i, file: path.basename(out), sizeBytes: fs.statSync(out).size, markLog: log });
        save();
      });
    }
  } finally {
    save(); rec.flush(); await closeVSCode(s);
  }
});
