/**
 * P6 UI response-time probe (P6-A total response, P6-B edit->graph update, P6-C scale, P6-D cache).
 *
 * Inputs are real UI inputs (click on Generate, typing in the editor). Timing is observed PASSIVELY:
 *  - webview: a capture-phase pointerdown listener, a window "message" listener (sees the extension's
 *    analysisResult / activeFile messages as the Cogic app receives them), a MutationObserver on the
 *    React Flow DOM, and requestAnimationFrame callbacks queued after each graph mutation;
 *  - workbench: a capture-phase keydown listener for the last keystroke of an edit.
 * Nothing is posted to the extension and no synthetic DOM event is dispatched. All timestamps are
 * performance.timeOrigin + performance.now() (epoch ms, sub-ms resolution) so frames can be compared.
 * The Cogic product code is unchanged; the extension-internal analysis time is NOT visible here and
 * is measured separately by the Node benchmark (research-results/p6-bench).
 *
 * Env: P6_ACTIVE (workspace-relative file), P6_CACHE=on|off, P6_LAUNCHES (>=1, 1st cold, rest warm restart),
 *      P6_REPEATS (repeated Generate per launch), P6_EDITS (edits per launch, 0 to skip), P6_DEPTH (0-3),
 *      P6_LABEL (target label for the CSV), P6_EDIT_SYMBOL (function to place the cursor before editing).
 */
import { test } from "@playwright/test";
import type { Frame, Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle, runCommand, codeCliVersion, VSCodeSession } from "./lib/vscode";
import { openCogicPanel, humanClick, fitGraph } from "./lib/cogic";
import { Recorder } from "./lib/recorder";

const ACTIVE = process.env.P6_ACTIVE ?? "src/demo.ts";
const CACHE = (process.env.P6_CACHE ?? "off") === "on";
const LAUNCHES = Number(process.env.P6_LAUNCHES ?? 2);
const REPEATS = Number(process.env.P6_REPEATS ?? 5);
const EDITS = Number(process.env.P6_EDITS ?? 5);
const DEPTH = process.env.P6_DEPTH ?? "1";
const LABEL = process.env.P6_LABEL ?? path.basename(ACTIVE);
const QUIET_MS = 1500;
// Safety net: the active file's original bytes are restored after every launch (edits are meant to stay unsaved).
const ACTIVE_ABS = path.join(process.env.STUDY_WORKSPACE ?? "", ACTIVE);
const ORIGINAL = fs.existsSync(ACTIVE_ABS) ? fs.readFileSync(ACTIVE_ABS) : null;

