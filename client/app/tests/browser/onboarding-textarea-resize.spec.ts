import { expect, test } from "./test";
import { onboardingFixture } from "./onboarding-fixture";
import { newOnboardingRecord } from "../../src/onboarding/types";
import { t } from "@situate/localization";

test.use({ localizationMode: "real" });

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 1280, height: 600 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`onboarding textarea stays contained and reachable at ${viewport.width}x${viewport.height}`, async ({
    page,
    browserName,
  }) => {
    const tab =
      process.platform === "darwin" && browserName === "webkit"
        ? "Alt+Tab"
        : "Tab";
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await onboardingFixture(page, {
      record: { ...newOnboardingRecord(), step: "method" },
    });
    await page.goto("/");
    const sources = page.getByRole("textbox", {
      name: t("onboarding.conversation.sources"),
      exact: true,
    });
    const preferences = page.getByRole("textbox", {
      name: t("onboarding.conversation.preferences"),
      exact: true,
    });
    const begin = page.getByRole("button", {
      name: t("onboarding.conversation.start"),
      exact: true,
    });
    await expect(sources).toHaveCSS("resize", "vertical");
    await expect(preferences).toHaveCSS("resize", "vertical");
    const text = `${"Synthetic reading notes and tasks. ".repeat(80)}\n${"x".repeat(1000)}\nLast task`;
    await sources.fill(text);
    const geometry = () =>
      sources.evaluate((element) => {
        const field = element as HTMLTextAreaElement;
        const bounds = field.getBoundingClientRect();
        const label = field.parentElement!.getBoundingClientRect();
        const form = field.closest("form")!;
        const panel = field.closest(".setup-panel")!;
        return {
          width: bounds.width,
          height: bounds.height,
          contained:
            bounds.left >= label.left - 1 && bounds.right <= label.right + 1,
          fieldOverflowX: field.scrollWidth - field.clientWidth,
          fieldOverflowY: field.scrollHeight - field.clientHeight,
          formOverflowX: form.scrollWidth - form.clientWidth,
          panelOverflowX: panel.scrollWidth - panel.clientWidth,
          pageOverflowX:
            document.documentElement.scrollWidth - window.innerWidth,
        };
      });
    const initial = await geometry();
    expect(initial.contained).toBe(true);
    expect(initial.fieldOverflowY).toBeGreaterThan(0);
    await sources.evaluate((element) =>
      element.scrollIntoView({ block: "end" }),
    );
    const bounds = (await sources.boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width - 3,
      bounds.y + bounds.height - 3,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width + 120,
      bounds.y + bounds.height + 100,
      { steps: 10 },
    );
    await page.mouse.up();
    const resized = await geometry();
    expect(resized.width).toBeCloseTo(initial.width, 0);
    expect(resized.height).toBeGreaterThan(initial.height + 30);

    // Exercise a retained native resize larger than the visible scroll area.
    await sources.evaluate((element, height) => {
      element.style.height = `${height * 2}px`;
    }, viewport.height);
    const large = await geometry();
    expect(large.contained).toBe(true);
    for (const overflow of [
      large.fieldOverflowX,
      large.formOverflowX,
      large.panelOverflowX,
      large.pageOverflowX,
    ]) {
      expect(overflow).toBeLessThanOrEqual(1);
    }
    await expect(sources).toHaveValue(text);
    await sources.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.scrollIntoView({ block: "end" });
    });
    expect(
      await sources.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          document.elementFromPoint(bounds.right - 4, bounds.bottom - 4) ===
          element
        );
      }),
    ).toBe(true);
    await sources.focus();
    await sources.press(tab);
    const fresh = page.getByRole("checkbox", {
      name: t("onboarding.conversation.fresh"),
      exact: true,
    });
    await expect(fresh).toBeFocused();
    await expect(fresh).toBeInViewport();
    await preferences.fill("Keep the reading folders.");
    await expect(preferences).toBeFocused();
    await preferences.press(tab);
    await expect(begin).toBeFocused();
    await expect(begin).toBeInViewport();
    await expect(begin).toBeEnabled();
    await begin.press("Enter");
    await expect(page.locator(".starting-details")).toHaveCount(0);
  });
}
