import { expect, test, type Page } from "./test";
import { t } from "@situate/localization";
import { onboardingFixture } from "./onboarding-fixture";

test.use({ localizationMode: "real" });
async function tick(page: Page, time: number) {
  await page.evaluate(
    (time) => Reflect.get(window, "__stepMotionTick")(time),
    time,
  );
}
test("verified access leaves, completes, travels and only then reveals the brief", async ({
  page,
}, info) => {
  await onboardingFixture(page, { modelProvider: "openai" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const check = page.getByRole("button", {
    name: t("onboarding.access.check"),
    exact: true,
  });
  await expect(check).toBeVisible();
  await page.evaluate(() => {
    let id = 0;
    const frames = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback) => {
      frames.set(++id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      frames.delete(id);
    };
    Reflect.set(window, "__stepMotionTick", (time: number) => {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(time);
      }
    });
  });
  await check.focus();
  await check.press("Enter");
  const panel = page.locator(".setup-panel");
  const art = page.locator(".setup-illustration");
  const incoming = page.getByRole("heading", {
    name: t("onboarding.conversation.briefTitle"),
    exact: true,
    includeHidden: true,
  });
  await expect(panel).toHaveAttribute("data-transition-phase", "leaving");
  await expect(panel).toHaveAttribute("inert", "");
  await expect(incoming).toHaveCount(0);
  const origin = await art.getAttribute("data-position");
  await tick(page, 0);
  await tick(page, 125);
  const leavingOpacity = await panel.evaluate((el) =>
    Number(getComputedStyle(el).opacity),
  );
  expect(leavingOpacity).toBeGreaterThan(0);
  expect(leavingOpacity).toBeLessThan(1);
  await info.attach("outgoing-task", {
    body: await page.screenshot({ path: info.outputPath("outgoing-task.png") }),
    contentType: "image/png",
  });
  await tick(page, 900);
  await expect(panel).toHaveCSS("visibility", "hidden");
  await expect(page.locator(".sparkles")).toBeVisible();
  await expect(art).toHaveAttribute("data-position", origin!);
  await expect(incoming).toHaveCount(0);
  await info.attach("header-completion", {
    body: await page.screenshot({
      path: info.outputPath("header-completion.png"),
    }),
    contentType: "image/png",
  });
  await tick(page, 1750);
  await expect(page.locator(".sparkles")).toHaveCount(0);
  await expect(art).not.toHaveAttribute("data-position", origin!);
  await expect(panel).toHaveCSS("visibility", "hidden");
  await expect(incoming).toHaveCount(0);
  await info.attach("garden-travel", {
    body: await page.screenshot({ path: info.outputPath("garden-travel.png") }),
    contentType: "image/png",
  });
  await tick(page, 2350);
  await expect(incoming).toHaveCount(1);
  await expect(panel).toHaveCSS("opacity", "0");
  const destination = await art.getAttribute("data-position");
  await tick(page, 2500);
  await expect(incoming).toBeVisible();
  await expect(panel).toHaveAttribute("inert", "");
  await expect(art).toHaveAttribute("data-position", destination!);
  await info.attach("incoming-task", {
    body: await page.screenshot({ path: info.outputPath("incoming-task.png") }),
    contentType: "image/png",
  });
  await tick(page, 2700);
  await expect(panel).not.toHaveAttribute("inert");
  await expect(incoming).toBeFocused();
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__onboardingFixture").progress(),
    ),
  ).toMatchObject({ step: "method" });
});
