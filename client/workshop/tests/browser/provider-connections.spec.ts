import { expect, test, type Page } from "./test";
import { selectOption } from "./select";

async function open(controls: Page, profile = "mac") {
  await controls.goto(
    `/?workshop=controls&scenario=settings-connections&profile=${profile}`,
  );
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await expect(
    preview.getByRole("heading", { name: "Connections", exact: true }),
  ).toBeVisible();
  return preview;
}
for (const width of [1280, 390, 320]) {
  test(`independent named accounts and servers at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page);
    await preview.setViewportSize({ width, height: 800 });
    await expect(preview.locator("[data-connection]")).toHaveCount(4);
    await expect(
      preview.locator('[data-connection="local-desk"]'),
    ).toContainText("https://desk.example.invalid/v1");
    await expect(
      preview.locator('[data-connection="local-lab"]'),
    ).toContainText("https://lab.example.invalid/v1");
    const rename = preview.getByRole("button", {
      name: "Rename Team ChatGPT",
      exact: true,
    });
    await rename.focus();
    await preview.keyboard.press("Enter");
    const name = preview.getByLabel("Connection name", { exact: true });
    await expect(name).toBeFocused();
    await name.fill("Personal OpenAI");
    await name.press("Enter");
    await expect(preview.getByRole("alert")).toContainText(
      "Another connection already uses this name",
    );
    await name.fill("Draft label");
    await preview.setViewportSize({
      width: width === 1280 ? 1000 : width + 10,
      height: 700,
    });
    await expect(name).toHaveValue("Draft label");
    await preview.keyboard.press("Escape");
    await expect(rename).toBeFocused();
    await rename.click();
    await name.fill("Studio ChatGPT");
    await name.press("Enter");
    await expect(preview.getByRole("dialog")).toHaveCount(0);
    await expect(
      preview.locator('[data-connection="openai-team"]'),
    ).toContainText("Studio ChatGPT");
    const connection = preview.getByLabel("Chat connection", { exact: true });
    await selectOption(connection, "openai-team");
    await expect(connection).toContainText("Studio ChatGPT");
    await expect(
      preview.locator('[data-connection="openai-team"]'),
    ).toContainText("Selected for chat");
    await preview.setViewportSize({ width, height: 800 });
    await preview
      .locator(".settings-content")
      .evaluate((element) => (element.scrollTop = 0));
    await preview.screenshot({
      path: info.outputPath(`connections-${width}.png`),
    });
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await preview
      .getByRole("button", { name: "Disconnect Personal OpenAI", exact: true })
      .click();
    await expect(preview.getByRole("dialog")).toContainText("Personal OpenAI");
    await expect(preview.getByRole("dialog")).not.toContainText(
      "Studio ChatGPT",
    );
    await preview
      .getByRole("button", { name: "Disconnect connection", exact: true })
      .click();
    await expect(connection).toHaveAttribute("data-value", "openai-team");
    await expect(preview.locator("[data-connection]")).toHaveCount(3);
    await preview
      .getByRole("button", { name: "Disconnect Studio ChatGPT", exact: true })
      .click();
    await preview
      .getByRole("button", { name: "Disconnect connection", exact: true })
      .click();
    await expect(connection).toHaveAttribute("data-value", "");
    await expect(preview.locator("[data-connection]")).toHaveCount(2);
    await expect(
      preview.getByText("Choose a connection before sending a message.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(preview.locator("[data-connection]")).toHaveCount(4);
    await expect(connection).toHaveAttribute("data-value", "openai");
  });
  test(`adding and reconnecting a second OpenAI key retains other connections at ${width}px`, async ({
    page,
  }) => {
    const preview = await open(page);
    await preview.setViewportSize({ width, height: 800 });
    await preview
      .getByRole("button", { name: "+ Add connection", exact: true })
      .click();
    const provider = preview.locator('[data-provider="openai"]');
    await expect(provider).toBeEnabled();
    await provider.click();
    await preview.locator('[data-method="key"]').click();
    await preview.locator("#credential").fill("synthetic-only");
    await preview.getByRole("button", { name: "Connect", exact: true }).click();
    await page.locator('[data-outcome="save-error"]').click();
    await preview
      .getByRole("button", { name: "Retry saving", exact: true })
      .click();
    await page.locator('[data-outcome="success"]').click();
    await preview
      .getByRole("button", { name: "Back to settings", exact: true })
      .click();
    await expect(preview.locator("[data-connection]")).toHaveCount(5);
    await expect(
      preview.getByLabel("Chat connection", { exact: true }),
    ).toHaveAttribute("data-value", "openai");
    await preview
      .getByRole("button", { name: "Manage OpenAI", exact: true })
      .click();
    await expect(
      preview.getByRole("heading", { name: "OpenAI", exact: true }),
    ).toBeVisible();
    await preview
      .getByRole("button", { name: "Change connection", exact: true })
      .click();
    await preview.locator('[data-provider="openai"]').click();
    await preview.locator('[data-method="key"]').click();
    await preview.locator("#credential").fill("synthetic-replacement");
    await preview.getByRole("button", { name: "Connect", exact: true }).click();
    await page.locator('[data-outcome="success"]').click();
    await preview
      .getByRole("button", { name: "Back to settings", exact: true })
      .click();
    await expect(preview.locator("[data-connection]")).toHaveCount(5);
    await expect(preview.locator('[data-connection="openai"]')).toContainText(
      "Personal OpenAI",
    );
    await expect(
      preview.locator('[data-connection="openai-team"]'),
    ).toContainText("Team ChatGPT");
  });
  test(`model refresh preserves explicit choices and exposes catalog outcomes at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page);
    await preview.setViewportSize({ width, height: 800 });
    const model = preview.getByLabel("Chat model", { exact: true });
    const refresh = preview.getByRole("button", {
      name: "Refresh models",
      exact: true,
    });
    await selectOption(model, "GPT Mini");
    for (const outcome of ["error", "unknown", "excluded", "empty"]) {
      await refresh.click();
      await expect(refresh).toBeDisabled();
      await expect(
        preview.getByText("Loading models…", { exact: true }),
      ).toBeVisible();
      await page.locator(`[data-catalog-outcome="${outcome}"]`).click();
      await expect(model).toHaveAttribute("data-value", "GPT Mini");
      await expect(
        preview.getByLabel("Chat connection", { exact: true }),
      ).toHaveAttribute("data-value", "openai");
    }
    await expect(
      preview.getByText(
        "No suitable chat models were found. Your connection is saved.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      preview.getByText(/Your saved model is not in the current list/),
    ).toBeVisible();
    await preview.screenshot({
      path: info.outputPath(`catalog-empty-${width}.png`),
    });
    await refresh.click();
    await page.locator('[data-catalog-outcome="ready"]').click();
    await expect(model).toHaveAttribute("data-value", "GPT Mini");
    await expect(
      preview.getByText("3 chat models listed", { exact: true }),
    ).toBeVisible();
    await refresh.click();
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(model).toHaveAttribute("data-value", "recommended");
    await expect(refresh).toBeEnabled();
    await expect(page.locator("[data-catalog-outcome]")).toHaveCount(0);
  });
}

