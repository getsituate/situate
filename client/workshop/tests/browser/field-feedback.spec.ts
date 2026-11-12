import { expect, test, type Page } from "./test";

async function open(page: Page, scenario: string) {
  await page.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await expect(
    page.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  return preview;
}

for (const width of [1280, 390]) {
  test(`workspace name feedback and correction at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page, "first-entry-create");
    await preview.setViewportSize({ width, height: 900 });
    const input = preview.getByLabel("Workspace name", { exact: true });
    await expect(input).toBeVisible();
    await input.fill("");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    const field = preview.locator(".workspace-name-field");
    const before = await field.boundingBox();
    await input.press("Tab");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(/Enter a workspace name/);
    await expect(
      field.getByText("Error: Enter a workspace name."),
    ).toBeVisible();
    expect((await field.boundingBox())!.height).toBeCloseTo(before!.height, 0);
    await input.focus();
    await expect(input).toHaveCSS("outline-width", "3px");
    await preview.screenshot({
      path: info.outputPath(`name-error-${width}.png`),
    });
    await input.fill("Field notes");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expect(input).not.toHaveAttribute("aria-describedby", /error/);
    await expect(field.locator(".situate-field-error")).toHaveCount(0);
    await expect(input).toBeFocused();
    await preview.screenshot({
      path: info.outputPath(`name-corrected-${width}.png`),
    });
    await input.fill("");
    await input.press("Enter");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await preview
      .getByRole("button", { name: "Create workspace", exact: true })
      .click();
    await expect(input).toBeFocused();
    await input.fill("Bad/name");
    await expect(input).toHaveAccessibleDescription(/at most 240 bytes/);
    const expanded = await field.boundingBox();
    const feedback = await field.locator(".situate-field-error").boundingBox();
    expect(feedback!.y + feedback!.height).toBeLessThanOrEqual(
      expanded!.y + expanded!.height + 1,
    );
    expect(
      await field.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await field.screenshot({
      path: info.outputPath(`name-long-error-${width}.png`),
    });
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expect(field.locator(".situate-field-error")).toHaveCount(0);
  });
}

test("library demonstrates default, help, error, warning, focus and corrected fields", async ({
  page,
}, info) => {
  const preview = await open(page, "components-ready");
  const gallery = preview.locator(".feedback-examples");
  await expect(gallery.locator("article")).toHaveCount(6);
  const warning = gallery.locator("#feedback-warning");
  await expect(warning).not.toHaveAttribute("aria-invalid");
  await expect(warning).toHaveAccessibleDescription(
    /Warning:.*You can still use it/,
  );
  await expect(warning).toHaveCSS("border-style", "dashed");
  await expect(gallery.locator("#feedback-error")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(gallery.locator("#feedback-corrected")).not.toHaveAttribute(
    "aria-describedby",
    /error|warning/,
  );
  const contrasts = await gallery.evaluate((node) => {
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map((value) => {
          const channel = Number(value) / 255;
          return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        });
      return (
        channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      );
    };
    const ratio = (a: string, b: string) => {
      const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
      return (values[1]! + 0.05) / (values[0]! + 0.05);
    };
    const style = (selector: string) =>
      getComputedStyle(node.querySelector(selector)!);
    const paper = getComputedStyle(
      node.closest(".component-library")!,
    ).backgroundColor;
    return {
      errorText: ratio(style(".situate-field-error").color, paper),
      helpText: ratio(style(".situate-field-help").color, paper),
      defaultEdge: ratio(
        style("#feedback-default").borderColor,
        style("#feedback-default").backgroundColor,
      ),
      errorEdge: ratio(
        style("#feedback-error").borderColor,
        style("#feedback-error").backgroundColor,
      ),
      warningEdge: ratio(
        style("#feedback-warning").borderColor,
        style("#feedback-warning").backgroundColor,
      ),
      focus: ratio(
        style("#feedback-focus").outlineColor,
        style("#feedback-focus").backgroundColor,
      ),
    };
  });
  for (const [name, ratio] of Object.entries(contrasts)) {
    expect(ratio, name).toBeGreaterThanOrEqual(name.endsWith("Text") ? 4.5 : 3);
  }
  await gallery.scrollIntoViewIfNeeded();
  await gallery.screenshot({
    path: info.outputPath("field-feedback-library.png"),
  });
  await preview.setViewportSize({ width: 320, height: 568 });
  await expect
    .poll(() =>
      gallery.evaluate((node) => node.scrollWidth <= node.clientWidth),
    )
    .toBe(true);
  await gallery.screenshot({
    path: info.outputPath("field-feedback-library-narrow.png"),
  });
});
