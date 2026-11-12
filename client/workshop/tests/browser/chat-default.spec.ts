import { expect, test, type Page } from "./test";
import { selectOption, selectOptions } from "./select";

async function open(page: Page, width: number) {
  await page.goto(
    `/?workshop=controls&scenario=chat-complete${width < 500 ? "&profile=ios" : ""}`,
  );
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.waitForLoadState("load");
  await preview.setViewportSize({ width, height: 844 });
  await expect(preview.locator(".chat-screen")).toBeVisible();
  return preview;
}

for (const width of [1280, 390, 320]) {
  test(`the inherited model is resolved and ready in the Conversation composer at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page, width);
    const model = preview.getByRole("button", {
      name: "Chat model: Example Chat. Workspace default",
      exact: true,
    });
    const draft = preview.getByLabel("Message", { exact: true });
    await expect(
      preview.locator(".ai-view, .chat-layout, .model-recovery"),
    ).toHaveCount(0);
    await expect(
      preview.getByRole("button", { name: "Attach file", exact: true }),
    ).toBeVisible();
    await expect(model).toHaveAttribute(
      "aria-description",
      "Workspace default · OpenAI · Example Chat. Applies to the next message in this conversation on this device.",
    );
    await draft.fill("Plan a quiet afternoon");
    await expect(
      preview.getByRole("button", { name: "Send message", exact: true }),
    ).toBeEnabled();
    await preview.screenshot({
      path: info.outputPath(`conversation-recommended-${width}.png`),
    });
    await model.focus();
    await preview.keyboard.press("Enter");
    const recommended = preview.locator('[data-choice=""]');
    await expect(recommended).toBeFocused();
    await expect(recommended).toHaveAttribute("aria-checked", "true");
    await expect(recommended).toContainText("OpenAI · Example Chat");
    await preview.screenshot({
      path: info.outputPath(`conversation-model-menu-${width}.png`),
    });
    await preview.keyboard.press("Escape");
    await expect(model).toBeFocused();
    await expect(draft).toHaveValue("Plan a quiet afternoon");
    await expect(preview.locator(".chat-thread")).not.toContainText(
      "Example Chat",
    );
    await expect(preview.locator(".composer-meta")).not.toContainText(
      "Next message on this device",
    );
    if (width < 500) {
      await page.getByLabel("Keyboard occlusion", { exact: true }).check();
      await draft.focus();
      await expect(draft).toBeInViewport();
      await expect(model).toBeInViewport();
      await expect(draft).toHaveValue("Plan a quiet afternoon");
    }
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      (
        await selectOptions(
          page.getByRole("combobox", { name: "Scenario", exact: true }),
        )
      ).filter((option) => option.value === "ai-chat-existing"),
    ).toHaveLength(0);
    expect(
      (
        await selectOptions(page.getByLabel("Starting state", { exact: true }))
      ).map((option) => option.value),
    ).toEqual([
      "chat-work-history",
      "chat-empty",
      "chat-work-history-working",
      "chat-question",
      "chat-work-history-approval",
      "chat-work-history-changes",
      "chat-plugin-available",
      "chat-work-history-cancelled",
      "chat-work-history-error",
      "ai-chat-unconfigured",
    ]);
  });
}

test("Settings defaults apply to inherited conversations while explicit overrides stay independent", async ({
  page,
}) => {
  const preview = await open(page, 1280);
  const model = preview.getByRole("button", { name: /^Chat model:/ });
  const draft = preview.getByLabel("Message", { exact: true });
  await draft.fill("Keep this through Settings");
  async function setDefault(value: string) {
    await preview
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await preview
      .getByRole("button", { name: "AI & models", exact: true })
      .click();
    const advanced = preview.locator("details.settings-advanced");
    if (!(await advanced.evaluate((node) => (node as HTMLDetailsElement).open)))
      await advanced.locator("summary").click();
    await selectOption(
      preview.getByLabel("Chat model", { exact: true }),
      value,
    );
    await preview
      .getByRole("button", { name: "Open chat", exact: true })
      .click();
    await expect(preview.locator(".chat-screen")).toBeVisible();
  }
  await setDefault("GPT Mini");
  await expect(model).toHaveAccessibleName(
    "Chat model: Example Fast. Workspace default",
  );
  await expect(model).toHaveAttribute(
    "aria-description",
    "Workspace default · OpenAI · Example Fast. Applies to the next message in this conversation on this device.",
  );
  await expect(draft).toHaveValue("Keep this through Settings");
  await model.click();
  await preview.locator('[data-choice="example-chat"]').click();
  await page
    .getByRole("button", { name: "Model choice saved", exact: true })
    .click();
  await setDefault("recommended");
  await expect(model).toHaveText("Example Chat");
  await model.click();
  await preview.locator('[data-choice=""]').click();
  await page
    .getByRole("button", { name: "Model choice saved", exact: true })
    .click();
  await expect(model).toHaveAccessibleName(
    "Chat model: Example Chat. Workspace default",
  );
  await preview.reload();
  await expect(model).toHaveAccessibleName(
    "Chat model: Example Chat. Workspace default",
  );
  await expect(draft).toHaveValue("Keep this through Settings");
});