test("connection naming and manual model entry stay reachable above the simulated iOS keyboard", async ({
  page,
}, info) => {
  const preview = await open(page, "ios");
  await preview.setViewportSize({ width: 390, height: 844 });
  await preview
    .getByRole("button", { name: "Rename Personal OpenAI", exact: true })
    .click();
  const name = preview.getByLabel("Connection name", { exact: true });
  await name.fill("A separate account");
  await expect(page.getByLabel("Provider state", { exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel("Keyboard occlusion").check();
  await expect(name).toHaveValue("A separate account");
  await name.focus();
  await expect(name).toBeInViewport();
  const save = preview.getByRole("button", { name: "Save name", exact: true });
  await save.focus();
  await expect(save).toBeInViewport();
  await preview.screenshot({
    path: info.outputPath("connection-name-ios-keyboard.png"),
  });
  await preview.keyboard.press("Escape");
  await expect(page.getByLabel("Keyboard occlusion")).toHaveCount(0);
  await selectOption(
    preview.getByLabel("Chat connection", { exact: true }),
    "local-desk",
  );
  const modelId = preview.getByLabel("Model ID", { exact: true });
  await modelId.fill("desk-chat-v2");
  await page.getByLabel("Keyboard occlusion").check();
  await modelId.focus();
  await expect(modelId).toBeInViewport();
  await expect(modelId).toHaveValue("desk-chat-v2");
  const use = preview.getByRole("button", {
    name: "Use model ID",
    exact: true,
  });
  await use.focus();
  await expect(use).toBeInViewport();
  await use.press("Enter");
  await expect(
    preview.getByLabel("Chat model", { exact: true }),
  ).toHaveAttribute("data-value", "desk-chat-v2");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    preview.getByRole("button", {
      name: "Rename Personal OpenAI",
      exact: true,
    }),
  ).toBeVisible();
});
