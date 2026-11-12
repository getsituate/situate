import { expect, test, type Page } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";

test.use({ localizationMode: "real", locale: "en-US" });
const diagnostics = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  diagnostics.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()))
      errors.push(message.text());
  });
});
test.afterEach(({ page }) => expect(diagnostics.get(page)).toEqual([]));

for (const width of [1440, 700]) {
  test(
    `plugin availability remains a chronological system note after the topic changes at ${width}px`,
    { tag: "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: 900 });
      await workspaceFixture(page, shellState, {
        aiConversationTitle: "Garden plans",
        aiConnection: {
          provider: "custom",
          endpoint: "http://localhost:8888/v1",
        },
        aiModel: "test-model",
        aiConversations: [
          {
            id: "legacy",
            title: "Garden plans",
            draft: "Keep the garden question unsent.",
            messages: [
              {
                role: "user",
                content: "Make a plugin for my reading list.",
                timestamp: 1000,
              },
              {
                role: "user",
                content: "Meanwhile, help me plan the garden.",
                timestamp: 2000,
              },
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "Which plants would you like to grow?",
                  },
                ],
                timestamp: 4000,
                stopReason: "stop",
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    total: 0,
                  },
                },
              },
            ],
            runtime: {
              draftAttachments: [],
              pending: [],
              runs: [],
              events: [
                {
                  id: "reading-ready",
                  runId: "reading-development",
                  sequence: 1,
                  type: "plugin_available",
                  data: { pluginName: "Reading list", timestamp: 3000 },
                },
              ],
            },
          },
        ],
      });
      await page.goto("/");
      const note = page.getByRole("note", {
        name: "System message",
        exact: true,
      });
      await expect(note).toHaveText(
        "“Reading list” is now available in this workspace.",
      );
      const transcript = page.locator(".messages");
      await expect(transcript.locator(":scope > *")).toHaveCount(4);
      await expect(transcript.locator(":scope > *").nth(1)).toContainText(
        "Meanwhile, help me plan the garden.",
      );
      await expect(transcript.locator(":scope > *").nth(2)).toHaveAttribute(
        "role",
        "note",
      );
      await expect(transcript.locator(":scope > *").nth(3)).toContainText(
        "Which plants would you like to grow?",
      );
      await expect(note.locator("strong, button")).toHaveCount(0);
      await expect(transcript.locator("article.assistant")).toHaveCount(1);
      await expect(transcript.locator("article.assistant")).not.toContainText(
        "Reading list",
      );
      const composer = page.getByRole("textbox", {
        name: "Message",
        exact: true,
      });
      await expect(composer).toHaveValue("Keep the garden question unsent.");
      await visual.capture("plugins.availability.changed-topic");
      await composer.fill("Should I plant herbs beside the reading corner?");
      const navigation = page.getByRole("navigation", {
        name: "Workspace navigation",
        exact: true,
      });
      if (!(await navigation.isVisible()))
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await page.locator(".conversations .section-heading button").click();
      await expect(composer).toHaveValue("");
      if (!(await navigation.isVisible()))
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await page
        .getByRole("button", { name: "Garden plans", exact: true })
        .click();
      await expect(composer).toHaveValue(
        "Should I plant herbs beside the reading corner?",
      );
      await expect(note).toHaveCount(1);
      await expect(note).toBeVisible();
      expect(
        await page.evaluate(() =>
          (Reflect.get(window, "__ipcCalls") as { command: string }[]).filter(
            (call) =>
              ["ai_begin", "ai_request", "plugin_development_create"].includes(
                call.command,
              ),
          ),
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    },
  );
}
