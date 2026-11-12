import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "../test-results/workshop-browser",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  workers: 2,
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "workshop-chromium", use: { browserName: "chromium" } },
    { name: "workshop-webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node ../scripts/browser-server.mjs",
    wait: {
      stdout:
        /SITUATE_BROWSER_URL=(?<situate_browser_url>http:\/\/127\.0\.0\.1:\d+)/,
    },
    stdout: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
