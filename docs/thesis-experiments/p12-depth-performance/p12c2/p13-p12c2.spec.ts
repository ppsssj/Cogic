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
test("P12-C2 real VS Code Depth 2", async () => {
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
    await sleep(3000);
    const old = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).length;
    const start = performance.now();
    await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
    await expect.poll(() => rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).length, { timeout: 30_000 }).toBeGreaterThan(old);
    const id = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).at(-1).requestId;
    fs.writeFileSync(path.join(out, "request.json"), JSON.stringify({preparation,id,before}, null, 2));
    await expect.poll(() => { check(); return rows().some(r => r.requestId === id && r.event === "pipeline.canvas.twoAnimationFrames"); }, { timeout: 900_000, intervals: [1000] }).toBeTruthy();
    const observedMs = performance.now() - start;
    await expect.poll(() => frame.evaluate(key => Boolean((window as any).__p12c2Results[key]), id), { timeout: 30_000 }).toBeTruthy();
    const graph = await frame.evaluate(key => (window as any).__p12c2Results[key], id);
    const root = process.env.STUDY_WORKSPACE!.replace(/\\/g, "/").toLowerCase();
    const rx = new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const norm = (v: any): any => typeof v === "string" ? v.replace(/\\/g, "/").replace(rx, "<fixture>") : Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k,x]) => [k,norm(x)])) : v;
    const normalized = JSON.stringify(norm(graph));
    fs.writeFileSync(path.join(out, "graph.normalized.json"), normalized);
    const picker = await frame.locator(".projectPicker").innerText();
    const inspector = (await frame.locator(".inspectorBody").innerText()).replace(/\s+/g, " ").slice(0, 1600);
    const result = { id, preparation, observedGenerateToTwoFramesMs: observedMs, nodes: graph.nodes.length, edges: graph.edges.length, sha256: crypto.createHash("sha256").update(normalized).digest("hex"), picker, inspector, before, minimum, aborted, requests: rows().filter(r => ["request.begin", "request.cancelled"].includes(r.event)) };
    fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    await waitGraphStable(frame, {minNodes: 1, quietMs: 1000, timeout: 60_000});
    expect(aborted).toBe(false);
  } finally {
    clearInterval(monitor); fs.writeFileSync(path.join(out, "memory-summary.json"), JSON.stringify({before,minimum,aborted}, null, 2));
    if (session) await closeVSCode(session);
    if (aborted) throw Error("Stopped: available physical memory below 800 MiB");
  }
});
