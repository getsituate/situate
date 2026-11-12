import { chooseSelect } from "./select";
import { expect, test, keyLabel, type Page } from "./test";
import {
  garden,
  reading,
  shellState,
  workspaceFixture,
} from "./workspace-fixture";

async function openNavigation(page: Page): Promise<void> {
  const button = page.getByRole("button", {
    name: keyLabel("navigation.openNavigation"),
    exact: true,
  });
  if (await button.isVisible()) await button.click();
}
async function openSettings(page: Page): Promise<void> {
  await openNavigation(page);
  await page
    .getByRole("button", { name: keyLabel("navigation.settings"), exact: true })
    .click();
  await page
    .getByRole("button", { name: keyLabel("settings.ai.title"), exact: true })
    .click();
  await expect(page.locator(".ai-settings .connections")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".ai-settings")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.locator(".advanced-settings summary").click();
  await expect(page.locator(".advanced-settings")).toHaveAttribute("open", "");
}
async function openChat(page: Page): Promise<void> {
  await openNavigation(page);
  await page.locator(".conversation-destination").first().click();
}
async function switchWorkspace(page: Page, name: string): Promise<void> {
  await openNavigation(page);
  await page
    .getByRole("button", {
      name: keyLabel("navigation.workspaceMenu"),
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: new RegExp(name, "u") }).click();
}

for (const width of [375, 1440]) {
  test(`workspace defaults and conversation overrides stay separate without leaking models or drafts at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await workspaceFixture(
      page,
      {
        ...shellState,
        mobile: true,
        known: [garden, reading],
        open: [garden, reading],
      },
      {
        aiConnection: { provider: "openai", endpoint: null },
        aiModel: "gpt-5.4",
      },
    );
    await page.goto("/");
    const draft = page.getByRole("textbox", {
      name: keyLabel("navigation.message"),
      exact: true,
    });
    await draft.fill("Keep the garden draft");
    await expect(page.locator(".model-picker")).toHaveCount(0);
    await openSettings(page);
    const chatModel = page
      .getByRole("region", {
        name: keyLabel("settings.ai.chatModel"),
        exact: true,
      })
      .getByRole("combobox", { name: keyLabel("ai.model"), exact: true });
    const commentModel = page
      .getByRole("region", {
        name: keyLabel("settings.ai.smallModel"),
        exact: true,
      })
      .getByRole("combobox", { name: keyLabel("ai.model"), exact: true });
    const inline = page.getByRole("switch", {
      name: keyLabel("settings.ai.showInlineModel"),
      exact: true,
    });
    const comments = page.getByRole("switch", {
      name: keyLabel("settings.ai.generatedComments"),
      exact: true,
    });
    await expect(chatModel).toHaveAttribute("data-value", "gpt-5.4");
    await expect(inline).not.toBeChecked();
    await expect(comments).toBeChecked();
    await chooseSelect(chatModel, "gpt-4.1");
    await expect(chatModel).toHaveAttribute("data-value", "gpt-4.1");
    await chooseSelect(commentModel, "gpt-4.1-mini");
    await expect(commentModel).toHaveAttribute("data-value", "gpt-4.1-mini");
    await comments.uncheck();
    await expect(comments).not.toBeChecked();
    await inline.check();
    await expect(inline).toBeChecked();
    expect(
      await page
        .locator(".settings-content")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await openChat(page);
    await expect(draft).toHaveValue("Keep the garden draft");
    const inlineModel = page.getByRole("button", {
      name: keyLabel("ai.model"),
      exact: true,
    });
    await expect(inlineModel).toHaveAttribute("aria-description", /gpt-4\.1/u);
    await inlineModel.click();
    await page
      .getByRole("menu")
      .locator('[role="menuitemradio"][data-choice="gpt-5.4"]')
      .click();
    await expect(inlineModel).toHaveAttribute("aria-description", /gpt-5\.4/u);
    await openSettings(page);
    await expect(chatModel).toHaveAttribute("data-value", "gpt-4.1");
    await expect(commentModel).toHaveAttribute("data-value", "gpt-4.1-mini");
    await expect(comments).not.toBeChecked();
    await switchWorkspace(page, "Reading room");
    await openSettings(page);
    await expect(inline).not.toBeChecked();
    await expect(comments).toBeChecked();
    await expect(chatModel).toBeDisabled();
    await expect(chatModel).toHaveAttribute("data-value", "");
    await expect(commentModel).toHaveAttribute("data-value", "");
    await openChat(page);
    await expect(draft).toHaveValue("");
    await expect(page.locator(".model-picker")).toHaveCount(0);
    await draft.fill("Keep the reading draft");
    await switchWorkspace(page, "Garden notes");
    await openChat(page);
    await expect(draft).toHaveValue("Keep the garden draft");
    await expect(inlineModel).toHaveAttribute("aria-description", /gpt-5\.4/u);
    const calls = await page.evaluate(
      () =>
        Reflect.get(window, "__ipcCalls") as {
          command: string;
          args: {
            scope?: string;
            conversation?: string;
            model?: string;
          };
        }[],
    );
    expect(
      calls.filter((call) => call.command === "ai_settings_save"),
    ).toHaveLength(4);
    expect(
      calls
        .filter((call) => call.command === "ai_select_conversation_model")
        .map((call) => call.args),
    ).toEqual([{ scope: "garden", conversation: "legacy", model: "gpt-5.4" }]);
    expect(
      calls
        .filter((call) => call.command === "ai_settings_save")
        .every((call) => call.args.scope === "garden"),
    ).toBe(true);
    expect(
      calls.filter((call) =>
        ["ai_begin", "ai_request", "ai_save", "ai_select_model"].includes(
          call.command,
        ),
      ),
    ).toEqual([]);
  });
}

test("custom model identities remain recognizable in inline and workspace settings", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, {
    aiConnection: { provider: "custom", endpoint: "http://localhost:8888/v1" },
    aiModel: "test-model",
    showInlineModel: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const model = page.getByRole("button", {
    name: keyLabel("ai.model"),
    exact: true,
  });
  await expect(model).toHaveAttribute("aria-description", /test-model/u);
  await model.click();
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue(
    "test-model",
  );
  await page.keyboard.press("Escape");
  await expect(model).toBeFocused();
  await openSettings(page);
  const chat = page.getByRole("region", {
    name: keyLabel("settings.ai.chatModel"),
    exact: true,
  });
  await expect(
    chat.getByRole("textbox", { name: keyLabel("ai.model"), exact: true }),
  ).toHaveAttribute("placeholder", /test-model/u);
  const comments = page.getByRole("region", {
    name: keyLabel("settings.ai.smallModel"),
    exact: true,
  });
  const commentModel = comments.getByRole("textbox", {
    name: keyLabel("ai.model"),
    exact: true,
  });
  await commentModel.fill("comment-model");
  await comments
    .getByRole("button", { name: keyLabel("ai.useModelID"), exact: true })
    .click();
  await expect(commentModel).toHaveAttribute("placeholder", /comment-model/u);
  const saves = await page.evaluate(() =>
    Reflect.get(window, "__ipcCalls").filter(
      (call: { command: string }) => call.command === "ai_settings_save",
    ),
  );
  expect(saves).toHaveLength(1);
  expect(saves[0].args).toMatchObject({
    scope: "garden",
    settings: {
      chat: { model: "test-model" },
      comment: { model: "comment-model", thinking: "off" },
    },
  });
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__ipcCalls").filter((call: { command: string }) =>
        ["ai_begin", "ai_request"].includes(call.command),
      ),
    ),
  ).toEqual([]);
});
