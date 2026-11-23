// Copy into the P13 harness e2e directory; uses its unchanged UI helpers.
import { test } from "@playwright/test";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle } from "./lib/vscode";
import { openCogicPanel, waitGraphStable } from "./lib/cogic";

test("P12C V1 Generate", async () => {
  const session = await launchVSCode({ profile: process.env.RUN_ID ?? "p12c-v1-isolated", extensions: ["cogic"], extraSettings: { "cogic.analysisCache.enabled": true } });
  try {
    await quickOpenFile(session.page, "packages/vite/src/node/server/index.ts");
    await waitTsReady(session.page, 120_000);
    await waitTsServerIdle(session.page, 180_000);
    const frame = await openCogicPanel(session.page);
    await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
    await session.page.waitForTimeout(1500);
    const start = Date.now();
    await frame.locator("button", { hasText: /^\s*Generate\s*$/ }).first().click({ delay: 80 });
    await waitGraphStable(frame, { minNodes: 2, quietMs: 3000, timeout: 600_000 });
    console.log(`P12C generate-and-stability-ms=${Date.now() - start}`);
  } finally {
    await closeVSCode(session);
  }
});
