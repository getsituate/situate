import { expect, test, keyLabel, type Page } from "./test";
import {
  shellState,
  workspaceFixture,
  nativeRequests,
  type NativeConversationFixture,
} from "./workspace-fixture";
import { expectDialogTypography } from "./dialog-typography";

const connection = { provider: "openai", endpoint: null };
const model = (page: Page) =>
  page.getByRole("button", { name: keyLabel("ai.model"), exact: true });
const message = (page: Page) =>
  page.getByRole("textbox", {
    name: keyLabel("navigation.message"),
    exact: true,
  });
const send = (page: Page) =>
  page.getByRole("button", { name: keyLabel("navigation.sendMessage") });
const calls = (page: Page) =>
  page.evaluate(
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

test("assistant Markdown is formatted without widening the conversation on desktop and mobile", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, {
    aiConnection: connection,
    aiModel: "gpt-5.4",
    aiResponseText:
      "**Important**\n\n- First\n- Second\n\n```text\n" +
      "long-code-".repeat(50) +
      "\n```\n\n[Reference](https://example.org)",
  });
  await page.goto("/");
  await message(page).fill("**Keep my text literal**");
  await send(page).click();
  const response = page.locator(".message.assistant .chat-markdown");
  await expect(response.locator("strong")).toHaveText("Important");
  await expect(response.locator("li")).toHaveText(["First", "Second"]);
  await expect(response.locator("pre")).toContainText("long-code-");
  await expect(
    response.getByRole("link", { name: "Reference" }),
  ).toHaveAttribute("href", "https://example.org");
  await expect(page.locator(".message.user p")).toHaveText(
    "**Keep my text literal**",
  );
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(response).toBeVisible();
    const sizes = await response.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      scrollWidth: element.scrollWidth,
    }));
    expect(sizes.scrollWidth).toBeLessThanOrEqual(Math.ceil(sizes.width));
  }
});

test("the next request uses the changed model and retains the same conversation without reconnecting", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, {
    aiConnection: connection,
    aiModel: "gpt-5.4",
    showInlineModel: true,
  });
  await page.goto("/");
  await message(page).fill("First model message");
  await expect(send(page)).toBeEnabled();
  await message(page).press("Enter");
  await expect(
    page.getByText("A streamed test response.", { exact: true }),
  ).toHaveCount(1);
  await expect(model(page)).toBeEnabled();
  await message(page).fill("Second model message");
  await model(page).click();
  await page
    .getByRole("menu")
    .locator('[role="menuitemradio"][data-choice="gpt-4.1"]')
    .click();
  await expect(model(page)).toHaveAttribute("aria-description", /gpt-4\.1/u);
  await expect(message(page)).toHaveValue("Second model message");
  await expect(
    page
      .getByLabel(keyLabel("navigation.conversation"))
      .getByText("First model message", { exact: true }),
  ).toBeVisible();
  await send(page).click();
  await expect(
    page.getByText("A streamed test response.", { exact: true }),
  ).toHaveCount(2);
  const requests = await nativeRequests(page);
  expect(requests.map(({ model }) => model)).toEqual(["gpt-5.4", "gpt-4.1"]);
  expect(requests.map(({ conversation }) => conversation)).toEqual([
    "legacy",
    "legacy",
  ]);
  const history = await page.evaluate(() =>
    (
      Reflect.get(
        window,
        "__nativeConversationFixture",
      ) as NativeConversationFixture
    ).getRecord("garden", "legacy"),
  );
  expect(
    history.messages
      .filter((message) => message.role === "user")
      .map((message) =>
        typeof message.content === "string" ? message.content : "",
      ),
  ).toEqual(["First model message", "Second model message"]);
  expect(
    (await calls(page)).filter((call) =>
      ["ai_save", "ai_openai_start"].includes(call.command),
    ),
  ).toEqual([]);
});

test("an unavailable stored model stays visible and blocks Send until another model is chosen", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, {
    aiConnection: connection,
    aiModel: "retired-model",
    aiModelError: "native.ai.model.savedUnavailable",
  });
  await page.goto("/");
  await expect(model(page)).toHaveAttribute(
    "aria-description",
    /retired-model/u,
  );
  const recovery = page.getByRole("dialog", {
    name: keyLabel("settings.ai.recovery"),
  });
  await expect(recovery).toBeVisible();
  await expectDialogTypography(recovery);
  await page.keyboard.press("Escape");
  await expect(recovery).toBeHidden();
  await model(page).click();
  await expect(
    page
      .getByRole("menu")
      .locator('[role="menuitemradio"][data-choice="retired-model"]'),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await message(page).fill("Wait for an available model");
  await expect(send(page)).toBeDisabled();
  await model(page).click();
  await page
    .getByRole("menu")
    .locator('[role="menuitemradio"][data-choice="gpt-4.1"]')
    .click();
  await expect(model(page)).toHaveCount(0);
  await expect(send(page)).toBeEnabled();
  await expect(message(page)).toHaveValue("Wait for an available model");
  await expect(
    page.getByText(keyLabel("native.ai.model.savedUnavailable"), {
      exact: false,
    }),
  ).toBeHidden();
  expect(
    (await calls(page))
      .filter((call) => call.command === "ai_select_conversation_model")
      .map((call) => call.args),
  ).toEqual([{ scope: "garden", conversation: "legacy", model: "gpt-4.1" }]);
});
