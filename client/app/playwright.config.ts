import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "../test-results/browser",
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Retain failure details even if a suite deadline interrupts the final summary.
  reporter: process.env.CI ? "line" : "list",
  use: { trace: "retain-on-failure", locale: "en-US" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
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
