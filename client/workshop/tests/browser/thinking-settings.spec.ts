import { expect, test, type Page } from "./test";
import { selectOption } from "./select";

async function open(page: Page, scenario: string, width: number) {
  await page.goto(
    `/?workshop=controls&scenario=${scenario}${width < 500 ? "&profile=ios" : ""}`,
  );
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize({ width, height: 844 });
  await expect(
    page.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  return preview;
}
async function navigation(preview: Page) {
  const button = preview.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  if (await button.isVisible()) await button.click();
}
async function settings(preview: Page) {
  await navigation(preview);
  await preview.getByRole("button", { name: "Settings", exact: true }).click();
  if (!(await preview.locator("#chat-provider").isVisible()))
    await preview
      .getByRole("button", { name: "AI & models", exact: true })
      .click();
  const advanced = preview.locator("details.settings-advanced");
  if (!(await advanced.evaluate((node) => (node as HTMLDetailsElement).open)))
    await advanced.locator("summary").click();
}
async function chat(preview: Page) {
  await navigation(preview);
  await preview.getByRole("button", { name: "Open chat", exact: true }).click();
}

for (const width of [1280, 390, 320]) {
  test(`thinking defaults and conversation overrides stay distinct at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page, "chat-complete", width);
    await selectOption(
      page.getByLabel("Model choice example", { exact: true }),
      "long",
    );
    const thinking = preview.getByRole("button", { name: /^Thinking level:/ });
    const draft = preview.getByLabel("Message", { exact: true });
    await draft.fill("Keep the reading plan");
    await expect(thinking).toHaveAccessibleName(
      "Thinking level: Medium. Workspace default",
    );
    await expect(thinking).toHaveAttribute(
      "aria-description",
      "Workspace default · Medium. Applies to the next message in this conversation on this device.",
    );
    await settings(preview);
    await expect(
      preview.getByLabel("Thinking level", { exact: true }),
    ).toBeDisabled();
    await expect(
      preview.getByLabel("Thinking level", { exact: true }),
    ).toHaveAccessibleDescription("Thinking is not adjustable for this model.");
    await selectOption(
      preview.getByLabel("Chat model", { exact: true }),
      "Example Reasoning",
    );
    const defaultThinking = preview.getByLabel("Thinking level", {
      exact: true,
    });
    await expect(defaultThinking).toHaveAttribute("data-value", "recommended");
    await selectOption(defaultThinking, "high");
    await preview.screenshot({
      path: info.outputPath(`thinking-settings-${width}.png`),
    });
    await chat(preview);
    await expect(thinking).toHaveAccessibleName(
      "Thinking level: High. Workspace default",
    );
    await expect(thinking).toHaveAttribute(
      "aria-description",
      "Workspace default · High. Applies to the next message in this conversation on this device.",
    );
    await thinking.focus();
    await preview.keyboard.press("Enter");
    const menu = preview.getByRole("menu", {
      name: "Thinking level",
      exact: true,
    });
    await expect(menu.locator('[data-choice=""]')).toBeFocused();
    await expect(menu.getByRole("menuitemradio")).toHaveCount(5);
    await preview.screenshot({
      path: info.outputPath(`thinking-chat-${width}.png`),
    });
    await menu.locator('[data-choice="low"]').click();
    await expect(draft).toBeFocused();
    await expect(thinking).toHaveText("Low");
    await settings(preview);
    await expect(defaultThinking).toHaveAttribute("data-value", "high");
    await selectOption(defaultThinking, "recommended");
    await chat(preview);
    await expect(thinking).toHaveText("Low");
    await thinking.click();
    await menu.locator('[data-choice="recommended"]').click();
    await expect(thinking).toHaveText("☆Medium");
    await expect(thinking).toHaveAccessibleName(
      "Thinking level: Medium. Recommended",
    );
    await expect(draft).toBeFocused();
    await thinking.click();
    await expect(menu.locator('[data-choice="recommended"]')).toBeFocused();
    await expect(menu.locator('[data-choice="recommended"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(menu.locator('[data-choice=""]')).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await menu.locator('[data-choice=""]').click();
    await expect(thinking).toHaveAccessibleName(
      "Thinking level: Medium. Workspace default",
    );
    await expect(thinking).toHaveAttribute(
      "aria-description",
      "Workspace default · Medium. Applies to the next message in this conversation on this device.",
    );
    await settings(preview);
    await preview
      .getByRole("switch", { name: "Show model picker in chat", exact: true })
      .uncheck();
    await chat(preview);
    await expect(thinking).toHaveCount(0);
    await expect(
      preview.getByRole("button", { name: /^Chat model:/ }),
    ).toHaveCount(0);
    await expect(draft).toHaveValue("Keep the reading plan");
    await settings(preview);
    await preview
      .getByRole("switch", { name: "Show model picker in chat", exact: true })
      .check();
    await chat(preview);
    await expect(thinking).toHaveAccessibleName(
      "Thinking level: Medium. Workspace default",
    );
    await preview.reload();
    await expect(thinking).toHaveAccessibleName(
      "Thinking level: Medium. Workspace default",
    );
    await expect(draft).toHaveValue("Keep the reading plan");
    if (width < 500) {
      await page.getByLabel("Keyboard occlusion", { exact: true }).check();
      await thinking.click();
      await expect(menu).toBeInViewport();
      await preview.keyboard.press("Escape");
      await expect(thinking).toBeFocused();
    }
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("Settings thinking follows model capabilities and the optional navigation chat picker", async ({
  page,
}) => {
  const preview = await open(page, "settings-advanced", 1280);
  const thinking = preview.getByLabel("Thinking level", { exact: true });
  await expect(thinking).toBeDisabled();
  await selectOption(
    preview.getByLabel("Chat connection", { exact: true }),
    "openai",
  );
  await selectOption(
    preview.getByLabel("Chat model", { exact: true }),
    "Example Reasoning",
  );
  await selectOption(thinking, "high");
  await selectOption(
    preview.getByLabel("Chat model", { exact: true }),
    "GPT Chat",
  );
  await expect(thinking).toBeDisabled();
  await selectOption(
    preview.getByLabel("Chat model", { exact: true }),
    "Example Reasoning",
  );
  await expect(thinking).toHaveAttribute("data-value", "high");
  await chat(preview);
  await expect(thinking).toHaveAttribute("data-value", "");
  await selectOption(thinking, "low");
  await settings(preview);
  await expect(thinking).toHaveAttribute("data-value", "high");
  await chat(preview);
  await expect(thinking).toHaveAttribute("data-value", "low");
});

test("hidden model controls retain access to unavailable-model recovery", async ({
  page,
}) => {
  const preview = await open(page, "chat-complete", 1280);
  await settings(preview);
  await preview
    .getByRole("switch", { name: "Show model picker in chat", exact: true })
    .uncheck();
  await chat(preview);
  await selectOption(
    page.getByLabel("Model choice example", { exact: true }),
    "unavailable",
  );
  await preview
    .getByRole("button", { name: "Choose model", exact: true })
    .click();
  const menu = preview.getByRole("menu", { name: "Chat model", exact: true });
  await expect(menu).toBeVisible();
  await menu.locator('[data-choice="example-chat"]').click();
  await page
    .getByRole("button", { name: "Model choice saved", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: /^Chat model:/ }),
  ).toHaveCount(0);
  await expect(preview.getByLabel("Message", { exact: true })).toBeFocused();
});

for (const width of [1280, 390]) {
  test(`future model and thinking choices do not alter the active response at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page, "chat-complete", width);
    await selectOption(
      page.getByLabel("Model choice example", { exact: true }),
      "long",
    );
    const model = preview.getByRole("button", { name: /^Chat model:/ });
    const thinking = preview.getByRole("button", { name: /^Thinking level:/ });
    const draft = preview.getByLabel("Message", { exact: true });
    const thinkingMenu = preview.getByRole("menu", {
      name: "Thinking level",
      exact: true,
    });
    await draft.fill("Use the next model for this draft");
    await thinking.click();
    await thinkingMenu.locator('[data-choice="high"]').click();
    await thinking.click();
    await selectOption(
      page.getByLabel("Response state", { exact: true }),
      "working",
    );
    await expect(thinkingMenu).toBeVisible();
    await thinkingMenu.locator('[data-choice="low"]').click();
    await expect(thinking).toHaveText("Low");
    const activeRequest = page.getByText(
      "Chat model: example-reasoning-long. Thinking: high.",
      { exact: false },
    );
    await expect(activeRequest).toBeVisible();
    await model.click();
    await preview.locator('[data-choice="example-fast"]').click();
    await page
      .getByRole("button", {
        name: "Model save outcome uncertain",
        exact: true,
      })
      .click();
    await expect(model).toBeDisabled();
    await expect(thinking).toBeDisabled();
    await expect(
      page.getByLabel("Response state", { exact: true }),
    ).toHaveAttribute("data-value", "working");
    await expect(activeRequest).toBeVisible();
    await preview
      .getByRole("button", { name: "Check saved choice", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Readback confirms previous model",
        exact: true,
      })
      .click();
    await expect(thinking).toHaveText("Low");
    await expect(model).toBeEnabled();
    await model.click();
    await preview.locator('[data-choice="example-fast"]').click();
    await page
      .getByRole("button", { name: "Model choice saved", exact: true })
      .click();
    await expect(model).toHaveText("Example Fast");
    await expect(thinking).toHaveCount(0);
    await expect(activeRequest).toBeVisible();
    await expect(
      preview.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    await expect(draft).toHaveValue("Use the next model for this draft");
    await preview.screenshot({
      path: info.outputPath(`next-model-working-${width}.png`),
    });
    await selectOption(
      page.getByLabel("Response state", { exact: true }),
      "complete",
    );
    await expect(
      page.getByText("Chat model: example-fast. Thinking: Not adjustable.", {
        exact: false,
      }),
    ).toBeVisible();
    await selectOption(
      page.getByLabel("Response state", { exact: true }),
      "working",
    );
    await expect(
      page.getByText("Chat model: example-fast. Thinking: Not adjustable.", {
        exact: false,
      }),
    ).toBeVisible();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("stopping a response does not settle the pending next-model save", async ({
  page,
}) => {
  const preview = await open(page, "chat-working", 1280);
  const model = preview.getByRole("button", { name: /^Chat model:/ });
  await model.click();
  await preview.locator('[data-choice="example-fast"]').click();
  await expect(model).toBeDisabled();
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.getByLabel("Response state", { exact: true }),
  ).toHaveAttribute("data-value", "cancelled");
  await expect(model).toBeDisabled();
  await page
    .getByRole("button", { name: "Model choice saved", exact: true })
    .click();
  await expect(model).toHaveText("Example Fast");
  await expect(model).toBeEnabled();
});

for (const [scenario, explanation] of [
  ["settings-ai", "Thinking is not adjustable for this model."],
  ["settings-local", "Thinking controls are not known for this model."],
  ["settings-empty", "Connect a provider to configure thinking."],
]) {
  for (const width of [1280, 320]) {
    test(`disabled thinking explains ${scenario} at ${width}px`, async ({
      page,
    }, info) => {
      const preview = await open(page, scenario!, width);
      await settings(preview);
      const thinking = preview.getByLabel("Thinking level", { exact: true });
      await thinking.scrollIntoViewIfNeeded();
      await expect(thinking).toBeVisible();
      await expect(thinking).toBeDisabled();
      await expect(thinking).toHaveAccessibleDescription(explanation!);
      await expect(preview.locator("#chat-thinking-help")).toBeVisible();
      await preview.screenshot({
        path: info.outputPath(`thinking-disabled-${scenario}-${width}.png`),
      });
      expect(
        await preview.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}
