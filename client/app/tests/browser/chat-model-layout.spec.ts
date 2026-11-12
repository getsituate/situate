import { expect, test, type Page } from "./test";
import { expectDialogTypography } from "./dialog-typography";
import {
  shellState,
  workspaceFixture,
  nativeRequests,
  type NativeConversationFixture,
} from "./workspace-fixture";

test.use({ localizationMode: "real" });
const connection = {
  provider: "openai",
  endpoint: null,
  connectionId: "personal",
  label: "Personal",
};
const model = (page: Page) =>
  page.getByRole("button", { name: "Model", exact: true });
const message = (page: Page) =>
  page.getByRole("textbox", { name: "Message", exact: true });
const send = (page: Page) =>
  page.getByRole("button", { name: "Send message", exact: true });
const calls = (page: Page) =>
  page.evaluate(
    () =>
      Reflect.get(window, "__ipcCalls") as {
        command: string;
        args: {
          model?: string;
          thinking?: string;
          config?: { connectionId: string };
        };
      }[],
  );
async function choose(page: Page, id: string, name = "Model") {
  await page.getByRole("button", { name, exact: true }).click();
  await page
    .getByRole("menu")
    .locator(`[role="menuitemradio"][data-choice="${id}"]`)
    .click();
}
async function finishSelection(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => typeof Reflect.get(window, "__finishModelSelection")),
    )
    .toBe("function");
  await page.evaluate(() => {
    const finish = Reflect.get(window, "__finishModelSelection");
    Reflect.deleteProperty(window, "__finishModelSelection");
    finish();
  });
}

