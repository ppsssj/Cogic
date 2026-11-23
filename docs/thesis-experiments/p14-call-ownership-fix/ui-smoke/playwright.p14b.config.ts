import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", testMatch: /p14b-ui\.spec\.ts$/, workers: 1, retries: 0, timeout: 300_000, reporter: [["list"]] });
