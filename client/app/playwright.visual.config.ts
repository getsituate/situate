import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { VisualOptions } from "./tests/browser/test";
import {
  visualGrep,
  visualPixelComparison,
} from "./tests/browser/visual-checkpoints.mjs";

const { image } = JSON.parse(
  readFileSync(
    new URL("../../tools/ci-image.lock.json", import.meta.url),
    "utf8",
  ),
);
if (
  process.platform !== "linux" ||
  process.arch !== "x64" ||
  process.env.SITUATE_CI_IMAGE !== image
) {
  throw new Error("Run visual tests with npm run test:visual from client/.");
}

export default defineConfig<VisualOptions>({
  testDir: "./tests/browser",
  outputDir: "../test-results/visual",
  snapshotPathTemplate:
    "{testDir}/../visual/baselines/{projectName}/{arg}{ext}",
  updateSnapshots: "none",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../test-results/visual-report", open: "never" }],
  ],
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      ...visualPixelComparison,
    },
  },
  use: {
    visualEnabled: true,
    browserName: "chromium",
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "desktop",
      grep: visualGrep("desktop", process.env.SITUATE_VISUAL_GREP),
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      grep: visualGrep("mobile", process.env.SITUATE_VISUAL_GREP),
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
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
