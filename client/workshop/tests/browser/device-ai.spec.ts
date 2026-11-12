import { expect, test, type Page } from "./test";
import { selectOption } from "./select";

async function open(page: Page, state: string, width: number) {
  await page.goto(
    `/?workshop=controls&scenario=${state}${width < 500 ? "&profile=ios" : ""}`,
  );
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize({ width, height: 900 });
  await expect(
    page.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  return preview;
}

for (const width of [1280, 390, 320]) {
  test(`new-device setup is not a broken connection at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page, "ai-missing", width);
    const title = preview.getByRole("heading", {
      name: "Set up AI on this device",
      exact: true,
    });
    await expect(title).toBeVisible();
    await expect(preview.locator(".provider-row")).toHaveCount(0);
    await expect(preview.locator(".settings-attention")).toHaveCount(0);
    await expect(
      preview.getByRole("button", {
        name: /Try again|Reconnect|Forget sign-in/,
      }),
    ).toHaveCount(0);
    await expect(preview.locator("[data-ai-scope]")).toContainText(
      "only to this workspace on this device",
    );
    await preview.screenshot({
      path: info.outputPath(`device-setup-${width}.png`),
    });
    const add = preview.getByRole("button", { name: /Add connection/ });
    await add.focus();
    await preview.keyboard.press("Enter");
    await expect(preview.locator(".settings-view .ai-view")).toBeVisible();
    await preview
      .getByRole("button", { name: "Back to AI & models", exact: true })
      .click();
    await expect(
      preview.getByRole("heading", { name: "AI & models", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(title).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Scenario", exact: true }),
    ).toHaveAttribute("data-value", "settings-ai");
    await expect(page).toHaveURL(/scenario=ai-missing/);
    await page.reload();
    await expect(title).toBeVisible();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`managed availability never replaces the local model at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page, "settings-managed", width);
    const provider = preview.getByLabel("Chat connection", { exact: true });
    await expect(provider).toHaveAttribute("data-value", "llama.cpp");
    await expect(
      preview.getByText("http://127.0.0.1:8080/v1", { exact: true }),
    ).toBeVisible();
    const availability = page.getByLabel("Situate account has AI access", {
      exact: true,
    });
    await availability.uncheck();
    await availability.check();
    await expect(provider).toHaveAttribute("data-value", "llama.cpp");
    await preview.screenshot({
      path: info.outputPath(`device-managed-available-${width}.png`),
    });
    const use = preview.getByRole("button", {
      name: "Use Situate AI",
      exact: true,
    });
    await use.focus();
    await preview.keyboard.press("Enter");
    await expect(provider).toHaveAttribute("data-value", "situate");
    await expect(provider).toBeFocused();
    await preview.screenshot({
      path: info.outputPath(`device-managed-selected-${width}.png`),
    });
    await expect(
      preview.getByText("Selected on this device", { exact: true }),
    ).toBeVisible();
    await expect(
      preview.getByText("Advanced settings", { exact: true }),
    ).toHaveCount(0);
    await availability.uncheck();
    await expect(
      preview.getByText(/^Situate AI is unavailable\./),
    ).toBeVisible();
    await preview.screenshot({
      path: info.outputPath(`device-managed-unavailable-${width}.png`),
    });
    await expect(provider).toHaveAttribute("data-value", "situate");
    await selectOption(provider, "llama.cpp");
    await expect(provider).toHaveAttribute("data-value", "llama.cpp");
    await preview
      .locator("summary")
      .filter({ hasText: "Advanced settings" })
      .click();
    await expect(
      preview.getByLabel("Chat model", { exact: true }),
    ).toHaveAttribute("data-value", "Local Chat");
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(provider).toHaveAttribute("data-value", "llama.cpp");
    await expect(availability).toBeChecked();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`synced replies preserve local defaults and never show model attribution at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page, "ai-chat-synced", width);
    const model = preview.getByRole("button", { name: /^Chat model:/ });
    const draft = preview.getByLabel("Message", { exact: true });
    await expect(preview.locator(".chat-thread")).not.toContainText(
      "llama.cpp",
    );
    await expect(model).toHaveAccessibleName(
      "Chat model: Example Chat. Workspace default",
    );
    await expect(model).toHaveAttribute(
      "aria-description",
      "Workspace default · OpenAI · Example Chat. Applies to the next message in this conversation on this device.",
    );
    await draft.fill("Keep my next message");
    await page
      .getByRole("button", {
        name: "Receive a reply from another device",
        exact: true,
      })
      .click();
    await expect(preview.locator(".chat-thread")).toContainText(
      "A small shelf beside the chair",
    );
    await expect(preview.locator(".chat-thread")).not.toContainText(
      "Example Chat",
    );
    await expect(model).toHaveAccessibleName(
      "Chat model: Example Chat. Workspace default",
    );
    await expect(draft).toHaveValue("Keep my next message");
    await model.click();
    await expect(
      preview.getByRole("menu", { name: "Chat model", exact: true }),
    ).toContainText("OpenAI · Example Chat");
    await preview.keyboard.press("Escape");
    await expect(model).toBeFocused();
    await preview.screenshot({
      path: info.outputPath(`device-chat-${width}.png`),
    });
    await selectOption(
      page.getByLabel("Starting state", { exact: true }),
      "ai-chat-unconfigured",
    );
    await draft.fill("Keep this while I set up AI");
    await expect(
      preview.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    await expect(
      preview.getByRole("button", { name: /^Model issue: AI access/ }),
    ).toBeVisible();
    await expect(draft).toHaveValue("Keep this while I set up AI");
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
