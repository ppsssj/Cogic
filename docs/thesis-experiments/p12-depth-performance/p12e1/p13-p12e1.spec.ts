import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle } from "./lib/vscode";
import { openCogicPanel, waitGraphStable } from "./lib/cogic";

const out = process.env.P12C2_OUTPUT!, log = process.env.COGIC_PIPELINE_PROFILE!;
const rows = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean).flatMap(s => { try { return [JSON.parse(s)]; } catch { return []; } }) : [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
test("P12-E1 VS Code Depth 2", async () => {
  test.setTimeout(1_200_000);
  const before = Math.round(os.freemem()/1048576); let minimum = before, aborted = false, session: Awaited<ReturnType<typeof launchVSCode>> | undefined;
  if (before < 2200) throw Error(`preflight free memory ${before} MiB is below 2200 MiB`);
  const monitor = setInterval(() => { const free = Math.round(os.freemem()/1048576); minimum = Math.min(minimum, free); if (free < 800 && !aborted) { aborted = true; fs.writeFileSync(path.join(out, "memory-abort"), String(free)); if (session) void session.app.close(); } }, 250);
  const check = () => { if (aborted) throw Error("memory guard fired"); };
  try {
    session = await launchVSCode({ profile: process.env.RUN_ID!, extensions: ["cogic"], extraSettings: { "cogic.analysisCache.enabled": process.env.P12C2_CACHE !== "off" } });
    if (aborted) throw Error("memory guard fired during startup");
    await quickOpenFile(session.page, process.env.P12C2_FILE ?? "src/main.ts");
    await waitTsReady(session.page, 120_000); await waitTsServerIdle(session.page, 180_000);
    const frame = await openCogicPanel(session.page);
    await frame.evaluate(() => { (window as any).__p12c2Results = {}; window.addEventListener("message", e => { if (e.data?.type === "analysisResult" && e.data.request?.lane === "active" && e.data.payload?.graph) (window as any).__p12c2Results[e.data.request.requestId] = e.data.payload.graph; }); });
    // Selecting Depth itself starts analysis. Keep it separate from the later Generate.
    const priorDepth = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("graphDepth.change")).length;
    await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
    await expect.poll(() => rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("graphDepth.change")).length, { timeout: 30_000 }).toBeGreaterThan(priorDepth);
    const preparation = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("graphDepth.change")).at(-1).requestId;
    console.log(JSON.stringify({phase: "preparation", preparation, before}));
    await expect.poll(() => { check(); return rows().some(r => r.requestId === preparation && ["postMessage.call", "request.cancelled", "request.failed", "request.dropped"].includes(r.event)); }, { timeout: 900_000, intervals: [1000] }).toBeTruthy();
    if (aborted) throw Error("memory guard fired during preparation");
    if (!rows().some(r => r.requestId === preparation && r.event === "postMessage.call")) throw Error("Depth 2 request did not complete");
    await expect.poll(() => { check(); return rows().some(r => r.requestId === preparation && r.event === "pipeline.canvas.twoAnimationFrames"); }, { timeout: 900_000, intervals: [1000] }).toBeTruthy();
    const prepGraph = await frame.evaluate(key => (window as any).__p12c2Results[key], preparation);
    if (!prepGraph) throw Error("Depth 2 result graph missing");
    const prepRoot = process.env.STUDY_WORKSPACE!.replace(/\\/g, "/").toLowerCase();
    const prepRx = new RegExp(prepRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const prepNorm = (v: any): any => typeof v === "string" ? v.replace(/\\/g, "/").replace(prepRx, "<fixture>") : Array.isArray(v) ? v.map(prepNorm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k,x]) => [k,prepNorm(x)])) : v;
    const prepNormalized = JSON.stringify(prepNorm(prepGraph));
    fs.writeFileSync(path.join(out, "preparation-graph.normalized.json"), prepNormalized);
    const prepInspector = (await frame.locator(".inspectorBody").innerText()).replace(/\s+/g, " ").slice(0, 1600);
    const prepSummary = {id: preparation, nodes: prepGraph.nodes.length, edges: prepGraph.edges.length, sha256: crypto.createHash("sha256").update(prepNormalized).digest("hex"), picker: await frame.locator(".projectPicker").innerText(), inspector: prepInspector, before, minimum};
    fs.writeFileSync(path.join(out, "preparation-summary.json"), JSON.stringify(prepSummary, null, 2));
    console.log(JSON.stringify({phase: "preparation-complete", ...prepSummary}));
    expect(aborted).toBe(false);
  } finally {
    clearInterval(monitor); fs.writeFileSync(path.join(out, "memory-summary.json"), JSON.stringify({before,minimum,aborted}, null, 2));
    if (session) await closeVSCode(session);
    if (aborted) throw Error("Stopped: available physical memory below 800 MiB");
  }
});
