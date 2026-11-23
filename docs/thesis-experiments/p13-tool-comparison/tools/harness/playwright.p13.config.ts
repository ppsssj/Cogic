import { defineConfig } from "@playwright/test";

// P13 additions (copy of playwright.p11.config.ts with testMatch p13-*) (new files only; the original P0-P4 specs and config are untouched).
const runId = process.env.RUN_ID ?? "dev";
export default defineConfig({
  testDir: "./e2e",
  testMatch: /p13-.*.spec.ts$/,
  testIgnore: /explore/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 2_400_000,
  expect: { timeout: 15_000 },
  outputDir: `./e2e-results/runs/${runId}/playwright-artifacts`,
  reporter: [
    ["list"],
    ["json", { outputFile: `./e2e-results/runs/${runId}/playwright-report.json` }],
  ],
});
