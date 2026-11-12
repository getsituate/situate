import { expect, type Locator } from "./test";

export async function expectDialogText(
  text: Locator,
  role: "title" | "body" | "section" | "help",
  rootSize = 16,
) {
  const [scale, leading, weight] = (
    {
      title: [1.25, 1.3, "650"],
      body: [1, 1.55, "400"],
      section: [1, 1.4, "600"],
      help: [0.875, 1.5, "400"],
    } as const
  )[role];
  await expect(text).toHaveCSS("font-size", `${rootSize * scale}px`);
  await expect
    .poll(() =>
      text.evaluate((element) =>
        parseFloat(getComputedStyle(element).lineHeight),
      ),
    )
    .toBeCloseTo(rootSize * scale * leading, 3);
  await expect(text).toHaveCSS("font-weight", weight);
  await expect(text).toHaveCSS("letter-spacing", "normal");
  expect(
    await text.evaluate((element) => getComputedStyle(element).fontFamily),
  ).toBe(
    await text.evaluate(
      (element) => getComputedStyle(element.closest("dialog")!).fontFamily,
    ),
  );
}

export async function expectDialogTypography(dialog: Locator, rootSize = 16) {
  await expect(dialog).toBeVisible();
  await expectDialogText(
    dialog
      .locator(
        ".situate-dialog__header h2, [data-dialog-title], :scope > h2, :scope > h3",
      )
      .first(),
    "title",
    rootSize,
  );
  for (const paragraph of await dialog
    .locator(
      "p:not(:where([data-dialog-document], [data-dialog-document] *, [data-dialog-help]))",
    )
    .all()) {
    await expectDialogText(paragraph, "body", rootSize);
  }
  for (const button of await dialog
    .locator(".situate-dialog-actions .situate-button")
    .all()) {
    await expect(button).toHaveCSS("font-size", `${rootSize * 0.875}px`);
    await expect(button).toHaveCSS("font-weight", "600");
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
}
