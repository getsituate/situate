import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  use: { browserName: "chromium" },
  webServer: {
    command: "node tests/server.js",
    wait: {
      stdout:
        /SITUATE_BROWSER_URL=(?<situate_browser_url>http:\/\/127\.0\.0\.1:\d+)/,
    },
    stdout: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
