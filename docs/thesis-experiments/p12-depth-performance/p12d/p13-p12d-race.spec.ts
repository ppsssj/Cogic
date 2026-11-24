import { test, expect, Frame } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle } from "./lib/vscode";
import { openCogicPanel, waitGraphStable } from "./lib/cogic";

const gate = process.env.P12D_GATE_DIR!, log = process.env.COGIC_PIPELINE_PROFILE!;
const rows = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean).flatMap(s => { try { return [JSON.parse(s)]; } catch { return []; } }) : [];
async function pick(frame: Frame, name: string) {
  await frame.locator(".projectPicker").click();
  await frame.locator(".projectMenuItem").filter({ hasText: name }).first().click();
}
test("deterministic file-selection race", async () => {
  test.setTimeout(180_000);
  const before = Math.round(os.freemem()/1048576);
  if (before < 800) throw Error(`insufficient memory ${before}`);
  const cacheEnabled = !["analysis", "analysis-generate", "failure", "debug", "trace", "late-activation-off"].includes(process.env.P12D_TEST_MODE ?? "");
  const session = await launchVSCode({ profile: process.env.RUN_ID!, extensions: ["cogic"], extraSettings: { "cogic.analysisCache.enabled": cacheEnabled } });
  let minimum = before, aborted = false;
  const monitor = setInterval(() => { minimum = Math.min(minimum, Math.round(os.freemem()/1048576)); if (minimum < 400 && !aborted) { aborted = true; void session.app.close(); } }, 1000);
  try {
    await quickOpenFile(session.page, "src/main.ts");
    await waitTsReady(session.page, 120_000); await waitTsServerIdle(session.page, 120_000);
    const frame = await openCogicPanel(session.page);
    if (process.env.P12D_TEST_MODE === "failure") {
      await frame.evaluate(() => { window.addEventListener("message", e => { if (e.data?.type === "analysisResult" && e.data.request?.lane === "active") (window as any).__p12dLastResult = e.data; }); });
    }
    if (["late-activation", "late-activation-off"].includes(process.env.P12D_TEST_MODE ?? "")) {
      await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
      await waitGraphStable(frame, { minNodes: 1, quietMs: 2000, timeout: 60_000 });
      await session.page.waitForTimeout(1200);
      const autoBefore = rows().filter(r => r.event === "request.begin" && r.reason === "auto").length;
      fs.writeFileSync(path.join(gate, "arm"), "arm");
      await quickOpenFile(session.page, "src/target.ts");
      await quickOpenFile(session.page, "src/main.ts");
      await session.page.waitForTimeout(2500);
      const autoAfter = rows().filter(r => r.event === "request.begin" && r.reason === "auto").length;
      const activationFile = path.join(gate, "activations.jsonl");
      const activations = fs.existsSync(activationFile) ? fs.readFileSync(activationFile, "utf8").trim().split(/\r?\n/).map(s => JSON.parse(s)) : [];
      console.log(JSON.stringify({ mode: "late-activation", before, minimum, autoBefore, autoAfter, activations }));
      expect(activations.some(a => String(a.file ?? "").toLowerCase().endsWith("main.ts"))).toBe(true);
      expect(autoAfter).toBe(autoBefore);
      return;
    }
    if (process.env.P12D_TEST_MODE === "trace") {
      await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
      await waitGraphStable(frame, { minNodes: 1, quietMs: 2000, timeout: 60_000 });
      fs.writeFileSync(path.join(gate, "arm"), "arm");
      await frame.locator('button[title="Trace mode OFF"]').click();
      await expect.poll(() => fs.existsSync(path.join(gate, "ready")), { timeout: 30_000 }).toBeTruthy();
      const id = rows().filter(r => r.event === "request.begin" && r.reason === "trace").at(-1).requestId;
      await frame.locator('button[title="Trace mode ON"]').click();
      await expect(frame.getByText("Loading trace graph...", { exact: true })).toHaveCount(0, { timeout: 30_000 });
      fs.writeFileSync(path.join(gate, "release"), "release");
      await expect.poll(() => rows().some(r => r.requestId === id && r.event === "request.cancelled"), { timeout: 60_000 }).toBeTruthy();
      expect(rows().some(r => r.requestId === id && r.event === "postMessage.call")).toBe(false);
      const beforeGenerate = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).length;
      await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
      await expect.poll(() => rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).length, { timeout: 30_000 }).toBeGreaterThan(beforeGenerate);
      const latest = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).at(-1).requestId;
      await expect.poll(() => rows().some(r => r.requestId === latest && r.event === "pipeline.result.received"), { timeout: 60_000 }).toBeTruthy();
      await waitGraphStable(frame, { minNodes: 1, quietMs: 2000, timeout: 60_000 });
      expect(await frame.locator(".inspectorBody").innerText()).toContain("main.ts");
      console.log(JSON.stringify({ mode: "trace", id, latest, before, minimum }));
      return;
    }
    if (["expand", "expand-cancel", "expand-pending"].includes(process.env.P12D_TEST_MODE ?? "")) {
      await frame.locator('select[aria-label="Graph depth"]').selectOption("1");
      await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
      await waitGraphStable(frame, { minNodes: 1, quietMs: 2000, timeout: 60_000 });
      const external = frame.locator(".analysisInteractiveButton").filter({ hasText: /finish.*external/i }).first();
      await expect(external).toBeVisible({ timeout: 30_000 });
      await external.click();
      const expand = frame.getByRole("button", { name: "Expand External" });
      await expect(expand).toBeVisible();
      fs.writeFileSync(path.join(gate, "arm"), "arm");
      await expand.click();
      const both = process.env.P12D_TEST_MODE === "expand-pending";
      await expect.poll(() => fs.existsSync(path.join(gate, both ? "ready-expansion" : "ready")), { timeout: 30_000 }).toBeTruthy();
      const expansion = rows().filter(r => r.event === "pipeline.request.sent" && r.webview?.action === "expandNode").at(-1).requestId;
      if (process.env.P12D_TEST_MODE === "expand-cancel" || both) {
        await pick(frame, "target.ts");
        const active = rows().filter(r => r.event === "pipeline.request.sent" && r.webview?.origin === "topbar.pickFile").at(-1).requestId;
        if (both) {
          await expect.poll(() => fs.existsSync(path.join(gate, "ready-active")), { timeout: 30_000 }).toBeTruthy();
          await expect(frame.getByText("Loading target.ts...", { exact: true })).toBeVisible();
          fs.writeFileSync(path.join(gate, "release-expansion"), "release");
          await expect.poll(() => rows().some(r => r.requestId === expansion && r.event === "request.cancelled"), { timeout: 30_000 }).toBeTruthy();
          await expect(frame.getByText("Loading target.ts...", { exact: true })).toBeVisible();
          fs.writeFileSync(path.join(gate, "release-active"), "release");
        }
        await expect.poll(() => rows().some(r => r.requestId === active && r.event === "pipeline.canvas.twoAnimationFrames"), { timeout: 60_000 }).toBeTruthy();
        if (!both) fs.writeFileSync(path.join(gate, "release"), "release");
        await expect.poll(() => rows().some(r => r.requestId === expansion && r.event === "request.cancelled"), { timeout: 30_000 }).toBeTruthy();
        expect(rows().some(r => r.requestId === expansion && r.event === "postMessage.call")).toBe(false);
        const body = await frame.locator(".inspectorBody").innerText();
        expect(body).toContain("target.ts"); expect(body).toContain("finish");
        await expect(frame.locator(".canvasLoading")).toHaveCount(0);
        console.log(JSON.stringify({ mode: process.env.P12D_TEST_MODE, expansion, active, before, minimum }));
      } else {
        fs.writeFileSync(path.join(gate, "release"), "release");
        await expect.poll(() => rows().some(r => r.requestId === expansion && r.event === "postMessage.call"), { timeout: 60_000 }).toBeTruthy();
        await expect.poll(() => frame.evaluate((id) => ((window as any).__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? []).some((e: any) => e.event === "analysisResult.applied.expand.merge" && e.detail?.requestId === id && e.detail.mergedNodes > e.detail.prevNodes), expansion), { timeout: 30_000 }).toBeTruthy();
        await expect(frame.locator(".canvasLoading")).toHaveCount(0, { timeout: 30_000 });
        console.log(JSON.stringify({ mode: "expand", expansion, before, minimum }));
      }
      return;
    }
    if (process.env.P12D_TEST_MODE === "interactions") {
      const depth = frame.locator('select[aria-label="Graph depth"]');
      await depth.selectOption("0"); await depth.selectOption("1"); await depth.selectOption("2");
      const generate = frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first();
      await generate.click({ delay: 80 }); await generate.click({ delay: 80 });
      await expect.poll(() => rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
      const latest = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).at(-1).requestId;
      await expect.poll(() => rows().some(r => r.requestId === latest && r.event === "pipeline.canvas.twoAnimationFrames"), { timeout: 60_000 }).toBeTruthy();
      await expect(frame.locator(".canvasLoading")).toHaveCount(0, { timeout: 60_000 });
      const beforeEdit = rows().filter(r => r.event === "request.begin" && r.reason === "auto").length;
      await quickOpenFile(session.page, "src/main.ts");
      await session.page.keyboard.press("Control+End");
      await session.page.keyboard.insertText("\nexport function p12dUpdatedValue(x: number) { return x + 7; }\n");
      await expect.poll(() => rows().filter(r => r.event === "request.begin" && r.reason === "auto").length, { timeout: 60_000 }).toBeGreaterThan(beforeEdit);
      await expect.poll(async () => ((await frame.locator(".inspectorBody").innerText()).split("GRAPH")[1] ?? "").includes("p12dUpdatedValue"), { timeout: 60_000 }).toBeTruthy();
      const afterEdit = rows().filter(r => r.event === "request.begin" && r.reason === "auto").length;
      await session.page.keyboard.press("Control+S");
      await expect.poll(() => rows().filter(r => r.event === "request.begin" && r.reason === "auto").length, { timeout: 60_000 }).toBeGreaterThan(afterEdit);
      const saveRequest = rows().filter(r => r.event === "request.begin" && r.reason === "auto").at(-1).requestId;
      await expect.poll(() => rows().some(r => r.requestId === saveRequest && r.event === "postMessage.call"), { timeout: 60_000 }).toBeTruthy();
      expect(fs.readFileSync(path.join(process.env.STUDY_WORKSPACE!, "src", "main.ts"), "utf8")).toContain("p12dUpdatedValue");
      await expect(frame.locator(".canvasLoading")).toHaveCount(0, { timeout: 60_000 });
      console.log(JSON.stringify({ mode: "interactions", latest, before, minimum, autoBefore: beforeEdit, autoAfterEdit: afterEdit, autoAfterSave: rows().filter(r => r.event === "request.begin" && r.reason === "auto").length }));
      return;
    }
    if (process.env.P12D_TEST_MODE === "replay") {
      await frame.evaluate(() => { window.addEventListener("message", e => { if (e.data?.type === "analysisResult" && e.data.request?.lane === "active") (window as any).__p12dLastResult = e.data; }); });
      await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
      await waitGraphStable(frame, { minNodes: 1, quietMs: 2000, timeout: 60_000 });
      await expect.poll(() => frame.evaluate(() => Boolean((window as any).__p12dLastResult)), { timeout: 30_000 }).toBeTruthy();
      const prior = await frame.evaluate(() => (window as any).__p12dLastResult.request.requestId);
      fs.writeFileSync(path.join(gate, "arm"), "arm");
      await pick(frame, "target.ts");
      await expect.poll(() => fs.existsSync(path.join(gate, "ready")), { timeout: 30_000 }).toBeTruthy();
      await expect(frame.getByText("Loading target.ts...", { exact: true })).toBeVisible();
      await frame.evaluate(() => window.dispatchEvent(new MessageEvent("message", { data: (window as any).__p12dLastResult })));
      await session.page.waitForTimeout(300);
      await expect(frame.getByText("Loading target.ts...", { exact: true })).toBeVisible();
      fs.writeFileSync(path.join(gate, "release"), "release");
      await expect(frame.getByText("Loading target.ts...", { exact: true })).toHaveCount(0, { timeout: 60_000 });
      await waitGraphStable(frame, { minNodes: 1, quietMs: 2000, timeout: 60_000 });
      const text = await frame.locator(".inspectorBody").innerText();
      expect(text).toContain("target.ts"); expect(text).toContain("finish");
      expect(await frame.locator(".projectPicker").innerText()).toContain("target.ts");
      console.log(JSON.stringify({ mode: "replay", prior, before, minimum, inspector: text.replace(/\s+/g, " ").slice(0, 800) }));
      return;
    }
    if (["analysis", "analysis-generate", "failure", "debug"].includes(process.env.P12D_TEST_MODE ?? "")) {
      await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
    }
    await session.page.waitForTimeout(2000);
    if (process.env.P12D_TEST_MODE === "failure") {
      await expect.poll(() => frame.evaluate(() => Boolean((window as any).__p12dLastResult)), { timeout: 30_000 }).toBeTruthy();
    }
    fs.writeFileSync(path.join(gate, "arm"), "arm");
    if (process.env.P12D_TEST_MODE === "debug") {
      await frame.evaluate(() => { (window as any).__p12dRuntime = []; window.addEventListener("message", e => { if (e.data?.type === "runtimeDebug") (window as any).__p12dRuntime.push(e.data.payload?.state); }); });
      await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
      await expect.poll(() => fs.existsSync(path.join(gate, "ready")), { timeout: 30_000 }).toBeTruthy();
      await expect(frame.getByText("Rendering graph...", { exact: true })).toBeVisible();
      const sent = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate"));
      const id = sent[sent.length-1].requestId;
      await session.page.keyboard.press("F5");
      await expect(session.page.getByRole("tab", { name: /Run and Debug.*1 active session/ })).toBeVisible({ timeout: 60_000 });
      await expect.poll(() => frame.evaluate(() => (window as any).__p12dRuntime.some((state: string) => state === "running" || state === "paused")), { timeout: 60_000 }).toBeTruthy();
      await expect(frame.getByText("Rendering graph...", { exact: true })).toHaveCount(0, { timeout: 60_000 });
      fs.writeFileSync(path.join(gate, "release"), "release");
      await expect.poll(() => rows().some(r => r.requestId === id && r.event === "request.cancelled"), { timeout: 60_000 }).toBeTruthy();
      expect(rows().some(r => r.requestId === id && r.event === "postMessage.call")).toBe(false);
      await session.page.keyboard.press("Shift+F5");
      await expect(session.page.getByRole("tab", { name: /Run and Debug.*1 active session/ })).toHaveCount(0, { timeout: 60_000 });
      await expect.poll(() => frame.evaluate(() => (window as any).__p12dRuntime.at(-1)), { timeout: 60_000 }).toBe("inactive");
      await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
      await expect.poll(() => rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).length, { timeout: 30_000 }).toBeGreaterThan(sent.length);
      const latest = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).at(-1).requestId;
      await expect.poll(() => rows().some(r => r.requestId === latest && r.event === "pipeline.result.received"), { timeout: 60_000 }).toBeTruthy();
      await waitGraphStable(frame, { minNodes: 1, quietMs: 2000, timeout: 60_000 });
      const text = await frame.locator(".inspectorBody").innerText();
      expect(text).toContain("main.ts");
      const runtimeStates = await frame.evaluate(() => (window as any).__p12dRuntime);
      console.log(JSON.stringify({ mode: "debug", id, latest, before, minimum, runtimeStates, inspector: text.replace(/\s+/g, " ").slice(0, 500) }));
      return;
    }
    await pick(frame, "main.ts");
    await expect.poll(() => fs.existsSync(path.join(gate, "ready")), { timeout: 30_000 }).toBeTruthy();
    if (process.env.P12D_TEST_MODE === "analysis-generate") {
      const a = rows().filter(r => r.event === "pipeline.request.sent" && r.webview?.origin === "topbar.pickFile").at(-1).requestId;
      await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
      await expect.poll(() => rows().some(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")), { timeout: 30_000 }).toBeTruthy();
      const b = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("generate")).at(-1).requestId;
      await expect.poll(() => rows().some(r => r.requestId === b && r.event === "request.begin"), { timeout: 30_000 }).toBeTruthy();
      fs.writeFileSync(path.join(gate, "release"), "release");
      await expect.poll(() => rows().some(r => r.requestId === a && r.event === "request.cancelled"), { timeout: 60_000 }).toBeTruthy();
      await expect.poll(() => rows().some(r => r.requestId === b && r.event === "pipeline.result.received"), { timeout: 60_000 }).toBeTruthy();
      expect(rows().some(r => r.requestId === a && r.event === "postMessage.call")).toBe(false);
      await expect(frame.locator(".canvasLoading")).toHaveCount(0, { timeout: 60_000 });
      expect(await frame.locator(".inspectorBody").innerText()).toContain("main.ts");
      console.log(JSON.stringify({ mode: "analysis-generate", a, b, before, minimum, aPrograms: rows().filter(r => r.requestId === a && r.event === "analyzer.program.created").length }));
      return;
    }
    await pick(frame, "target.ts");
    const picks = rows().filter(r => r.event === "pipeline.request.sent" && r.webview?.origin === "topbar.pickFile");
    expect(picks.length).toBeGreaterThanOrEqual(2);
    const a = picks[picks.length-2].requestId, b = picks[picks.length-1].requestId;
    if (["open", "analysis"].includes(process.env.P12D_TEST_MODE ?? "")) {
      await expect.poll(() => rows().some(r => r.requestId === b && r.event === "postMessage.call"), { timeout: 30_000 }).toBeTruthy();
    }
    if (process.env.P12D_TEST_MODE === "failure") {
      await expect(frame.getByText("Analysis failed", { exact: true })).toBeVisible({ timeout: 30_000 });
    }
    fs.writeFileSync(path.join(gate, "release"), "release");
    if (process.env.P12D_TEST_MODE === "failure") {
      await expect.poll(() => rows().some(r => r.requestId === a && r.event === "request.cancelled"), { timeout: 30_000 }).toBeTruthy();
      expect(rows().some(r => r.requestId === a && r.event === "postMessage.call")).toBe(false);
      await expect(frame.getByText("Analysis failed", { exact: true })).toBeVisible();
      await expect(frame.locator(".canvasLoading")).toHaveCount(0);
      const appliedBefore = await frame.evaluate(() => ((window as any).__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? []).filter((e: any) => e.event === "analysisResult.applied.active.graph").length);
      await frame.evaluate(() => window.dispatchEvent(new MessageEvent("message", { data: (window as any).__p12dLastResult })));
      await session.page.waitForTimeout(300);
      const appliedAfter = await frame.evaluate(() => ((window as any).__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? []).filter((e: any) => e.event === "analysisResult.applied.active.graph").length);
      expect(appliedAfter).toBe(appliedBefore);
      await expect(frame.getByText("Analysis failed", { exact: true })).toBeVisible();
      await expect(frame.locator(".canvasLoading")).toHaveCount(0);
      console.log(JSON.stringify({ mode: "failure", a, b, before, minimum, aPrograms: rows().filter(r => r.requestId === a && r.event === "analyzer.program.created").length }));
      return;
    }
    await expect.poll(() => rows().some(r => r.requestId === b && r.event === "pipeline.canvas.twoAnimationFrames"), { timeout: 60_000 }).toBeTruthy();
    await waitGraphStable(frame, { minNodes: 1, quietMs: 2000, timeout: 60_000 });
    const text = await frame.locator(".inspectorBody").innerText();
    expect(text).toContain("target.ts"); expect(text).toContain("finish");
    expect(await frame.locator(".projectPicker").innerText()).toContain("target.ts");
    expect(rows().some(r => r.requestId === a && r.event === "postMessage.call")).toBe(false);
    expect(rows().some(r => r.requestId === a && r.event === "request.cancelled")).toBe(true);
    console.log(JSON.stringify({ mode: process.env.P12D_TEST_MODE, a, b, before, minimum, aPrograms: rows().filter(r => r.requestId === a && r.event === "analyzer.program.created").length, inspector: text.replace(/\s+/g, " ").slice(0, 800) }));
  } finally { clearInterval(monitor); console.log(JSON.stringify({ mode: process.env.P12D_TEST_MODE, availableBeforeMiB: before, minimumMiB: minimum, aborted })); for (const file of ["release", "release-active", "release-expansion"]) fs.writeFileSync(path.join(gate, file), "release"); await closeVSCode(session); if (aborted) throw Error("Stopped: sampled available memory below 400 MiB"); }
});
