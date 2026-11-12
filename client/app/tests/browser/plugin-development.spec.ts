import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";
import { expectDialogText, expectDialogTypography } from "./dialog-typography";
import type { PreviewRequest } from "../../src/plugins/check-renderer-client";
import type { PreviewBridge } from "../../src/plugins/preview-transport";

const developmentId = "44444444-4444-4444-8444-444444444444";
const assignment = "Create a reading list from my book notes.";
const source = "export default () => ({ tools: [] });";
const before = "1".repeat(40),
  after = "2".repeat(40),
  view = "3".repeat(40),
  shellBefore = "4".repeat(40),
  shellAfter = "5".repeat(40);
test.use({ localizationMode: "real" });
async function selectConversation(page: Page, title: string) {
  const choice = page.getByRole("button", { name: title, exact: true });
  await expect(page.locator(".topic-window")).toBeVisible({ timeout: 15_000 });
  const navigation = page.getByRole("button", {
    name: /^(Open navigation|Navigation öffnen)$/u,
  });
  if (!(await choice.isVisible()) && (await navigation.isVisible()))
    await navigation.click();
  await choice.click();
}
async function openDevelopment(
  page: Page,
  errors: { source?: string; conversation?: string } = {},
) {
  const records = [
    {
      name: "edit_plugin_sources",
      args: {
        operation: "write",
        pluginId: "mail",
        path: "entry.js",
        text: source,
        expectedRevision: "source-before",
      },
      details: {
        change: {
          store: "plugin",
          pluginId: "mail",
          operation: "modified",
          before: { path: "entry.js", revision: before },
          after: { path: "entry.js", revision: after },
          attribution: "recorded",
        },
      },
    },
    {
      name: "edit_plugin_sources",
      args: {
        operation: "write",
        pluginId: "reading-list",
        path: "view.js",
        text: source,
        expectedRevision: null,
      },
      details: {
        change: {
          store: "plugin",
          pluginId: "reading-list",
          operation: "added",
          before: null,
          after: { path: "view.js", revision: view },
          attribution: "recorded",
        },
      },
    },
    {
      name: "write",
      args: {
        path: "notes/reading-list.md",
        text: "# Reading list\n\n- Example book\n",
        expectedRevision: "note-before",
      },
      details: {
        change: {
          path: "notes/reading-list.md",
          before: "# Reading list\n",
          after: "# Reading list\n\n- Example book\n",
          beforeRevision: "note-before",
          afterRevision: "note-after",
        },
      },
    },
    {
      name: "shell",
      args: { command: "rm notes/outdated.md" },
      details: {
        beforeHistoryRevision: shellBefore,
        afterHistoryRevision: shellAfter,
        attribution: "uncertainExternalChangesMayCoexist",
      },
    },
  ];
  await workspaceFixture(page, shellState, {
    aiConnection: { provider: "openai", endpoint: null },
    aiModel: "gpt-5.4",
    aiConversationTitle: "Reading notes",
    pluginSourceError: errors.source,
    aiConversationLoadErrors: errors.conversation
      ? { [developmentId]: errors.conversation }
      : undefined,
    changeRevisions: {
      [before]: {
        ".situate/plugins/mail/code/entry.js": "export default () => ({});",
      },
      [after]: { ".situate/plugins/mail/code/entry.js": source },
      [view]: { ".situate/plugins/reading-list/code/view.js": source },
      [shellBefore]: { "notes/outdated.md": "# Old note\n" },
      [shellAfter]: {},
    },
    changeLists: {
      [shellBefore]: {
        [shellAfter]: [{ path: "notes/outdated.md", operation: "deleted" }],
      },
    },
    aiConversations: [
      {
        id: developmentId,
        title: "Build a reading list",
        draft: assignment,
        development: {
          version: 2,
          originConversationId: "legacy",
          ...(errors.source ? { pluginId: "reading-list" } : {}),
        },
        messages: [
          {
            role: "user",
            content: "Prepare the connection and reading list.",
            timestamp: 1,
          },
        ],
        runtime: {
          draftAttachments: [],
          pending: [],
          runs: [
            {
              id: "finished-run",
              state: "completed",
              startedAt: 1,
              endedAt: 2,
              usage: [],
            },
          ],
          events: records.flatMap((record, index) => [
            {
              id: `edit-${index}`,
              runId: "finished-run",
              sequence: index * 2 + 1,
              type: "tool_intent",
              data: { name: record.name, args: record.args },
            },
            {
              id: `result-${index}`,
              runId: "finished-run",
              sequence: index * 2 + 2,
              type: "tool_execution_end",
              data: {
                toolCallId: `edit-${index}`,
                result: { content: [], details: record.details },
                isError: false,
              },
            },
          ]),
        },
      },
    ],
  });
  await page.goto("/");
  await selectConversation(page, "Build a reading list");
}
const requests = (page: Page) =>
  page.evaluate(() =>
    (
      Reflect.get(window, "__ipcCalls") as {
        command: string;
        args: { request?: { operation?: string } };
      }[]
    ).filter(
      (call) =>
        call.command === "ai_begin" ||
        call.command === "ai_request" ||
        ["plugin_sources", "plugin_changes_check"].includes(call.command) ||
        (call.command === "workspace_file_tool" &&
          ["shell", "write", "edit"].includes(
            call.args.request?.operation ?? "",
          )) ||
        (call.command === "ai_conversation_action" &&
          ["submit", "enqueue"].includes(
            (call.args as { action?: { type: string } }).action?.type ?? "",
          )),
    ),
  );
