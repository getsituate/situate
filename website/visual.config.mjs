import { createRequire } from "node:module";
import { join } from "node:path";

const { defineConfig } = createRequire(
  new URL("../client/package.json", import.meta.url),
)("@playwright/test");
const report = process.env.WEBSITE_VISUAL_REPORT;

export default defineConfig({
  testDir: "./visual",
  outputDir: join(report, "results"),
  snapshotPathTemplate: "{testDir}/baselines/{projectName}/{arg}{ext}",
  updateSnapshots: "none",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: join(report, "html"), open: "never" }],
  ],
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      threshold: 0.01,
      maxDiffPixels: 0,
    },
  },
  use: {
    browserName: "chromium",
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    colorScheme: "light",
    deviceScaleFactor: 1,
    serviceWorkers: "block",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
