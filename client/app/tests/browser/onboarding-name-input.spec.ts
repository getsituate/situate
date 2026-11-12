import { expect, test } from "./test";
import { onboardingFixture } from "./onboarding-fixture";

test.use({ localizationMode: "real" });

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 1280, height: 600 },
  { width: 390, height: 844 },
]) {
  test(`name preflight keeps accent controls and scrolling stable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await onboardingFixture(page, { startAtEntry: true, connected: false });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      const host = Reflect.get(window, "__TAURI_INTERNALS__");
      const invoke = host.invoke.bind(host);
      const pending: (() => void)[] = [];
      Reflect.set(window, "finishNameCheck", () => pending.shift()?.());
      host.invoke = async (command: string, args: Record<string, unknown>) => {
        if (command === "workspace_preflight") {
          await new Promise<void>((resolve) => {
            pending.push(resolve);
          });
        }
        return invoke(command, args);
      };
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Create a workspace" }).click();
    const name = page.getByRole("textbox", {
      name: "Workspace name",
      exact: true,
    });
    const create = page.getByRole("button", {
      name: "Create workspace",
      exact: true,
    });
    const finish = () =>
      page.evaluate(() => Reflect.get(window, "finishNameCheck")());
    await expect(page.getByRole("status")).toHaveText("Checking folder…");
    await finish();
    await expect(create).toBeEnabled();
    await page.getByRole("radio", { name: "Tangerine", exact: true }).check();
    await name.scrollIntoViewIfNeeded();
    await expect(page.locator(".setup-entry-enter-active")).toHaveCount(0);
    await name.evaluate((element) => {
      element.focus({ preventScroll: true });
    });
    const geometry = () =>
      page.evaluate(() => {
        const panel = document.querySelector(".setup-panel")!;
        const colors = document.querySelector(".appearance-colors")!;
        return {
          colorsTop: colors.getBoundingClientRect().top,
          panelScroll: panel.scrollTop,
          formScroll: document.querySelector(".entry-layout")!.scrollTop,
          frameScroll: document.querySelector(".setup-frame")!.scrollTop,
          footerTop: document
            .querySelector(".form-actions")!
            .getBoundingClientRect().top,
        };
      });
    const settled = await geometry();
    await name.fill("Field notes");
    await expect(page.getByRole("status")).toHaveText("Checking folder…");
    await expect(create).toBeDisabled();
    await name.press("Enter");
    expect(
      await page.evaluate(() =>
        Reflect.get(window, "__ipcCalls").filter(
          (c: { args: { action?: string } }) => c.args.action === "create",
        ),
      ),
    ).toEqual([]);
    expect(await geometry()).toEqual(settled);
    await finish();
    await expect(create).toBeEnabled();
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(await geometry()).toEqual(settled);
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Field notes");
    await expect(
      page.getByRole("radio", { name: "Tangerine", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("textbox", { name: "Workspace folder", exact: true }),
    ).toHaveValue("/Documents/Field notes");
  });
}
