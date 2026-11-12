import { expect, test, type Locator, type Page } from "./test";
import { t } from "@situate/localization";
import {
  shellState,
  workspaceFixture,
  type NativeConversationFixture,
} from "./workspace-fixture";
import { onboardingFixture } from "./onboarding-fixture";
import { newOnboardingRecord } from "../../src/onboarding/types";

test.use({ localizationMode: "real" });

const revision = "a".repeat(40);
const scroll = (page: Page) => page.locator(".transcript-scroll");
const gap = (region: Locator) =>
  region.evaluate((element) =>
    Math.max(
      0,
      element.scrollHeight - element.clientHeight - element.scrollTop,
    ),
  );
const atEnd = (region: Locator) =>
  expect.poll(() => gap(region)).toBeLessThanOrEqual(1);
async function settled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
async function move(region: Locator, top: number | "end") {
  await region.evaluate((element, top) => {
    element.scrollTop = top === "end" ? element.scrollHeight : top;
  }, top);
}
async function openChat(
  page: Page,
  onboarding = false,
  short = false,
  draft = "",
) {
  let id = "44444444-4444-4444-8444-444444444444";
  if (onboarding) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await onboardingFixture(page, {
      holdImportResponse: true,
      record: { ...newOnboardingRecord(), step: "method" },
    });
    await page.goto("/");
    await page
      .getByRole("textbox", {
        name: t("onboarding.conversation.sources"),
        exact: true,
      })
      .fill("Reading notes in Markdown files.");
    await page
      .getByRole("textbox", {
        name: t("onboarding.conversation.preferences"),
        exact: true,
      })
      .fill("Keep the existing folders.");
    await page
      .getByRole("button", {
        name: t("onboarding.conversation.start"),
        exact: true,
      })
      .click();
    const confirm = page.locator(".question-options").getByRole("button", {
      name: t("onboardingAgent.choice.confirm"),
      exact: true,
    });
    await confirm.click();
    await page.waitForFunction(
      () => typeof Reflect.get(window, "__finishImportResponse") === "function",
    );
    id = await page.evaluate(
      () =>
        Reflect.get(window, "__onboardingFixture").progress().conversationId,
    );
  } else {
    await workspaceFixture(page, shellState, {
      aiConnection: {
        provider: "custom",
        endpoint: "https://model.example.invalid/v1",
        auth: "api_key",
      },
      aiModel: "fixture-model",
      aiConversations: [
        {
          id,
          title: "Reading notes",
          draft,
          messages: Array.from({ length: short ? 1 : 18 }, (_, index) => ({
            role: "user",
            content: `Reading note ${index + 1}\nA quiet place to collect ideas.`,
            timestamp: index + 1,
          })),
        },
      ],
    });
    await page.goto("/");
    await expect(page.locator(".topic-window")).toBeVisible();
    const conversation = page.getByRole("button", {
      name: "Reading notes",
      exact: true,
    });
    if (!(await conversation.isVisible()))
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await conversation.click();
  }
  await page.evaluate(
    async ({ id, short }) => {
      const modulePath = "/src/ai/chat.ts";
      const { workspaceChat } = await import(modulePath);
      const chat = workspaceChat("garden", id);
      Reflect.set(window, "__scrollChat", chat);
      Reflect.set(window, "__scrollConversationId", id);
      chat.state.questions = [];
      chat.state.transcript = Array.from(
        { length: short ? 1 : 18 },
        (_, index) => ({
          role: "user",
          content: `Reading note ${index + 1}\nA quiet place to collect ideas.`,
          timestamp: index + 1,
        }),
      );
    },
    { id, short },
  );
  await expect(scroll(page)).toBeVisible();
  await settled(page);
  if (!onboarding) await atEnd(scroll(page));
  await move(scroll(page), "end");
  await settled(page);
}
async function append(page: Page, text = "New reading notes\n".repeat(12)) {
  await page.evaluate((text) => {
    const native = Reflect.get(
      window,
      "__nativeConversationFixture",
    ) as NativeConversationFixture;
    const id = Reflect.get(window, "__scrollConversationId") as string;
    const record = native.getRecord("garden", id);
    record.messages = [
      ...Reflect.get(window, "__scrollChat").state.transcript,
      { role: "user", content: text, timestamp: Date.now() },
    ];
    native.saveRecord("garden", record);
  }, text);
  await settled(page);
}
async function importFiles(
  page: Page,
  count = 2,
  inspectPreview?: (dialog: Locator, path: string) => Promise<void>,
) {
  const pending = new Map<string, (reply: unknown) => void>();
  await page.exposeBinding(
    "__readScrollImport",
    (_source, path: string) =>
      new Promise((resolve) => {
        pending.set(path, resolve);
      }),
  );
  await page.evaluate((count) => {
    const host = Reflect.get(window, "__TAURI_INTERNALS__");
    const original = host.invoke.bind(host);
    host.invoke = (
      command: string,
      args: { request?: { path?: string; operation?: string } },
    ) => {
      if (
        command === "files_request" &&
        args.request?.operation === "read" &&
        args.request.path?.startsWith("Imported/")
      )
        return Reflect.get(window, "__readScrollImport")(args.request.path);
      return original(command, args);
    };
    const state = Reflect.get(window, "__scrollChat").state;
    state.transcript = [
      ...state.transcript,
      {
        role: "toolResult",
        toolCallId: "import-reading",
        toolName: "create_batch",
        content: [{ type: "text", text: `Imported ${count} reading notes.` }],
        isError: false,
        timestamp: Date.now(),
        details: {
          files: Array.from({ length: count }, (_, index) => ({
            path:
              index === 0
                ? "Imported/one.md"
                : index === 1
                  ? "Imported/two.md"
                  : `Imported/${"Long-folder-name/".repeat(8)}note-${index}.md`,
            revision: "a".repeat(40),
          })),
        },
      },
    ];
  }, count);
  const disclosure = page.locator("details.call-details").last();
  await expect(disclosure).not.toHaveAttribute("open");
  await expect(page.locator(".change-path")).toHaveCount(0);
  await expect(page.locator(".change-added")).toHaveCount(0);
  expect(pending.size).toBe(0);
  await settled(page);
  await disclosure.locator("summary").focus();
  await expect(disclosure.locator("summary")).toBeFocused();
  await disclosure.locator("summary").press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(disclosure.locator(".batch-file")).toHaveCount(
    Math.min(10, count),
  );
  expect(pending.size).toBe(0);
  await expect(
    page.getByText(t("files.loadingFiles"), { exact: true }),
  ).toHaveCount(0);
  await settled(page);
  await move(scroll(page), "end");
  await settled(page);
  return async (path: string) => {
    const row = disclosure.getByRole("button", { name: path, exact: true });
    await row.focus();
    await row.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: path.split("/").at(-1),
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveText(
      t("files.loadingDocument"),
    );
    await expect.poll(() => pending.has(path)).toBe(true);
    pending.get(path)!({
      status: "ok",
      document: {
        path,
        version: {
          text: "# Reading\n\n" + "An imported reading note.\n".repeat(30),
          revision,
        },
        html: "",
        issues: [],
      },
    });
    await expect(
      page.locator(".change-path").filter({ hasText: path }),
    ).toBeVisible();
    await expect(dialog.locator(".change-added")).toBeVisible();
    await inspectPreview?.(dialog, path);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();
    await settled(page);
  };
}

