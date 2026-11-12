import { selectOption } from "./select";
import { expect, test } from "./test";
import { gestures } from "../../src/mini-bend-playful/gestures";

test("ten articulated waiting scenes stay in their fixed stage and stop on request completion", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/?workshop=controls&scenario=chat-working");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.waitForLoadState("load");
  const mark = preview.locator(".mini-bend-playful");
  await expect(mark).toBeVisible();
  const original = await mark.boundingBox();
  for (const { id: variant } of gestures) {
    await selectOption(
      page.getByLabel("Mini Bend movement", { exact: true }),
      variant,
    );
    await expect
      .poll(() =>
        mark.evaluate((el) => el.getAnimations({ subtree: true }).length),
      )
      .toBe(2);
    const samples = await mark.evaluate(async (el) => {
      const animations = el.getAnimations({ subtree: true });
      animations.forEach((animation) => animation.pause());
      const body = el.querySelector("g")!;
      const samples = [];
      for (const fraction of [0, 0.4, 0.65, 1]) {
        animations.forEach((animation) => {
          animation.currentTime =
            Number(animation.effect!.getTiming().duration) * fraction;
        });
        await new Promise(requestAnimationFrame);
        const box = el.getBoundingClientRect();
        samples.push({
          width: box.width,
          height: box.height,
          left: el.querySelector(".mini-bend-playful__left")!.getAttribute("d"),
          transform:
            getComputedStyle(body).transform === "none"
              ? "matrix(1, 0, 0, 1, 0, 0)"
              : getComputedStyle(body).transform,
        });
      }
      return samples;
    });
    expect(
      samples.every(
        (sample) =>
          sample.width === original!.width &&
          sample.height === original!.height,
      ),
    ).toBe(true);
    expect(samples[1].transform).not.toBe(samples[0].transform);
    expect(samples[1].left).not.toBe(samples[0].left);
    expect(samples.at(-1)!.left).toBe(samples[0].left);
    expect(samples.at(-1)!.transform).toBe(samples[0].transform);
    await preview
      .getByRole("button", { name: "Pause animation", exact: true })
      .click();
    expect(
      await mark.evaluate((el) => el.getAnimations({ subtree: true }).length),
    ).toBe(0);
    await preview
      .getByRole("button", { name: "Resume animation", exact: true })
      .click();
  }
  await selectOption(
    page.getByLabel("Response state", { exact: true }),
    "complete",
  );
  await expect(mark).toHaveCount(0);
  await expect(preview.locator(".bend-status")).toHaveCount(0);
});
