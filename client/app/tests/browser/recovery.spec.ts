import { test, expect } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";

test.use({ localizationMode: "real" });

test("recovery keeps built-in settings available @visual-desktop", async ({
  page,
  visual,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspaceFixture(page, shellState, { recovery: true });
  await page.goto("/");
  await expect(
    page.getByText(
      /^(Some plugins are paused\.|Einige Plugins sind pausiert\.)$/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /^(Resume plugins individually or all together\.|Setze Plugins einzeln oder gemeinsam fort\.)/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(Settings|Einstellungen)$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /^(Message|Nachricht)$/ }),
  ).toBeVisible();
  await visual.capture("recovery.workspace");
  await page
    .getByRole("button", { name: /^(Settings|Einstellungen)$/ })
    .click();
  await expect(
    page.getByRole("heading", { name: /^(Settings|Einstellungen)$/ }),
  ).toBeVisible();
  await visual.capture("recovery.settings");
  const calls = await page.evaluate(
    () => Reflect.get(window, "__ipcCalls") as { command: string }[],
  );
  expect(
    calls.findIndex(({ command }) => command === "plugin_recovery_mode"),
  ).toBeLessThan(
    calls.findIndex(({ command }) => command === "workspace_snapshot"),
  );
});

test("normal startup has no recovery notice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspaceFixture(page, shellState);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".recovery-notice")).toHaveCount(0);
});

test("failed recovery lookup shows an error without opening workspaces @visual-desktop", async ({
  page,
  visual,
}) => {
  await workspaceFixture(page, shellState, { recoveryError: true });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /^(Oops\. Something went wrong\.|Ups\. Hier ist etwas schiefgelaufen\.)$/,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: /^(Reload Situate|Situate neu laden)$/ }),
  ).toBeVisible();
  await visual.capture("recovery.startup-error");
  const calls = await page.evaluate(
    () => Reflect.get(window, "__ipcCalls") as { command: string }[],
  );
  expect(calls.map(({ command }) => command)).toContain("plugin_recovery_mode");
  expect(calls.map(({ command }) => command)).not.toContain(
    "workspace_snapshot",
  );
  await expect(page.locator(".app-shell")).toHaveCount(0);
});
