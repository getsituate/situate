import { expect, test } from "./test";
import { onboardingFixture } from "./onboarding-fixture";

test.use({ localizationMode: "real" });

test("the held welcome hands over naturally and leaves no entrance animation running", async ({
  page,
}) => {
  await onboardingFixture(page, { startAtEntry: true, connected: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("button", { name: "Create a workspace" }).click();
  await expect(page.locator("#create-title")).toBeFocused({ timeout: 15_000 });
  await expect(page.locator(".unfolding-place")).toHaveCount(0);
  await expect(page.locator(".setup-entry-enter-active")).toHaveCount(0);
  expect(
    await page
      .locator(".setup-entry-destination")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
});

test("cancelling during the overlap removes both stages and does not steal focus later", async ({
  page,
}) => {
  await onboardingFixture(page, { startAtEntry: true, connected: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const create = page.getByRole("button", { name: "Create a workspace" });
  await create.click();
  await page.getByRole("button", { name: "Skip intro", exact: true }).click();
  await expect(page.locator(".setup-entry-leave-active")).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".setup-entry-host")).toHaveCount(0);
  await expect(create).toBeFocused();
  await page.waitForTimeout(700);
  await expect(create).toBeFocused();
  await create.click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("#create-title")).toBeFocused();
  await expect(page.locator(".setup-panel")).toHaveCSS("opacity", "1");
});

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`welcome overlaps the creation entrance at ${viewport.width}px without delaying input`, async ({
    page,
  }, info) => {
    await onboardingFixture(page, { startAtEntry: true, connected: false });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await page.getByRole("button", { name: "Create a workspace" }).click();
    const skip = page.getByRole("button", { name: "Skip intro", exact: true });
    await expect(skip).toBeVisible();
    await skip.click();
    const destination = page.locator(".setup-entry-destination");
    await expect(destination).toBeVisible();
    const overlap = await page.evaluate(() => {
      const welcome = document.querySelector<HTMLElement>(".unfolding-place");
      const panel = document.querySelector<HTMLElement>(".setup-panel")!;
      return {
        inert: welcome?.inert,
        hidden: welcome?.getAttribute("aria-hidden"),
        pointerEvents: welcome && getComputedStyle(welcome).pointerEvents,
        position: welcome && getComputedStyle(welcome).position,
        destinationTop:
          document
            .querySelector(".setup-entry-destination")!
            .getBoundingClientRect().top -
          document.querySelector(".setup-entry-host")!.getBoundingClientRect()
            .top,
        duration: panel.getAnimations()[0]?.effect?.getTiming().duration,
        delay: panel.getAnimations()[0]?.effect?.getTiming().delay,
        focused: document.activeElement?.id,
        overflowing: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(overlap).toEqual({
      inert: true,
      hidden: "true",
      pointerEvents: "none",
      position: "absolute",
      destinationTop: 0,
      duration: 520,
      delay: 120,
      focused: "create-title",
      overflowing: false,
    });
    await info.attach("creation-entrance", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.waitForTimeout(180);
    await info.attach("creation-entrance-settling", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    const name = page.getByRole("textbox", {
      name: "Workspace name",
      exact: true,
    });
    await name.focus();
    await expect(page.locator(".setup-panel")).toHaveCSS("opacity", "1");
    await name.fill("Field notes");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".setup-entry-destination .frame-art")).toHaveCSS(
      "animation-name",
      "none",
    );
    await expect(name).toHaveValue("Field notes");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Create a workspace" }),
    ).toBeFocused();
    await expect(page.locator(".setup-entry-host")).toHaveCount(0);
    await page.getByRole("button", { name: "Create a workspace" }).click();
    await expect(name).toBeVisible();
    await expect(page.locator(".setup-panel")).toHaveCSS("opacity", "1");
    await expect(page.locator("#create-title")).toBeFocused();
  });
}
