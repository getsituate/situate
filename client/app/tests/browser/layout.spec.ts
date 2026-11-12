import { expect, test } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";

test.use({ localizationMode: "real" });
test.beforeEach(async ({ page }) => workspaceFixture(page, shellState));

test("new chat plays a finite greeting without moving the composer", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install();
  await page.goto("/");
  const greeting = page.locator(".greeting");
  await expect(greeting).toHaveAttribute("data-state", "playing");
  await expect(greeting.locator(".unrevealed").first()).toBeAttached();
  const before = await page.locator(".chat-footer").boundingBox();
  expect(
    await greeting.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(2);
  await page.clock.runFor(3000);
  await expect(greeting).toHaveAttribute("data-state", "done");
  await expect(greeting.locator(".unrevealed")).toHaveCount(0);
  expect(await page.locator(".chat-footer").boundingBox()).toEqual(before);
  expect(
    await greeting.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
});

for (const width of [320, 375, 768, 1183, 1184, 1280, 1440]) {
  test(`shell fits a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(
      page.getByRole("tab", { name: "New chat", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".greeting h2")).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Attach file" }),
    ).toBeEnabled();
    await expect(page.locator("textarea")).toBeEditable();
    await expect(page.locator(".model-picker")).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Keep this disconnected draft");
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("Keep this disconnected draft");
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight <=
          document.documentElement.clientHeight,
      ),
    ).toBe(true);

    if (width >= 1184) {
      await expect(
        page.getByRole("navigation", { name: "Workspace navigation" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Open navigation" }),
      ).toBeHidden();
      expect(
        (await page.locator(".desktop-sidebar").boundingBox())?.width,
      ).toBe(300);
    } else {
      await expect(page.getByRole("navigation")).toBeHidden();
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(
        page.getByRole("dialog", { name: "Workspace navigation" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Settings", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Close navigation" }).click();
    }
    await expect(page.locator(".welcome-bend")).toBeVisible();
    await expect(page.locator(".welcome-bend svg")).toBeVisible();
    const heading = await page.locator(".greeting h2").boundingBox();
    const composer = await page.locator(".chat-footer").boundingBox();
    expect(composer!.y - (heading!.y + heading!.height)).toBeGreaterThanOrEqual(
      20,
    );
    await expect
      .poll(() =>
        page
          .getByAltText("Situate", { exact: true })
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  });
}

test("navigation remains reachable at fractional viewport widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = "/";
    frame.title = "Narrow workspace";
    frame.style.cssText =
      "position:fixed;inset:0;width:1183.5px;height:640px;border:0;zoom:1.25;z-index:1";
    document.body.append(frame);
  });
  const workspace = page.frameLocator("iframe");
  await expect(
    workspace.getByRole("tab", { name: "New chat", exact: true }),
  ).toBeVisible();
  const wide = await workspace
    .locator("body")
    .evaluate(() => matchMedia("(min-width: 1184px)").matches);
  if (wide) {
    await expect(workspace.getByRole("navigation")).toBeVisible();
  } else {
    await expect(
      workspace.getByRole("button", { name: "Open navigation" }),
    ).toBeVisible();
    await workspace.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      workspace.getByRole("dialog", { name: "Workspace navigation" }),
    ).toBeVisible();
  }
});

test("desktop navigation keeps enlarged text within the sidebar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const sidebar = page.getByRole("navigation", {
    name: "Workspace navigation",
  });
  const bounds = await sidebar.boundingBox();
  expect(bounds).not.toBeNull();
  for (const name of ["Plugins", "Settings"]) {
    const button = sidebar.getByRole("button", { name, exact: true });
    await expect(button).toBeInViewport({ ratio: 1 });
    const buttonBounds = (await button.boundingBox())!;
    expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(
      bounds!.x + bounds!.width,
    );
  }
});

test("short windows and enlarged text remain scrollable without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page
    .getByRole("button", { name: "Attach file" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Attach file" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeInViewport();
  await page
    .locator(".conversation-destination")
    .first()
    .scrollIntoViewIfNeeded();
  await expect(
    page.locator(".conversation-destination").first(),
  ).toBeInViewport();
  const overflow = await page
    .locator(".app-sidebar")
    .evaluate((sidebar) => sidebar.scrollWidth > sidebar.clientWidth);
  expect(overflow).toBe(false);
});

test("a long workspace name leaves compact navigation actions reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const name = page.locator(".workspace-name").last();
  await name.evaluate((element) => {
    element.textContent = "A very long personal workspace name ".repeat(8);
  });
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeInViewport();
  expect(
    await page
      .locator(".app-sidebar")
      .last()
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
});

test("long navigation labels reflow and reduced motion stays static", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .locator(".nav-destination span")
    .first()
    .evaluate((element) => {
      element.textContent =
        "A longer personal calendar and planning collection";
    });
  expect(
    await page
      .locator(".desktop-sidebar .app-sidebar")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
