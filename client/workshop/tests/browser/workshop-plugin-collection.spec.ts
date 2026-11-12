import { selectScenario } from "./scenarios";
import { expect, test, type Page } from "./test";

async function open(page: Page) {
  await page.goto("/?workshop=controls&scenario=plugins-list");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await expect(
    page.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  return preview;
}

test("tool cards reflow without hiding names, states or actions", async ({
  page,
}) => {
  const preview = await open(page);
  for (const width of [1440, 768, 375, 320]) {
    await preview.setViewportSize({ width, height: 900 });
    await expect(preview.locator(".plugin-row")).toHaveCount(7);
    await expect(
      preview.locator(".plugin-heading .plugin-workspace"),
    ).toHaveCount(0);
    await expect(preview.locator(".plugin-heading")).not.toContainText(
      "Field notes",
    );
    const weekly = preview.getByRole("article", {
      name: "Weekly planning",
      exact: true,
    });
    await expect(
      weekly.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(
      weekly.getByRole("button", { name: "Adapt plugin", exact: true }),
    ).toBeVisible();
    await expect(
      weekly.getByRole("button", { name: "Calendar connection", exact: true }),
    ).toBeVisible();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    const card = await weekly.boundingBox();
    const action = await weekly
      .getByRole("button", { name: "Adapt plugin", exact: true })
      .boundingBox();
    expect(action!.x + action!.width).toBeLessThanOrEqual(
      card!.x + card!.width,
    );
  }
  await preview
    .locator(".plugin-row h3")
    .first()
    .evaluate((element) => {
      element.textContent =
        "Calendar connection for courses, appointments and a very long personal project name";
    });
  await preview.setViewportSize({ width: 1440, height: 1000 });
  await preview.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await preview
      .locator(".plugin-view")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
});

test("collections omit versions and empty metadata rows but retain running activity", async ({
  page,
}) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 375, height: 900 });
  const cards = preview.locator(".plugin-row");
  await expect(cards.getByText(/^Version \d+$/)).toHaveCount(0);
  const weekly = preview.getByRole("article", {
    name: "Weekly planning",
    exact: true,
  });
  const calendar = preview.getByRole("article", {
    name: "Calendar connection",
    exact: true,
  });
  await expect(weekly.locator(".plugin-meta")).toHaveText("1 running");
  await expect(calendar.locator(".plugin-meta")).toHaveText("1 running");
  await expect(
    preview
      .getByRole("article", { name: "Morning brief", exact: true })
      .locator(".plugin-meta"),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Finish running plugin actions", exact: true })
    .click();
  await expect(cards.locator(".plugin-meta")).toHaveCount(0);
  await selectScenario(page, "plugins-connections");
  await expect(cards).toHaveCount(7);
  await expect(
    preview.getByRole("article", { name: "Gmail", exact: true }),
  ).toBeVisible();
  await expect(cards.getByText(/^Version \d+$/)).toHaveCount(0);
  await expect(cards.locator(".plugin-meta")).toHaveCount(0);
});

test("keyboard settings, instructions and adaptation target the selected tool", async ({
  page,
}) => {
  const preview = await open(page);
  const weekly = preview.getByRole("article", {
    name: "Weekly planning",
    exact: true,
  });
  const settings = weekly.getByRole("button", {
    name: "Settings",
    exact: true,
  });
  await settings.focus();
  await settings.press("Enter");
  await expect(preview.getByLabel("Prepare my weekly plan")).toBeVisible();
  await preview.getByRole("button", { name: /Back to plugins/ }).click();
  const calendar = preview.getByRole("article", {
    name: "Calendar connection",
    exact: true,
  });
  const instructions = calendar.getByRole("button", {
    name: "View files",
    exact: true,
  });
  await instructions.focus();
  await instructions.press("Enter");
  await expect(preview.locator(".plugin-code-browser")).toContainText(
    "Calendar connection",
  );
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await preview.getByRole("button", { name: /Back to plugins/ }).click();
  await expect(instructions).toBeFocused();
  await calendar
    .getByRole("button", { name: "Adapt plugin", exact: true })
    .click();
  await expect(
    preview
      .locator(".chat-pane-header")
      .getByRole("heading", { name: "Calendar connection", exact: true }),
  ).toBeVisible();
  await expect(preview.getByLabel("Your request", { exact: true })).toHaveValue(
    /Calendar connection/,
  );
});
