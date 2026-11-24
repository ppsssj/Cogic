import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle } from "./lib/vscode";
import { openCogicPanel, waitGraphStable } from "./lib/cogic";

test("completed graph snapshot", async () => {
  test.setTimeout(180_000);
  const before = Math.round(os.freemem()/1048576);
  if (before < 800) throw Error(`insufficient memory ${before}`);
  const session = await launchVSCode({ profile: process.env.RUN_ID!, extensions: ["cogic"], extraSettings: { "cogic.analysisCache.enabled": false } });
  let minimum = before;
  const monitor = setInterval(() => { minimum = Math.min(minimum, Math.round(os.freemem()/1048576)); if (minimum < 400) void session.app.close(); }, 1000);
  try {
    await quickOpenFile(session.page, "src/main.ts"); await waitTsReady(session.page, 120_000); await waitTsServerIdle(session.page, 120_000);
    const frame = await openCogicPanel(session.page);
    await frame.evaluate(() => { (window as any).__p12dSnapshots = {}; window.addEventListener("message", e => { if (e.data?.type === "analysisResult" && e.data.request?.lane === "active" && e.data.payload?.graph) (window as any).__p12dSnapshots[e.data.request.requestId] = e.data.payload.graph; }); });
    await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
    await session.page.waitForTimeout(5000);
    const log = process.env.COGIC_PIPELINE_PROFILE!;
    const rows = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean).flatMap(s => { try { return [JSON.parse(s)]; } catch { return []; } }) : [];
    const beforeCount = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).length;
    await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
    await expect.poll(() => rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).length, { timeout: 30_000 }).toBeGreaterThan(beforeCount);
    const id = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).at(-1).requestId;
    await expect.poll(() => frame.evaluate((key) => Boolean((window as any).__p12dSnapshots[key]), id), { timeout: 60_000 }).toBeTruthy();
    await waitGraphStable(frame, { minNodes: 1, quietMs: 2000, timeout: 60_000 });
    const graph = await frame.evaluate((key) => (window as any).__p12dSnapshots[key], id);
    const root = process.env.STUDY_WORKSPACE!.replace(/\\/g, "/").toLowerCase();
    const rootPattern = new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const normalize = (v: any): any => typeof v === "string" ? v.replace(/\\/g, "/").replace(rootPattern, "<fixture>") : Array.isArray(v) ? v.map(normalize) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, value]) => [k, normalize(value)])) : v;
    const normalized = JSON.stringify(normalize(graph));
    const summary = { id, nodes: graph.nodes.length, edges: graph.edges.length, sha256: crypto.createHash("sha256").update(normalized).digest("hex"), before, minimum };
    fs.writeFileSync(path.join(process.env.P12D_OUTPUT!, "graph.normalized.json"), normalized);
    fs.writeFileSync(path.join(process.env.P12D_OUTPUT!, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
  } finally { clearInterval(monitor); await closeVSCode(session); }
});
