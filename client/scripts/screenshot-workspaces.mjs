import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, expect } from "@playwright/test";
import * as vite from "vite";
import { startBrowserServer } from "../../tools/browser-server.mjs";

const { values, positionals } = parseArgs({
  options: { all: { type: "boolean" } },
  allowPositionals: true,
});
const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(
  positionals[0] ?? join(root, "test-results/design-screenshots"),
);
await mkdir(output, { recursive: true });
const server = await startBrowserServer(vite, {
  configFile: join(root, "workshop/vite.config.ts"),
  root: join(root, "workshop"),
});
const scenes = [
  "welcome",
  "workspaces",
  "create",
  "collision",
  "create-error",
  "invalid-folder",
  "remove",
  "restore-error",
];
let browser;
try {
  browser = await chromium.launch();
  if (values.all) {
    const index = await browser.newPage();
    try {
      await index.goto(`${server.url}/?workshop=controls`);
      const selector = index.getByLabel("Scenario", { exact: true });
      await expect(selector).toBeVisible();
      scenes.splice(
        0,
        scenes.length,
        ...(await selector
          .locator("option")
          .evaluateAll((options) => options.map((option) => option.value))),
      );
    } finally {
      await index.close();
    }
  }
  const captures = [];
  for (const [profile, width, height] of [
    ["mac", 1280, 800],
    ["ios", 390, 844],
    ["android", 412, 852],
  ]) {
    for (const scene of scenes) {
      const context = await browser.newContext({
        reducedMotion: "reduce",
        deviceScaleFactor: 1,
      });
      try {
        const controls = await context.newPage();
        await controls.goto(
          `${server.url}/?workshop=controls&scenario=${scene}&profile=${profile}`,
        );
        const opened = controls.waitForEvent("popup");
        await controls
          .getByRole("button", { name: "Open preview", exact: true })
          .click();
        const preview = await opened;
        await preview.setViewportSize({ width, height });
        await expect(
          preview.locator(".environment-content > *").first(),
        ).toBeVisible();
        await preview.evaluate(() => document.fonts.ready);
        const file = `${profile}-${scene}.png`;
        await preview.screenshot({ path: join(output, file) });
        captures.push(
          `## ${profile} · ${scene} · ${width} × ${height} CSS px\n\n![${scene}](${file})\n`,
        );
      } finally {
        await context.close();
      }
    }
  }
  const index = join(output, "index.md");
  await writeFile(
    index,
    "# Design workshop captures\n\nVue views rendered in Chromium with synthetic data and reduced motion. Platform profiles simulate content space, not native OS decoration, keyboards or device rendering.\n\n" +
      captures.join("\n"),
  );
  console.log(index);
} finally {
  await browser?.close();
  await server.close();
}
