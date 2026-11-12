import { expect, test } from "./test";

for (const mobile of [false, true]) {
  test(`conversation rename stays inline (${mobile ? "phone" : "desktop"})`, async ({
    page,
    browserName,
  }) => {
    await page.goto(
      `/?workshop=controls&scenario=navigation-chat${mobile ? "&profile=ios" : ""}`,
    );
    const popup = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "Open preview", exact: true })
      .click();
    const preview = await popup;
    await preview.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    );
    if (mobile)
      await preview
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    const options = preview.getByRole("button", {
      name: "Options for Prepare the workshop",
      exact: true,
    });
    const row = preview.locator(".conversation-row").filter({ has: options });
    const before = await row.boundingBox();
    await options.click();
    const actions = preview.getByRole("dialog", {
      name: "Conversation actions",
      exact: true,
    });
    await expect(actions).toBeVisible();
    await expect(actions).not.toContainText("Prepare the workshop");
    await preview.screenshot({
      path: test.info().outputPath("conversation-menu.png"),
    });
    await actions
      .getByRole("button", { name: "Rename", exact: true })
      .press("Enter");
    const input = preview.getByRole("textbox", {
      name: "Conversation title",
      exact: true,
    });
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("type", "text");
    expect(
      await input.evaluate((element: HTMLInputElement) => [
        element.selectionStart,
        element.selectionEnd,
      ]),
    ).toEqual([0, "Prepare the workshop".length]);
    await input.evaluate((element: HTMLInputElement) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "Spring\nworkshop");
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(input).toHaveValue("Spring workshop");
    await input.dispatchEvent("compositionstart");
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await expect(input).toBeVisible();
    await input.dispatchEvent("compositionend");
    await input.fill("Spring workshop");
    const editingRow = preview.locator(".conversation-row.editing");
    const during = await editingRow.boundingBox();
    expect(during?.height).toBe(before?.height);
    expect(during?.y).toBe(before?.y);
    await preview.screenshot({
      path: test.info().outputPath("conversation-edit.png"),
    });
    await input.fill(
      "A much longer conversation name for preparing the spring workshop and all its materials",
    );
    expect((await editingRow.boundingBox())?.height).toBe(before?.height);
    await input.focus();
    await expect(input).toBeFocused();
    await input.press("Escape");
    await expect(options).toBeFocused();
    if (mobile)
      await expect(
        preview.getByRole("dialog", {
          name: "Workspace navigation",
          exact: true,
        }),
      ).toBeVisible();
    await options.click();
    await preview.getByRole("button", { name: "Rename", exact: true }).click();
    await input.fill("   ");
    await expect(
      preview.getByRole("button", { name: "Save name", exact: true }),
    ).toBeDisabled();
    await input.press("Enter");
    await expect(input).toBeVisible();
    await input.fill("Spring workshop");
    await input.press("Enter");
    await expect(input).toHaveCount(0);
    const renamed = preview.getByRole("button", {
      name: "Options for Spring workshop",
      exact: true,
    });
    await expect(renamed).toBeFocused();
    await renamed.click();
    await preview.getByRole("button", { name: "Rename", exact: true }).click();
    await input.fill("Discard this");
    await preview
      .getByRole("button", { name: "Cancel rename", exact: true })
      .click();
    await expect(renamed).toBeFocused();
    await renamed.click();
    await preview.getByRole("button", { name: "Rename", exact: true }).click();
    await input.fill("Autumn workshop");
    await input.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(
      preview.getByRole("button", { name: "Save name", exact: true }),
    ).toBeFocused();
    await preview
      .getByRole("button", { name: "Save name", exact: true })
      .click();
    await expect(
      preview.getByRole("button", {
        name: "Options for Autumn workshop",
        exact: true,
      }),
    ).toBeFocused();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(
      page.getByLabel("Prepare the workshop", { exact: true }),
    ).toBeVisible();
    if (mobile) {
      await expect(
        preview.getByRole("dialog", {
          name: "Workspace navigation",
          exact: true,
        }),
      ).not.toBeVisible();
      await preview
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    }
    await expect(options).toBeVisible();
    await expect(input).toHaveCount(0);
  });
}
