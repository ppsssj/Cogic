import { defineConfig } from "@playwright/test";

// VS Code Desktop E2E: one VS Code instance at a time, no retries (failures must stay visible).
// Exploratory/diagnostic specs (e2e/explore) are excluded here; see playwright.explore.config.ts.
const runId = process.env.RUN_ID ?? "dev";
export default defineConfig({
  testDir: "./e2e",
  testMatch: /p[0-4][a-d]*-.*\.spec\.ts$/,
  testIgnore: /explore/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  outputDir: `./e2e-results/runs/${runId}/playwright-artifacts`,
  reporter: [
    ["list"],
    ["json", { outputFile: `./e2e-results/runs/${runId}/playwright-report.json` }],
  ],
});
