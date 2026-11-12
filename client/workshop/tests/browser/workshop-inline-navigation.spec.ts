import { expect, test } from "./test";

for (const scenario of ["plugins-list", "settings-formats"]) {
  const workspaceSubtitleCount = scenario === "plugins-list" ? 0 : 1;
  test(`${scenario}: inline navigation preserves sidebar access and focus`, async ({
    page,
  }) => {
    await page.goto(`/?workshop=controls&scenario=${scenario}`);
    const popup = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "Open preview", exact: true })
      .click();
    const preview = await popup;
    await preview.setViewportSize({ width: 1440, height: 900 });
    const view = preview.locator(
      scenario === "plugins-list" ? ".plugin-view" : ".settings-view",
    );
    await expect(view).toBeVisible();
    await expect(view.locator(".plugin-topbar, .settings-topbar")).toHaveCount(
      0,
    );
    await expect(view.getByText("Field notes", { exact: true })).toHaveCount(0);
    await expect(
      view.getByRole("button", { name: "Open navigation", exact: true }),
    ).toHaveCount(0);
    await preview.getByRole("button", { name: "Collapse sidebar" }).click();
    let menu = view.getByRole("button", {
      name: "Open navigation",
      exact: true,
    });
    await expect(menu).toHaveCount(1);
    await expect(
      view.getByText("Field notes", { exact: true }).filter({ visible: true }),
    ).toHaveCount(workspaceSubtitleCount);
    await menu.click();
    await expect(preview.locator(".desktop-sidebar")).toBeVisible();
    await preview.setViewportSize({ width: 375, height: 844 });
    menu = view.getByRole("button", { name: "Open navigation", exact: true });
    await expect(menu).toHaveCount(1);
    await menu.focus();
    await menu.press("Enter");
    const drawer = preview.getByRole("dialog", {
      name: "Workspace navigation",
      exact: true,
    });
    await expect(drawer).toBeVisible();
    await drawer.press("Escape");
    await expect(menu).toBeFocused();
    await expect(
      view.getByText("Field notes", { exact: true }).filter({ visible: true }),
    ).toHaveCount(workspaceSubtitleCount);
    if (scenario === "settings-formats") {
      await view.getByRole("button", { name: /Language & formats/ }).click();
      menu = view.getByRole("button", { name: "Open navigation", exact: true });
      await expect(menu).toHaveCount(1);
      await expect(
        view.getByLabel("Time format", { exact: true }),
      ).toBeVisible();
      await menu.click();
      await expect(drawer).toBeVisible();
      await drawer.press("Escape");
      await expect(menu).toBeFocused();
      await preview
        .getByRole("button", { name: "All settings", exact: false })
        .click();
      await expect(
        view.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeVisible();
      menu = view.getByRole("button", { name: "Open navigation", exact: true });
      await expect(menu).toHaveCount(1);
      await menu.click();
      await expect(drawer).toBeVisible();
      await drawer.press("Escape");
      await expect(menu).toBeFocused();
    }
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  });
}
