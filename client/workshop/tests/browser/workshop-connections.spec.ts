import { expect, test, type Page } from "./test";
import type { Locator } from "@playwright/test";

async function appearance(element: Locator) {
  return element.evaluate((node) => {
    const style = getComputedStyle(node);
    return Object.fromEntries(
      [
        "background-color",
        "color",
        "border-radius",
        "border-top-color",
        "border-top-width",
        "font-size",
        "font-weight",
        ...(node instanceof HTMLButtonElement ? ["min-height"] : []),
        "padding-top",
        "padding-bottom",
        "text-decoration-line",
      ].map((property) => [property, style.getPropertyValue(property)]),
    );
  });
}
async function open(page: Page, scenario = "plugins-connections") {
  await page.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize({ width: 1360, height: 1000 });
  await expect(
    page.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  return preview;
}

test("tools and connections share surfaces and action styles across sizes and states", async ({
  page,
}) => {
  const preview = await open(page);
  const tool = preview.getByRole("article", { name: "Inbox", exact: true });
  const connection = preview.getByRole("article", {
    name: "Gmail",
    exact: true,
  });
  const toolSettings = tool.getByRole("button", {
    name: "Settings",
    exact: true,
  });
  const accounts = connection.getByRole("button", {
    name: "Settings",
    exact: true,
  });
  const surface = await preview.locator(".plugin-view").evaluate((element) => {
    const style = getComputedStyle(element);
    const color = document.createElement("span").style;
    color.color = style.getPropertyValue("--situate-surface").trim();
    return color.color;
  });
  await expect(preview.locator(".plugin-view")).toHaveCSS(
    "background-color",
    surface,
  );
  for (const width of [1440, 768, 375, 320]) {
    await preview.setViewportSize({ width, height: 900 });
    expect(await appearance(connection)).toEqual(await appearance(tool));
    const toolBox = (await tool.boundingBox())!;
    const connectionBox = (await connection.boundingBox())!;
    expect(connectionBox.width).toBeCloseTo(toolBox.width, 0);
    expect(connectionBox.x).toBeCloseTo(toolBox.x, 0);
    for (const selector of [
      ".plugin-card-top",
      ".plugin-availability",
      "h3",
      ".plugin-row-content > p",
    ]) {
      const toolPart = (await tool.locator(selector).first().boundingBox())!;
      const connectionPart = (await connection
        .locator(selector)
        .first()
        .boundingBox())!;
      expect(connectionPart.x - connectionBox.x).toBeCloseTo(
        toolPart.x - toolBox.x,
        0,
      );
      expect(connectionPart.y - connectionBox.y).toBeCloseTo(
        toolPart.y - toolBox.y,
        0,
      );
    }
    const toolGrid = await tool
      .locator("..")
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    const connectionGrid = await connection
      .locator("..")
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    expect(connectionGrid).toBe(toolGrid);
    expect(connectionGrid.split(" ")).toHaveLength(
      width === 1440 || width === 768 ? 2 : 1,
    );
    expect(await appearance(connection.getByRole("heading"))).toEqual(
      await appearance(tool.getByRole("heading")),
    );
    expect(await appearance(accounts)).toEqual(await appearance(toolSettings));
    for (const name of ["Adapt plugin", "View files", "Disable"]) {
      expect(
        await appearance(connection.getByRole("button", { name, exact: true })),
      ).toEqual(
        await appearance(tool.getByRole("button", { name, exact: true })),
      );
    }
    expect(
      await preview
        .locator(".plugin-view")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
  }
  await connection
    .getByRole("button", { name: "Disable", exact: true })
    .click();
  await preview
    .getByRole("dialog")
    .getByRole("button", { name: "Disable plugin", exact: true })
    .click();
  await expect(accounts).toBeDisabled();
  await expect(toolSettings).toBeDisabled();
  expect(await appearance(accounts)).toEqual(await appearance(toolSettings));
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await accounts.focus();
  await accounts.press("Enter");
  await expect(
    preview.getByRole("heading", { name: "Connected accounts", exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".plugin-view")).toHaveCSS(
    "background-color",
    surface,
  );
  await preview.getByRole("button", { name: /Back to plugins/ }).click();
  await preview.getByRole("button", { name: /All settings/ }).click();
  await expect(preview.locator(".settings-view")).toHaveCSS(
    "background-color",
    surface,
  );
});

test("connection names and actions reflow with long content and enlarged text", async ({
  page,
}) => {
  const preview = await open(page);
  const connection = preview.locator('[data-plugin-id="gmail"]');
  await connection.getByRole("heading").evaluate((heading) => {
    heading.textContent =
      "Mail connection for correspondence, appointments and community projects";
  });
  for (const width of [320, 768, 1440]) {
    await preview.setViewportSize({ width, height: 1000 });
    await preview.evaluate(
      (zoom) => {
        document.documentElement.style.zoom = zoom;
      },
      width === 1440 ? "2" : "1",
    );
    await connection.scrollIntoViewIfNeeded();
    const card = await connection.boundingBox();
    for (const button of await connection.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(card!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(card!.x + card!.width);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await preview
        .locator(".plugin-view")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
  }
});

test("tools link to a shared connection and select accounts independently", async ({
  page,
}) => {
  const preview = await open(page);
  await expect(
    preview.locator(".plugin-list").getByRole("article"),
  ).toHaveCount(2);
  await expect(
    preview
      .getByRole("region", { name: "Connections", exact: true })
      .getByRole("article"),
  ).toHaveCount(2);
  const inbox = preview.getByRole("article", { name: "Inbox", exact: true });
  await inbox.getByRole("button", { name: "Gmail", exact: true }).click();
  await expect(
    preview.getByRole("heading", { name: "Connected accounts" }),
  ).toBeVisible();
  await expect(
    preview.getByText("Personal mail", { exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("region", { name: "Used by", exact: true })
    .getByRole("button", { name: "Inbox", exact: true })
    .click();
  await expect(
    preview.getByRole("checkbox", { name: "Personal mail", exact: true }),
  ).toBeChecked();
  await expect(
    preview.getByRole("checkbox", { name: "Garden project", exact: true }),
  ).not.toBeChecked();
  const garden = preview.getByRole("checkbox", {
    name: "Garden project",
    exact: true,
  });
  await garden.focus();
  await preview.keyboard.press("Space");
  await expect(garden).toBeChecked();
  await preview
    .getByRole("button", { name: "Settings · Gmail", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Complete connection", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Complete connection", exact: true })
    .click();
  await preview
    .getByRole("region", { name: "Used by", exact: true })
    .getByRole("button", { name: "Mail follow-up", exact: true })
    .click();
  await expect(
    preview.getByRole("checkbox", { name: "Personal mail", exact: true }),
  ).not.toBeChecked();
  await expect(
    preview.getByRole("checkbox", { name: "Garden project", exact: true }),
  ).toBeChecked();
  await expect(preview.getByRole("checkbox").nth(2)).not.toBeChecked();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    preview.getByRole("article", { name: "Gmail", exact: true }),
  ).toContainText("2 accounts connected");
});

test("connection failure retains account choices and phone navigation preserves context", async ({
  page,
}) => {
  const preview = await open(page, "plugins-connection-error");
  await preview.setViewportSize({ width: 320, height: 700 });
  await preview
    .getByRole("button", { name: "Sign in again", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fail connection", exact: true })
    .click();
  await expect(preview.getByRole("alert")).toHaveText(
    "The account could not be connected. Try again.",
  );
  await preview
    .getByRole("button", { name: "Sign in again", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Complete connection", exact: true })
    .click();
  await expect(
    preview.getByText("Sign-in required", { exact: true }),
  ).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Back to plugins", exact: false })
    .click();
  const gmail = preview.getByRole("article", { name: "Gmail", exact: true });
  await gmail.getByRole("button", { name: "Disable", exact: true }).click();
  const dialog = preview.getByRole("dialog", { name: "Disable Gmail?" });
  await expect(dialog).toContainText("Inbox");
  await expect(dialog).toContainText("Mail follow-up");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    gmail.getByRole("button", { name: "Disable", exact: true }),
  ).toBeFocused();
  expect(
    await preview
      .locator(".plugin-view")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
});
