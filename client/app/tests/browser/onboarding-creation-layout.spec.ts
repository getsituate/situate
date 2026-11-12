import { expect, test } from "./test";
import { onboardingFixture } from "./onboarding-fixture";
import nativeConfig from "../../src-tauri/tauri.conf.json" with { type: "json" };

const nativeWindow = nativeConfig.app.windows[0]!;

test.use({ localizationMode: "real" });

for (const viewport of [
  { width: nativeWindow.width, height: nativeWindow.height },
  { width: 800, height: 360 },
  { width: 390, height: 844 },
  { width: 320, height: 360 },
]) {
  test(
    `onboarding creation keeps actions visible at ${viewport.width}x${viewport.height}`,
    { tag: viewport.width > 700 ? "@visual-desktop" : "@visual-mobile" },
    async ({ page, visual, browserName }) => {
      const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
      await onboardingFixture(page, { startAtEntry: true, connected: false });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await page.getByRole("button", { name: "Create a workspace" }).click();
      await expect(page.locator("#create-title")).toBeFocused();
      await expect(page.locator(".setup-entry-enter-active")).toHaveCount(0);
      const cancel = page.getByRole("button", { name: "Cancel", exact: true });
      const create = page.getByRole("button", {
        name: "Create workspace",
        exact: true,
      });
      await expect(create).toBeEnabled();
      await expect(cancel).toBeInViewport({ ratio: 1 });
      await expect(create).toBeInViewport({ ratio: 1 });
      expect(
        await page
          .locator(".entry-layout")
          .evaluate((element) => element.clientHeight),
      ).toBeGreaterThanOrEqual(60);
      if (viewport.width === nativeWindow.width) {
        await expect(
          page.getByRole("textbox", { name: "Workspace name", exact: true }),
        ).toBeInViewport({ ratio: 1 });
        await expect(
          page.getByRole("textbox", { name: "Workspace folder" }),
        ).toBeInViewport({ ratio: 1 });
        await expect(
          page.locator(".appearance-option-content").last(),
        ).toBeInViewport({ ratio: 1 });
        expect(
          await page
            .locator(".setup-entry-destination, .setup-panel, .entry-layout")
            .evaluateAll((elements) =>
              elements.map((element) => element.scrollTop),
            ),
        ).toEqual([0, 0, 0]);
      }
      await visual.capture("onboarding.creation.actions-ready");
      const bounds = await page
        .locator(".workspace-create-actions")
        .boundingBox();
      const name = page.getByRole("textbox", {
        name: "Workspace name",
        exact: true,
      });
      if (viewport.width === 390) {
        await name.focus();
        await page.setViewportSize({ width: 390, height: 430 });
        await expect(name).toBeFocused();
        await expect(name).toHaveValue("My workspace");
        await expect(cancel).toBeInViewport({ ratio: 1 });
        await expect(create).toBeInViewport({ ratio: 1 });
        await page.setViewportSize(viewport);
      }
      await name.fill("Existing");
      await expect(page.locator("#folder-error")).toBeVisible();
      await page.locator("#folder-error").scrollIntoViewIfNeeded();
      await expect(page.locator("#folder-error")).toBeInViewport();
      await expect(name).toBeFocused();
      await expect(cancel).toBeInViewport({ ratio: 1 });
      await expect(create).toBeInViewport({ ratio: 1 });
      await expect(create).toBeDisabled();
      expect(
        await page.locator(".workspace-create-actions").boundingBox(),
      ).toEqual(bounds);
      await visual.capture("onboarding.creation.actions-collision");
      await name.fill("Field notes");
      await expect(create).toBeEnabled();
      await name.focus();
      await page.keyboard.press(tab);
      await expect(
        page.getByRole("textbox", { name: "Workspace folder" }),
      ).toBeFocused();
      await page.keyboard.press(tab);
      await expect(page.getByRole("button", { name: "Choose…" })).toBeFocused();
      await page
        .getByRole("radio", { name: "Violet Default", exact: true })
        .focus();
      await page.keyboard.press(tab);
      await expect(cancel).toBeFocused();
      await page.keyboard.press(tab);
      await expect(create).toBeFocused();
      await expect(create).toBeInViewport({ ratio: 1 });
      await page.keyboard.press(`Shift+${tab}`);
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("button", { name: "Create a workspace" }),
      ).toBeFocused();
    },
  );
}