for (const width of [1440, 1000, 700]) {
  test(
    `retained workspace development preserves chat and recorded Changes at ${width}px`,
    { tag: "@visual-desktop" },
    async ({ page, visual }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await openDevelopment(page);
      const development = page.locator(".plugin-development");
      await expect(development).toBeVisible({ timeout: 15_000 });
      await expect(
        development.getByRole("button", {
          name: "Development data",
          exact: true,
        }),
      ).toHaveCount(0);
      const message = page.getByRole("textbox", {
        name: /^(Message|Nachricht)$/u,
      });
      await expect(message).toHaveValue(assignment);
      await expect(development.locator(".development-context")).toHaveCount(0);
      await visual.capture("plugins.development.chat");
      await development.locator(".development-help-trigger").click();
      const help = page.getByRole("dialog");
      await expect(help).toContainText(
        /compare files before and after edits|Dateien vor und nach der Bearbeitung zu vergleichen/u,
      );
      await expectDialogTypography(help);
      await expectDialogText(help.locator("h3"), "section");
      await visual.capture("plugins.development.help");
      await page.keyboard.press("Escape");
      await expect(help).toHaveCount(0);
      const toggle = development.locator(".development-changes-toggle");
      await toggle.click();
      const changes = development.locator(".development-changes");
      await expect(changes).toBeVisible();
      await expect(changes.locator(".file-row")).toHaveCount(4);
      await expect(changes.locator(".uncertain-mark")).toHaveCount(1);
      await expect(
        changes.locator('[role="tablist"],.code-browser'),
      ).toHaveCount(0);
      await visual.capture("plugins.development.changes");
      await changes
        .locator(".file-row")
        .filter({ hasText: "entry.js" })
        .click();
      await expect(changes.locator(".diff-lines")).toContainText(source);
      await visual.capture("plugins.development.diff");
      if (width > 840) {
        await changes.locator(".inspection-header button").click();
        await expect(development.locator(".development-layout")).toHaveClass(
          /changes-expanded/u,
        );
        await visual.capture("plugins.development.diff-expanded");
        await changes.locator(".inspection-header button").click();
      }
      await toggle.click();
      await expect(changes).not.toBeVisible();
      await expect(message).toHaveValue(assignment);
      await toggle.click();
      await expect(changes.locator(".diff-lines")).toContainText(source);
      await changes.locator(".detail-pane .back").click();
      await changes.getByRole("searchbox").fill("notes/");
      await changes
        .locator(".file-row")
        .filter({ hasText: "outdated.md" })
        .click();
      await expect(changes.locator(".diff-lines")).toContainText("# Old note");
      await expect(changes.locator(".change-notice")).toBeVisible();
      await visual.capture("plugins.development.observed-deletion");
      await changes.locator(".detail-pane .back").click();
      await changes
        .locator(".file-row")
        .filter({ hasText: "reading-list.md" })
        .click();
      await expect(changes.locator(".diff-lines")).toContainText(
        "# Reading list",
      );
      await expect(changes.locator(".diff-lines")).toContainText(
        "- Example book",
      );
      await expect(changes.locator("h1")).toHaveCount(0);
      await visual.capture("plugins.development.note-diff");
      await toggle.click();
      await selectConversation(page, "Reading notes");
      await expect(development).toHaveCount(0);
      await expect(message).toHaveValue("");
      await page
        .getByRole("button", {
          name: /^(Back in this pane|In diesem Bereich zurück)$/u,
        })
        .click();
      await expect(message).toHaveValue(assignment);
      await page.locator(".development-changes-toggle").click();
      await expect(
        page.locator(".development-changes .diff-lines"),
      ).toContainText("- Example book");
      expect(await requests(page)).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    },
  );
}
test("plugin UI checks keep the development chat unobscured until they finish", async ({
  page,
}, testInfo) => {
  await openDevelopment(page);
  const message = page.getByRole("textbox", { name: /^(Message|Nachricht)$/u });
  await message.focus();
  const bounds = await message.boundingBox();
  expect(bounds).not.toBeNull();
  const point = {
    x: bounds!.x + bounds!.width / 2,
    y: bounds!.y + bounds!.height / 2,
  };
  const unobscured = () =>
    message.evaluate((element, point) => {
      const top = document.elementFromPoint(point.x, point.y);
      return top === element || element.contains(top);
    }, point);
  expect(await unobscured()).toBe(true);

  expect(
    await page.evaluate(() => window.__situatePreviewRequest),
  ).toBeUndefined();
  const renderer = await page.context().newPage();
  await renderer.setViewportSize({ width: 1024, height: 768 });
  const replies = new Map<string, { value?: unknown; error?: string }>();
  await renderer.exposeFunction(
    "recordPreviewReply",
    (reply: { requestId: string; value?: unknown; error?: string }) => {
      replies.set(reply.requestId, reply);
    },
  );
  await renderer.addInitScript(() => {
    Reflect.set(window, "__SITUATE_EXECUTOR__", {
      send: (reply: unknown) =>
        Reflect.get(window, "recordPreviewReply")(reply),
    });
  });
  await renderer.route("**/plugin-preview-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="/dist/plugin-check-renderer.js"></script></body></html>',
    }),
  );
  await renderer.route("**/dist/plugin-check-renderer.js", async (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: await readFile(
        new URL("../../dist/plugin-check-renderer.js", import.meta.url),
        "utf8",
      ),
    }),
  );
  await renderer.goto(new URL("/plugin-preview-fixture", page.url()).href);
  await renderer.waitForFunction(
    () => Reflect.get(window, "__SITUATE_EXECUTOR__").receive,
  );
  let sequence = 0;
  async function send(
    operation: PreviewRequest["operation"],
    args: PreviewRequest["args"] = {},
  ) {
    const requestId = `preview-${++sequence}`;
    await renderer.evaluate(
      (request) => {
        const { __SITUATE_EXECUTOR__: bridge } = window as unknown as {
          __SITUATE_EXECUTOR__: PreviewBridge;
        };
        bridge.receive!({ type: "request", request });
      },
      {
        generation: 1,
        invocationId: "ui-check",
        requestId,
        operation,
        args,
      },
    );
    await expect.poll(() => replies.has(requestId)).toBe(true);
    const reply = replies.get(requestId)!;
    expect(reply.error).toBeUndefined();
    return reply.value;
  }
  await send("previewOpen", {
    viewId: "counter:main",
    source: {
      manifest: {
        schemaVersion: 2,
        id: "counter",
        name: "Counter",
        description: "Synthetic counter",
        skills: [],
        uiEntry: "view.js",
      },
      serviceEntry: null,
      uiEntry: `export default ({ vue: { h, ref } }) => ({ views: [{
        id: "counter:main", title: () => "Counter", icon: "folder",
        component: { setup() {
          const count = ref(0);
          return () => h("div", { "data-localization-content": "external" }, [
            h("button", { onClick: () => count.value++ }, "Increment"),
            h("output", String(count.value)),
          ]);
        } },
      }] });`,
      modules: {},
      skills: [],
    },
  });
  let during: boolean;
  try {
    expect(
      await send("previewStep", { action: "read", selector: "output" }),
    ).toBe("0");
    await send("previewStep", { action: "click", selector: "button" });
    expect(
      await send("previewStep", { action: "read", selector: "output" }),
    ).toBe("1");
    during = await unobscured();
    await testInfo.attach("plugin-check-open", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } finally {
    try {
      await send("previewClose");
    } finally {
      await renderer.close();
    }
  }
  await expect(page.locator("[data-plugin-preview]")).toHaveCount(0);
  await expect(message).toHaveValue(assignment);
  await expect(message).toBeFocused();
  expect(await unobscured()).toBe(true);
  expect(
    during,
    "The development chat must remain unobscured during UI checks",
  ).toBe(true);
});

