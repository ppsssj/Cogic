import { defineConfig } from "@playwright/test";

// P8 additions (new files only; the original P0-P4 specs and config are untouched).
const runId = process.env.RUN_ID ?? "dev";
export default defineConfig({
  testDir: "./e2e",
  testMatch: /p8[a-z]*-.*\.spec\.ts$/,
  testIgnore: /explore/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 15_000 },
  outputDir: `./e2e-results/runs/${runId}/playwright-artifacts`,
  reporter: [
    ["list"],
    ["json", { outputFile: `./e2e-results/runs/${runId}/playwright-report.json` }],
  ],
});
