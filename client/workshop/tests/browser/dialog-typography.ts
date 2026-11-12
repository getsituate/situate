import { expect, type Locator } from "./test";

async function expectTextRole(
  text: Locator,
  scale: number,
  leading: number,
  weight: string,
) {
  const rootSize = await text.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  await expect(text).toHaveCSS("font-size", `${rootSize * scale}px`);
  await expect
    .poll(() =>
      text.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight)),
    )
    .toBeCloseTo(rootSize * scale * leading, 3);
  await expect(text).toHaveCSS("font-weight", weight);
  await expect(text).toHaveCSS("letter-spacing", "normal");
  const dialogFont = await text.evaluate(
    (node) => getComputedStyle(node.closest("dialog")!).fontFamily,
  );
  await expect(text).toHaveCSS("font-family", dialogFont);
  const ink = await text.evaluate(
    (node) => getComputedStyle(node.closest("dialog")!).color,
  );
  await expect(text).toHaveCSS("color", ink);
}
export const expectDialogTitle = (title: Locator) =>
  expectTextRole(title, 1.25, 1.3, "650");
export const expectDialogBody = (body: Locator) =>
  expectTextRole(body, 1, 1.55, "400");
export const expectDialogSection = (heading: Locator) =>
  expectTextRole(heading, 1, 1.4, "600");
