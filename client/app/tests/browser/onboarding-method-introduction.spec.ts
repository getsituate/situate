import { expect, test } from "./test";
import { t } from "@situate/localization";
import { onboardingFixture } from "./onboarding-fixture";
import { newOnboardingRecord } from "../../src/onboarding/types";

test.use({ localizationMode: "real" });

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
]) {
  test(
    `working method introduction and form remain reachable on ${viewport.name}`,
    { tag: `@visual-${viewport.name}` },
    async ({ page, visual, browserName }, info) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await onboardingFixture(page, {
        record: { ...newOnboardingRecord(), step: "method" },
      });
      await page.goto("/");
      const form = page.locator("form.starting-details");
      await expect(form.getByRole("heading", { level: 1 })).toHaveText(
        t("onboarding.conversation.briefTitle"),
      );
      await expect(form.getByRole("heading", { level: 2 })).toHaveText(
        t("onboarding.conversation.chatTitle"),
      );
      await expect(
        form.getByText(t("onboarding.conversation.chatHelp")),
      ).toBeVisible();
      await visual.capture("onboarding.method.introduction");
      await info.attach("method-introduction", {
        body: await page.screenshot({
          path: info.outputPath("method-introduction.png"),
        }),
        contentType: "image/png",
      });
      const sources = form.getByRole("textbox", {
        name: t("onboarding.conversation.sources"),
        exact: true,
      });
      await sources.fill("A folder of synthetic reading notes.");
      await form
        .getByRole("radio", {
          name: t("onboarding.conversation.keep"),
          exact: true,
        })
        .check();
      const preferences = form.getByRole("textbox", {
        name: t("onboarding.conversation.preferences"),
        exact: true,
      });
      await preferences.fill("Keep the existing folders.");
      await preferences.press(
        process.platform === "darwin" && browserName === "webkit"
          ? "Alt+Tab"
          : "Tab",
      );
      const submit = form.getByRole("button", {
        name: t("onboarding.conversation.start"),
        exact: true,
      });
      await expect(submit).toBeFocused();
      await expect(submit).toBeInViewport();
      await expect(submit).toBeEnabled();
      await expect(
        form.getByText(t("onboarding.conversation.laterHelp")),
      ).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await visual.capture("onboarding.method.ready");
      await info.attach("method-form-ready", {
        body: await page.screenshot({
          path: info.outputPath("method-form-ready.png"),
        }),
        contentType: "image/png",
      });
      await page.setViewportSize({
        width: viewport.width === 375 ? 320 : 768,
        height: 740,
      });
      await expect(preferences).toHaveValue("Keep the existing folders.");
      await expect(sources).toHaveValue("A folder of synthetic reading notes.");
      await submit.scrollIntoViewIfNeeded();
      await expect(submit).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await submit.press("Enter");
      await expect(page.locator(".chat-pane")).toBeVisible();
      await expect(form).toHaveCount(0);
    },
  );
}
