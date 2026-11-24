import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle } from "./lib/vscode";
import { openCogicPanel, waitGraphStable } from "./lib/cogic";

test("baseline compatibility payload", async () => {
  test.setTimeout(180_000);
  const before = Math.round(os.freemem()/1048576);
  if (before < 800) throw Error(`insufficient memory ${before}`);
  const session = await launchVSCode({ profile: process.env.RUN_ID!, extensions: ["cogic"], extraSettings: { "cogic.analysisCache.enabled": false } });
  let minimum = before, aborted = false;
  const monitor = setInterval(() => { minimum = Math.min(minimum, Math.round(os.freemem()/1048576)); if (minimum < 400 && !aborted) { aborted = true; void session.app.close(); } }, 1000);
  try {
    await quickOpenFile(session.page, "src/main.ts"); await waitTsReady(session.page, 120_000); await waitTsServerIdle(session.page, 120_000);
    const frame = await openCogicPanel(session.page);
    await frame.evaluate(() => { (window as any).__p12dCompat = []; window.addEventListener("message", e => { if (e.data?.type === "analysisResult" || e.data?.type === "runtimeDebug") (window as any).__p12dCompat.push(e.data); }); });
    await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
    await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
    await waitGraphStable(frame, { minNodes: 1, quietMs: 2000, timeout: 60_000 });
    let snapshot: any;
    if (process.env.P12D_COMPAT === "trace") {
      await frame.locator('button[title="Trace mode OFF"]').click();
      await expect.poll(() => frame.evaluate(() => (window as any).__p12dCompat.some((m: any) => m.type === "analysisResult" && m.payload?.trace?.length)), { timeout: 60_000 }).toBeTruthy();
      snapshot = await frame.evaluate(() => { const p = (window as any).__p12dCompat.filter((m: any) => m.type === "analysisResult" && m.payload?.trace?.length).at(-1).payload; return { graph: p.graph, trace: p.trace }; });
    } else {
      await session.page.keyboard.press("F5");
      await expect(session.page.getByRole("tab", { name: /Run and Debug.*1 active session/ })).toBeVisible({ timeout: 60_000 });
      await expect.poll(() => frame.evaluate(() => (window as any).__p12dCompat.some((m: any) => m.type === "runtimeDebug" && m.payload?.state === "paused" && m.payload?.frame && m.payload?.variables?.some((v: any) => v.name === "p12dLocal"))), { timeout: 60_000 }).toBeTruthy();
      const paused = await frame.evaluate(() => (window as any).__p12dCompat.find((m: any) => m.type === "runtimeDebug" && m.payload?.state === "paused" && m.payload?.frame && m.payload?.variables?.some((v: any) => v.name === "p12dLocal")).payload);
      const local = paused.variables.find((v: any) => v.name === "p12dLocal");
      snapshot = { state: paused.state, frame: {name: paused.frame.name, sourceName: paused.frame.sourceName, filePath: paused.frame.filePath, line: paused.frame.line, column: paused.frame.column }, local: { scope: local.scope, name: local.name, value: local.value, type: local.type, evaluateName: local.evaluateName } };
      await session.page.keyboard.press("Shift+F5");
      await expect(session.page.getByRole("tab", { name: /Run and Debug.*1 active session/ })).toHaveCount(0, { timeout: 60_000 });
    }
    const root = process.env.STUDY_WORKSPACE!.replace(/\\/g, "/").toLowerCase();
    const rootPattern = new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const normalize = (v: any): any => typeof v === "string" ? v.replace(/\\/g, "/").replace(rootPattern, "<fixture>") : Array.isArray(v) ? v.map(normalize) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, value]) => [k, normalize(value)])) : v;
    const normalized = JSON.stringify(normalize(snapshot));
    const summary = { mode: process.env.P12D_COMPAT, sha256: crypto.createHash("sha256").update(normalized).digest("hex"), nodes: snapshot.graph?.nodes.length, edges: snapshot.graph?.edges.length, traceEvents: snapshot.trace?.length, before, minimum };
    fs.writeFileSync(path.join(process.env.P12D_OUTPUT!, "payload.normalized.json"), normalized);
    fs.writeFileSync(path.join(process.env.P12D_OUTPUT!, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
  } finally { clearInterval(monitor); await closeVSCode(session); if (aborted) throw Error("Stopped: sampled available memory below 400 MiB"); }
});
