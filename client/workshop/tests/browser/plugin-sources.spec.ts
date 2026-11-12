import { selectOption } from "./select";
import { selectScenario } from "./scenarios";
import { expect, test, type Page } from "./test";

async function open(page: Page, scenario: string, mobile: boolean) {
  await page.goto(
    `/?workshop=controls&scenario=${scenario}&profile=${mobile ? "ios" : "mac"}`,
  );
  const ready = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await ready;
  await preview.setViewportSize({
    width: mobile ? 390 : 1440,
    height: mobile ? 844 : 900,
  });
  await expect(preview.locator(".plugin-view, .documents-view")).toBeVisible();
  return preview;
}

for (const mobile of [false, true]) {
  test(`sources share plugin cards but remain distinct from connections · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "plugins-sources", mobile);
    const sources = preview.getByRole("region", {
      name: "Sources",
      exact: true,
    });
    await expect(sources.getByRole("article")).toHaveCount(3);
    const drive = sources.getByRole("article", {
      name: "Cloud drive",
      exact: true,
    });
    const paperless = sources.getByRole("article", {
      name: "Paperless",
      exact: true,
    });
    await expect(
      paperless.getByText("Access managed by this source", { exact: true }),
    ).toBeVisible();
    await expect(
      paperless.getByRole("button", { name: "Cloud connection", exact: true }),
    ).toHaveCount(0);
    await expect(
      drive.getByRole("button", { name: "Cloud connection", exact: true }),
    ).toBeVisible();
    await info.attach("sources-list", {
      body: await preview.screenshot(),
      contentType: "image/png",
    });
    await drive
      .getByRole("button", { name: "Cloud connection", exact: true })
      .click();
    await expect(
      preview.getByRole("heading", { name: "Cloud connection", exact: true }),
    ).toBeFocused();
    await expect(
      preview.getByRole("button", { name: "Cloud drive", exact: true }),
    ).toBeVisible();
    await preview
      .getByRole("button", { name: "Cloud drive", exact: true })
      .click();
    await expect(
      preview.getByRole("heading", { name: "Cloud drive", exact: true }),
    ).toBeFocused();
    await expect(
      preview.getByText("Documents / Shared", { exact: true }),
    ).toBeVisible();
    await expect(preview.locator(".plugin-source-details input")).toHaveCount(
      0,
    );
    await info.attach("source-details", {
      body: await preview.screenshot(),
      contentType: "image/png",
    });
    await preview
      .getByRole("button", { name: "‹ Back to plugins", exact: true })
      .click();
    await expect(
      sources.getByRole("heading", { name: /^Sources/ }),
    ).toBeFocused();
    await paperless
      .getByRole("button", { name: "Disable", exact: true })
      .click();
    await preview
      .getByRole("dialog")
      .getByRole("button", { name: "Disable plugin", exact: true })
      .click();
    await expect(
      paperless.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeDisabled();
    await expect(
      paperless.getByText("Updates paused", { exact: true }),
    ).toBeVisible();
    await paperless
      .getByRole("button", { name: "Enable", exact: true })
      .click();
    await expect(
      paperless.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeEnabled();
    await selectOption(
      page.getByLabel("Next source or opening action"),
      "wait",
    );
    await drive.getByRole("button", { name: "Refresh", exact: true }).click();
    await page
      .getByRole("button", { name: "Fail document action", exact: true })
      .click();
    await expect(drive.getByRole("status")).toContainText(
      "could not be refreshed",
    );
    await drive.getByRole("button", { name: "Refresh", exact: true }).click();
    await page
      .getByRole("button", { name: "Complete document action", exact: true })
      .click();
    await expect(drive.getByText("Up to date", { exact: true })).toBeVisible();
    await expect(preview.locator(".doc-source-screen")).toHaveCount(0);
  });

  test(`unavailable document routes to its source and returns to the same preview · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    const preview = await open(page, "documents-unavailable", mobile);
    await preview
      .getByRole("button", { name: "Review sources", exact: true })
      .click();
    await expect(
      preview.getByRole("heading", { name: "Home computer", exact: true }),
    ).toBeFocused();
    await preview
      .getByRole("button", { name: "Open Documents →", exact: true })
      .click();
    await expect(preview.locator("[data-document-heading]")).toBeFocused();
    await expect(
      preview.getByRole("heading", { name: "On another device", exact: true }),
    ).toBeVisible();
  });

  test(`source development uses the existing chat and keeps its draft through resizing · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-connect", mobile);
    const request = preview.getByRole("textbox", {
      name: "Your request",
      exact: true,
    });
    await expect(request).toHaveValue(/document source/);
    await request.fill(
      "Use the shared connection to find my household invoices.",
    );
    await preview.setViewportSize({ width: 320, height: 700 });
    if (mobile)
      await page.getByLabel("Keyboard occlusion", { exact: true }).check();
    await expect(request).toHaveValue(
      "Use the shared connection to find my household invoices.",
    );
    await request.focus();
    await expect(request).toBeFocused();
    await expect(
      preview.getByRole("button", { name: "Send request", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await info.attach("source-chat-keyboard", {
      body: await preview.screenshot(),
      contentType: "image/png",
    });
    if (mobile)
      await page.getByLabel("Keyboard occlusion", { exact: true }).uncheck();
    await preview
      .getByRole("button", { name: "Close development view", exact: true })
      .click();
    await expect(
      preview.getByRole("heading", { name: /^Sources/ }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(request).toHaveValue(/document source/);
  });
}

test("returning from empty-source development restores document focus", async ({
  page,
}) => {
  const preview = await open(page, "documents-empty", true);
  await preview.getByRole("button", { name: /Create a source/ }).click();
  await preview
    .getByRole("button", { name: "Close development view", exact: true })
    .click();
  const back = preview.getByRole("button", { name: /Back to documents/ });
  await expect(back).toBeInViewport({ ratio: 1 });
  await back.click();
  await expect(preview.locator("[data-doc-title]")).toBeFocused();
  await expect(
    preview.getByRole("button", { name: /Create a source/ }),
  ).toBeVisible();
});

test("source settings lead to adapting the same source in the plugin chat", async ({
  page,
}) => {
  const preview = await open(page, "plugins-source-detail", false);
  await preview.getByRole("button", { name: /Adapt plugin/ }).click();
  await expect(
    preview.getByRole("heading", { name: "Cloud drive", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("textbox", { name: "Your request", exact: true }),
  ).toHaveValue(/Cloud drive/);
  await expect(
    page.getByRole("combobox", {
      name: "Example development result",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("source creation develops a connection and consumer without a type choice", async ({
  page,
}) => {
  const preview = await open(page, "plugins-source-create", false);
  await expect(
    page.getByRole("combobox", {
      name: "Example development result",
      exact: true,
    }),
  ).toHaveCount(0);
  await preview
    .getByRole("textbox", { name: "Your request", exact: true })
    .fill("Add documents from my archive.");
  await preview
    .getByRole("button", { name: "Send request", exact: true })
    .click();
  await expect(preview.locator(".activity .call-detail")).toHaveCount(2);
  for (const name of [
    "Start checks",
    "Checks passed; actions still running",
    "Actions finished; adopt checked changes",
  ])
    await page.getByRole("button", { name, exact: true }).click();
  await preview
    .getByRole("button", { name: "Close development view", exact: true })
    .click();
  await expect(
    preview
      .getByRole("region", { name: "Sources", exact: true })
      .getByRole("article", { name: "Archive documents", exact: true }),
  ).toBeVisible();
});

test("source scenarios are directly selectable and reset their outcomes", async ({
  page,
}) => {
  const preview = await open(page, "plugins-sources-empty", false);
  await expect(preview.locator(".plugin-sources .plugin-row")).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Create a source", exact: true }),
  ).toBeVisible();
  for (const scenario of [
    "plugins-source-detail",
    "plugins-source-disabled",
    "plugins-source-create",
    "plugins-source-error",
    "plugins-source-success",
  ]) {
    await selectScenario(page, scenario);
    await expect(preview.locator(".plugin-view")).toBeVisible();
    if (scenario === "plugins-source-disabled")
      await expect(
        preview.getByRole("button", { name: "Enable", exact: true }),
      ).toBeVisible();
    if (scenario === "plugins-source-error")
      await expect(preview.locator(".chat-message.assistant")).toContainText(
        "has not been activated",
      );
    if (scenario === "plugins-source-success")
      await expect(preview.locator(".chat-message.assistant")).toContainText(
        "checked code is active",
      );
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
  }
});
