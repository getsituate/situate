import { expect, test } from "./test";

for (const scenario of [
  "workspace",
  "navigation-chat",
  "navigation-draft",
  "files-chat",
  "chat-complete",
  "chat-empty",
  "chat-working",
  "chat-queue-mixed",
]) {
  test(`${scenario} keeps chat actions in the corner and navigation reachable`, async ({
    page,
  }) => {
    await page.goto(`/?workshop=controls&scenario=${scenario}`);
    const popup = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "Open preview", exact: true })
      .click();
    const preview = await popup;
    const navigation = preview.getByRole("button", {
      name: "Open navigation",
      exact: true,
    });
    const actions = preview.getByRole("button", {
      name: "Chat actions",
      exact: true,
    });
    for (const width of [320, 375, 600]) {
      await preview.setViewportSize({ width, height: 844 });
      await expect(navigation).toHaveCount(1);
      await expect(actions).toBeVisible();
      await expect(
        actions
          .locator(
            "xpath=ancestor::*[contains(@class, 'chat-mode-surface')][1]",
          )
          .locator(".chat-pane-header"),
      ).toHaveCount(0);
      const nav = (await navigation.boundingBox())!;
      const more = (await actions.boundingBox())!;
      expect(nav.x + nav.width).toBeLessThan(more.x);
      expect(nav.y).toBeCloseTo(more.y, 0);
      expect(more.width).toBeGreaterThanOrEqual(44);
      expect(more.height).toBeGreaterThanOrEqual(44);
      await navigation.click();
      const drawer = preview.getByRole("dialog", {
        name: "Workspace navigation",
        exact: true,
      });
      await expect(drawer).toBeVisible();
      await drawer.press("Escape");
      await expect(navigation).toBeFocused();
    }
    await preview.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await preview.setViewportSize({ width: 750, height: 1000 });
    await expect(navigation).toBeVisible();
    await expect(actions).toBeVisible();
  });
}
