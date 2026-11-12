import { expect, test, type Page } from "./test";
import {
  shellState,
  workspaceFixture,
  nativeRequests,
  type NativeConversationFixture,
} from "./workspace-fixture";
import type { ConversationAction } from "../../src/ai/native-conversation";

test.use({ localizationMode: "real" });

async function openNavigation(page: Page): Promise<void> {
  if (
    !(await page
      .getByRole("navigation", { name: "Workspace navigation", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(
    `conversation titles stay on one line and rename without moving the list at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      const fullTitle =
        "Plan the garden with a quiet reading corner and leave enough room for herbs to grow";
      await workspaceFixture(
        page,
        { ...shellState, mobile: viewport.width < 600 },
        { aiConversationTitle: fullTitle },
      );
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(
        page.getByRole("textbox", { name: "Message", exact: true }),
      ).toBeVisible();
      await openNavigation(page);
      const title = page.locator(".conversation-title").first();
      const row = page.locator(".conversation-row").first();
      const options = page.locator(".conversation-actions").first();
      await expect(title).toHaveText(fullTitle);
      expect(
        await title.evaluate((node) => getComputedStyle(node).whiteSpace),
      ).toBe("nowrap");
      const before = await row.boundingBox();
      await visual.capture("chat.conversations.title-single-line");
      await options.click();
      const menu = page.getByRole("menu", {
        name: "Rename conversation",
        exact: true,
      });
      await expect(menu).toBeVisible();
      await expect(menu).not.toContainText(fullTitle);
      await visual.capture("chat.conversations.title-options");
      await menu
        .getByRole("menuitem", { name: "Rename conversation", exact: true })
        .press("Enter");
      const input = page.getByRole("textbox", {
        name: "Conversation title",
        exact: true,
      });
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute("type", "text");
      expect(
        await input.evaluate((element: HTMLInputElement) => [
          element.selectionStart,
          element.selectionEnd,
        ]),
      ).toEqual([0, fullTitle.length]);
      await input.fill("Garden with reading corner");
      await page.mouse.move(0, 0);
      const editing = await row.boundingBox();
      expect(editing?.y).toBe(before?.y);
      expect(editing?.height).toBe(before?.height);
      await visual.capture("chat.conversations.title-edit");
      await input.press("Enter");
      await expect(title).toHaveText("Garden with reading corner");
      await expect(options).toBeFocused();
      await visual.capture("chat.conversations.title-renamed");
      await options.click();
      await page
        .getByRole("menuitem", { name: "Rename conversation", exact: true })
        .click();
      await input.fill("   ");
      await expect(
        page.getByRole("button", { name: "Save title", exact: true }),
      ).toBeDisabled();
      await input.press("Enter");
      await expect(input).toBeVisible();
      await visual.capture("chat.conversations.title-empty");
      await input.fill("Discard this change");
      await input.press("Escape");
      await expect(title).toHaveText("Garden with reading corner");
      await expect(options).toBeFocused();
      await expect(
        page.getByRole("navigation", {
          name: "Workspace navigation",
          exact: true,
        }),
      ).toBeVisible();
      await options.click();
      await page
        .getByRole("menuitem", { name: "Rename conversation", exact: true })
        .click();
      await input.fill("Cancel with a button");
      await page
        .getByRole("button", { name: "Cancel rename", exact: true })
        .click();
      await expect(title).toHaveText("Garden with reading corner");
      await options.click();
      await page
        .getByRole("menuitem", { name: "Rename conversation", exact: true })
        .click();
      await input.fill("Herb garden");
      await page
        .getByRole("button", { name: "Save title", exact: true })
        .click();
      await expect(title).toHaveText("Herb garden");
      await expect(options).toBeFocused();
      await expect(page.getByRole("alert")).toHaveCount(0);
    },
  );
}

async function actions(page: Page) {
  return page.evaluate(() =>
    (
      Reflect.get(window, "__ipcCalls") as {
        command: string;
        args: {
          conversation: string;
          generation: string;
          action: ConversationAction;
        };
      }[]
    ).filter((call) => call.command === "ai_conversation_action"),
  );
}
async function savedPending(page: Page) {
  return page.evaluate(
    () =>
      (
        Reflect.get(
          window,
          "__nativeConversationFixture",
        ) as NativeConversationFixture
      )
        .getRecord("garden", "legacy")
        .runtime?.pending.filter((row) => row.state === "pending")
        .map(({ kind, text, state }) => ({ kind, text, state })) ?? [],
  );
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(
    `conversations keep separate drafts across navigation and persist through their own IPC identities at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual, browserName }) => {
      await workspaceFixture(
        page,
        {
          ...shellState,
          mobile: viewport.width < 600,
        },
        {
          aiConversations: [
            { id: "legacy", title: "", draft: "" },
            { id: "second", title: "", draft: "" },
          ],
        },
      );
      await page.setViewportSize(viewport);
      await page.goto("/");
      const draft = page.getByRole("textbox", {
        name: "Message",
        exact: true,
      });
      const rows = page.locator(".conversation-destination");
      await expect(rows).toHaveCount(2);
      const attach = page.getByRole("button", {
        name: "Attach file",
        exact: true,
      });
      await expect(attach).toBeEnabled();
      await expect(attach.locator("svg path")).toHaveAttribute(
        "d",
        "M12 5v14M5 12h14",
      );
      const attachmentBounds = await attach.boundingBox();
      const draftBounds = await draft.boundingBox();
      expect(attachmentBounds).not.toBeNull();
      expect(draftBounds).not.toBeNull();
      expect(attachmentBounds!.x + attachmentBounds!.width).toBeLessThanOrEqual(
        draftBounds!.x,
      );
      expect(attachmentBounds!.y + attachmentBounds!.height).toBe(
        draftBounds!.y + draftBounds!.height,
      );
      expect(attachmentBounds!.width).toBeGreaterThanOrEqual(44);
      expect(attachmentBounds!.height).toBeGreaterThanOrEqual(44);
      const tab =
        process.platform === "darwin" && browserName === "webkit"
          ? "Alt+Tab"
          : "Tab";
      await draft.focus();
      await page.keyboard.press(`Shift+${tab}`);
      await expect(attach).toBeFocused();
      await expect(page.getByRole("tooltip")).toHaveText("Attach file");
      await page.keyboard.press(tab);
      await expect(draft).toBeFocused();
      await draft.fill("First conversation draft");
      await openNavigation(page);
      await rows.last().click();
      await expect(rows).toHaveCount(2);
      await expect(draft).toHaveValue("");
      await draft.fill("Second conversation draft");
      await openNavigation(page);
      await expect(rows).toHaveCount(2);
      if (viewport.width >= 600) {
        await page.locator(".conversations .section-heading button").hover();
        await expect(page.getByRole("tooltip")).toHaveText("New chat");
      }
      await visual.capture("chat.conversations.draft-navigation");
      await rows.first().click();
      await expect(draft).toHaveValue("First conversation draft");
      await expect(
        page.locator('.topic-tabs [aria-selected="true"], .mobile-tab-trigger'),
      ).toBeFocused();
      await visual.capture("chat.conversations.first-draft-restored");
      await openNavigation(page);
      await rows.last().click();
      await expect(draft).toHaveValue("Second conversation draft");
      await expect
        .poll(() =>
          actions(page).then((calls) =>
            calls.flatMap(({ args }) =>
              args.action.type === "draft"
                ? [{ id: args.conversation, draft: args.action.input.text }]
                : [],
            ),
          ),
        )
        .toEqual(
          expect.arrayContaining([
            { id: "legacy", draft: "First conversation draft" },
            { id: expect.any(String), draft: "Second conversation draft" },
          ]),
        );
      await expect(page.getByRole("alert")).toHaveCount(0);
      await visual.capture("chat.conversations.second-draft-restored");
    },
  );

  test(
    `switching the visible chat leaves a background response running at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await workspaceFixture(
        page,
        { ...shellState, mobile: viewport.width < 600 },
        {
          aiConnection: {
            provider: "custom",
            endpoint: "http://localhost:8888/v1",
          },
          aiModel: "test-model",
          aiHoldResponse: true,
          aiConversations: [
            { id: "legacy", title: "", draft: "" },
            { id: "second", title: "", draft: "" },
          ],
        },
      );
      await page.setViewportSize(viewport);
      await page.goto("/");
      const draft = page.getByRole("textbox", {
        name: "Message",
        exact: true,
      });
      await draft.fill("First topic");
      await page
        .getByRole("button", {
          name: "Send message",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Stop response",
          exact: true,
        }),
      ).toBeVisible();
      await openNavigation(page);
      await page.locator(".conversation-destination").last().click();
      await expect(draft).toHaveValue("");
      await expect(page.locator(".messages")).toHaveCount(0);
      await expect(
        page
          .locator(".conversation-destination")
          .first()
          .locator(".working-indicator"),
      ).toHaveCount(1);
      await draft.fill("Unsent second topic");
      await openNavigation(page);
      await expect(
        page
          .locator(".conversation-destination")
          .first()
          .getByRole("img", { name: "Responding…", exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(".conversation-destination").first(),
      ).toContainText("First topic");
      const activity = page.locator(
        ".topic-tabs .working-indicator, .mobile-tab-trigger .working-indicator",
      );
      await expect(activity).toHaveCount(0);
      await expect(
        page.locator(".conversation-destination").first(),
      ).toHaveText("First topic");
      await page.emulateMedia({ reducedMotion: "reduce" });
      if (viewport.width >= 600) {
        await page.locator(".conversations .section-heading button").hover();
        await expect(page.getByRole("tooltip")).toHaveText("New chat");
      }
      await visual.capture("chat.conversations.background-response");
      await page.locator(".conversation-destination").first().click();
      await expect(activity).toHaveCount(1);
      await expect(activity).toHaveAccessibleName("Working");
      await expect(activity.locator("svg")).toHaveAttribute(
        "data-mini-frame",
        "rest",
      );
      await expect(
        page.getByRole("button", {
          name: "Stop response",
          exact: true,
        }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => typeof Reflect.get(window, "__finishResponse")),
        )
        .toBe("function");
      await page.evaluate(() => Reflect.get(window, "__finishResponse")());
      await expect(
        page.getByRole("button", {
          name: "Stop response",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(page.locator(".messages")).toContainText(
        "A streamed test response.",
      );
      await expect(activity).toHaveCount(0);
      await expect(
        page.locator(".conversation-destination .working-indicator"),
      ).toHaveCount(0);
      await visual.capture("chat.conversations.completed-topic");
      await openNavigation(page);
      await expect(
        page.locator(".conversation-destination").first(),
      ).toHaveAccessibleName("First topic");
      await page.locator(".conversation-destination").last().click();
      await expect(draft).toHaveValue("Unsent second topic");
      expect(
        (await actions(page)).filter(
          ({ args }) => args.action.type === "cancel",
        ),
      ).toEqual([]);
      expect(await nativeRequests(page)).toHaveLength(1);
    },
  );

  test(
    `mixed pending messages expand and return to the draft without stopping the response at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      await workspaceFixture(
        page,
        { ...shellState, mobile: viewport.width < 600 },
        {
          aiConnection: {
            provider: "custom",
            endpoint: "http://localhost:8888/v1",
          },
          aiModel: "test-model",
          aiHoldResponse: true,
        },
      );
      await page.goto("/");
      const draft = page.getByRole("textbox", { name: "Message", exact: true });
      const stop = page.getByRole("button", {
        name: "Stop response",
        exact: true,
      });
      await draft.fill("Plan a quiet garden with herbs and a reading corner.");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(stop).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => typeof Reflect.get(window, "__finishResponse")),
        )
        .toBe("function");
      const steering =
        "Keep the sunny path clear.\nLeave space between the herbs so they are easy to reach.";
      const followUp = "After the plan, make a short watering checklist.";
      await draft.fill(steering);
      await draft.press("Enter");
      await expect(draft).toHaveValue("");
      await draft.fill(followUp);
      await draft.press("Alt+Enter");
      await expect(draft).toHaveValue("");
      await expect
        .poll(() => savedPending(page))
        .toEqual([
          { kind: "steering", text: steering, state: "pending" },
          { kind: "followUp", text: followUp, state: "pending" },
        ]);
      const count = page.getByRole("button", {
        name: "2 pending",
        exact: true,
      });
      await expect(count).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".pending-list")).toBeHidden();
      await visual.capture("chat.pending.mixed-collapsed");
      await count.click();
      await expect(count).toHaveAttribute("aria-expanded", "true");
      await expect(
        page.getByRole("heading", { name: "Steering", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Follow-up", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".pending-message")).toHaveCount(2);
      await visual.capture("chat.pending.mixed-expanded");
      await page.locator(".pending-message summary").first().click();
      await expect(page.locator(".pending-body").first()).toBeVisible();
      await expect(page.locator(".pending-body").first()).toHaveText(steering);
      await visual.capture("chat.pending.steering-detail");
      const unsent = "Also leave a place for mint.";
      await draft.fill(unsent);
      await draft.press("ArrowUp");
      await expect(draft).toHaveValue(unsent);
      await expect(count).toBeVisible();
      if (viewport.width < 600)
        await page
          .getByRole("button", { name: "Edit all pending", exact: true })
          .click();
      else await draft.press("Alt+ArrowUp");
      await expect(draft).toHaveValue(
        [steering, followUp, unsent].join("\n\n"),
      );
      await expect(draft).toBeFocused();
      await expect(page.locator(".pending")).toHaveCount(0);
      await expect.poll(() => savedPending(page)).toEqual([]);
      await expect(stop).toBeVisible();
      await visual.capture("chat.pending.recalled-draft");
      await page.evaluate(() => Reflect.get(window, "__finishResponse")());
      await expect(stop).toHaveCount(0);
      await expect(draft).toHaveValue(
        [steering, followUp, unsent].join("\n\n"),
      );
      expect(await nativeRequests(page)).toHaveLength(1);
      expect(
        (await actions(page)).filter(
          ({ args }) => args.action.type === "cancel",
        ),
      ).toEqual([]);
    },
  );
}
