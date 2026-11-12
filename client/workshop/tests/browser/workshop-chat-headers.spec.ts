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
  test(`${scenario} keeps navigation and chat controls in a single mobile header`, async ({
    page,
  }) => {
    await page.goto(`/?workshop=controls&scenario=${scenario}`);
    const popup = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "Open preview", exact: true })
      .click();
    const preview = await popup;
    for (const width of [320, 375, 600]) {
      await preview.setViewportSize({ width, height: 844 });
      const header = preview.locator(".chat-pane-header:visible");
      await expect(header).toHaveCount(1);
      const navigation = header.getByRole("button", {
        name: "Open navigation",
        exact: true,
      });
      await expect(navigation).toBeVisible();
      const name = (await header.locator(".pane-title").boundingBox())!;
      const menu = (await navigation.boundingBox())!;
      const bar = (await header.boundingBox())!;
      expect(name.height).toBeLessThan(24);
      expect(name.y + name.height / 2).toBeCloseTo(menu.y + menu.height / 2, 0);
      expect(bar.height).toBeLessThanOrEqual(64);
      for (const control of await header.getByRole("button").all()) {
        const box = (await control.boundingBox())!;
        expect(box.y).toBeCloseTo(menu.y, 0);
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await expect(preview.locator(".navigation-access")).toHaveCount(0);
      await expect(
        preview.getByRole("button", { name: "Open navigation", exact: true }),
      ).toHaveCount(1);
      await navigation.click();
      const drawer = preview.getByRole("dialog", {
        name: "Workspace navigation",
        exact: true,
      });
      await expect(drawer).toBeVisible();
      await drawer.press("Escape");
      await expect(navigation).toBeFocused();
      expect(
        await header.evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(false);
    }
    await preview.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await preview.setViewportSize({ width: 750, height: 1000 });
    const header = preview.locator(".chat-pane-header:visible");
    expect(await header.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      false,
    );
    await expect(
      header.getByRole("button", { name: "Open navigation", exact: true }),
    ).toBeVisible();
  });
}
