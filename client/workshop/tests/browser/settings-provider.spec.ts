import { selectOption } from "./select";
import { expect, test } from "./test";

for (const width of [1280, 780, 390]) {
  test(`provider forms remain inside Settings at ${width}px`, async ({
    page,
  }, info) => {
    await page.goto("/?workshop=controls&scenario=settings-ai");
    const popup = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "Open preview", exact: true })
      .click();
    const preview = await popup;
    await preview.setViewportSize({ width, height: 844 });
    if (width <= 760)
      await preview
        .getByRole("button", { name: "AI & models", exact: true })
        .click();
    const heading = preview.getByRole("heading", {
      name: "AI & models",
      exact: true,
    });
    await expect(heading).toBeVisible();
    await preview.getByRole("button", { name: "+ Add connection" }).click();
    await expect(
      preview.getByRole("heading", { name: "Choose a provider" }),
    ).toBeVisible();
    await expect(
      preview.locator(".settings-view .embedded-connection"),
    ).toBeVisible();
    await expect(
      preview.locator(
        ".ai-view :is(.app-header, .setup-header, .sidebar, .setup-progress)",
      ),
    ).toHaveCount(0);
    await expect(preview.locator(".settings-view main")).toHaveCount(1);
    await preview.screenshot({
      path: info.outputPath(`settings-provider-chooser-${width}.png`),
    });
    await preview.locator('[data-provider="openrouter"]').click();
    await preview.locator('[data-method="key"]').click();
    const key = preview.locator("#credential");
    await key.fill("example-key-draft");
    await expect(
      page.getByRole("region", { name: "AI controls", exact: true }),
    ).toBeVisible();
    const primary = preview.locator('.ai-view [data-action="validate"]');
    await expect(primary).toHaveCSS("border-radius", "10px");
    await expect(primary).toHaveCSS("background-color", "rgb(134, 81, 237)");
    if (width <= 760)
      await preview.getByRole("button", { name: "All settings" }).click();
    await preview
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await preview.getByRole("radio", { name: /^Cobalt/ }).click();
    if (width <= 760)
      await preview.getByRole("button", { name: "All settings" }).click();
    await preview
      .getByRole("button", { name: "AI & models", exact: true })
      .click();
    await expect(primary).toHaveCSS("background-color", "rgb(48, 92, 244)");
    await expect(key).toHaveValue("example-key-draft");
    await preview.screenshot({
      path: info.outputPath(`settings-provider-key-${width}.png`),
    });
    if (width <= 760)
      await preview.getByRole("button", { name: "All settings" }).click();
    await preview
      .getByRole("button", { name: "Language & formats", exact: true })
      .click();
    await expect(
      preview.getByLabel("Interface language", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "AI controls", exact: true }),
    ).toHaveCount(0);
    if (width <= 760)
      await preview.getByRole("button", { name: "All settings" }).click();
    await preview
      .getByRole("button", { name: "AI & models", exact: true })
      .click();
    await expect(key).toHaveValue("example-key-draft");
    await preview
      .getByRole("button", { name: "Back to AI & models", exact: true })
      .click();
    await expect(heading).toBeFocused();
    await expect(
      preview.getByRole("button", { name: "Manage Anthropic", exact: true }),
    ).toBeVisible();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("settings credential recovery keeps the phone shell through keyboard and reset", async ({
  page,
}, info) => {
  await page.goto("/?workshop=controls&scenario=settings-error&profile=ios");
  await selectOption(
    page.getByLabel("Provider state", { exact: true }),
    "missing",
  );
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(
    preview.locator(".provider-row").filter({ hasText: "OpenAI" }),
  ).toContainText("Connect on this device");
  await preview.screenshot({
    path: info.outputPath("settings-missing-ios.png"),
  });
  await preview
    .getByRole("button", { name: "Connect again", exact: true })
    .click();
  await preview.locator('[data-method="key"]').click();
  await preview.locator("#credential").fill("example-key");
  await page.getByLabel("Keyboard occlusion").check();
  await expect(preview.locator("#credential")).toHaveValue("example-key");
  await preview.locator("#credential").focus();
  await expect(preview.locator("#credential")).toBeInViewport();
  await preview.locator('.ai-view [data-action="validate"]').focus();
  await expect(
    preview.locator('.ai-view [data-action="validate"]'),
  ).toBeInViewport();
  await preview.screenshot({
    path: info.outputPath("settings-keyboard-ios.png"),
  });
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "Reconnect", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Provider state", { exact: true }),
  ).toHaveAttribute("data-value", "reconnect");
  await expect(preview.locator("#credential")).toHaveCount(0);
});
