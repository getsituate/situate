import { selectScenario } from "./scenarios";
import { expect, test, type Page } from "./test";

async function open(page: Page) {
  await page.goto("/?workshop=controls&scenario=plugins-empty");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await expect(
    page.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  return preview;
}

test("first-use illustration leaves creation clear at narrow sizes and enlarged text", async ({
  page,
}) => {
  const preview = await open(page);
  await preview.emulateMedia({ reducedMotion: "reduce" });
  const empty = preview.getByRole("region", {
    name: "What should we make first?",
    exact: true,
  });
  await expect(
    preview.getByRole("button", { name: "Create a plugin", exact: true }),
  ).toHaveCount(1);
  await expect(
    preview.getByRole("button", { name: "Create a connection", exact: true }),
  ).toHaveCount(0);
  await expect(empty.getByRole("button")).toHaveCount(1);
  await expect(empty).toContainText(
    "connect your services, create new views, and change how the app works",
  );
  await expect(
    preview.getByRole("region", { name: "Connections", exact: true }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: /Pending code/ }),
  ).toHaveCount(0);
  const art = empty.locator(".plugin-first-tool-art");
  await expect(art).toHaveAttribute("aria-hidden", "true");
  await expect(art.locator("img")).toHaveAttribute("src", /point-curious/);
  for (const width of [1440, 768, 375, 320]) {
    await preview.setViewportSize({ width, height: 900 });
    await expect(empty.getByRole("heading")).toBeVisible();
    expect(
      await preview
        .locator(".plugin-view")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    const bounds = (await empty.boundingBox())!;
    for (const button of await empty.getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  await preview.setViewportSize({ width: 1440, height: 1000 });
  await preview.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await preview
      .locator(".plugin-view")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect(
    await art.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
  await expect(
    empty.getByRole("button", { name: "Create a plugin", exact: true }),
  ).toBeEnabled();
});

test("shared creation opens development and preserves the route to unfinished work", async ({
  page,
}) => {
  const preview = await open(page);
  const create = preview.getByRole("button", {
    name: "Create a plugin",
    exact: true,
  });
  await create.focus();
  await create.press("Enter");
  await expect(
    preview.getByRole("heading", { name: "New assignment", exact: true }),
  ).toBeFocused();
  await expect(
    preview.getByLabel("Your request", { exact: true }),
  ).toBeEditable();
  await preview
    .getByRole("button", { name: "Close development view", exact: true })
    .click();
  await preview.getByRole("button", { name: /Pending code/ }).click();
  await expect(
    preview.getByRole("heading", { name: "Pending code", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: /Pending code/ }),
  ).toHaveCount(0);
  for (const scenario of ["plugins-list", "plugins-connections"]) {
    await selectScenario(page, scenario);
    await expect(
      preview.getByRole("button", { name: "Create a plugin", exact: true }),
    ).toHaveCount(1);
    await expect(
      preview.getByRole("button", { name: "Create a connection", exact: true }),
    ).toHaveCount(0);
    await preview
      .getByRole("button", { name: "Create a plugin", exact: true })
      .click();
    await expect(
      preview.getByRole("heading", { name: "New assignment", exact: true }),
    ).toBeFocused();
    await expect(
      preview.getByLabel("Your request", { exact: true }),
    ).toHaveValue(
      "Help me create a plugin. Ask what I want to connect, see or change in Situate.",
    );
    await preview
      .getByLabel("Your request", { exact: true })
      .fill("Connect my calendar so I can use it across my tools.");
    await expect(
      preview.getByRole("button", { name: "Send request", exact: true }),
    ).toBeEnabled();
  }
});
