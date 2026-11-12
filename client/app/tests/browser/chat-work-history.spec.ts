import { expect, test, type Page } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";
import { de, t } from "@situate/localization";
import type { AssistantMessage } from "../../src/ai/contracts";

const assistant = (
  content: AssistantMessage["content"],
  timestamp: number,
) => ({
  role: "assistant" as const,
  content,
  timestamp,
  stopReason: "stop" as const,
  usage: null,
});
const result = (id: string, name: string, timestamp: number, details = {}) => ({
  role: "toolResult" as const,
  toolCallId: id,
  toolName: name,
  timestamp,
  isError: false,
  content: [{ type: "text" as const, text: "Recorded tool result." }],
  details,
});
const id = "44444444-4444-4444-8444-444444444444";
const messages = [
  {
    role: "user" as const,
    content: "Make a short plan for our reading evening. Start at 7 pm.",
    timestamp: 1,
  },
  assistant(
    [
      {
        type: "thinking",
        thinking:
          "### Keep the evening open\n\nReview the previous plan and leave time for conversation.",
      },
      {
        type: "text",
        text: "I’ll check the previous plan.",
        textSignature: '{"v":1,"id":"progress","phase":"commentary"}',
      },
      {
        type: "toolCall",
        id: "first",
        name: "read",
        arguments: { path: "Reading evenings.md" },
      },
    ],
    2,
  ),
  result("first", "read", 3),
  assistant(
    [
      {
        type: "toolCall",
        id: "second",
        name: "read",
        arguments: { path: "Reading evenings.md", offset: 100 },
      },
    ],
    4,
  ),
  result("second", "read", 5),
  assistant(
    [
      {
        type: "toolCall",
        id: "books",
        name: "books_search",
        arguments: { query: "The Lantern Orchard" },
      },
    ],
    6,
  ),
  result("books", "books_search", 7),
  assistant(
    [
      {
        type: "toolCall",
        id: "edit",
        name: "edit",
        arguments: { path: "Reading evenings.md" },
      },
    ],
    8,
  ),
  result("edit", "edit", 9, {
    change: {
      path: "Reading evenings.md",
      before: "18:30 — Arrive and settle in.",
      after: "19:00 — Arrive and settle in.",
      beforeRevision: "a".repeat(40),
      afterRevision: "b".repeat(40),
    },
  }),
  assistant(
    [
      {
        type: "text",
        text: "Here’s a light plan for your reading evening:\n\n- **7:00 pm** — Arrive and settle in.\n- **7:05 pm** — Share favourite passages.\n- **7:25 pm onwards** — Open conversation.\n\nNo invitations have been sent.",
        textSignature: '{"v":1,"id":"answer","phase":"final_answer"}',
      },
    ],
    10,
  ),
];
function answerReady(long = false) {
  const thought = (text: string) => ({
    type: "thinking" as const,
    thinking: text,
  });
  const progress = (text: string) => ({
    type: "text" as const,
    text,
    textSignature: '{"v":1,"id":"progress","phase":"commentary"}',
  });
  const call = (id: string, name: string, args: Record<string, string>) => ({
    type: "toolCall" as const,
    id,
    name,
    arguments: args,
  });
  const toolResult = (
    id: string,
    name: string,
    text: string,
    timestamp: number,
  ) => ({
    ...result(id, name, timestamp),
    content: [{ type: "text" as const, text }],
  });
  return [
    {
      role: "user" as const,
      content:
        "Make a short plan for our reading evening. Keep time for conversation and start at 7 pm.",
      timestamp: 1,
    },
    assistant(
      [
        thought(
          long
            ? "### Preserve the open conversation\nThe start time changes, not the character of the evening. I should keep **room for conversation**.\n\n- Check the previous plan.\n- Keep the selected chapters: *1–4*.\n- Start at **7 pm**.\n\n> Leave time for conversation.\n\nThe note `Reading evening.md` can hold a short schedule. Sending invitations is a separate action."
            : "The previous plan may contain a different start time. I should check it before proposing a schedule.",
        ),
        progress(
          "I’ll check the previous plan and the selected book, then put together a short schedule.",
        ),
        call("search", "grep", { query: "reading evening" }),
      ],
      2,
    ),
    toolResult(
      "search",
      "grep",
      "Reading evenings.md: Start at 18:30.\nReading notes.md: The Lantern Orchard — chapters 1–4.",
      3,
    ),
    assistant(
      [
        thought(
          "The selected chapters are **1–4**. I’ll compare the previous start time with the requested **7 pm**.",
        ),
        call("plan", "read", { path: "Reading evenings.md" }),
        call("notes", "read", { path: "Reading notes.md" }),
      ],
      4,
    ),
    toolResult(
      "plan",
      "read",
      "Start at 18:30. Share passages, then leave time for conversation.",
      5,
    ),
    toolResult(
      "notes",
      "read",
      "Keep the introduction brief. Leave the rest of the evening open.",
      6,
    ),
    assistant(
      [
        thought(
          long
            ? "### Check the timing\nA five-minute introduction and twenty minutes of shared passages leave the rest of the evening open.\n\n1. Arrive at 7 pm.\n2. Share favourite passages.\n3. Leave time for conversation.\n\n```text\n19:00  Arrive and settle in\n19:05  Share favourite passages\n19:25  Open conversation\n```\n\nNo invitation needs to be sent to prepare this plan."
            : "A **five-minute introduction** and **twenty minutes of passages** leave the rest of the evening open.",
        ),
        progress(
          "The old start time was 6:30 pm. I’m moving the proposed schedule to 7 pm and keeping the rest of the evening open.",
        ),
        {
          type: "text",
          text: "Here’s a light plan for your reading evening:\n\n- **7:00 pm** — Arrive and settle in.\n- **7:05 pm** — Share favourite passages from chapters 1–4.\n- **7:25 pm onwards** — Open conversation.\n\nThe start is half an hour later than last time. No invitations have been sent.",
          textSignature: '{"v":1,"id":"answer","phase":"final_answer"}',
        },
      ],
      7,
    ),
  ];
}