test("unavailable plugin sources do not block history or conversation navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await openDevelopment(page, {
    source: "native.plugins.unavailable",
  });
  const message = page.getByRole("textbox", { name: /^(Message|Nachricht)$/u });
  await expect(message).toHaveValue(assignment);
  await expect(message).toBeEnabled();
  expect(
    await page.evaluate(async () => {
      try {
        await Reflect.get(window, "__TAURI_INTERNALS__").invoke(
          "plugins_source",
          {
            scope: "garden",
            request: { operation: "files", pluginId: "reading-list" },
          },
        );
        return null;
      } catch (error) {
        return error;
      }
    }),
  ).toBe("native.plugins.unavailable");
  await expect(
    page.getByText("Prepare the connection and reading list.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".situate-error-screen")).toHaveCount(0);
  await selectConversation(page, "Reading notes");
  await expect(message).toHaveValue("");
  await selectConversation(page, "Build a reading list");
  await expect(message).toHaveValue(assignment);
  await expect(page.locator(".situate-error-screen")).toHaveCount(0);
  expect(await requests(page)).toEqual([]);
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, "__ipcCalls") as { command: string }[]).some(
        (call) => call.command === "plugin_development_status",
      ),
    ),
  ).toBe(false);
});
test("a narrow conversation load error retains access to conversation navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await openDevelopment(page, {
    conversation: "native.ai.conversation.versionInvalid",
  });
  await expect(
    page.getByRole("dialog", { name: "Oops. Something went wrong." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.locator(".chat-load-error")).toBeVisible();
  await selectConversation(page, "Reading notes");
  await expect(page.locator(".chat-load-error")).toHaveCount(0);
  await selectConversation(page, "Build a reading list");
  await expect(page.locator(".chat-load-error")).toBeVisible();
  expect(await requests(page)).toEqual([]);
});
test(
  "conversation loading failure shows a safe error and retains conversation navigation",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDevelopment(page, {
      conversation: "native.ai.conversation.versionInvalid",
    });
    await expect(
      page.getByRole("dialog", { name: "Oops. Something went wrong." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    const error = page.locator(".chat-pane .chat-load-error");
    await expect(error.locator(":scope > span:not(.error-actions)")).toHaveText(
      /^(The saved conversation is invalid or uses an unsupported version\. Keep the original file and check workspace storage\.|Die gespeicherte Unterhaltung ist ungültig oder verwendet eine nicht unterstützte Version\. Bewahre die Originaldatei auf und prüfe den Speicher des Arbeitsbereichs\.)$/u,
    );
    await expect(
      error.getByRole("button", { name: "Report a problem", exact: true }),
    ).toBeVisible();
    await visual.capture("chat.load-error");
    await selectConversation(page, "Reading notes");
    await expect(error).toHaveCount(0);
    await selectConversation(page, "Build a reading list");
    await expect(error).toBeVisible();
    expect(await requests(page)).toEqual([]);
  },
);
