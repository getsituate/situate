import { expect, test, type Page } from "./test";
import {
  shellState,
  workspaceFixture,
  nativeRequests,
  type NativeConversationFixture,
} from "./workspace-fixture";
import type { ConversationAction } from "../../src/ai/native-conversation";
import { emptyLayout, reduceLayout } from "../../src/layout/model";

test.use({ localizationMode: "real" });

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(
    `mixed file attachments show paths and thumbnails above the message at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await workspaceFixture(
        page,
        { ...shellState, mobile: viewport.width < 600 },
        {
          aiConversations: [{ id: "legacy", title: "Garden plans", draft: "" }],
          aiFileSelection: {
            attachments: [
              {
                id: "external-image",
                name: "photo.png",
                mimeType: "text/plain",
                size: 127,
              },
            ],
            references: ["Plans/garden.xlsx", "Images/map.png"].map((path) => ({
              kind: "live",
              workspaceId: "garden",
              path,
              anchorRevision: "a".repeat(40),
            })),
            failed: false,
          },
          aiAttachmentPreviews: {
            "external-image":
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAYUlEQVR42mM4cOMdVRDDgBn063QyBFFkENwUTLNoaVDj7A4qGAQ0BYIoCiO4KfjNIhBraKaQahYDHlNIMosBvynEm8VA0BQizSLWoKCOYkxErEFYNeNCDJRoRjeIbM3ICABlqC8+ZphuLgAAAABJRU5ErkJggg==",
            "Images/map.png":
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA8AAAAYCAIAAACqZzA+AAAAaklEQVR42mO4cnApJioL2odVnAGIf7w8gYwgqtFELjy4BkS0Vk2807GbDSSRjSfgEuqpJt7pOM1GNp6wS0hTDVSKifC5G9Pp+FwCdwxR7qaGauKdTsBsiPHEuoRi1cQ7nbDZEOOJdQn5qgGAWVz82Sgg8gAAAABJRU5ErkJggg==",
          },
        },
      );
      await page.setViewportSize(viewport);
      await page.goto("/");
      const draft = page.getByRole("textbox", { name: "Message", exact: true });
      await draft.fill("Keep the notes");
      await page
        .getByRole("button", { name: "Attach file", exact: true })
        .click();

      const attachments = page.getByRole("list", { name: "Attachments" });
      const preview = attachments.getByRole("img", { name: "photo.png" });
      const workspaceImage = page.getByRole("img", { name: "map.png" });
      for (const image of [preview, workspaceImage]) {
        await expect(image).toBeVisible();
        await expect
          .poll(() =>
            image.evaluate((img) => (img as HTMLImageElement).naturalWidth),
          )
          .toBeGreaterThan(0);
      }
      await expect(attachments).not.toContainText("photo.png");
      const workspaceReference = attachments.getByText("Plans/garden.xlsx", {
        exact: true,
      });
      await expect(workspaceReference).toBeVisible();
      const bounds = (await attachments.boundingBox())!;
      expect(bounds.y + bounds.height).toBeLessThan(
        (await draft.boundingBox())!.y,
      );
      await expect(attachments.getByRole("listitem")).toHaveCount(3);
      await visual.capture("chat.composer.file-attachments");

      await attachments
        .getByRole("button", { name: "Remove attachment photo.png" })
        .click();
      await expect(preview).toHaveCount(0);
      await expect(workspaceReference).toBeVisible();
      await expect(draft).toBeFocused();
      await expect(draft).toHaveValue("Keep the notes");
    },
  );
}

for (const target of [
  { kind: "conversation", conversationId: "deleted" },
  { kind: "view", viewId: "missing:board", contentId: "old-item" },
] as const) {
  test(
    `a retained missing ${target.kind} opens the new-tab chooser without a startup error`,
    {
      tag: target.kind === "conversation" ? "@visual-desktop" : [],
    },
    async ({ page, visual }) => {
      if (target.kind === "conversation")
        await page.setViewportSize({ width: 1280, height: 800 });
      let sequence = 0;
      await workspaceFixture(page, shellState, {
        aiHoldConversationList: target.kind === "conversation",
        layout: {
          records: {
            garden: {
              revision: "retained-layout",
              data: {
                version: 1,
                pinnedViews: ["files"],
                layout: reduceLayout(
                  emptyLayout(),
                  {
                    type: "open",
                    target,
                  },
                  () => `retained-${++sequence}`,
                ),
              },
            },
          },
        },
      });
      await page.goto("/");
      if (target.kind === "conversation") {
        await expect(page.getByRole("tabpanel").getByRole("status")).toHaveText(
          "Opening conversation…",
        );
        await expect(
          page.getByRole("tab", { name: "Conversation", exact: true }),
        ).toBeVisible();
        const sidebar = page.getByRole("navigation", {
          name: "Workspace navigation",
          exact: true,
        });
        await expect(
          sidebar.getByText("Loading conversations…", { exact: true }),
        ).toBeVisible();
        await expect(
          sidebar.getByText("No conversations yet.", { exact: true }),
        ).toHaveCount(0);
        await visual.capture("layout.pane.opening");
      }
      const requestsForMissing = () =>
        page.evaluate(() =>
          (
            Reflect.get(window, "__ipcCalls") as {
              args: { conversation?: string };
            }[]
          ).filter(({ args }) => args.conversation === "deleted"),
        );
      expect(await requestsForMissing()).toEqual([]);
      if (target.kind === "conversation")
        await page.evaluate(() =>
          Reflect.get(window, "__releaseConversationList")(),
        );
      await expect(
        page.getByRole("heading", {
          name: "What would you like here?",
          exact: true,
        }),
      ).toBeVisible();
      expect(await requestsForMissing()).toEqual([]);
      await page.locator(".view-chooser .new-conversation").click();
      await expect(
        page.getByRole("textbox", { name: "Message", exact: true }),
      ).toHaveValue("");
    },
  );
}

test(
  "a saved conversation does not show a new-chat greeting while its history loads",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    const title = "Garden plans";
    const message = "Keep the herbs by the kitchen.";
    const draft = "An unfinished thought";
    await workspaceFixture(page, shellState, {
      aiHoldConversationSnapshot: "legacy",
      aiConversations: [
        {
          id: "legacy",
          title,
          draft,
          messages: [{ role: "user", content: message, timestamp: 1 }],
        },
      ],
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const sidebar = page.getByRole("navigation", {
      name: "Workspace navigation",
      exact: true,
    });
    await sidebar.getByRole("button", { name: title, exact: true }).click();
    const pane = page.getByRole("tabpanel");
    await expect(
      pane.getByText("Opening conversation…", { exact: true }),
    ).toBeVisible();
    await expect(pane.locator(".welcome-bend")).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: title, exact: true }),
    ).toBeVisible();
    await visual.capture("chat.history.opening");
    await expect(
      pane.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() =>
      Reflect.get(window, "__releaseConversationSnapshot")(),
    );
    await expect(pane.getByText(message, { exact: true })).toBeVisible();
    await expect(
      pane.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue(draft);
    await expect(
      pane.getByText("Opening conversation…", { exact: true }),
    ).toHaveCount(0);
  },
);

async function openNavigation(page: Page): Promise<void> {
  const navigation = page.getByRole("navigation", {
    name: "Workspace navigation",
    exact: true,
  });
  const trigger = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await expect
    .poll(
      async () => (await navigation.isVisible()) || (await trigger.isVisible()),
    )
    .toBe(true);
  if (!(await navigation.isVisible())) await trigger.click();
}

for (const width of [1280, 1000]) {
  test(`middle-click opens and focuses a new conversation tab at ${width}px`, async ({
    page,
  }) => {
    const title = "Garden plans";
    await workspaceFixture(page, shellState, {
      aiConversations: [{ id: "legacy", title, draft: "Existing draft" }],
    });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const item = page.getByRole("button", { name: title, exact: true });
    const tabs = page.getByRole("tab", { name: title, exact: true });
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(message).toHaveValue("Existing draft");
    await expect(tabs).toHaveCount(1);
    await openNavigation(page);
    await item.click({ button: "middle" });
    await expect(tabs).toHaveCount(2);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "false");
    await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
    await expect(tabs.last()).toBeFocused();
    await expect(message).toHaveValue("Existing draft");
  });
}

test("right-click opens the conversation menu without selecting the row", async ({
  page,
}) => {
  const title = "Garden plans";
  await workspaceFixture(page, shellState, {
    aiConversations: [
      { id: "legacy", title: "Notes", draft: "" },
      { id: "garden-plans", title, draft: "" },
    ],
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const item = page.getByRole("button", { name: title, exact: true });
  await expect(item).not.toHaveAttribute("aria-current", "page");
  await item.click({ button: "right" });
  const menu = page.getByRole("menu", {
    name: `Conversation options: ${title}`,
  });
  await expect(menu).toBeVisible();
  await expect(item).not.toHaveAttribute("aria-current", "page");
  const rename = menu.getByRole("menuitem", { name: "Rename conversation" });
  await expect(rename).toBeFocused();
  await rename.press("Escape");
  await expect(menu).toBeHidden();
  await expect(
    page.getByRole("button", { name: `Conversation options: ${title}` }),
  ).toBeFocused();
  await item.click({ button: "right" });
  await rename.click();
  await expect(
    page.getByRole("textbox", { name: "Conversation title" }),
  ).toHaveValue(title);
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(
    `conversation titles stay on one line and rename without moving the list at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual, visualEnabled }) => {
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
        name: `Conversation options: ${fullTitle}`,
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
      if (visualEnabled && viewport.width >= 600) {
        await expect(page.getByRole("tooltip")).toHaveText(
          "Conversation options: Garden with reading corner",
        );
      }
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

test(
  "archives an open conversation and can read and restore it after reopening",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    const title = "Garden plans";
    const message = "Keep the herbs by the kitchen.";
    await workspaceFixture(page, shellState, {
      aiConversations: [
        {
          id: "legacy",
          title,
          draft: "An unfinished thought",
          messages: [{ role: "user", content: message, timestamp: 1 }],
        },
      ],
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const sidebar = page.getByRole("navigation", {
      name: "Workspace navigation",
    });
    const archive = sidebar.locator(".conversation-archive");
    const summary = archive.locator("summary");
    const item = sidebar.getByRole("button", { name: title, exact: true });
    const shortcut = sidebar.getByRole("button", {
      name: `Archive ${title}`,
      exact: true,
    });
    await item.click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(shortcut).toHaveCSS("opacity", "0");
    await item.hover();
    await expect(shortcut).toHaveCSS("opacity", "1");
    await shortcut.click();
    await expect(summary).toHaveText("Archive");
    await expect(summary).toBeFocused();
    await expect(item).toHaveCount(0);
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await page.reload();
    await expect(archive).toHaveJSProperty("open", false);
    await summary.press("Enter");
    await archive.getByRole("button", { name: title, exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("An unfinished thought");
    await visual.capture("chat.conversations.archive-open");
    await archive
      .getByRole("button", { name: `Conversation options: ${title}` })
      .click();
    await page
      .getByRole("menuitem", { name: "Restore conversation", exact: true })
      .click();
    await expect(archive.getByText("No archived conversations.")).toBeVisible();
    await expect(item).toBeVisible();
    await page.reload();
    await expect(item).toBeVisible();
  },
);

test("narrow sidebar keeps archive in the menu and reports a failed save", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, {
    aiConversationTitle: "Garden plans",
    aiArchiveFailures: 1,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  await handle.press("Home");
  const sidebar = page.getByRole("navigation", {
    name: "Workspace navigation",
  });
  const options = sidebar.getByRole("button", {
    name: "Conversation options: Garden plans",
  });
  await options.hover();
  await expect(
    sidebar.getByRole("button", { name: "Archive Garden plans", exact: true }),
  ).toHaveCount(0);
  const action = page.getByRole("menuitem", {
    name: "Archive conversation",
    exact: true,
  });
  await options.click();
  await action.click();
  const error = page
    .getByRole("alert")
    .filter({ hasText: "The change to the archive could not be confirmed." });
  await expect(error).toBeVisible();
  await error.locator("..").press("Escape");
  await expect(options).toBeFocused();
  await options.click();
  await action.click();
  const archive = sidebar.locator(".conversation-archive");
  const summary = archive.locator("summary");
  await expect(summary).toBeFocused();
  await expect(options).toHaveCount(0);
  await summary.click();
  await expect(
    archive.getByRole("button", { name: "Garden plans", exact: true }),
  ).toBeVisible();
});

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
    `conversation deletion confirms, retries failures and survives reopening at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await workspaceFixture(
        page,
        { ...shellState, mobile: viewport.width < 600 },
        {
          aiConversations: [
            { id: "legacy", title: "Garden plan", draft: "Unsent ideas" },
            { id: "other", title: "Reading list", draft: "Keep this draft" },
          ],
          aiDeleteFailures: 1,
        },
      );
      await page.setViewportSize(viewport);
      await page.goto("/");
      await openNavigation(page);
      const options = page.getByRole("button", {
        name: "Conversation options: Garden plan",
        exact: true,
      });
      await options.click();
      await page
        .getByRole("menuitem", { name: "Delete conversation…", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Delete conversation?",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Garden plan");
      await expect(
        dialog.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeFocused();
      await visual.capture("chat.conversations.delete-confirmation");
      await dialog.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(options).toBeFocused();
      await options.click();
      await page
        .getByRole("menuitem", { name: "Delete conversation…", exact: true })
        .press("Enter");
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText(
        "Deletion could not be confirmed.",
      );
      await visual.capture("chat.conversations.delete-error");
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(options).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Reading list", exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(".conversations .section-heading button"),
      ).toBeFocused();
      if (viewport.width < 600)
        await page
          .getByRole("button", { name: "Close navigation", exact: true })
          .click();
      const chooser = page.getByRole("heading", {
        name: "What would you like here?",
        exact: true,
      });
      await expect(chooser).toBeVisible();
      await visual.capture("chat.conversations.deleted-view");
      await page.reload();
      await expect(chooser).toBeVisible();
      await page.locator(".view-chooser .new-conversation").click();
      await expect(
        page.getByRole("textbox", { name: "Message", exact: true }),
      ).toHaveValue("");
      await openNavigation(page);
      await expect(options).toHaveCount(0);
      await page
        .getByRole("button", { name: "Reading list", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Message", exact: true }),
      ).toHaveValue("Keep this draft");
    },
  );
  test(
    `conversation deletion warns about running work and discards late responses at ${viewport.width}px`,
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
            { id: "legacy", title: "Garden plan", draft: "" },
            { id: "other", title: "Reading list", draft: "" },
          ],
        },
      );
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .fill("Plan the garden");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Stop response", exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => typeof Reflect.get(window, "__finishResponse")),
        )
        .toBe("function");
      await openNavigation(page);
      await page
        .getByRole("button", { name: "Reading list", exact: true })
        .click();
      await openNavigation(page);
      await page
        .getByRole("button", {
          name: "Conversation options: Garden plan",
          exact: true,
        })
        .click();
      await page
        .getByRole("menuitem", { name: "Delete conversation…", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Delete conversation?",
        exact: true,
      });
      await expect(dialog).toContainText("Deleting it will stop that work.");
      await visual.capture("chat.conversations.delete-running-confirmation");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(
        page.locator(".conversation-destination .working-indicator"),
      ).toHaveCount(1);
      await page
        .getByRole("button", {
          name: "Conversation options: Garden plan",
          exact: true,
        })
        .click();
      await page
        .getByRole("menuitem", { name: "Delete conversation…", exact: true })
        .click();
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Garden plan", exact: true }),
      ).toHaveCount(0);
      await page.evaluate(() => Reflect.get(window, "__finishResponse")());
      await page.reload();
      await openNavigation(page);
      await expect(
        page.getByRole("button", { name: "Garden plan", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Reading list", exact: true }),
      ).toBeVisible();
      expect(await nativeRequests(page)).toHaveLength(1);
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