async function installProbe(f: Frame) {
  await f.evaluate(() => {
    const w = window as any;
    const now = () => performance.timeOrigin + performance.now();
    w.__p6 = { events: [] as any[], mut: { last: 0, lastFrame: 0, count: 0 } };
    const P = w.__p6;
    document.addEventListener("pointerdown", (e) => {
      const el = (e.target as HTMLElement | null)?.closest("button");
      P.events.push({ k: "pointerdown", t: performance.timeOrigin + e.timeStamp, label: (el?.textContent ?? "").trim().slice(0, 40) });
    }, { capture: true, passive: true });
    window.addEventListener("message", (e) => {
      const d: any = e.data;
      const m = d && typeof d === "object" ? (d.type ? d : d.data && d.data.type ? d.data : null) : null;
      if (!m || (m.type !== "analysisResult" && m.type !== "activeFile")) return;
      const g = m.payload?.graph;
      P.events.push({ k: m.type, t: now(), reason: m.request?.reason, lane: m.request?.lane, nodes: g?.nodes?.length ?? null, edges: g?.edges?.length ?? null,
        bytes: m.type === "analysisResult" ? JSON.stringify(m.payload ?? null).length : null });
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

async function resetProbe(f: Frame) {
  await f.evaluate(() => { const P = (window as any).__p6; P.events = []; P.mut = { last: 0, lastFrame: 0, count: 0 }; });
}

/** Waits until no graph mutation for QUIET_MS (and, if given, until predicate text appears in the graph DOM). */
async function waitSettled(f: Frame, mustContain?: string, timeout = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const st = await f.evaluate((needle) => {
      const P = (window as any).__p6;
      const nowT = performance.timeOrigin + performance.now();
      const has = needle ? (document.querySelector(".react-flow")?.textContent ?? "").includes(needle) : true;
      const res = P.events.filter((e: any) => e.k === "analysisResult");
      const gotResult = res.length > 0;
      // quiet = no graph mutation for 1500 ms after the later of (last mutation, last analysisResult)
      const ref = Math.max(P.mut.last, gotResult ? res[res.length - 1].t : 0);
      return { quiet: ref > 0 && nowT - ref >= 1500, has, gotResult, loading: !!document.querySelector(".canvasLoading") };
    }, mustContain ?? null);
    if (st.quiet && st.has && st.gotResult && !st.loading) return true;
    await f.page().waitForTimeout(200);
  }
  return false;
}

async function collect(f: Frame) {
  return f.evaluate(() => {
    const P = (window as any).__p6;
    return {
      events: P.events, lastGraphMutation: P.mut.last, frameAfterLastMutation: P.mut.lastFrame, mutations: P.mut.count,
      visibility: document.visibilityState, hasFocus: document.hasFocus(),
      domNodes: document.querySelectorAll(".react-flow__node").length, domChildNodes: document.querySelectorAll(".cgChildNode").length,
      domEdges: document.querySelectorAll(".react-flow__edge").length,
    };
  });
}

function phases(raw: any, t0: number | null) {
  const first = (k: string) => raw.events.find((e: any) => e.k === k);
  const results = raw.events.filter((e: any) => e.k === "analysisResult");
  const lastRes = results[results.length - 1];
  const d = (a?: number | null, b?: number | null) => (a && b ? +(b - a).toFixed(2) : null);
  return {
    t0,
    inputToLoadingShownMs: d(t0, first("loadingShown")?.t),
    inputToActiveFileMsgMs: d(t0, first("activeFile")?.t),
    inputToResultMs: d(t0, lastRes?.t),
    domChangedAfterResult: !!(lastRes && raw.lastGraphMutation > lastRes.t),
    resultToDomSettledMs: d(lastRes?.t, raw.lastGraphMutation),
    domSettledToFrameMs: d(raw.lastGraphMutation, raw.frameAfterLastMutation || null),
    inputToDomSettledMs: d(t0, raw.lastGraphMutation),
    inputToFrameMs: d(t0, raw.frameAfterLastMutation || null),
    analysisResults: results.length,
    resultReason: lastRes?.reason ?? null,
    payloadNodes: lastRes?.nodes ?? null, payloadEdges: lastRes?.edges ?? null, payloadChars: lastRes?.bytes ?? null,
    domNodes: raw.domNodes, domChildNodes: raw.domChildNodes, domEdges: raw.domEdges,
    mutations: raw.mutations, visibility: raw.visibility, hasFocus: raw.hasFocus, rafObserved: !!raw.frameAfterLastMutation,
  };
}

test("P6 UI response time", async () => {
  const rec = new Recorder(`p6-ui-${LABEL}-cache-${CACHE ? "on" : "off"}`);
  const rows: any[] = [];
  const save = () => {
    fs.writeFileSync(path.join(rec.dir, "samples.json"), JSON.stringify({ meta: { active: ACTIVE, cache: CACHE, depth: DEPTH, label: LABEL, launches: LAUNCHES, repeats: REPEATS, edits: EDITS, vscode: codeCliVersion() }, rows }, null, 2));
  };
  for (let launch = 0; launch < LAUNCHES; launch++) {
    let s: VSCodeSession | undefined;
    const startKind = launch === 0 ? "cold-start" : "warm-restart";
    try {
      s = (await rec.step(`launch-${launch}`, () => launchVSCode({ profile: "p6-ui", extensions: ["cogic"], freshProfile: launch === 0, extraSettings: { "cogic.analysisCache.enabled": CACHE } })))!;
      const page: Page = s.page;
      rec.attach(page);
      await rec.step(`prepare-${launch}`, async () => {
        await quickOpenFile(page, ACTIVE);
        await waitTsReady(page); await waitTsServerIdle(page);
      });
      const f = await openCogicPanel(page);
      await f.locator('select[aria-label="Graph depth"]').selectOption(DEPTH);
      await installProbe(f);
      const gen = f.locator("button", { hasText: /^\s*Generate\s*$/ }).first();
      // first Generate of this VS Code process, then identical repeats
      for (let i = 0; i <= REPEATS; i++) {
        await resetProbe(f);
        await rec.step(`${startKind}-generate-${i}`, async () => {
          await humanClick(gen);
          const ok = await waitSettled(f);
          const raw = await collect(f);
          const t0 = raw.events.find((e: any) => e.k === "pointerdown")?.t ?? null;
          rows.push({ launch, scenario: i === 0 ? startKind : "repeated-generate", iter: i, settled: ok, ...phases(raw, t0), events: raw.events });
          save();
        });
      }
      // active-file edits (auto-analysis path: change event -> 350 ms debounce -> analysis -> post -> render)
      if (EDITS > 0) {
        await page.evaluate(() => {
          const w = window as any; w.__p6k = { last: 0 };
          document.addEventListener("keydown", (e) => { w.__p6k.last = performance.timeOrigin + e.timeStamp; }, { capture: true, passive: true });
        });
        for (let e = 0; e < EDITS; e++) {
          const probe = `p6Probe${launch}x${e}`;
          await resetProbe(f);
          await rec.step(`edit-${launch}-${e}`, async () => {
            await page.keyboard.press("Control+1");
            await page.keyboard.press("Control+End");
            await page.keyboard.press("Enter");
            await page.keyboard.type(`export function ${probe}(): number { return ${e}; }`, { delay: 5 });
            const tKey = await page.evaluate(() => (window as any).__p6k.last as number);
            const ok = await waitSettled(f, probe, 60_000);
            const raw = await collect(f);
            await fitGraph(f);
            const visible = await f.evaluate((p) => (document.querySelector(".react-flow")?.textContent ?? "").includes(p), probe);
            rows.push({ launch, scenario: "active-edit", iter: e, settled: ok, probe, probeVisibleAfterFit: visible, ...phases(raw, tKey), events: raw.events });
            save();
          });
        }
        await page.keyboard.press("Control+1");
        await runCommand(page, "File: Revert File");
        await page.waitForTimeout(1500);
      }
    } finally {
      save();
      await closeVSCode(s);
      if (ORIGINAL && !fs.readFileSync(ACTIVE_ABS).equals(ORIGINAL)) {
        fs.writeFileSync(ACTIVE_ABS, ORIGINAL);
        rec.log(`WARNING: ${ACTIVE} differed from original after launch ${launch}; original bytes restored`);
        rows.push({ launch, scenario: "restore-warning", note: "active file was modified on disk and has been restored" });
        save();
      }
    }
  }
  rec.flush();
});
