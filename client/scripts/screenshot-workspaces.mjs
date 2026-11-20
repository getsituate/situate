import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, expect } from "@playwright/test";
import * as vite from "vite";
import { startBrowserServer } from "../../tools/browser-server.mjs";
import { assertLocalPath } from "./ios-project-lock.mjs";

function validateScene(scene) {
  if (typeof scene !== "string" || !scene || /[^a-z0-9-]/u.test(scene))
    throw new Error("Invalid workshop scenario ID.");
}

export function screenshotPath(output, profile, scene) {
  validateScene(scene);
  if (!["mac", "ios", "android"].includes(profile))
    throw new Error("Invalid workshop screenshot profile.");
  const path = join(output, `${profile}-${scene}.png`);
  assertLocalPath(output, path);
  return path;
}

if (import.meta.main) await main();

async function main() {
  const { values, positionals } = parseArgs({
    options: { all: { type: "boolean" } },
    allowPositionals: true,
  });
  const root = fileURLToPath(new URL("..", import.meta.url));
  const output = resolve(
    positionals[0] ?? join(root, "test-results/design-screenshots"),
  );
  await mkdir(output, { recursive: true });
  const indexPath = join(output, "index.md");
  assertLocalPath(output, indexPath);
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
    scenes.forEach(validateScene);
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
          const path = screenshotPath(output, profile, scene);
          await preview.screenshot({ path });
          const file = basename(path);
          captures.push(
            `## ${profile} · ${scene} · ${width} × ${height} CSS px\n\n![${scene}](${file})\n`,
          );
        } finally {
          await context.close();
        }
      }
    }
    assertLocalPath(output, indexPath);
    await writeFile(
      indexPath,
      "# Design workshop captures\n\nVue views rendered in Chromium with synthetic data and reduced motion. Platform profiles simulate content space, not native OS decoration, keyboards or device rendering.\n\n" +
        captures.join("\n"),
    );
    console.log(indexPath);
  } finally {
    await browser?.close();
    await server.close();
  }
}