async function showConversation(page: Page, language: "en" | "de" = "en") {
  await page.goto("/");
  await expect(page.locator(".topic-window")).toBeVisible();
  const conversation = page.getByRole("button", {
    name: "Reading evening",
    exact: true,
  });
  if (!(await conversation.isVisible()))
    await page
      .getByRole("button", {
        name:
          language === "de"
            ? de["navigation.openNavigation"]
            : t("navigation.openNavigation"),
        exact: true,
      })
      .click();
  await conversation.click();
  await expect(page.locator(".messages")).toBeVisible();
}

test.use({ localizationMode: "real" });
for (const width of [1280, 390]) {
  test(
    `chronological work history keeps the answer and saved change visible at ${width}px`,
    { tag: width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await workspaceFixture(
        page,
        { ...shellState, mobile: width < 600 },
        {
          aiConversations: [
            {
              id,
              title: "Reading evening",
              draft: "Keep this unsent draft",
              messages,
              runtime: {
                draftAttachments: [],
                pending: [],
                runs: [],
                events: [
                  {
                    id: "books",
                    runId: "run",
                    sequence: 1,
                    type: "tool_intent",
                    data: {
                      name: "books_search",
                      args: { query: "The Lantern Orchard" },
                      messageIndex: 5,
                      pluginId: "books",
                      pluginName: "Book shelf",
                    },
                  },
                  {
                    id: "books-result",
                    runId: "run",
                    sequence: 2,
                    type: "tool_execution_end",
                    data: { toolCallId: "books", isError: false },
                  },
                  {
                    id: "work",
                    runId: "run",
                    sequence: 3,
                    type: "work_block_end",
                    data: {
                      startMessageCount: 0,
                      messageCount: messages.length,
                      durationMs: 103000,
                      outcome: "complete",
                    },
                  },
                ],
              },
            },
          ],
        },
      );
      await showConversation(page);
      const toggle = page.locator(".work-history-toggle");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toContainText(
        t("chat.workDuration", {
          duration: t("chat.durationMinutesSeconds", {
            minutes: "1",
            seconds: "43",
          }),
        }),
      );
      await expect(page.locator(".history-reasoning")).toBeHidden();
      await expect(
        page.getByText("I’ll check the previous plan.", { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".change-card")).toBeVisible();
      await expect(
        page.getByText("No invitations have been sent.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(
          ".work-history-heading .plugin-name, .response-stopped, .reasoning",
        ),
      ).toHaveCount(0);
      await visual.capture("chat.work-history.closed");
      await toggle.scrollIntoViewIfNeeded();
      const historyTop = (await toggle.boundingBox())!.y;
      await toggle.focus();
      await toggle.press("Enter");
      await expect
        .poll(async () => (await toggle.boundingBox())!.y)
        .toBeCloseTo(historyTop, 0);
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".history-reasoning h3")).toHaveText(
        "Keep the evening open",
      );
      const groups = page.locator("details.history-tools");
      await expect(groups).toHaveCount(2);
      await expect(groups.first().locator(":scope > summary")).toHaveText(
        t("chat.historyReadFile"),
      );
      await visual.capture("chat.work-history.open");
      await groups.first().locator(":scope > summary").click();
      await expect(
        groups.first().locator(".call-details > summary").first(),
      ).toContainText("Reading evenings.md");
      await groups.last().locator(":scope > summary").click();
      await expect(page.locator(".plugin-name")).toContainText("Book shelf");
      await expect(
        page.locator(".plugin-name").locator(".."),
      ).not.toHaveAttribute("open");
      await groups.first().locator(".call-details > summary").first().click();
      await expect(
        groups.first().locator(".tool-identifier").first(),
      ).toHaveText("read");
      await visual.capture("chat.work-history.call-details");
      await toggle.click();
      await expect(page.locator(".plugin-name")).toBeHidden();
      await expect(
        page.getByRole("textbox", {
          name: t("navigation.message"),
          exact: true,
        }),
      ).toHaveValue("Keep this unsent draft");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    },
  );
}