for (const width of [375, 1280]) {
  test(`stopping a response is non-modal and preserves the conversation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await workspaceFixture(
      page,
      { ...shellState, mobile: width < 600 },
      {
        aiConnection: connection,
        aiModel: "gpt-5.4",
        aiHoldPartialResponse: true,
      },
    );
    await page.goto("/");
    await message(page).fill("Start a response");
    await send(page).click();
    await expect(
      page.getByText("A streamed test response.", { exact: true }),
    ).toBeVisible();
    await message(page).fill("My next message");
    await page
      .getByRole("button", { name: "Stop response", exact: true })
      .click();
    await page.evaluate(() => Reflect.get(window, "__finishResponse")());
    await expect(page.locator(".work-history-heading")).toContainText(
      "Stopped",
    );
    await expect(page.locator(".response-stopped")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      page.getByText("A streamed test response.", { exact: true }),
    ).toBeVisible();
    await expect(message(page)).toHaveValue("My next message");
    await expect(send(page)).toBeEnabled();
    await expect(page.getByRole("timer")).toHaveCount(0);
    await expect(page.locator(".work-history-heading")).toBeInViewport({
      ratio: 1,
    });
    expect(await nativeRequests(page)).toHaveLength(1);
  });
}

for (const width of [320, 375, 800, 1280]) {
  test(
    `inline model controls fit the composer and preserve the draft at ${width}px`,
    { tag: width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: 800 });
      await workspaceFixture(
        page,
        { ...shellState, mobile: width < 600 },
        {
          aiConnection: connection,
          aiModel: "gpt-5.4",
          showInlineModel: true,
        },
      );
      await page.goto("/");
      await message(page).fill("Keep this draft");
      await expect(model(page)).toHaveAttribute(
        "aria-description",
        /Personal.*gpt-5\.4/u,
      );
      const composer = (await page.locator(".chat-composer").boundingBox())!;
      for (const control of await page
        .locator(".model-picker .choice-trigger")
        .all()) {
        await expect(control).toBeInViewport({ ratio: 1 });
        const bounds = (await control.boundingBox())!;
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.x).toBeGreaterThanOrEqual(composer.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(
          composer.x + composer.width,
        );
      }
      await model(page).click();
      await expect(page.getByRole("menu")).toBeInViewport({ ratio: 1 });
      await expect(
        page
          .getByRole("menu")
          .locator('[role="menuitemradio"][aria-checked="true"]'),
      ).toHaveAttribute("data-choice", "");
      await expect(
        page.getByRole("menuitemradio").filter({ hasText: "Claude" }),
      ).toHaveCount(0);
      const popup = (await page.getByRole("menu").boundingBox())!;
      const trigger = (await model(page).boundingBox())!;
      expect(popup.height).toBeLessThanOrEqual(280);
      expect(popup.x).toBeCloseTo(
        Math.max(8, Math.min(width - popup.width - 8, trigger.x)),
        0,
      );
      await expect(page.getByRole("menu")).toHaveAccessibleName("Model");
      await expect(
        page.getByRole("menu").locator('[data-choice=""] small'),
      ).toHaveText("Personal · openai · gpt-5.4");
      await expect(page.locator(".choice-description")).toHaveCount(0);
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("chat.model.menu");
      await page.keyboard.press("Escape");
      await expect(model(page)).toBeFocused();
      expect(
        (await calls(page)).filter(
          (call) => call.command === "ai_select_conversation_model",
        ),
      ).toEqual([]);
      await message(page).focus();
      await expect(message(page)).toBeFocused();
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("chat.model.inline");
      await choose(page, "gpt-4.1");
      await expect(model(page)).toHaveAttribute(
        "aria-description",
        /gpt-4\.1/u,
      );
      await expect(message(page)).toHaveValue("Keep this draft");
      await expect(message(page)).toBeFocused();
      await expect(
        page.getByRole("tab", { name: "New chat", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const selected = (await calls(page)).filter(
        (call) => call.command === "ai_select_conversation_model",
      );
      expect(selected.map((call) => call.args)).toEqual([
        { scope: "garden", conversation: "legacy", model: "gpt-4.1" },
      ]);
      expect(
        (await calls(page)).filter((call) =>
          [
            "ai_save",
            "ai_openai_start",
            "ai_request",
            "ai_settings_save",
          ].includes(call.command),
        ),
      ).toEqual([]);
      await model(page).click();
      await expect(
        page.getByRole("menu").locator('[data-choice=""] small'),
      ).toHaveText("Personal · openai · gpt-5.4");
      await expect(
        page.getByRole("menu").locator('[data-choice="gpt-4.1"]'),
      ).toHaveAttribute("aria-checked", "true");
      await visual.capture("chat.model.menu-explicit");
      await page.keyboard.press("Escape");
      await message(page).focus();
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("chat.model.selected");
    },
  );
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(
    `delayed model save during a response affects only the next request at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      await workspaceFixture(
        page,
        { ...shellState, mobile: viewport.width < 600 },
        {
          aiConnection: connection,
          aiModel: "gpt-5.4",
          showInlineModel: true,
          aiHoldResponse: true,
          aiDeferSelection: true,
        },
      );
      await page.goto("/");
      await message(page).fill("A pending response");
      await send(page).click();
      await expect(
        page.getByRole("button", { name: "Stop response", exact: true }),
      ).toBeVisible();
      await expect(model(page)).toBeEnabled();
      await expect(
        page.getByText("A streamed test response.", { exact: true }),
      ).toBeVisible();
      const activity = page.locator(".chat-activity");
      await expect(activity.getByRole("status")).not.toBeEmpty();
      await expect(activity.locator(".comment-reveal")).not.toBeEmpty();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await activity
        .getByRole("button", { name: "Pause animation", exact: true })
        .click();
      await activity
        .getByRole("button", { name: "Resume animation", exact: true })
        .click();
      const eyes = activity.locator(
        ".mini-bend-playful__body > path:last-child",
      );
      await expect
        .poll(() => eyes.evaluate((element) => element.getAnimations().length))
        .toBe(1);
      const samples = await eyes.evaluate((element) => {
        const animation = element.getAnimations()[0];
        animation.pause();
        const duration = Number(animation.effect!.getTiming().duration);
        return [0.2, 0.3, 0.52, 0.6, 0.74, 0.8].map((fraction) => {
          animation.currentTime = duration * fraction;
          return getComputedStyle(element).transform;
        });
      });
      expect(new Set(samples).size).toBe(samples.length);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect
        .poll(() => eyes.evaluate((element) => element.getAnimations().length))
        .toBe(0);
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("chat.response.running");
      await message(page).fill("Keep the next request draft");
      await choose(page, "gpt-4.1");
      await expect(model(page)).toBeDisabled();
      await expect(send(page)).toHaveCount(0);
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("chat.model.saving");
      await finishSelection(page);
      await expect(model(page)).toHaveAttribute(
        "aria-description",
        /gpt-4\.1/u,
      );
      await expect(model(page)).toBeEnabled();
      await expect(message(page)).toHaveValue("Keep the next request draft");
      const active = await nativeRequests(page);
      expect(
        active.map(({ model, config }) => ({
          model,
          connection: config?.connectionId,
        })),
      ).toEqual([{ model: "gpt-5.4", connection: "personal" }]);
      await page.evaluate(() => Reflect.get(window, "__finishResponse")());
      await expect(
        page.getByRole("button", { name: "Stop response", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".work-history-heading .duration")).toHaveText(
        /^Worked for (?:less than 1 sec|\d+ sec|\d+ min \d+ sec)$/u,
      );
      await expect(activity).toHaveCount(0);
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("chat.response.complete");
      const record = await page.evaluate(() =>
        (
          Reflect.get(
            window,
            "__nativeConversationFixture",
          ) as NativeConversationFixture
        ).getRecord("garden", "legacy"),
      );
      expect(record).not.toHaveProperty("modelOverride");
      expect(JSON.stringify(record)).not.toMatch(
        /"(?:provider|model|connection|thinkingLevel)"\s*:/u,
      );
      await send(page).click();
      await expect
        .poll(async () => (await nativeRequests(page)).length)
        .toBe(2);
      expect((await nativeRequests(page)).map(({ model }) => model)).toEqual([
        "gpt-5.4",
        "gpt-4.1",
      ]);
      await page.evaluate(() => Reflect.get(window, "__finishResponse")());
    },
  );

  test(
    `confirmed failed selection preserves the previous choice and permits another attempt at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      await workspaceFixture(page, shellState, {
        aiConnection: connection,
        aiModel: "gpt-5.4",
        showInlineModel: true,
        aiSelectionFailures: 1,
        aiDeferSelection: true,
      });
      await page.goto("/");
      await message(page).fill("Keep the previous choice until confirmed");
      await choose(page, "gpt-4.1");
      await expect(model(page)).toBeDisabled();
      await expect(send(page)).toBeDisabled();
      await message(page).press("Enter");
      expect(
        (await calls(page)).filter((call) =>
          ["ai_begin", "ai_request"].includes(call.command),
        ),
      ).toEqual([]);
      await finishSelection(page);
      await expect(model(page)).toHaveAttribute(
        "aria-description",
        /gpt-5\.4/u,
      );
      await expect(page.locator(".model-error")).toBeVisible();
      await expect(model(page)).toBeEnabled();
      await expect(send(page)).toBeEnabled();
      await expect(message(page)).toHaveValue(
        "Keep the previous choice until confirmed",
      );
      await page.mouse.move(0, 0);
      await expect(page.locator(".model-error")).toBeInViewport({ ratio: 1 });
      await expectDialogTypography(page.locator(".model-error"));
      await visual.capture("chat.model.confirmed-failure");
      await page
        .locator(".model-error")
        .getByRole("button", { name: "Retry", exact: true })
        .click();
      await expect(send(page)).toBeDisabled();
      await finishSelection(page);
      await expect(model(page)).toHaveAttribute(
        "aria-description",
        /gpt-4\.1/u,
      );
      await expect(page.locator(".model-error")).toBeHidden();
      await expect(send(page)).toBeEnabled();
      await expect(message(page)).toHaveValue(
        "Keep the previous choice until confirmed",
      );
      expect(
        (await calls(page))
          .filter((call) => call.command === "ai_select_conversation_model")
          .map((call) => call.args.model),
      ).toEqual(["gpt-4.1", "gpt-4.1"]);
      expect(
        (await calls(page)).filter((call) =>
          ["ai_begin", "ai_request"].includes(call.command),
        ),
      ).toEqual([]);
    },
  );

  test(
    `model and thinking stay mutable for active and unsaved responses at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      await workspaceFixture(page, shellState, {
        aiConnection: connection,
        aiModel: "gpt-6.1-sol",
        showInlineModel: true,
        aiHoldResponse: true,
        aiFailResponseSave: true,
      });
      await page.goto("/");
      await message(page).fill("Keep this response even if saving fails");
      await send(page).click();
      await expect(
        page.getByText("A streamed test response.", { exact: true }),
      ).toBeVisible();
      await choose(page, "high", "Thinking");
      await expect(
        page.getByRole("button", { name: "Thinking", exact: true }),
      ).toHaveText("High");
      expect(await nativeRequests(page)).toMatchObject([
        { model: "gpt-6.1-sol", thinking: "medium" },
      ]);
      await page.evaluate(() => Reflect.get(window, "__finishResponse")());
      await expect(
        page.getByRole("button", { name: "Stop response", exact: true }),
      ).toHaveCount(0);
      const retry = page.getByRole("button", {
        name: "Retry saving conversation",
        exact: true,
      });
      const saveDialog = page.getByRole("dialog", {
        name: "Conversation not saved",
        exact: true,
      });
      await expect(saveDialog).toBeVisible();
      await expect(saveDialog.getByRole("alert")).toContainText(
        "Keep this workspace open",
      );
      await expect(retry).toHaveClass(/situate-button--primary/);
      await page.keyboard.press("Escape");
      await expect(saveDialog).toBeHidden();
      await expect(retry).toHaveClass(/situate-button--secondary/);
      await message(page).fill("Keep the unsaved response draft");
      await choose(page, "gpt-5.4");
      await expect(model(page)).toHaveAttribute(
        "aria-description",
        /gpt-5\.4/u,
      );
      await choose(page, "gpt-6.1-sol");
      await expect(
        page.getByRole("button", { name: "Thinking", exact: true }),
      ).toHaveText("High");
      await choose(page, "low", "Thinking");
      await expect(
        page.getByRole("button", { name: "Thinking", exact: true }),
      ).toHaveText("Low");
      await expect(send(page)).toBeDisabled();
      await expect(retry).toBeVisible();
      await expect(
        page.getByText("A streamed test response.", { exact: true }),
      ).toBeVisible();
      await expect(message(page)).toHaveValue(
        "Keep the unsaved response draft",
      );
      await expect(saveDialog).toBeHidden();
      await retry.click();
      await expect(saveDialog).toBeVisible();
      await expect(retry).toBeEnabled();
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await expectDialogTypography(saveDialog);
      await visual.capture("chat.model.unsaved-response");
      await page.evaluate(() => Reflect.get(window, "__allowResponseSave")());
      await retry.click();
      await expect(retry).toHaveCount(0);
      await expect(send(page)).toBeEnabled();
      expect(await nativeRequests(page)).toHaveLength(1);
      expect(
        (await calls(page))
          .filter((call) => call.command === "ai_select_conversation_thinking")
          .map((call) => call.args.thinking),
      ).toEqual(["high", "low"]);
    },
  );

  test(
    `uncertain choice save blocks the next request until readback at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      await workspaceFixture(page, shellState, {
        aiConnection: connection,
        aiModel: "gpt-5.4",
        showInlineModel: true,
        aiHoldResponse: true,
        aiSelectionFailures: 1,
        aiSelectionSaveThenFail: true,
        aiSelectionReadbackError: true,
      });
      await page.goto("/");
      await message(page).fill("Keep this active response");
      await send(page).click();
      await expect(
        page.getByRole("button", { name: "Stop response", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("A streamed test response.", { exact: true }),
      ).toBeVisible();
      await message(page).fill("Keep until confirmed");
      await choose(page, "gpt-4.1");
      await expect(model(page)).toBeDisabled();
      await expect(page.locator(".model-error")).toBeVisible();
      await expect(send(page)).toHaveCount(0);
      const recovery = page.getByRole("dialog", {
        name: "Review model selection",
      });
      await expect(recovery.getByRole("alert")).toHaveText(
        "The saved choice could not be confirmed. Check again before sending.",
      );
      await visual.capture("chat.model.save-failed");
      await page.keyboard.press("Escape");
      await expect(recovery).toBeHidden();
      await message(page).press("Enter");
      await expect(message(page)).toHaveValue("Keep until confirmed");
      await page
        .getByRole("button", { name: "Review model selection", exact: true })
        .click();
      await expect(recovery).toBeVisible();
      expect(await nativeRequests(page)).toHaveLength(1);
      await page.evaluate(() => Reflect.get(window, "__finishResponse")());
      await expect(
        page.getByRole("button", { name: "Stop response", exact: true }),
      ).toHaveCount(0);
      await expect(send(page)).toBeDisabled();
      await page.evaluate(() =>
        Reflect.get(window, "__restoreSelectionReadback")(),
      );
      await page
        .locator(".model-error")
        .getByRole("button", { name: "Retry", exact: true })
        .click();
      await expect(model(page)).toHaveAttribute(
        "aria-description",
        /gpt-4\.1/u,
      );
      await expect(model(page)).toBeEnabled();
      await expect(send(page)).toBeEnabled();
      await expect(page.locator(".model-error")).toBeHidden();
      await expect(message(page)).toHaveValue("Keep until confirmed");
      expect(
        (await calls(page)).filter(
          (call) => call.command === "ai_select_conversation_model",
        ),
      ).toHaveLength(1);
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("chat.model.confirmed");
    },
  );
}
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(
    `long conversations keep messages and the draft reachable at ${viewport.width}px`,
    {
      tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop",
    },
    async ({ page, visual }) => {
      const response = [
        "Plant lavender near the sunny wall, leaving enough space between each plant for air to circulate. Keep the path clear so the herbs remain easy to reach.",
        "In the shaded corner, use a small bench and a few pots of mint. Water the pots separately from the lavender, which prefers drier soil.",
        "Check the soil each morning during the first week. Note which plants need more water before changing the rest of the garden.",
      ].join("\n\n");
      await page.setViewportSize(viewport);
      await workspaceFixture(
        page,
        { ...shellState, mobile: viewport.width < 600 },
        {
          aiConnection: connection,
          aiModel: "gpt-5.4",
          showInlineModel: true,
          aiResponseText: response,
        },
      );
      await page.goto("/");
      const message = page.getByRole("textbox", {
        name: "Message",
        exact: true,
      });
      for (let week = 1; week <= 4; week++) {
        await message.fill(
          `Plan the garden for week ${week}.\nKeep a quiet reading corner and leave room for the herbs to grow.`,
        );
        await page
          .getByRole("button", { name: "Send message", exact: true })
          .click();
        await expect(page.locator(".messages article")).toHaveCount(week * 2);
        await expect(page.locator(".messages article.assistant")).toHaveCount(
          week,
        );
        await expect(
          page
            .locator(".messages article.assistant")
            .last()
            .locator(".chat-markdown p"),
        ).toHaveText(response.split("\n\n"));
        await expect(model(page)).toBeEnabled();
      }
      const draft = "Which plants should I move next spring?";
      await message.fill(draft);
      const scroll = page.locator(".transcript-scroll");
      const scrollSize = await scroll.evaluate((element) => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
      expect(scrollSize.scrollHeight).toBeGreaterThan(scrollSize.clientHeight);
      expect(
        await page
          .locator(".layout-scroll")
          .evaluate((element) => element.scrollHeight - element.clientHeight),
      ).toBeLessThanOrEqual(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await scroll.evaluate((element) => element.scrollTo(0, 0));
      await expect(page.locator(".messages article").first()).toBeInViewport();
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("chat.conversation.long-start");
      await scroll.evaluate((element) =>
        element.scrollTo(0, element.scrollHeight),
      );
      await message.scrollIntoViewIfNeeded();
      await expect(message).toBeInViewport({ ratio: 1 });
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await expect(message).toHaveValue(draft);
      await expect(page.locator(".messages article").last()).toBeInViewport();
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("chat.conversation.long-end");
      expect(await nativeRequests(page)).toHaveLength(4);
    },
  );
}

for (const development of [false, true]) {
  test(
    `long ${development ? "development" : "ordinary"} chats retain their viewport and keep response failures visible`,
    { tag: "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize({ width: 1100, height: 760 });
      const id = "44444444-4444-4444-8444-444444444444";
      await workspaceFixture(page, shellState, {
        aiConnection: connection,
        aiModel: "gpt-5.4",
        aiRequestError: "native.ai.request.failed",
        aiConversations: [
          {
            id,
            title: "Build an inbox",
            draft: "",
            ...(development ? { development: { version: 2 } } : {}),
            messages: [
              {
                role: "user",
                content: Array(60)
                  .fill("Earlier synthetic context.")
                  .join("\n\n"),
                timestamp: 1,
              },
            ],
          },
        ],
      });
      await page.goto("/");
      await expect(page.locator(".topic-window")).toBeVisible();
      const conversation = page.getByRole("button", {
        name: "Build an inbox",
        exact: true,
      });
      if (!(await conversation.isVisible()))
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await conversation.click();
      const pane = page.locator(".chat-pane");
      await expect(pane).toBeVisible();
      if (development)
        await expect(pane.locator(".plugin-development")).toBeVisible();
      const outer = page.locator(".layout-scroll");
      await expect
        .poll(() =>
          outer.evaluate(
            (element) => element.scrollHeight - element.clientHeight,
          ),
        )
        .toBeLessThanOrEqual(1);
      const scroll = pane.locator(".transcript-scroll");
      expect(
        await scroll.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      ).toBe(true);
      await scroll.evaluate((element) =>
        element.scrollTo(0, element.scrollHeight),
      );
      await expect(message(page)).toBeInViewport({ ratio: 1 });
      await message(page).fill("Continue the assignment.");
      await send(page).click();
      const history = pane.locator(".work-history-heading").last();
      await expect(history).toContainText("Ended with an error");
      await expect(pane.locator(".work-history-toggle")).toHaveCount(0);
      await expect(
        page.getByRole("dialog", { name: "Action failed", exact: true }),
      ).toHaveCount(0);
      await expect(pane.locator(".chat-footer > p[role=alert]")).toHaveCount(0);
      await expect(pane.locator(".history-failure").last()).toBeVisible();
      await expect(pane.locator(".history-failure").last()).toContainText(
        "The response failed.",
      );
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture(
        `chat.response-failure.${development ? "development" : "ordinary"}.visible`,
      );
      await message(page).fill("Keep this draft.");
      expect(await nativeRequests(page)).toHaveLength(1);
      expect(
        await outer.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      ).toBeLessThanOrEqual(1);
      await send(page).click();
      await expect(pane.locator(".work-history-heading").last()).toContainText(
        "Ended with an error",
      );
      await expect(
        page.getByRole("dialog", { name: "Action failed", exact: true }),
      ).toHaveCount(0);
      await expect
        .poll(async () => (await nativeRequests(page)).length)
        .toBe(2);
      await expect(pane.locator(".work-history-heading")).toHaveCount(2);
    },
  );
}
