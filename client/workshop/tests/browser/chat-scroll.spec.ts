import { expect, test } from "./test";
import { chooseSelect } from "./select";

for (const profile of ["mac", "ios"] as const) {
  test(`chat scroll-to-end preserves reading position and resumes following on ${profile}`, async ({
    page,
  }, testInfo) => {
    await page.goto(
      `/?workshop=controls&scenario=chat-work-history&profile=${profile}`,
    );
    const popup = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "Open preview", exact: true })
      .click();
    const preview = await popup;
    await preview.waitForLoadState("load");
    await preview.setViewportSize(
      profile === "ios"
        ? { width: 390, height: 700 }
        : { width: 1040, height: 600 },
    );
    const scroll = preview.locator(".chat-scroll");
    const button = preview.getByRole("button", {
      name: "Scroll to end",
      exact: true,
    });
    const distance = () =>
      scroll.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    await expect(scroll).toBeVisible();
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event("scroll"));
    });
    await preview.locator(".work-history-heading").click();
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(48);
    await expect.poll(distance).toBeLessThanOrEqual(48);
    await expect(button).toBeHidden();
    await expect(preview.locator(".chat-footer")).not.toHaveClass(
      /is-scrolled-back/,
    );

    await scroll.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const footer = await preview.locator(".chat-footer").boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(footer!.y);
    const composer = await preview.locator(".composer-area").boundingBox();
    expect(
      Math.abs(box!.x + box!.width - composer!.x - composer!.width),
    ).toBeLessThanOrEqual(1);
    const fade = await preview.locator(".chat-footer").evaluate((el) => {
      const style = getComputedStyle(el, "::before");
      return {
        background: style.backgroundImage,
        pointerEvents: style.pointerEvents,
      };
    });
    expect(fade.background).toContain("linear-gradient");
    expect(fade.pointerEvents).toBe("none");
    await button.focus();
    await preview.screenshot({
      path: testInfo.outputPath(`chat-scroll-${profile}.png`),
    });

    if (profile === "ios") {
      await page.getByLabel("Keyboard occlusion", { exact: true }).check();
      await expect(button).toBeInViewport();
      await preview.screenshot({
        path: testInfo.outputPath("chat-scroll-ios-keyboard.png"),
      });
      await page.getByLabel("Keyboard occlusion", { exact: true }).uncheck();
    }

    // Content growth uses the same resize path as an arriving response.
    await preview.locator(".chat-thread").evaluate((el) => {
      const addition = document.createElement("p");
      addition.textContent = "An additional response.";
      addition.style.height = "300px";
      el.append(addition);
    });
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(0);
    await expect(button).toBeVisible();
    await preview.keyboard.press("Enter");
    await expect.poll(distance).toBeLessThanOrEqual(1);
    await expect(button).toBeHidden();
    await expect(scroll).toBeFocused();
    await preview.locator(".chat-thread > p:last-child").evaluate((el) => {
      el.style.height = "600px";
    });
    await expect.poll(distance).toBeLessThanOrEqual(1);

    await scroll.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await chooseSelect(page.getByLabel("Composer control language"), "de");
    const germanButton = preview.getByRole("button", {
      name: "Zum Ende",
      exact: true,
    });
    await expect(germanButton).toBeVisible();
    await germanButton.click();
    await expect.poll(distance).toBeLessThanOrEqual(1);
    await expect(germanButton).toBeHidden();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