for (const width of [375, 1280]) {
  test(`scroll-to-end button returns to live content at ${width}px @visual-${width < 600 ? "mobile" : "desktop"}`, async ({
    page,
    visual,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await openChat(page, false, false, "Unsent reading notes");
    const button = page.getByRole("button", {
      name: "Scroll to end",
      exact: true,
    });
    await expect(button).toBeHidden();
    await expect(scroll(page)).toHaveCSS("mask-image", "none");
    await append(page, "A reading note\n".repeat(70));
    await atEnd(scroll(page));
    await expect(button).toBeHidden();
    const composer = page.locator(".chat-composer textarea");
    await expect(composer).toHaveValue("Unsent reading notes");
    await move(scroll(page), 150);
    await settled(page);
    await expect(button).toBeVisible();
    await expect(scroll(page)).toHaveCSS("mask-image", /linear-gradient/);
    await expect(button).toHaveCSS("mask-image", "none");
    await expect(page.locator(".chat-footer")).toHaveCSS("mask-image", "none");
    const box = (await button.boundingBox())!;
    const input = (await page.locator(".chat-composer").boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(
      Math.abs(box.x + box.width - input.x - input.width),
    ).toBeLessThanOrEqual(1);
    expect(box.y + box.height).toBeLessThanOrEqual(input.y);
    await visual.capture("chat.scroll.reading");
    await page.screenshot({
      path: testInfo.outputPath("chat-scroll.reading.png"),
    });
    await append(page);
    expect(await scroll(page).evaluate((el) => el.scrollTop)).toBe(150);
    await button.focus();
    await page.keyboard.press("Enter");
    await atEnd(scroll(page));
    await expect(button).toBeHidden();
    await expect(scroll(page)).toBeFocused();
    await expect(scroll(page)).toHaveCSS("mask-image", "none");
    await expect(composer).toHaveValue("Unsent reading notes");
    await visual.capture("chat.scroll.latest");
    await append(page);
    await atEnd(scroll(page));

    await move(scroll(page), 150);
    await settled(page);
    await page.setViewportSize({ width, height: 500 });
    await expect(button).toBeInViewport();
    await button.click();
    await atEnd(scroll(page));
    await expect(button).toBeHidden();
    await expect(composer).toHaveValue("Unsent reading notes");
  });
}

test("the transcript fades without painting over its background @visual-desktop", async ({
  page,
  visual,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openChat(page);
  await move(scroll(page), 150);
  const controls = page.locator(".chat-scroll-controls");
  await expect(controls.getByRole("button")).toBeVisible();
  const mask = await scroll(page).evaluate(
    (element) => getComputedStyle(element).maskImage,
  );
  expect(mask).toContain("linear-gradient");
  expect(mask).toContain("8px");
  expect(
    await controls.evaluate(
      (element) => getComputedStyle(element, "::before").content,
    ),
  ).toBe("none");
  for (const [name, background] of [
    ["light", "#fffdf9"],
    ["colored", "#d8cdf2"],
    ["gradient", "linear-gradient(120deg, #d8cdf2, #c8d9f4)"],
  ] as const) {
    await page.locator(".empty-chat").evaluate((element, background) => {
      (element as HTMLElement).style.background = background;
    }, background);
    await expect(scroll(page)).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(scroll(page)).toHaveCSS("mask-image", mask);
    await visual.capture(`chat.scroll.background-${name}`);
  }
  await page.emulateMedia({ forcedColors: "active" });
  await expect(scroll(page)).toHaveCSS("mask-image", "none");
  await expect(controls.getByRole("button")).toBeVisible();
});

test("the scroll-to-end button works in the onboarding conversation", async ({
  page,
}) => {
  await openChat(page, true);
  await move(scroll(page), 150);
  await settled(page);
  const button = page.getByRole("button", {
    name: "Scroll to end",
    exact: true,
  });
  await expect(button).toBeVisible();
  await button.click();
  await atEnd(scroll(page));
  await expect(button).toBeHidden();
});

for (const onboarding of [false, true]) {
  test(`opens individual imported files with the keyboard in ${onboarding ? "onboarding" : "ordinary chat"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1040, height: 760 });
    await openChat(page, onboarding);
    const release = await importFiles(page);
    await atEnd(scroll(page));
    await release("Imported/one.md");
    await atEnd(scroll(page));
    await release("Imported/two.md");
    await atEnd(scroll(page));
  });
}

for (const width of [1040, 375]) {
  test(`large import lists and individual previews stay within a ${width}px viewport`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 760 });
    await openChat(page);
    const release = await importFiles(page, 108, async (dialog, path) => {
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.height).toBeLessThanOrEqual(760);
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          path.length > 40
            ? "import-file-preview-long-path.png"
            : "import-file-preview.png",
        ),
      });
    });
    const card = page.locator(".tool-card").last();
    await expect(card.locator(".batch-file")).toHaveCount(10);
    await expect(card.locator(".tool-content")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("import-file-list.png"),
    });
    expect(
      await card.evaluate((element) =>
        Array.from(element.querySelectorAll("*"))
          .filter((child) => child.scrollWidth > child.clientWidth + 1)
          .map((child) => ({
            tag: child.tagName,
            class: child.className,
            width: child.clientWidth,
            scroll: child.scrollWidth,
          })),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await card.locator(".batch-more").click();
    await expect(card.locator(".batch-file")).toHaveCount(20);
    await card.locator("summary").first().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("import-file-list.png"),
    });
    await release("Imported/one.md");
    await release(`Imported/${"Long-folder-name/".repeat(8)}note-2.md`);
    await expect(card.locator(".batch-file")).toHaveCount(20);
    await expect(page.locator(".change-added")).toHaveCount(0);
  });
}

test("reading older messages with an expanded import survives completion; returning to the end resumes following", async ({
  page,
}) => {
  await openChat(page);
  await importFiles(page);
  await atEnd(scroll(page));
  await move(scroll(page), 150);
  await settled(page);
  await page.evaluate(() => {
    Reflect.get(window, "__scrollChat").state.running = false;
  });
  await append(page);
  expect(await scroll(page).evaluate((element) => element.scrollTop)).toBe(150);
  await move(scroll(page), "end");
  await settled(page);
  await append(page);
  await atEnd(scroll(page));
});

test("follows a short conversation as it overflows and retains the end through viewport and composer resizing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 760 });
  await openChat(page, false, true);
  expect(await gap(scroll(page))).toBe(0);
  await append(page, "A reading note\n".repeat(70));
  await atEnd(scroll(page));
  await page.setViewportSize({ width: 700, height: 500 });
  await atEnd(scroll(page));
  const draft = "Unsent reading notes\n".repeat(6);
  await page.locator(".chat-composer textarea").fill(draft);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const native = Reflect.get(
          window,
          "__nativeConversationFixture",
        ) as NativeConversationFixture;
        return native.getRecord(
          "garden",
          Reflect.get(window, "__scrollConversationId") as string,
        ).draft;
      }),
    )
    .toBe(draft);
  await expect(page.locator(".messages > .message")).toHaveCount(2);
  await atEnd(scroll(page));
  await move(scroll(page), 200);
  await settled(page);
  await page.setViewportSize({ width: 700, height: 700 });
  await settled(page);
  expect(await scroll(page).evaluate((element) => element.scrollTop)).toBe(200);
  expect(await gap(scroll(page))).toBeGreaterThan(48);
});

test("narrowing a pane preserves the visible message while earlier messages reflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 760 });
  await openChat(page);
  const message = page.locator(".messages > .message").nth(7);
  await scroll(page).evaluate(
    (element, top) => {
      element.scrollTop = top;
    },
    await message.evaluate((element) => (element as HTMLElement).offsetTop),
  );
  await settled(page);
  const offset = () =>
    message.evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        element.closest(".transcript-scroll")!.getBoundingClientRect().top,
    );
  const before = await offset();
  await page.setViewportSize({ width: 320, height: 760 });
  await settled(page);
  expect(await offset()).toBeCloseTo(before, 0);
  expect(await gap(scroll(page))).toBeGreaterThan(48);
});

test("sending resumes following, but typing and queueing during a response do not", async ({
  page,
}) => {
  await openChat(page);
  await move(scroll(page), 150);
  await settled(page);
  const composer = page.locator(".chat-composer textarea");
  await composer.fill("Keep the reading corner.");
  await settled(page);
  expect(await scroll(page).evaluate((element) => element.scrollTop)).toBe(150);
  await composer.press("Enter");
  await atEnd(scroll(page));
  await expect(
    page.getByRole("button", { name: "Stop response", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(async () => {
    const fixture = Reflect.get(
      window,
      "__nativeConversationFixture",
    ) as NativeConversationFixture;
    const admitted = fixture.requests().at(-1)!;
    await fixture.accept(
      admitted.scope,
      admitted.conversation,
      "scroll-active-response",
      {
        version: 1,
        type: "submit",
        input: {
          text: "Continue the reading notes.",
          attachments: [],
          references: [],
        },
        timestamp: Date.now(),
      },
    );
  });
  await expect(
    page.getByRole("button", { name: "Stop response", exact: true }),
  ).toBeVisible();
  await move(scroll(page), 150);
  await settled(page);
  await composer.fill("Consider the herbs later.");
  await composer.press("Alt+Enter");
  await expect(page.locator(".pending")).toBeVisible();
  await expect(page.locator(".pending")).toContainText(
    "Consider the herbs later.",
  );
  await settled(page);
  expect(await scroll(page).evaluate((element) => element.scrollTop)).toBe(150);
});

test("opening tool details keeps the summary in place until the reader returns to the end", async ({
  page,
}) => {
  await openChat(page);
  await page.evaluate(() => {
    const state = Reflect.get(window, "__scrollChat").state;
    state.transcript = [
      ...state.transcript,
      {
        role: "toolResult",
        toolCallId: "read-notes",
        toolName: "read",
        content: [{ type: "text", text: "Reading notes\n".repeat(80) }],
        isError: false,
        timestamp: Date.now(),
      },
    ];
  });
  await atEnd(scroll(page));
  await page.locator(".work-history-toggle").click();
  const activity = page.locator(".history-tools > summary");
  await activity.click();
  await settled(page);
  const summary = page.locator(".call-details > summary");
  await summary.scrollIntoViewIfNeeded();
  await move(scroll(page), "end");
  await settled(page);
  const before = (await summary.boundingBox())!.y;
  await summary.press("Enter");
  await expect(page.locator(".call-details")).toHaveAttribute("open", "");
  await settled(page);
  expect((await summary.boundingBox())!.y).toBeCloseTo(before, 0);
  await append(page);
  expect((await summary.boundingBox())!.y).toBeCloseTo(before, 0);
  await move(scroll(page), "end");
  await settled(page);
  await append(page);
  await atEnd(scroll(page));
});

for (const width of [375, 1280]) {
  test(`work history keeps details secondary and ordinary text visible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openChat(page, false, true);
    await page.evaluate(() => {
      Reflect.get(window, "__scrollChat").state.transcript = [
        {
          role: "assistant",
          timestamp: 1,
          content: [
            { type: "toolCall", id: "first", name: "read", arguments: {} },
            { type: "thinking", thinking: "Review the reading notes." },
            { type: "thinking", thinking: "Compare the next steps." },
            { type: "text", text: "The notes are ready." },
            { type: "toolCall", id: "second", name: "read", arguments: {} },
            { type: "text", text: "" },
            { type: "thinking", thinking: "" },
            { type: "toolCall", id: "third", name: "read", arguments: {} },
          ],
        },
      ];
    });
    const histories = page.locator(".work-history-toggle");
    await expect(histories).toHaveCount(2);
    await expect(page.locator(".history-reasoning:visible")).toHaveCount(0);
    await expect(
      page.getByText("The notes are ready.", { exact: true }),
    ).toBeVisible();
    await histories.first().click();
    await expect(page.locator(".history-reasoning:visible")).toHaveCount(2);
    const reasoningSize = await page
      .locator(".history-reasoning")
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    const answerSize = await page
      .locator(".message.assistant")
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(reasoningSize).toBeLessThan(answerSize);
    await page.locator(".history-tools > summary").first().click();
    await expect(page.locator(".history-tools").first()).toHaveAttribute(
      "open",
      "",
    );
    await expect(histories.first()).toHaveAttribute("aria-expanded", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("reopening restores the saved reading position rather than jumping to the end", async ({
  page,
}) => {
  await openChat(page);
  await move(scroll(page), 150);
  await expect
    .poll(async () =>
      JSON.stringify(
        (await page.evaluate(() => window.__layoutTest.stored("garden"))).data,
      ),
    )
    .toContain('"scrollTop":150');
  await page.reload();
  await expect(page.locator(".messages > .message")).toHaveCount(18);
  await expect
    .poll(() => scroll(page).evaluate((element) => element.scrollTop))
    .toBe(150);
  await settled(page);
  expect(await gap(scroll(page))).toBeGreaterThan(48);
});
