// Run in the P13 harness with a fresh profile and an isolated extension build.
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle } from "./lib/vscode";
import { openCogicPanel, waitGraphStable } from "./lib/cogic";

const log = process.env.COGIC_PIPELINE_PROFILE!;
function records(): any[] {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

test("P12C isolated Generate", async () => {
  test.setTimeout(300_000);
  const before = Math.round(os.freemem() / 1048576);
  if (before < 1200) throw Error(`Insufficient available memory before launch: ${before} MiB`);
  const session = await launchVSCode({ profile: process.env.RUN_ID!, extensions: ["cogic"], extraSettings: { "cogic.analysisCache.enabled": true } });
  let minimum = before, aborted = false;
  const monitor = setInterval(() => {
    minimum = Math.min(minimum, Math.round(os.freemem() / 1048576));
    if (minimum < 400 && !aborted) { aborted = true; void session.app.close(); }
  }, 1000);
  async function idle() {
    let last = "", since = Date.now();
    for (let i = 0; i < 180; i++) {
      const rows = records(), starts = rows.filter(r => r.event === "request.begin");
      const pending = starts.filter(r => !rows.some(end => end.requestId === r.requestId && ["postMessage.call", "request.dropped", "request.cancelled", "request.failed", "request.empty"].includes(end.event)));
      const signature = `${rows.length}:${pending.length}`;
      if (signature !== last) { last = signature; since = Date.now(); }
      if (!pending.length && Date.now() - since >= 3000) return;
      if (aborted) throw Error("Stopped: available memory below 400 MiB");
      await session.page.waitForTimeout(500);
    }
    throw Error("Analysis did not become idle");
  }
  try {
    await quickOpenFile(session.page, process.env.P12C_FILE ?? "src/main.ts");
    await waitTsReady(session.page, 120_000);
    await waitTsServerIdle(session.page, 180_000);
    const frame = await openCogicPanel(session.page);
    await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
    await idle();
    const start = Date.now();
    await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
    await expect.poll(() => records().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).length, { timeout: 30_000 }).toBeGreaterThan(0);
    const id = records().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).at(-1).requestId;
    await expect.poll(() => records().some(r => r.requestId === id && r.event === "pipeline.canvas.twoAnimationFrames"), { timeout: 120_000 }).toBeTruthy();
    await waitGraphStable(frame, { minNodes: 1, quietMs: 3000, timeout: 120_000 });
    const rows = records().filter(r => r.requestId === id);
    for (const event of ["request.begin", "postMessage.call", "pipeline.result.received", "pipeline.canvas.commit", "pipeline.canvas.twoAnimationFrames"]) expect(rows.some(r => r.event === event), event).toBeTruthy();
    const inspector = await frame.locator(".inspectorBody").innerText();
    expect(inspector.toUpperCase()).toContain("PARAM FLOW");
    expect(inspector).toContain("Example.request -> Example.fetch");
    expect(inspector).toContain("value <- value");
    const all = records(), begin = rows.find(r => r.event === "request.begin").monotonicMs;
    const frameAck = rows.find(r => r.event === "pipeline.canvas.twoAnimationFrames").monotonicMs;
    const interveningRequests = all.filter(r => r.event === "request.begin" && r.requestId !== id && r.monotonicMs >= begin && r.monotonicMs <= frameAck).map(r => r.requestId);
    console.log(JSON.stringify({ requestId: id, generateAndStabilityMs: Date.now() - start, availableBeforeMiB: before, minimumMiB: minimum, interveningRequests, inspector: inspector.replace(/\s+/g, " ").slice(0, 1500), aborted }));
  } finally {
    clearInterval(monitor);
    console.log(JSON.stringify({ availableBeforeMiB: before, minimumMiB: minimum, aborted }));
    await closeVSCode(session);
  }
});