for (const width of [1040, 390]) {
  for (const long of [false, true]) {
    test(
      `answer-ready ${long ? "long" : "standard"} history at ${width}px`,
      { tag: width < 600 ? "@visual-mobile" : "@visual-desktop" },
      async ({ page, visual }) => {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
        const ready = answerReady(long);
        await workspaceFixture(
          page,
          { ...shellState, mobile: width < 600 },
          {
            aiConversations: [
              {
                id,
                title: "Reading evening",
                draft: "",
                messages: ready,
                runtime: {
                  draftAttachments: [],
                  pending: [],
                  runs: [],
                  events: [
                    {
                      id: "work",
                      runId: "run",
                      sequence: 1,
                      type: "work_block_end",
                      data: {
                        startMessageCount: 0,
                        messageCount: ready.length,
                        durationMs: 103000,
                        outcome: "complete",
                      },
                    },
                  ],
                },
              },
            ],
          },
        );
        await showConversation(page);
        const state = `chat.answer-ready.${long ? "long" : "standard"}`;
        const toggle = page.locator(".work-history-toggle");
        const answer = page
          .locator(".message.assistant")
          .filter({ hasText: "Here’s a light plan" });
        await expect(answer).toContainText("Here’s a light plan");
        await expect(answer).toBeVisible();
        await expect(page.locator(".duration")).toHaveCount(1);
        await expect(toggle.locator(".duration")).toContainText("1 min 43 sec");
        await visual.capture(`${state}.closed`);
        await toggle.scrollIntoViewIfNeeded();
        await toggle.focus();
        await toggle.press("Space");
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        const reasoning = page.locator(".history-reasoning");
        await expect(reasoning).toHaveCount(3);
        const paragraph = reasoning.first().locator("p").first();
        await expect(paragraph).toHaveCSS("font-size", "13px");
        await expect(paragraph).toHaveCSS("line-height", "22.1px");
        await expect(paragraph).toHaveCSS("font-weight", "400");
        if (long) {
          await expect(reasoning.first().locator("h3")).toHaveCSS(
            "font-size",
            "13px",
          );
          await expect(reasoning.first().locator("h3")).toHaveCSS(
            "font-weight",
            "500",
          );
          await expect(reasoning.last().locator("pre")).toContainText("19:25");
        } else {
          expect((await reasoning.first().boundingBox())!.height).toBeLessThan(
            width < 600 ? 100 : 60,
          );
        }
        await visual.capture(`${state}.open`);
        const groups = page.locator(".history-tools");
        await expect(groups).toHaveCount(2);
        for (const group of await groups.all()) {
          const summary = group.locator(":scope > summary");
          const label = summary.locator("span").first();
          const chevron = summary.locator(".history-chevron");
          expect(
            (await chevron.boundingBox())!.x -
              ((await label.boundingBox())!.x +
                (await label.boundingBox())!.width),
          ).toBeLessThan(16);
          await summary.focus();
          await summary.press("Enter");
          await expect(group).toHaveAttribute("open", "");
        }
        await visual.capture(`${state}.groups`);
        const calls = page.locator(".history-tools .call-details");
        await expect(calls).toHaveCount(3);
        for (const call of await calls.all()) {
          await call.locator(":scope > summary").click();
          await expect(call).toHaveAttribute("open", "");
          await expect(call.locator(".tool-content")).toBeVisible();
          await expect(call.locator(".tool-name")).toHaveCSS(
            "font-family",
            await paragraph.evaluate((el) => getComputedStyle(el).fontFamily),
          );
        }
        await calls.last().scrollIntoViewIfNeeded();
        await visual.capture(`${state}.details`);
        await toggle.click();
        await expect(answer).toBeVisible();
        await toggle.click();
        await expect(calls.last()).toHaveAttribute("open", "");
        expect(
          await page
            .locator(".transcript-scroll")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      },
    );
  }
}

for (const width of [1280, 390]) {
  test(
    `question context stays visible with folded work history at ${width}px`,
    { tag: width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      const ready = answerReady();
      const question = {
        id: "save-plan",
        prompt: "Shall I save this reading plan?",
        timestamp: 11,
        suggestions: [
          { id: "save", label: "Save the plan" },
          { id: "discuss", label: "Discuss changes" },
        ],
      };
      const decision = assistant(
        [
          {
            type: "thinking",
            thinking: "Check the start time before offering to save the plan.",
          },
          {
            type: "text",
            text: "Here’s the proposed reading plan:\n\n- **7:00 pm** — Arrive and settle in.\n- **7:05 pm** — Share favourite passages.\n\nThe rest of the evening stays open for conversation. No invitations have been sent.",
            textSignature: '{"v":1,"id":"decision","phase":"commentary"}',
          },
          {
            type: "toolCall",
            id: "check-plan",
            name: "read",
            arguments: { path: "Reading evenings.md" },
          },
        ],
        7,
      );
      const transcript = [
        ...ready.slice(0, -1),
        decision,
        result("check-plan", "read", 8),
        assistant(
          [
            {
              type: "toolCall",
              id: "question",
              name: "ask_question",
              arguments: question,
            },
          ],
          9,
        ),
      ];
      await workspaceFixture(
        page,
        { ...shellState, mobile: width < 600 },
        {
          aiConversations: [
            {
              id,
              title: "Reading evening",
              draft: "Keep this unsent draft",
              messages: transcript,
              runtime: {
                draftAttachments: [],
                pending: [],
                runs: [],
                events: [
                  {
                    id: "work",
                    runId: "run",
                    sequence: 1,
                    type: "work_block_end",
                    data: {
                      startMessageCount: 0,
                      messageCount: transcript.length,
                      durationMs: 44000,
                      outcome: "complete",
                    },
                  },
                  {
                    id: "question-event",
                    runId: "run",
                    sequence: 2,
                    type: "question_presented",
                    data: question,
                  },
                ],
              },
            },
          ],
        },
      );
      await showConversation(page);
      const answer = page
        .locator(".message.assistant")
        .filter({ hasText: "Here’s the proposed reading plan:" });
      await expect(answer).toContainText("Here’s the proposed reading plan:");
      await expect(answer).toBeVisible();
      await expect(page.locator(".history-reasoning").last()).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Save the plan", exact: true }),
      ).toBeVisible();
      await visual.capture("chat.work-history.question-context");
      const toggle = page.locator(".work-history-toggle");
      await toggle.click();
      await toggle.click();
      await expect(answer).toBeVisible();
      await page.reload();
      await showConversation(page);
      await expect(answer).toBeVisible();
      await expect(page.locator(".work-history-toggle")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(
        page.locator(".work-history-heading .duration"),
      ).toContainText("44 sec");
    },
  );
}

test.describe("German work history", () => {
  test.use({ locale: "de-DE" });
  test(
    "long results wrap inside nested details",
    { tag: "@visual-mobile" },
    async ({ page, visual }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const ready = answerReady(true);
      const lastRead = ready.find(
        (message) =>
          message.role === "toolResult" && message.toolCallId === "notes",
      );
      if (!lastRead || lastRead.role !== "toolResult")
        throw new Error("Missing reading result");
      lastRead.content = [
        {
          type: "text",
          text:
            "Keep the introduction brief. Leave the rest of the evening open.\n".repeat(
              30,
            ) + "Reading-notes-".repeat(30),
        },
      ];
      await workspaceFixture(
        page,
        { ...shellState, mobile: true },
        {
          localization: {
            language: "de",
            formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
            writable: true,
          },
          aiConversations: [
            {
              id,
              title: "Reading evening",
              draft: "",
              messages: ready,
              runtime: {
                draftAttachments: [],
                pending: [],
                runs: [],
                events: [
                  {
                    id: "work",
                    runId: "run",
                    sequence: 1,
                    type: "work_block_end",
                    data: {
                      startMessageCount: 0,
                      messageCount: ready.length,
                      durationMs: 103000,
                      outcome: "complete",
                    },
                  },
                ],
              },
            },
          ],
        },
      );
      await showConversation(page, "de");
      const toggle = page.locator(".work-history-toggle");
      await expect(toggle).toContainText("1 Min. 43 Sek. gearbeitet");
      await toggle.click();
      const group = page.locator(".history-tools").last();
      await expect(group.locator(":scope > summary")).toHaveText(
        "2 Dateien gelesen",
      );
      await group.locator(":scope > summary").click();
      const call = group.locator(".call-details").last();
      await call.locator(":scope > summary").click();
      const result = call.locator(".tool-content pre").last();
      await expect(result).toContainText("Reading-notes-");
      expect(
        await result.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(
        await result.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
      ).toBe(true);
      await call.locator(":scope > summary").scrollIntoViewIfNeeded();
      await visual.capture("chat.work-history.long-result");
      await result.evaluate((el) => el.scrollIntoView({ block: "end" }));
      await visual.capture("chat.work-history.long-result-end");
      await page.setViewportSize({ width: 320, height: 700 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .locator(".transcript-scroll")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    },
  );
});

test("the session clock survives navigation and stops without an extra interruption banner", async ({
  page,
}) => {
  await page.clock.install();
  await workspaceFixture(page, shellState, {
    aiHoldResponse: true,
    aiConnection: {
      provider: "custom",
      endpoint: "https://model.example.invalid/v1",
      auth: "api_key",
    },
    aiModel: "fixture-model",
  });
  await page.goto("/");
  const message = page.getByRole("textbox", {
    name: t("navigation.message"),
    exact: true,
  });
  await message.fill("Prepare a short plan.");
  await page
    .getByRole("button", { name: t("navigation.sendMessage"), exact: true })
    .click();
  const timer = page.getByRole("timer", { name: t("chat.elapsedWorkTime") });
  await expect(timer).toBeVisible();
  const before = await timer.innerText();
  await page
    .getByRole("button", { name: t("navigation.files"), exact: true })
    .click();
  await expect(timer).toHaveCount(0);
  await page.clock.fastForward(3000);
  await page.locator(".conversation-title").first().click();
  await expect(timer).toBeVisible();
  await expect
    .poll(async () => {
      const time = (await timer.innerText()).split(":").map(Number);
      const previous = before.split(":").map(Number);
      return time[0] * 60 + time[1] - previous[0] * 60 - previous[1];
    })
    .toBeGreaterThanOrEqual(3);
  await message.fill("Keep my draft");
  await page
    .getByRole("button", { name: t("navigation.stopResponse"), exact: true })
    .click();
  await page.waitForFunction(
    () => typeof Reflect.get(window, "__finishResponse") === "function",
  );
  await page.evaluate(() => Reflect.get(window, "__finishResponse")());
  await expect(timer).toHaveCount(0);
  await expect(page.locator(".work-history-heading")).toContainText(
    t("chat.workStopped", { duration: "" }).split("·")[0].trim(),
  );
  await expect(
    page.locator(".response-stopped, .chat-footer [role=alert]"),
  ).toHaveCount(0);
  await expect(message).toHaveValue("Keep my draft");
});
