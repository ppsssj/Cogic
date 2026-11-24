import { test, expect } from "@playwright/test";
import * as os from "node:os";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle } from "./lib/vscode";
import { openCogicPanel, waitGraphStable } from "./lib/cogic";

test("user request ID exists with profiling disabled", async () => {
  test.setTimeout(180_000);
  delete process.env.COGIC_PIPELINE_PROFILE;
  const before = Math.round(os.freemem() / 1048576);
  if (before < 1200) throw Error(`Insufficient memory: ${before} MiB`);
  const session = await launchVSCode({ profile: process.env.RUN_ID!, extensions: ["cogic"] });
  let minimum = before;
  const monitor = setInterval(() => {
    minimum = Math.min(minimum, Math.round(os.freemem() / 1048576));
    if (minimum < 400) void session.app.close();
  }, 1000);
  try {
    await quickOpenFile(session.page, "src/main.ts");
    await waitTsReady(session.page, 120_000);
    await waitTsServerIdle(session.page, 120_000);
    const frame = await openCogicPanel(session.page);
    expect(await frame.locator('meta[name="cogic-pipeline-profile"]').count()).toBe(0);
    await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
    await waitGraphStable(frame, { minNodes: 1, quietMs: 3000, timeout: 120_000 });
    const ids = await frame.evaluate(() => ((window as any).__CODEGRAPH_WEBVIEW_DEBUG__?.entries ?? []).filter((x: any) => x.event === "analysisResult.received").map((x: any) => x.detail?.requestId));
    expect(ids.some((id: unknown) => typeof id === "string" && id.startsWith("web-"))).toBe(true);
    console.log(JSON.stringify({ ids, before, minimum }));
  } finally { clearInterval(monitor); await closeVSCode(session); }
});
